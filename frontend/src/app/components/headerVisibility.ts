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

// Route patterns (not prefixes) that stay headerless.
const HEADERLESS_PATTERNS: RegExp[] = [
  // The agency-run workspace is a full-viewport filing environment with its
  // own compact header; the global nav is removed there so the embedded
  // browser and the chat panes get the full height.
  /\/agency-run(\/|$)/,
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export function shouldShowHeader(pathname: string, search: string): boolean {
  if (HEADERLESS_PATTERNS.some((re) => re.test(pathname))) return false;
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
