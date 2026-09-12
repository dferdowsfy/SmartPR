// Compute regulatory impact: deterministically match an event against the
// workspace's obligations / businesses / facilities / projects and upsert
// regulatory_impacts rows (idempotent; reviewer ack/implementation progress
// is preserved across re-runs).
//
// CRITICAL LIFECYCLE RULE (enforced here):
// - lifecycle != 'effective' -> rows are written with applicability='projected'
//   and obligation_work is NEVER touched (no remediation before a change is
//   actually effective).
// - lifecycle == 'effective' -> applicability='confirmed' and the affected
//   obligations get remediation obligation_work rows (re-opened to
//   in_progress with a note referencing the event).
//
// Impact matching heuristic (deterministic, explainable):
//   1. Reviewer-explicit picks (targeting.obligation_ids / business_ids /
//      facility_ids) always match — they bypass tag filters.
//   2. Tag matching: every SPECIFIED tag group (agency_names, municipalities,
//      business_types, industries, requirement_names) must match, OR within a
//      group. Each row stores match_basis explaining exactly what matched.
//   3. When the event carries no targeting but is linked to a KG detection
//      (change_event_id), agency/municipality/business_type tags are derived
//      from the linked requirement_rule as a fallback.

import type { PoolClient } from "pg";
import { getPool } from "../../../../../../graph/db";
import {
  sanitizeTargeting,
  matchObligation,
  matchFacility,
  requiredActionForObligation,
  requiredActionForBusiness,
  requiredActionForFacility,
  requiredActionForProject,
  impactMatchKey,
  mayTriggerRemediation,
  applicabilityFor,
  normalizeTag,
  type TargetingSpec,
  type ObligationCandidate,
  type EventBrief,
  type RegulatoryLifecycle,
  type ImpactApplicability,
} from "../../../../../../../lib/enterprise-regulatory";
import {
  gateRequest,
  isUuid,
  readJsonBody,
  resolveWorkspaceId,
  ensureDatabase,
  noDatabase,
  withTx,
  auditInTx,
} from "../../../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ImpactRow {
  match_key: string;
  obligation_id: string | null;
  business_id: string | null;
  facility_id: string | null;
  matter_id: string | null;
  required_action: string;
  applicability: ImpactApplicability;
  match_basis: string;
}

interface Candidate {
  obligation_id: string;
  obligation_name: string;
  agency: string | null;
  requirement_id: string | null;
  matter_id: string | null;
  business_id: string;
  business_name: string;
  business_type: string | null;
  industry: string | null;
  municipality: string | null;
}

async function deriveTargetingFromChangeEvent(
  client: PoolClient,
  changeEventId: string
): Promise<{ targeting: TargetingSpec; found: boolean }> {
  const { rows } = await client.query(
    `SELECT rr.agency_name, rr.municipality, rr.business_type, rr.activity_type
       FROM requirement_change_events rce
       LEFT JOIN requirement_rules rr ON rr.id = rce.rule_id
      WHERE rce.id = $1
      LIMIT 1`,
    [changeEventId]
  );
  if (rows.length === 0) return { targeting: {}, found: false };
  const r = rows[0] as Record<string, string | null>;
  const targeting: TargetingSpec = {};
  if (r.agency_name) targeting.agency_names = [r.agency_name];
  if (r.municipality) targeting.municipalities = [r.municipality];
  if (r.business_type) targeting.business_types = [r.business_type];
  return { targeting, found: true };
}

function targetingIsEmpty(t: TargetingSpec): boolean {
  return (
    !t.obligation_ids?.length &&
    !t.business_ids?.length &&
    !t.facility_ids?.length &&
    !t.agency_names?.length &&
    !t.municipalities?.length &&
    !t.business_types?.length &&
    !t.industries?.length &&
    !t.requirement_names?.length
  );
}

