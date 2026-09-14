import { bootstrapPlatformUser } from "../../../../lib/auth/bootstrap";
import { getCurrentUser } from "../../../../lib/supabase/server";
import { schemaFailures } from "../../../graph/store";
import { getPool, isEnabled } from "../../../graph/db";
import { convertLeadForUser } from "../../../../lib/leads";
import {
  normalizePartnerCode,
  partnerCodeErrorResponse,
} from "../../../../lib/partnerCodes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { partnerCode?: string; code?: string };
  const partnerCode = normalizePartnerCode(body.partnerCode ?? body.code);

  try {
    const { workspaceId, partner } = await bootstrapPlatformUser(user, { partnerCode });
    // Link any landing-page lead to this account and tell the founder.
    // Best-effort: a notification failure must never break signup.
    try {
      if (isEnabled()) {
        const pool = getPool();
        if (pool) await convertLeadForUser(pool, user);
      }
    } catch (leadError) {
      console.error("[auth-bootstrap] lead conversion", (leadError as Error).message);
    }
    return Response.json({
      ready: true,
      workspace_id: workspaceId,
      partner: partner
        ? {
            plan: partner.plan,
            role: partner.role,
            workspace_name: partner.workspaceName,
            already_redeemed: partner.alreadyRedeemed,
            current_period_end: partner.currentPeriodEnd,
          }
        : null,
    });
  } catch (error) {
    const mapped = partnerCodeErrorResponse(error);
    if (mapped) return mapped;
    const detail = (error as Error).message;
    console.error("[auth-bootstrap]", detail);
    return Response.json(
      {
        error: "SmartPR could not initialize the Supabase workspace.",
        // Without this the only symptom was an anonymous 503: a missing
        // DATABASE_URL, an unreachable database and a rejected schema
        // statement were indistinguishable from the browser.
        detail,
        schemaFailures: schemaFailures(),
      },
      { status: 503 }
    );
  }
}
