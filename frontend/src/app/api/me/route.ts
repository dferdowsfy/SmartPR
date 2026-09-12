// Lightweight "who am I" probe used by client components to toggle UI
// (Sign in vs avatar/Sign out) without round-tripping through middleware.

import { getCurrentUser, isAuthConfigured } from "../../../lib/supabase/server";
import { isUserAdmin } from "../../../lib/admin";
import { bootstrapPlatformUser } from "../../../lib/auth/bootstrap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isAuthConfigured()) return Response.json({ configured: false, user: null });
  const user = await getCurrentUser();
  if (!user) return Response.json({ configured: true, user: null });
  let workspaceId: string | null = null;
  try {
    workspaceId = (await bootstrapPlatformUser(user)).workspaceId;
  } catch (error) {
    console.error("[api-me] platform bootstrap failed:", (error as Error).message);
  }
  return Response.json({
    configured: true,
    workspace_ready: Boolean(workspaceId),
    user: {
      id: user.id,
      email: user.email,
      name: (user.user_metadata?.full_name as string) || (user.user_metadata?.name as string) || null,
      avatar: (user.user_metadata?.avatar_url as string) || null,
      isAdmin: await isUserAdmin(user.email),
      workspace_id: workspaceId,
      business_name: (user.user_metadata?.business_name as string) || null,
      onboarding_intent: (user.user_metadata?.onboarding_intent as string) || null,
      professional_role: (user.user_metadata?.professional_role as string) || null,
    },
  });
}
