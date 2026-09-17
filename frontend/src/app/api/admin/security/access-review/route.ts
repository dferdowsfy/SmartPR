import { requireSecurityAdmin, auditSecurityMutation, jsonOk } from "../_util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET — privileged access snapshot for review (admins, active support grants,
 * service accounts). Does not invent review completion.
 * POST — record that a human review was performed (evidence).
 */
export async function GET() {
  const gate = await requireSecurityAdmin();
  if ("response" in gate) return gate.response;
  const { pool } = gate;

  let adminAllowlist: unknown[] = [];
  let activeSupport: unknown[] = [];
  let serviceAccounts: unknown[] = [];
  let pastReviews: unknown[] = [];

  try {
    const a = await pool.query(
      `SELECT email, groups, created_at FROM admin_allowlist ORDER BY email ASC LIMIT 500`
    );
    adminAllowlist = a.rows;
  } catch { /* table may differ */ }

  try {
    const s = await pool.query(
      `SELECT id::text, workspace_id::text, granted_to_email, reason, scope, expires_at, created_at,
              use_count, last_used_at
         FROM support_access_grants
        WHERE revoked_at IS NULL AND expires_at > now()
        ORDER BY expires_at ASC
        LIMIT 200`
    );
    activeSupport = s.rows;
  } catch {
    try {
      const s2 = await pool.query(
        `SELECT id::text, workspace_id::text, granted_to_email, reason, scope, expires_at, created_at
           FROM support_access_grants
          WHERE revoked_at IS NULL AND expires_at > now()
          ORDER BY expires_at ASC
          LIMIT 200`
      );
      activeSupport = s2.rows;
    } catch { /* missing */ }
  }

  try {
    const sa = await pool.query(
      `SELECT id::text, workspace_id::text, name, scopes, expires_at, last_used_at, revoked, created_at
         FROM service_accounts
        WHERE revoked = false
        ORDER BY created_at DESC
        LIMIT 200`
    );
    // Never include credential_hash
    serviceAccounts = sa.rows;
  } catch { /* missing */ }

  try {
    const r = await pool.query(
      `SELECT id::text, period_start, period_end, reviewer_user_id::text, status,
              findings_summary, completed_at, created_at
         FROM security_access_reviews
        ORDER BY created_at DESC
        LIMIT 50`
    );
    pastReviews = r.rows;
  } catch { /* missing */ }

  return jsonOk({
    disclaimer:
      "Privileged access snapshot for human review. Completing a review requires POST with real period dates — do not fabricate.",
    snapshot: {
      admin_allowlist: adminAllowlist,
      active_support_grants: activeSupport,
      active_service_accounts: serviceAccounts,
    },
    past_reviews: pastReviews,
  });
}

export async function POST(request: Request) {
  const gate = await requireSecurityAdmin();
  if ("response" in gate) return gate.response;
  const body = (await request.json().catch(() => ({}))) as {
    period_start?: string;
    period_end?: string;
    findings_summary?: string;
    status?: string;
    snapshot?: Record<string, unknown>;
  };
  const periodStart = (body.period_start || "").trim();
  const periodEnd = (body.period_end || "").trim();
  if (!periodStart || !periodEnd) {
    return Response.json({ error: "period_start and period_end (ISO dates) required" }, { status: 400 });
  }
  const status = (body.status || "completed").toLowerCase();
  if (!["in_progress", "completed", "cancelled"].includes(status)) {
    return Response.json({ error: "invalid status" }, { status: 400 });
  }

  try {
    const { rows } = await gate.pool.query(
      `INSERT INTO security_access_reviews
         (period_start, period_end, reviewer_user_id, status, findings_summary, snapshot, completed_at)
       VALUES ($1::date,$2::date,$3,$4,$5,$6::jsonb,$7)
       RETURNING id::text, period_start, period_end, status, completed_at`,
      [
        periodStart,
        periodEnd,
        gate.ctx.userId,
        status,
        body.findings_summary ?? null,
        JSON.stringify(body.snapshot ?? {}),
        status === "completed" ? new Date().toISOString() : null,
      ]
    );
    await auditSecurityMutation(
      gate.pool,
      request,
      gate.ctx,
      "security.access_review_recorded",
      "security_access_review",
      rows[0].id,
      { period_start: periodStart, period_end: periodEnd, status }
    );
    return jsonOk({ review: rows[0] }, 201);
  } catch (e) {
    return Response.json({ error: "schema_missing_or_failed", detail: (e as Error).message }, { status: 503 });
  }
}
