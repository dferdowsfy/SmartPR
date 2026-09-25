// Decides whether the persistent app header (TopNav) renders for a route.
// Shared by the root layout (server, first paint) and TopNavMount (client,
// after client-side navigation) so both always agree.

const HEADERLESS_PREFIXES = [
  "/auth",
  "/signup",
  "/rehearsal-portal",
  "/es",
  "/demo",
  "/voice",
  "/workspace",
  "/requirements",
  "/about",
  "/pricing",
  "/privacy",
  "/professionals",
  "/restaurants",
  "/trust",
  "/clinics",
];

// Admin subsections that keep the app header; the rest of /admin is headerless.
const ADMIN_HEADER_PREFIXES = [
  "/admin/billing",
  "/admin/form-mappings",
  "/admin/pilots",
  "/admin/requirements",
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export function shouldShowHeader(pathname: string, search: string): boolean {
  // "/" is the marketing landing EXCEPT when it carries intake params.
  if (pathname === "/") {
    const query = search.startsWith("?") ? search.slice(1) : search;
    const params = new URLSearchParams(query);
    return (
      params.get("entry") === "new-business" ||
      params.has("resume") ||
      params.has("debug")
    );
  }
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return ADMIN_HEADER_PREFIXES.some((p) => matchesPrefix(pathname, p));
  }
  if (HEADERLESS_PREFIXES.some((p) => matchesPrefix(pathname, p))) return false;
  return true;
}
