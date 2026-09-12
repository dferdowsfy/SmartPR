// ============================================================================
// Enterprise demo seed — Phase 8.
//
// Seeds the "Caribe Industrial Manufacturing LLC (Demo)" workspace:
// 5 fictional facilities, 1 business, 2 matters, 8 obligations drawn ONLY from
// real knowledge-graph requirement_rules content (the repo's guarded KG seed
// rows in data/requirements_seed.sql — inserted idempotently if absent; no
// laws, permits, agencies, deadlines, or sources are invented), obligation_work
// (assigned incl. one overdue + unassigned), evidence across all 8 enterprise
// states with versions and review decisions, internal-target deadline
// schedules (the KG provides no verified renewal data, so nothing here is
// marked verified), one clearly-labeled [DEMO] proposed regulatory event,
// audit events, notifications, and one inert demo webhook endpoint
// (https://example.com/webhooks/demo — never sends; Phase 6's inert-URL rule).
//
// Users: creating real Supabase auth users is out of scope, so the seed
// creates workspace_members + enterprise_roles + role_assignments rows for a
// set of fictional (deterministic) user ids. The seeding super admin is added
// as OWNER and org_owner so a real person can enter the demo.
//
// Idempotency / Reset Demo: the seed is keyed on the workspace name. If a
// demo workspace already exists it is deleted first (cascades wipe the whole
// demo subtree) and re-seeded, so running twice never duplicates. This same
// wipe+restore is what POST /api/demo/enterprise-seed ("Reset demo") uses.
// Note: audit_events is append-only by schema trigger, so demo audit rows
// survive a reset with workspace_id set to NULL — that is intentional.
// ============================================================================

import { createHash, randomUUID } from "node:crypto";
import { ENTERPRISE_ROLES, ROLE_PERMISSIONS, type RoleKey } from "./enterprise-permissions";
import { DEMO_USERS, DEMO_FACILITIES } from "./demo-enterprise-data";

// Re-exported so existing server-side importers keep working; the client
// demo page imports these from ./demo-enterprise-data directly (client-safe).
export { DEMO_USERS, DEMO_FACILITIES };

