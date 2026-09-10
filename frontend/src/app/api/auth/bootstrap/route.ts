import { bootstrapPlatformUser } from "../../../../lib/auth/bootstrap";
import { getCurrentUser } from "../../../../lib/supabase/server";
import { schemaFailures } from "../../../graph/store";
import { getPool, isEnabled } from "../../../graph/db";
import { convertLeadForUser } from "../../../../lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { workspaceId } = await bootstrapPlatformUser(user);
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
    return Response.json({ ready: true, workspace_id: workspaceId });
  } catch (error) {
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