async function upsertImpactRows(
  client: PoolClient,
  eventId: string,
  workspaceId: string,
  rows: ImpactRow[]
): Promise<number> {
  if (rows.length === 0) return 0;
  const cols =
    `(event_id, workspace_id, match_key, obligation_id, business_id, facility_id, matter_id, required_action, applicability, match_basis)`;
  const values: string[] = [];
  const params: unknown[] = [];
  rows.forEach((r, i) => {
    const base = i * 10;
    values.push(
      `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},$${base + 10})`
    );
    params.push(
      eventId,
      workspaceId,
      r.match_key,
      r.obligation_id,
      r.business_id,
      r.facility_id,
      r.matter_id,
      r.required_action,
      r.applicability,
      r.match_basis
    );
  });
  // Idempotent: re-running recomputes applicability/required_action/match_basis
  // but NEVER resets reviewer ack_status or implementation_status.
  // Uniqueness is per (event_id, workspace_id, match_key) so one workspace's
  // recompute can never touch another workspace's rows.
  const { rowCount } = await client.query(
    `INSERT INTO regulatory_impacts ${cols}
     VALUES ${values.join(",")}
     ON CONFLICT (event_id, workspace_id, match_key) DO UPDATE SET
       obligation_id = EXCLUDED.obligation_id,
       business_id = EXCLUDED.business_id,
       facility_id = EXCLUDED.facility_id,
       matter_id = EXCLUDED.matter_id,
       required_action = EXCLUDED.required_action,
       applicability = EXCLUDED.applicability,
       match_basis = EXCLUDED.match_basis,
       updated_at = now()`,
    params
  );
  return rowCount ?? 0;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const body = await readJsonBody(req);
  const ws = resolveWorkspaceId(req, body);
  if (!ws) return Response.json({ error: "workspace_required" }, { status: 400 });
  const gated = await gateRequest(req, "manage_exceptions", ws);
  if ("response" in gated) return gated.response;
  const { gate, meta } = gated;
  if (!ensureDatabase()) return noDatabase();

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "invalid_event_id" }, { status: 400 });
  }

  const actionOverride =
    typeof body.required_action === "string" && body.required_action.trim()
      ? body.required_action.trim().slice(0, 4000)
      : null;

  try {
    const result = await withTx(async (client) => {
      // --- load event (tenant-scoped: own workspace or global) ---
      const { rows: events } = await client.query(
        `SELECT id, title, lifecycle, regulatory_source, source_version,
                effective_date, change_event_id, targeting
           FROM regulatory_events re
          WHERE re.id = $1 AND (re.workspace_id = $2 OR re.workspace_id IS NULL)
          LIMIT 1`,
        [id, ws]
      );
      if (events.length === 0) {
        throw Object.assign(new Error("event_not_found"), { status: 404 });
      }
      const event = events[0] as {
        id: string;
        title: string;
        lifecycle: RegulatoryLifecycle;
        regulatory_source: string;
        source_version: string | null;
        effective_date: string | null;
        change_event_id: string | null;
        targeting: unknown;
      };

      // --- effective targeting ---
      let targeting = sanitizeTargeting(event.targeting);
      let targetingSource: "event" | "change_event" | "none" = "event";
      if (targetingIsEmpty(targeting)) {
        if (event.change_event_id) {
          const derived = await deriveTargetingFromChangeEvent(client, event.change_event_id);
          targeting = derived.targeting;
          targetingSource = derived.found ? "change_event" : "none";
        } else {
          targetingSource = "none";
        }
      }

      const brief: EventBrief = {
        title: event.title,
        regulatory_source: event.regulatory_source,
        source_version: event.source_version,
        lifecycle: event.lifecycle,
        effective_date: event.effective_date,
      };
      const applicability = applicabilityFor(event.lifecycle);
      const actionFor = (s: string) => actionOverride ?? s;

      // --- candidates ---
      const { rows: obligationRows } = await client.query(
        `SELECT o.id AS obligation_id, o.name AS obligation_name, o.agency,
                o.requirement_id, o.matter_id,
                b.id AS business_id, b.name AS business_name,
                b.business_type, b.industry, b.municipality
           FROM obligations o
           JOIN businesses b ON b.id = o.business_id
          WHERE b.workspace_id = $1 AND (b.archived IS NOT TRUE)`,
        [ws]
      );
      const candidates = obligationRows as Candidate[];

      const { rows: businessRows } = await client.query(
        `SELECT id, name, business_type, industry, municipality
           FROM businesses WHERE workspace_id = $1 AND (archived IS NOT TRUE)`,
        [ws]
      );
      const businessById = new Map<string, (typeof businessRows)[number]>();
      for (const b of businessRows) businessById.set(String(b.id), b);

      const { rows: facilityRows } = await client.query(
        `SELECT id, name, business_id, municipality
           FROM facilities WHERE workspace_id = $1`,
        [ws]
      );
      const { rows: matterRows } = await client.query(
        `SELECT id, title, business_id FROM matters WHERE workspace_id = $1`,
        [ws]
      );

      // --- match obligations ---
      const rows: ImpactRow[] = [];
      const matchedObligationIds: string[] = [];
      const affectedBusinessIds = new Set<string>();
      const affectedMatterIds = new Set<string>();

      for (const c of candidates) {
        const m = matchObligation(targeting, {
          obligation_id: String(c.obligation_id),
          obligation_name: String(c.obligation_name ?? ""),
          agency: c.agency,
          requirement_id: c.requirement_id,
          business_id: String(c.business_id),
          business_name: String(c.business_name ?? ""),
          business_type: c.business_type,
          industry: c.industry,
          municipality: c.municipality,
          matter_id: c.matter_id ? String(c.matter_id) : null,
        } as ObligationCandidate);
        if (!m.matched) continue;
        const oid = String(c.obligation_id);
        matchedObligationIds.push(oid);
        affectedBusinessIds.add(String(c.business_id));
        if (c.matter_id) affectedMatterIds.add(String(c.matter_id));
        rows.push({
          match_key: impactMatchKey("obligation", oid),
          obligation_id: oid,
          business_id: String(c.business_id),
          facility_id: null,
          matter_id: c.matter_id ? String(c.matter_id) : null,
          required_action: actionFor(
            requiredActionForObligation(brief, String(c.obligation_name ?? ""), String(c.business_name ?? ""))
          ),
          applicability,
          match_basis: m.basis,
        });
      }

      // --- explicit business picks ---
      for (const bid of targeting.business_ids ?? []) {
        affectedBusinessIds.add(bid);
      }

      // --- business-level rows ---
      for (const bid of affectedBusinessIds) {
        const b = businessById.get(bid);
        if (!b) continue; // fail closed: only workspace businesses
        rows.push({
          match_key: impactMatchKey("business", bid),
          obligation_id: null,
          business_id: bid,
          facility_id: null,
          matter_id: null,
          required_action: actionFor(requiredActionForBusiness(brief, String(b.name ?? ""))),
          applicability,
          match_basis: (targeting.business_ids ?? []).includes(bid)
            ? "Selected by reviewer (explicit business pick)"
            : "Business has affected requirements",
        });
      }

      // --- facility rows ---
      let facilityCount = 0;
      for (const f of facilityRows) {
        const fid = String(f.id);
        const m = matchFacility(
          targeting,
          {
            facility_id: fid,
            facility_name: String(f.name ?? ""),
            business_id: f.business_id ? String(f.business_id) : null,
            municipality: f.municipality,
          },
          affectedBusinessIds
        );
        if (!m.matched) continue;
        facilityCount += 1;
        rows.push({
          match_key: impactMatchKey("facility", fid),
          obligation_id: null,
          business_id: f.business_id ? String(f.business_id) : null,
          facility_id: fid,
          matter_id: null,
          required_action: actionFor(
            requiredActionForFacility(brief, String(f.name ?? ""), f.municipality)
          ),
          applicability,
          match_basis: m.basis,
        });
      }

      // --- project (matter) rows ---
      let projectCount = 0;
      for (const mt of matterRows) {
        const mid = String(mt.id);
        const ofAffectedBusiness =
          mt.business_id && affectedBusinessIds.has(String(mt.business_id));
        if (!affectedMatterIds.has(mid) && !ofAffectedBusiness) continue;
        projectCount += 1;
        rows.push({
          match_key: impactMatchKey("project", mid),
          obligation_id: null,
          business_id: mt.business_id ? String(mt.business_id) : null,
          facility_id: null,
          matter_id: mid,
          required_action: actionFor(requiredActionForProject(brief, String(mt.title ?? ""))),
          applicability,
          match_basis: affectedMatterIds.has(mid)
            ? "Project contains affected requirements"
            : "Project belongs to an affected business",
        });
      }

      // --- idempotent upsert ---
      const { rows: before } = await client.query(
        `SELECT COUNT(*)::int AS n FROM regulatory_impacts WHERE event_id = $1 AND workspace_id = $2`,
        [id, ws]
      );
      const beforeCount = (before[0] as { n: number }).n;
      const upserted = await upsertImpactRows(client, id, ws, rows);

      // --- stale cleanup: drop rows that no longer match --------------------
      // (e.g. the targeting was narrowed). Ack/implementation state of the
      // still-matched rows is preserved by the upsert above; only rows whose
      // match_key is absent from this recompute are removed.
      const matchedKeys = rows.map((r) => r.match_key);
      const stale = await client.query(
        `DELETE FROM regulatory_impacts
          WHERE event_id = $1 AND workspace_id = $2
            AND NOT (match_key = ANY($3::text[]))`,
        [id, ws, matchedKeys]
      );
      const staleRemoved = stale.rowCount ?? 0;

      // --- remediation: ONLY for effective events -------------------------
      // Projected impacts must never create or modify obligation_work.
      let obligationWorkUpdated = 0;
      if (mayTriggerRemediation(event.lifecycle)) {
        const note =
          `Regulatory change "${event.title}" is now effective` +
          `${event.effective_date ? ` (${event.effective_date})` : ""}: re-review required (event ${id}).`;
        for (const oid of matchedObligationIds) {
          await client.query(
            `INSERT INTO obligation_work (obligation_id, work_status, notes)
             VALUES ($1, 'in_progress', $2)
             ON CONFLICT (obligation_id) DO UPDATE SET
               work_status = 'in_progress',
               notes = CASE
                 WHEN obligation_work.notes IS NULL OR obligation_work.notes = ''
                   THEN EXCLUDED.notes
                 WHEN obligation_work.notes NOT LIKE '%' || $3 || '%'
                   THEN obligation_work.notes || E'\n' || EXCLUDED.notes
                 ELSE obligation_work.notes
               END,
               updated_at = now()`,
            [oid, note, id]
          );
        }
        obligationWorkUpdated = matchedObligationIds.length;
      }

      await auditInTx({
        client,
        meta,
        userId: gate.user.id,
        workspaceId: ws,
        action: "regulatory_event.impact_computed",
        targetType: "regulatory_event",
        targetId: id,
        before: { impact_count: beforeCount, lifecycle: event.lifecycle },
        after: {
          impact_count: rows.length,
          applicability,
          targeting_source: targetingSource,
          remediation_triggered: mayTriggerRemediation(event.lifecycle),
          obligation_work_updated: obligationWorkUpdated,
          stale_impacts_removed: staleRemoved,
        },
      });

      return {
        event_id: id,
        applicability,
        targeting_source: targetingSource,
        warning: targetingSource === "none" ? "no_targeting_specified" : null,
        matched: {
          obligations: matchedObligationIds.length,
          businesses: affectedBusinessIds.size,
          facilities: facilityCount,
          projects: projectCount,
        },
        impacts_upserted: upserted,
        stale_impacts_removed: staleRemoved,
        obligation_work_updated: obligationWorkUpdated,
      };
    });

    return Response.json(result);
  } catch (err) {
    const e = err as Error & { status?: number };
    if (e.message === "event_not_found") {
      return Response.json({ error: "event_not_found" }, { status: 404 });
    }
    console.error("[regulatory-event] compute-impact failed:", e.message);
    return Response.json({ error: "compute_failed" }, { status: e.status ?? 500 });
  }
}