/** Minimal query surface; pg.Pool satisfies it, tests inject a fake. */
export interface Queryable {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

export const DEMO_WORKSPACE_NAME = "Caribe Industrial Manufacturing LLC (Demo)";

/** Deterministic fictional user id (uuid-shaped) for a demo role key. */
export function demoUserId(roleKey: string): string {
  const hex = createHash("sha256").update(`smartpr-demo:user:${roleKey}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Real KG requirement content (verbatim from data/requirements_seed.sql).
 * Inserted idempotently if absent; obligations reference these rows only.
 */
const KG_RULES = [
  {
    municipality: "San Juan", business_type: "restaurant", activity_type: "food_service",
    agency_name: "Municipio de San Juan / OGPe", requirement_category: "license",
    requirement_name: "Permiso Único & Licencia Sanitaria (Restaurant)",
    description: "Single permit (Permiso Único) plus health/sanitation license required to operate a food-service establishment in San Juan.",
    official_source_url: "https://ogpe.pr.gov/", source_domain: "ogpe.pr.gov",
    confidence_score: 0.8, status: "active", effective_date: "2025-01-01",
  },
  {
    municipality: "Guaynabo", business_type: "short_term_rental", activity_type: "short_term_rental",
    agency_name: "Municipio de Guaynabo", requirement_category: "registration",
    requirement_name: "Registro Municipal de Alquiler a Corto Plazo",
    description: "Municipal registration required to operate a short-term rental property in Guaynabo.",
    official_source_url: "https://guaynabo.pr.gov/", source_domain: "guaynabo.pr.gov",
    confidence_score: 0.7, status: "active", effective_date: "2025-01-01",
  },
  {
    municipality: "Bayamón", business_type: "retail_store", activity_type: "retail",
    agency_name: "Municipio de Bayamón", requirement_category: "license",
    requirement_name: "Patente Municipal & Certificado de Uso (Retail)",
    description: "Municipal business license (patente) and certificate of use required for a retail store in Bayamón.",
    official_source_url: "https://bayamon.pr.gov/", source_domain: "bayamon.pr.gov",
    confidence_score: 0.75, status: "active", effective_date: "2025-01-01",
  },
  {
    municipality: "San Juan", business_type: "professional_services_office", activity_type: "professional_services",
    agency_name: "Municipio de San Juan", requirement_category: "license",
    requirement_name: "Patente Municipal (Professional Services Office)",
    description: "Municipal business license (patente) required for a professional services office in San Juan.",
    official_source_url: "https://sanjuan.pr.gov/", source_domain: "sanjuan.pr.gov",
    confidence_score: 0.75, status: "active", effective_date: "2025-01-01",
  },
];

const EIGHT_STATES = [
  "draft",
  "submitted_for_review",
  "under_review",
  "changes_requested",
  "approved",
  "rejected",
  "superseded",
  "expired",
] as const;

/** Legacy review_status mapping for the pre-enterprise evidence column (best effort). */
function legacyReviewStatus(state: string): string {
  switch (state) {
    case "draft": return "UPLOADED";
    case "submitted_for_review": return "UPLOADED";
    case "under_review": return "PROCESSING";
    case "changes_requested": return "NEEDS_REVIEW";
    case "approved": return "VERIFIED";
    case "rejected": return "REJECTED";
    case "superseded": return "VERIFIED";
    case "expired": return "VERIFIED";
    default: return "UPLOADED";
  }
}

export interface SeedSummary {
  workspaceId: string;
  businessId: string;
  facilityIds: string[];
  obligationIds: string[];
  evidenceIds: string[];
  reset: boolean;
}

/**
 * Wipe (if present) and re-seed the enterprise demo workspace.
 * Everything runs in one transaction; the caller supplies the pool.
 */
export async function seedEnterpriseDemo(
  pool: Queryable,
  actorUserId: string,
  actorEmail: string
): Promise<SeedSummary> {
  const q = (text: string, params?: unknown[]) => pool.query(text, params);

  // Transaction guard for real pools; the test fake ignores these.
  const begin = async () => { try { await q("BEGIN"); } catch { /* fake */ } };
  const commit = async () => { try { await q("COMMIT"); } catch { /* fake */ } };
  const rollback = async () => { try { await q("ROLLBACK"); } catch { /* fake */ } };

  await begin();
  try {
    // 1. Real KG rules first (guarded; shared KG content — never wiped).
    const ruleIds: string[] = [];
    for (const r of KG_RULES) {
      const found = await q(
        `SELECT id::text AS id FROM requirement_rules
          WHERE requirement_name = $1 AND municipality = $2 AND business_type = $3
          LIMIT 1`,
        [r.requirement_name, r.municipality, r.business_type]
      );
      if (found.rows[0]?.id) {
        ruleIds.push(String(found.rows[0].id));
        continue;
      }
      const ins = await q(
        `INSERT INTO requirement_rules
           (state_or_territory, municipality, agency_name, business_type, activity_type,
            requirement_category, requirement_name, description, official_source_url,
            source_domain, confidence_score, status, effective_date)
         VALUES ('PR',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::date)
         RETURNING id::text AS id`,
        [r.municipality, r.agency_name, r.business_type, r.activity_type, r.requirement_category,
         r.requirement_name, r.description, r.official_source_url, r.source_domain,
         r.confidence_score, r.status, r.effective_date]
      );
      ruleIds.push(String(ins.rows[0].id));
    }

    // 2. Reset: delete any existing demo workspace (cascades wipe the subtree).
    const existing = await q(
      `SELECT id::text AS id FROM workspaces WHERE name = $1 AND archived_at IS NULL LIMIT 1`,
      [DEMO_WORKSPACE_NAME]
    );
    const reset = existing.rows.length > 0;
    if (reset) {
      await q(`DELETE FROM workspaces WHERE id = $1`, [existing.rows[0].id]);
    }

    // 3. Workspace + business.
    const workspaceId = randomUUID();
    await q(
      `INSERT INTO workspaces (id, owner_user_id, name, kind) VALUES ($1, $2, $3, 'PROFESSIONAL')`,
      [workspaceId, actorUserId, DEMO_WORKSPACE_NAME]
    );
    const businessId = randomUUID();
    await q(
      `INSERT INTO businesses (id, user_id, workspace_id, name, legal_name, business_type, industry, municipality)
       VALUES ($1,$2,$3,$4,$4,'manufacturing','Manufacturing','San Juan')`,
      [businessId, actorUserId, workspaceId, DEMO_WORKSPACE_NAME]
    );

    // 4. Members: caller as OWNER + fictional users.
    const memberRows: Array<[string, string]> = [[actorUserId, "OWNER"]];
    for (const u of DEMO_USERS) memberRows.push([demoUserId(u.roleKey), u.legacyRole]);
    for (const [userId, role] of memberRows) {
      await q(
        `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [workspaceId, userId, role]
      );
    }

