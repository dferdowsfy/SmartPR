import { getPool, isEnabled } from "../../../graph/db";
import { isCurrentUserAdmin } from "../../../../lib/admin";
import { isPlanId, type PlanId } from "../../../../lib/billing/catalog";
import { normalizePartnerCode } from "../../../../lib/partnerCodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateBody = {
  code?: string;
  plan?: string;
  maxRedemptions?: number;
  pilotDays?: number;
  workspaceName?: string;
  expiresInDays?: number;
  notes?: string;
};

export async function GET() {
  if (!(await isCurrentUserAdmin())) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  try {
    const { rows } = await pool.query(
      `SELECT id, code, plan::text AS plan, workspace_id, workspace_name,
              max_redemptions, redemption_count, pilot_days, expires_at,
              active, notes, created_at, updated_at
         FROM partner_codes
        ORDER BY created_at DESC
        LIMIT 200`
    );
    return Response.json({ codes: rows });
  } catch (err) {
    const msg = (err as Error).message;
    if (/partner_codes/i.test(msg) && /does not exist|relation/i.test(msg)) {
      return Response.json(
        { error: "schema_missing", message: "Apply data/partner_codes_schema.sql first.", codes: [] },
        { status: 503 }
      );
    }
    throw err;
  }
}

export async function POST(request: Request) {
  if (!(await isCurrentUserAdmin())) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }

  const code = normalizePartnerCode(body.code);
  const planRaw = (body.plan || "partner").trim().toLowerCase();
  if (!code) {
    return Response.json({ error: "code required" }, { status: 400 });
  }
  if (!isPlanId(planRaw)) {
    return Response.json(
      { error: "invalid_plan", message: "plan must be free|core|operator|partner|pilot|enterprise" },
      { status: 400 }
    );
  }
  const plan = planRaw as PlanId;
  const maxRedemptions = Math.max(1, Number(body.maxRedemptions) || 10);
  const pilotDays = Math.max(1, Number(body.pilotDays) || 90);
  const expiresInDays = body.expiresInDays != null ? Math.max(1, Number(body.expiresInDays)) : pilotDays;
  const workspaceName = (body.workspaceName || `${code} Pilot`).trim();
  const notes = body.notes?.trim() || null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO partner_codes (
         code, plan, workspace_name, max_redemptions, pilot_days,
         expires_at, notes, active, updated_at
       ) VALUES (
         $1, $2::plan_id, $3, $4, $5,
         NOW() + make_interval(days => $6), $7, true, NOW()
       )
       ON CONFLICT (code) DO UPDATE SET
         plan = EXCLUDED.plan,
         workspace_name = EXCLUDED.workspace_name,
         max_redemptions = EXCLUDED.max_redemptions,
         pilot_days = EXCLUDED.pilot_days,
         expires_at = EXCLUDED.expires_at,
         notes = COALESCE(EXCLUDED.notes, partner_codes.notes),
         active = true,
         updated_at = NOW()
       RETURNING id, code, plan::text AS plan, workspace_name, max_redemptions,
                 pilot_days, expires_at, active, redemption_count`,
      [code, plan, workspaceName, maxRedemptions, pilotDays, expiresInDays, notes]
    );
    return Response.json({ ok: true, code: rows[0] });
  } catch (err) {
    const msg = (err as Error).message;
    if (/partner_codes/i.test(msg) && /does not exist|relation/i.test(msg)) {
      return Response.json(
        { error: "schema_missing", message: "Apply data/partner_codes_schema.sql first." },
        { status: 503 }
      );
    }
    return Response.json({ error: "create_failed", message: msg }, { status: 500 });
  }
}
