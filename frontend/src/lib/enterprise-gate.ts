// ============================================================================
// Enterprise branding/security route gate — Phase 8.
//
// Allows callers that EITHER:
//   1. are platform super admins (SmartPR team, e.g. the /admin company view), or
//   2. hold the `configure_branding_security` enterprise permission in the
//      workspace (org_owner / org_admin via role_assignments or legacy mapping).
//
// Server-side only (imports next/headers lazily like enterprise-permissions).
// ============================================================================

import { requireEnterprisePermission } from "./enterprise-permissions";

export interface BrandingSecurityGrant {
  user: { id: string; email?: string | null };
  workspaceId: string;
}

export async function requireBrandingSecurity(
  workspaceId: string
): Promise<BrandingSecurityGrant | { response: Response }> {
  if (!workspaceId || typeof workspaceId !== "string") {
    return { response: Response.json({ error: "workspace_id is required" }, { status: 400 }) };
  }

  let user: { id: string; email?: string | null } | null = null;
  try {
    const { getCurrentUser } = await import("./supabase/server");
    user = await getCurrentUser();
  } catch {
    user = null;
  }
  if (!user) {
    return { response: Response.json({ error: "unauthorized" }, { status: 401 }) };
  }

  // Super admins (SmartPR team) always pass — e.g. the /admin company UI.
  try {
    const { isSuperAdmin } = await import("./admin");
    if (await isSuperAdmin(user.email)) return { user, workspaceId };
  } catch {
    // Fall through to the enterprise permission check.
  }

  // Otherwise the caller needs the enterprise permission in this workspace.
  return requireEnterprisePermission("configure_branding_security", workspaceId, {
    type: "organization",
    id: workspaceId,
  });
}
