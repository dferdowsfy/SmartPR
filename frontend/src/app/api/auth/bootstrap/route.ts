import { bootstrapPlatformUser } from "../../../../lib/auth/bootstrap";
import { getCurrentUser } from "../../../../lib/supabase/server";
import { schemaFailures } from "../../../graph/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const { workspaceId } = await bootstrapPlatformUser(user);
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
