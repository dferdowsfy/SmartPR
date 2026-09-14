import { getPool, isEnabled } from "../../../graph/db";
import { getCurrentUser } from "../../../../lib/supabase/server";
import {
  normalizePartnerCode,
  partnerCodeErrorResponse,
  redeemPartnerCode,
} from "../../../../lib/partnerCodes";
import { ensureSchema } from "../../../graph/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Redeem a partner code → join/create the shared pilot workspace (auth required). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { code?: string };
  const code = normalizePartnerCode(body.code);
  if (!code) {
    return Response.json({ error: "Enter a partner code.", code: "invalid" }, { status: 400 });
  }

  try {
    await ensureSchema();
    // Ensure public.users row exists for FK-ish consistency with bootstrap.
    await pool.query(
      `INSERT INTO users (id, email, name, last_login)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (id) DO UPDATE SET
         email = COALESCE(EXCLUDED.email, users.email),
         last_login = now()`,
      [
        user.id,
        user.email ?? null,
        (user.user_metadata?.full_name as string | undefined) ||
          (user.user_metadata?.name as string | undefined) ||
          null,
      ]
    );

    const result = await redeemPartnerCode(pool, {
      userId: user.id,
      code,
      email: user.email,
    });
    return Response.json({
      ok: true,
      workspace_id: result.workspaceId,
      workspace_name: result.workspaceName,
      plan: result.plan,
      role: result.role,
      already_redeemed: result.alreadyRedeemed,
      current_period_end: result.currentPeriodEnd,
    });
  } catch (err) {
    const mapped = partnerCodeErrorResponse(err);
    if (mapped) return mapped;
    console.error("[partner-codes/redeem]", (err as Error).message);
    return Response.json({ error: "Could not redeem partner code." }, { status: 500 });
  }
}