    // 5. Facilities.
    const facilityIds: string[] = [];
    for (const f of DEMO_FACILITIES) {
      const fid = randomUUID();
      await q(
        `INSERT INTO facilities (id, workspace_id, business_id, name, municipality, address)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [fid, workspaceId, businessId, f.name, f.municipality, f.address]
      );
      facilityIds.push(fid);
    }

    // 6. Matters (projects).
    const matterIds: string[] = [];
    for (const title of ["Expansión Planta Norte (Demo)", "Renovación de permisos — Oficinas (Demo)"]) {
      const mid = randomUUID();
      await q(
        `INSERT INTO matters (id, business_id, workspace_id, user_id, matter_type, title, status)
         VALUES ($1,$2,$3,$4,'compliance',$5,'IN_PROGRESS')`,
        [mid, businessId, workspaceId, actorUserId, title]
      );
      matterIds.push(mid);
    }

    // 7. System enterprise roles (10).
    const roleIdByKey = new Map<string, string>();
    for (const r of ENTERPRISE_ROLES) {
      const rid = randomUUID();
      await q(
        `INSERT INTO enterprise_roles (id, workspace_id, key, label, permissions, is_system)
         VALUES ($1,$2,$3,$4,$5::jsonb,true)`,
        [rid, workspaceId, r.key, r.label, JSON.stringify(ROLE_PERMISSIONS[r.key as RoleKey])]
      );
      roleIdByKey.set(r.key, rid);
    }

    // 8. Role assignments (incl. facility_manager scoped to ONE facility).
    const assign = async (userId: string, roleKey: RoleKey, scopeType: string, scopeId: string | null) => {
      await q(
        `INSERT INTO role_assignments (user_id, workspace_id, enterprise_role_id, scope_type, scope_id)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (user_id, workspace_id, enterprise_role_id, scope_type, scope_id) DO NOTHING`,
        [userId, workspaceId, roleIdByKey.get(roleKey), scopeType, scopeId]
      );
    };
    await assign(actorUserId, "org_owner", "organization", workspaceId);
    for (const u of DEMO_USERS) {
      const uid = demoUserId(u.roleKey);
      if (u.roleKey === "facility_manager") {
        await assign(uid, u.roleKey, "facility", facilityIds[1]); // Planta Norte only
      } else {
        await assign(uid, u.roleKey, "organization", workspaceId);
      }
    }

    // 9. Obligations: 4 KG rules × 2 (assigned + unassigned) = 8.
    const managerId = demoUserId("compliance_manager");
    const reviewerId = demoUserId("evidence_reviewer");
    const contributorId = demoUserId("contributor");
    const obligationIds: string[] = [];
    const workInserts: Array<{ oid: string; assigned: boolean; overdue?: boolean; idx: number }> = [];
    const obligationSpecs = [
      { status: "OVERDUE", work_status: "in_progress", priority: "high", assigned: true, overdue: true, due: "2026-08-15", next: "(Demo) Internal target — overdue; evidence in review." },
      { status: "MISSING", work_status: "not_started", priority: "medium", assigned: false },
      { status: "IN_PROGRESS", work_status: "evidence_submitted", priority: "high", assigned: true, due: "2026-12-01", next: "(Demo) Internal target; evidence submitted for review." },
      { status: "MISSING", work_status: "not_started", priority: "medium", assigned: false },
      { status: "DUE_SOON", work_status: "in_progress", priority: "critical", assigned: true, due: "2026-09-25", next: "(Demo) Internal target — due soon." },
      { status: "MISSING", work_status: "not_started", priority: "low", assigned: false },
      { status: "UPCOMING", work_status: "not_started", priority: "medium", assigned: true, due: "2027-01-15", next: "(Demo) Internal target — upcoming." },
      { status: "CURRENT", work_status: "not_started", priority: "low", assigned: false },
    ];
    for (let i = 0; i < 4; i++) {
      const rule = KG_RULES[i];
      const ruleId = ruleIds[i];
      for (let cycle = 1; cycle <= 2; cycle++) {
        const spec = obligationSpecs[i * 2 + (cycle - 1)];
        const oid = randomUUID();
        await q(
          `INSERT INTO obligations
             (id, business_id, matter_id, requirement_id, name, agency, status,
              due_date, due_date_source, source, source_reference, mandatory, next_action, cycle_index)
           VALUES ($1,$2,NULL,$3,$4,$5,$6,$7::date,'USER_PROVIDED','REGULATORY_GRAPH',$8,true,$9,$10)`,
          [oid, businessId, ruleId, `${rule.requirement_name} (Demo)`, rule.agency_name,
           spec.status, spec.due ?? null, rule.official_source_url, spec.next ?? "(Demo) Unassigned — awaiting triage.", cycle]
        );
        obligationIds.push(oid);
        workInserts.push({ oid, assigned: spec.assigned, overdue: spec.overdue, idx: i * 2 + (cycle - 1) });
      }
    }

    // 10. obligation_work: assigned + unassigned rows.
    for (const w of workInserts) {
      const spec = obligationSpecs[w.idx];
      await q(
        `INSERT INTO obligation_work
           (obligation_id, owner_user_id, department, reviewer_user_id, priority,
            internal_due_date, work_status, escalation_state, notes)
         VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9)`,
        [
          w.oid,
          w.assigned ? managerId : null,
          w.assigned ? "Compliance" : null,
          w.assigned ? reviewerId : null,
          spec.priority,
          spec.due ?? null,
          spec.work_status,
          w.overdue ? "escalated" : "none",
          w.assigned
            ? `(Demo) Internal target${w.overdue ? " — OVERDUE" : ""}; dates are planning targets, not verified regulatory deadlines.`
            : "(Demo) Unassigned — awaiting triage.",
        ]
      );
    }

    // 11. Evidence across all 8 enterprise states (+ versions + review decisions).
    const evidenceIds: string[] = [];
    for (let i = 0; i < 8; i++) {
      const state = EIGHT_STATES[i];
      const oid = obligationIds[i];
      const eid = randomUUID();
      const filename = `demo-evidence-${state.replace(/_/g, "-")}.pdf`;
      const storagePath = `demo/enterprise/${workspaceId}/${eid}/v1.pdf`;
      await q(
        `INSERT INTO evidence
           (id, user_id, business_id, obligation_id, original_filename, storage_path,
            mime_type, size_bytes, document_type, review_status, enterprise_state)
         VALUES ($1,$2,$3,$4,$5,$6,'application/pdf',18432,'permit', $7, $8)`,
        [eid, contributorId, businessId, oid, filename, storagePath, legacyReviewStatus(state), state]
      );
      evidenceIds.push(eid);
      const versions = state === "approved" ? 2 : 1;
      let versionIdV1 = "";
      for (let v = 1; v <= versions; v++) {
        const vid = randomUUID();
        if (v === 1) versionIdV1 = vid;
        await q(
          `INSERT INTO evidence_versions (id, evidence_id, version_number, storage_path, file_hash, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [vid, eid, v, v === 1 ? storagePath : `demo/enterprise/${workspaceId}/${eid}/v2.pdf`,
           createHash("sha256").update(`demo-evidence:${eid}:v${v}`).digest("hex"), contributorId]
        );
      }
      if (state === "approved") {
        await q(
          `INSERT INTO evidence_reviews
             (evidence_id, evidence_version_id, reviewer_user_id, decision, reason, previous_state, resulting_state)
           VALUES ($1,$2,$3,'approve','(Demo) Evidence complete and legible.','under_review','approved')`,
          [eid, versionIdV1, reviewerId]
        );
      }
      if (state === "changes_requested") {
        await q(
          `INSERT INTO evidence_reviews
             (evidence_id, evidence_version_id, reviewer_user_id, decision, reason, previous_state, resulting_state)
           VALUES ($1,$2,$3,'request_changes','(Demo) Signature page missing — please re-upload.','under_review','changes_requested')`,
          [eid, versionIdV1, reviewerId]
        );
      }
    }

    // 12. Deadline schedules: internal targets only (KG has no verified renewals).
    for (const [oid, due] of [[obligationIds[0], "2026-12-01"], [obligationIds[2], "2026-09-25"], [obligationIds[6], "2027-01-15"]] as Array<[string, string]>) {
      await q(
        `INSERT INTO deadline_schedules
           (workspace_id, obligation_id, schedule_type, due_date, is_verified, label, source_note)
         VALUES ($1,$2,'one_time',$3::date,false,
           '(Demo) Internal target — not a verified regulatory deadline',
           'Demo seed: internal planning target. The knowledge graph provides no verified renewal data for this requirement.')`,
        [workspaceId, oid, due]
      );
    }

    // 13. One [DEMO] proposed regulatory event (+ impact). Must not alter requirements.
    const eventIns = await q(
      `INSERT INTO regulatory_events
         (title, summary, lifecycle, regulatory_source, workspace_id, reviewer_notes)
       VALUES ($1,$2,'proposed',$3,$4,$5)
       RETURNING id::text AS id`,
      [
        "[DEMO] Proposed change: municipal license renewal cadence",
        "DEMO placeholder. This proposed event is illustrative only and does NOT alter any requirement, deadline, obligation, or knowledge-graph rule. No action is required while it remains proposed.",
        "(Demo) No external source — illustrative only",
        workspaceId,
        "(Demo) Awaiting human verification; do not enact.",
      ]
    );
    // applicability is 'projected' (the event is only proposed); the [DEMO]
    // prefix in the text marks it as illustrative.
    const eventId = String(eventIns.rows[0].id);
    await q(
      `INSERT INTO regulatory_impacts
         (event_id, workspace_id, obligation_id, business_id, required_action, ack_status, implementation_status, applicability)
       VALUES ($1,$2,$3,$4,$5,'pending','not_started','projected')`,
      [eventId, workspaceId, obligationIds[4], businessId,
       "(Demo) Review impact if enacted — no action required while proposed."]
    );

    // 14. Notifications for the seeding admin. Live constraint requires
    // channel IN ('IN_APP','EMAIL','SMS') and status IN ('PENDING',...).
    for (const message of [
      "(Demo) Welcome to the Caribe Industrial demo workspace — 8 obligations seeded across 5 facilities.",
      "(Demo) 1 obligation is overdue on its internal target: review the work queue.",
    ]) {
      await q(
        `INSERT INTO notifications (user_id, workspace_id, business_id, type, channel, scheduled_for, status, message)
         VALUES ($1,$2,$3,'demo_notice','IN_APP',now(),'PENDING',$4)`,
        [actorUserId, workspaceId, businessId, message]
      );
    }

    // 15. Inert demo webhook endpoint (never sends — example.com is inert per Phase 6).
    await q(
      `INSERT INTO webhook_endpoints (workspace_id, url, secret_hash, events, active)
       VALUES ($1,'https://example.com/webhooks/demo',$2,'{evidence.approved,obligation.completed}',true)`,
      [workspaceId, createHash("sha256").update("smartpr-demo:webhook-secret:example.com").digest("hex")]
    );

    // 16. Audit trail for the seed itself.
    await q(
      `INSERT INTO audit_events
         (actor_user_id, workspace_id, action, target_type, target_id, "before", "after", source, reason)
       VALUES ($1,$2,'enterprise.demo.seed','workspace',$2,$3,$4,'superadmin','Enterprise demo seed (Phase 8)')`,
      [
        actorUserId, workspaceId,
        reset ? JSON.stringify({ reset: true }) : null,
        JSON.stringify({
          workspace: DEMO_WORKSPACE_NAME, seeded_by: actorEmail,
          facilities: 5, obligations: 8, evidence_states: [...EIGHT_STATES],
          demo_users: DEMO_USERS.map((u) => u.roleKey),
        }),
      ]
    );

    await commit();
    return { workspaceId, businessId, facilityIds, obligationIds, evidenceIds, reset };
  } catch (e) {
    await rollback();
    throw e;
  }
}

/** Find the demo workspace id, if seeded. */
export async function findDemoWorkspace(pool: Queryable): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT id::text AS id FROM workspaces WHERE name = $1 AND archived_at IS NULL LIMIT 1`,
    [DEMO_WORKSPACE_NAME]
  );
  return rows[0]?.id ? String(rows[0].id) : null;
}
