// Monthly regulatory-scan runner scaffold.
//
// POST /api/cron/regulatory-scan
//
// The scan itself is a scheduled research pass (human/agent): it reviews the
// authoritative sources in REGULATORY_SCAN_SOURCES for developments since the
// previous scan, verifies each material finding against a primary government
// source, and records findings in regulatory_developments (via
// POST /api/compliance/regulatory-developments or SQL). New findings enter
// with review_status='unreviewed'; a human promotes them to 'verified'.
// Only 'verified' findings reach the monthly digest (WHAT CHANGED).
//
// Recommended host schedule: 1st of the month ~6:00am ET, BEFORE the digest
// cron (~8:00am ET), so fresh findings are available at digest generation.
//
// Auth: header `x-cron-secret: $COMPLIANCE_CRON_SECRET` (same secret as the
// reminder/digest crons).
//
// Actions (JSON body):
// - { "action": "start" } (default) → opens a scan run, returns the
//   procedure: sources to check, confidence rubric, steps.
// - { "action": "complete", "run_id": "<uuid>", "sources_checked": [...],
//   "notes": "..." } → closes the run, counts findings recorded since start.

import { getPool } from "../../../graph/db";
import {
  CONFIDENCE_RUBRIC,
  REGULATORY_SCAN_SOURCES,
  SCAN_PROCEDURE_STEPS,
} from "../../../../lib/compliance-regulatory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cronAuthorized(req: Request): boolean {
  const secret = process.env.COMPLIANCE_CRON_SECRET;
  if (!secret) return false;
  const given = req.headers.get("x-cron-secret");
  if (!given || given.length !== secret.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  if (!cronAuthorized(req)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const pool = getPool();
  if (!pool) return Response.json({ error: "Database unavailable." }, { status: 503 });

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const action = typeof body.action === "string" ? body.action : "start";

  if (action === "complete") {
    const runId = typeof body.run_id === "string" ? body.run_id : null;
    if (!runId) return Response.json({ error: "run_id is required." }, { status: 400 });
    const sourcesChecked = Array.isArray(body.sources_checked)
      ? body.sources_checked.filter((s): s is string => typeof s === "string")
      : [];
    const notes = typeof body.notes === "string" ? body.notes : null;
    const found = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM regulatory_developments
        WHERE recorded_at >= (SELECT started_at FROM regulatory_scan_runs WHERE id = $1)`,
      [runId]
    );
    await pool.query(
      `UPDATE regulatory_scan_runs
          SET completed_at = now(), sources_checked = $2, developments_found = $3, notes = $4
        WHERE id = $1`,
      [runId, sourcesChecked, Number(found.rows[0]?.c ?? 0), notes]
    );
    return Response.json({ ok: true, run_id: runId, developments_found: Number(found.rows[0]?.c ?? 0) });
  }

  // action === "start"
  const run = await pool.query<{ id: string; started_at: string }>(
    `INSERT INTO regulatory_scan_runs DEFAULT VALUES RETURNING id::text AS id, started_at::text AS started_at`
  );
  return Response.json({
    ok: true,
    run: run.rows[0],
    procedure: {
      steps: SCAN_PROCEDURE_STEPS,
      sources: REGULATORY_SCAN_SOURCES,
      confidence_rubric: CONFIDENCE_RUBRIC,
      record_findings_via: "POST /api/compliance/regulatory-developments (x-cron-secret) or SQL",
      verification_gate:
        "Only review_status='verified' findings reach the digest. Verify every material finding against a primary government source first.",
    },
  });
}
