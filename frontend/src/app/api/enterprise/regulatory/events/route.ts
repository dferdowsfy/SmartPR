// Regulatory events — review queue (GET) and record-a-development (POST).
//
// POST requires a HUMAN-entered regulatory_source: SmartPR never invents
// requirements, agencies, laws, deadlines, or sources, so the source is
// mandatory and is stored verbatim. New events always start at
// lifecycle='proposed'.

import { getPool } from "../../../../graph/db";
import { isRegulatoryLifecycle, sanitizeTargeting, isUuidLike } from "../../../../../lib/enterprise-regulatory";
import {
  gateRequest,
  readJsonBody,
  resolveWorkspaceId,
  ensureDatabase,
  noDatabase,
  withTx,
  auditInTx,
} from "../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EVENT_COLUMNS = `
  re.id, re.title, re.summary, re.lifecycle, re.regulatory_source,
  re.source_version, re.effective_date, re.verification_date, re.verified_by,
  re.reviewer_notes, re.workspace_id, re.change_event_id, re.targeting,
  re.prev_rule_text, re.updated_rule_text, re.created_at, re.updated_at
`;

export async function GET(req: Request) {
  const ws = resolveWorkspaceId(req);
  if (!ws) return Response.json({ error: "workspace_required" }, { status: 400 });
  const gated = await gateRequest(req, "view_records", ws);
  if ("response" in gated) return gated.response;
  if (!ensureDatabase()) return noDatabase();
  const pool = getPool()!;

  const url = new URL(req.url);
  const lifecycle = url.searchParams.get("lifecycle");
  const search = (url.searchParams.get("search") ?? "").trim();

  const where: string[] = [`(re.workspace_id = $1 OR re.workspace_id IS NULL)`];
  const params: unknown[] = [ws];
  if (lifecycle) {
    if (!isRegulatoryLifecycle(lifecycle)) {
      return Response.json({ error: "invalid_lifecycle" }, { status: 400 });
    }
    params.push(lifecycle);
    where.push(`re.lifecycle = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(
      `(re.title ILIKE $${params.length} OR re.summary ILIKE $${params.length} OR re.regulatory_source ILIKE $${params.length})`
    );
  }

  try {
    const { rows } = await pool.query(
      `SELECT ${EVENT_COLUMNS},
              (SELECT COUNT(*)::int FROM regulatory_impacts ri WHERE ri.event_id = re.id) AS impact_count,
              (SELECT COUNT(*)::int FROM regulatory_impacts ri WHERE ri.event_id = re.id AND ri.ack_status = 'acknowledged') AS acknowledged_count
         FROM regulatory_events re
        WHERE ${where.join(" AND ")}
        ORDER BY re.created_at DESC
        LIMIT 200`,
      params
    );
    return Response.json({ events: rows });
  } catch (err) {
    console.error("[regulatory-events] list failed:", (err as Error).message);
    return Response.json({ error: "query_failed" }, { status: 500 });
  }
}

function asText(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function asDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(t + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : t;
}

export async function POST(req: Request) {
  const body = await readJsonBody(req);
  const ws = resolveWorkspaceId(req, body);
  if (!ws) return Response.json({ error: "workspace_required" }, { status: 400 });
  const gated = await gateRequest(req, "manage_exceptions", ws);
  if ("response" in gated) return gated.response;
  const { gate, meta } = gated;
  if (!ensureDatabase()) return noDatabase();

  const title = asText(body.title, 500);
  // Mandatory: the human-verified official source this development was
  // recorded from. Never defaulted or inferred.
  const regulatorySource = asText(body.regulatory_source, 500);
  if (!title) return Response.json({ error: "title_required" }, { status: 400 });
  if (!regulatorySource) {
    return Response.json(
      {
        error: "regulatory_source_required",
        message:
          "Every regulatory event must cite the human-verified official source it was recorded from. SmartPR never invents agencies, laws, or sources.",
      },
      { status: 400 }
    );
  }

  const sourceVersion = asText(body.source_version, 120);
  const summary = asText(body.summary, 8000);
  const prevRuleText = asText(body.prev_rule_text, 8000);
  const updatedRuleText = asText(body.updated_rule_text, 8000);
  const effectiveDate = body.effective_date == null ? null : asDate(body.effective_date);
  if (body.effective_date != null && effectiveDate === null) {
    return Response.json({ error: "invalid_effective_date", message: "Use YYYY-MM-DD." }, { status: 400 });
  }
  const targeting = sanitizeTargeting(body.targeting);

  let changeEventId: string | null = null;
  if (body.change_event_id != null) {
    if (typeof body.change_event_id !== "string" || !isUuidLike(body.change_event_id)) {
      return Response.json({ error: "invalid_change_event_id" }, { status: 400 });
    }
    changeEventId = body.change_event_id;
  }

  // Workspace scoping: a null workspace_id records a GLOBAL development
  // (demo-friendly); otherwise the event belongs to the gated workspace.
  let eventWorkspaceId: string | null = ws;
  if (body.workspace_id === null) eventWorkspaceId = null;

  try {
    const created = await withTx(async (client) => {
      if (changeEventId) {
        const { rows } = await client.query(
          `SELECT id FROM requirement_change_events WHERE id = $1 LIMIT 1`,
          [changeEventId]
        );
        if (rows.length === 0) {
          throw Object.assign(new Error("change_event_not_found"), { status: 400 });
        }
      }
      const { rows } = await client.query(
        `INSERT INTO regulatory_events
           (title, summary, lifecycle, regulatory_source, source_version,
            effective_date, workspace_id, change_event_id, targeting,
            prev_rule_text, updated_rule_text)
         VALUES ($1,$2,'proposed',$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, title, summary, lifecycle, regulatory_source,
                   source_version, effective_date, verification_date,
                   verified_by, reviewer_notes, workspace_id, change_event_id,
                   targeting, prev_rule_text, updated_rule_text,
                   created_at, updated_at`,
        [
          title,
          summary,
          regulatorySource,
          sourceVersion,
          effectiveDate,
          eventWorkspaceId,
          changeEventId,
          JSON.stringify(targeting),
          prevRuleText,
          updatedRuleText,
        ]
      );
      const row = rows[0] as Record<string, unknown>;
      await auditInTx({
        client,
        meta,
        userId: gate.user.id,
        workspaceId: ws,
        action: "regulatory_event.recorded",
        targetType: "regulatory_event",
        targetId: String(row.id),
        after: {
          title,
          lifecycle: "proposed",
          regulatory_source: regulatorySource,
          source_version: sourceVersion,
          effective_date: effectiveDate,
          global: eventWorkspaceId === null,
        },
      });
      return row;
    });
    return Response.json({ event: created }, { status: 201 });
  } catch (err) {
    const e = err as Error & { status?: number };
    if (e.message === "change_event_not_found") {
      return Response.json({ error: "change_event_not_found" }, { status: 400 });
    }
    console.error("[regulatory-events] create failed:", e.message);
    return Response.json({ error: "create_failed" }, { status: e.status ?? 500 });
  }
}
