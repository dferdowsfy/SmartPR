// Same-origin guard for state-changing /api/* requests (CSRF), used by
// src/middleware.ts.
//
// A site on another origin can make the user's browser send their session
// cookie with a cross-site POST; it cannot make the browser send an
// Authorization header or one of our secrets. So the guard applies to
// cookie-style browser requests, and machine-to-machine callers (Stripe, cron,
// SCIM, the MCP and voice connectors) keep working: they authenticate with
// their own headers and send no Origin.

type HeaderSource = { get(name: string): string | null; has(name: string): boolean };
export interface GuardRequest {
  headers: HeaderSource;
  nextUrl: { pathname: string };
}

export const ALLOWED_API_HOSTS = new Set(["www.getsmartpr.com", "getsmartpr.com", "trust.getsmartpr.com", "localhost", "127.0.0.1"]);
export const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Server-to-server endpoints, each authenticated by its own signature, secret or token. */
const MACHINE_API_PREFIXES = [
  "/api/billing/webhook",
  "/api/voice/xai-webhook",
  "/api/scim/",
  "/api/mcp/",
  "/api/chatgpt/",
  "/api/voice/v1/",
  "/api/voice/phone/",
  "/api/voice/session/",
  "/api/voice/action/",
];
/** Credentials a browser never attaches on its own to a cross-site request. */
const MACHINE_AUTH_HEADERS = ["authorization", "x-cron-secret", "stripe-signature"];

function hostnameOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function ownHosts(req: GuardRequest): Set<string> {
  const first = (v: string | null) => v?.split(",")[0]?.split(":")[0]?.trim().toLowerCase() ?? "";
  return new Set([first(req.headers.get("host")), first(req.headers.get("x-forwarded-host"))].filter(Boolean));
}

export function isMachineApiRequest(req: GuardRequest): boolean {
  const path = req.nextUrl.pathname;
  if (MACHINE_API_PREFIXES.some((p) => path === p || path.startsWith(p))) return true;
  return MACHINE_AUTH_HEADERS.some((h) => req.headers.has(h));
}

/** True when a browser request's Origin (else Referer) is this app. */
export function isValidApiOrigin(req: GuardRequest): boolean {
  const claimed = hostnameOf(req.headers.get("origin")) ?? hostnameOf(req.headers.get("referer"));
  if (!claimed) {
    // Every current browser sends Origin on POST/PUT/PATCH/DELETE; a request
    // with neither header is not a browser, and is refused in production.
    return process.env.NODE_ENV !== "production";
  }
  return ALLOWED_API_HOSTS.has(claimed) || ownHosts(req).has(claimed);
}
