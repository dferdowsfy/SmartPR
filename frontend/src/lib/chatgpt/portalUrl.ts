// Where ChatGPT handoff links (Unlock / Use my plan / Continue) point.
//
// The handoff link is opened in the user's own browser from ChatGPT, so it
// must be a public SmartPR portal — never localhost and never the dev tunnel
// (ngrok etc.) that only exists to expose the MCP endpoint to ChatGPT.
//
// Resolution order:
//   1. CHATGPT_PORTAL_URL — runtime-only explicit override (not inlined at
//      build time). A localhost/private value is honoured only for local-only
//      testing, i.e. when the MCP request itself did not arrive via a public
//      host (an explicit tunnel URL is allowed — that is a deliberate choice).
//   2. The request's own origin, when it is a SmartPR production host
//      (*.getsmartpr.com) — keeps the link on the deployment that signed it.
//   3. NEXT_PUBLIC_SITE_URL, when it looks like a public portal (https, not
//      local, not a tunnel). NOTE: Next inlines NEXT_PUBLIC_* at BUILD time,
//      so a value exported only when running `next start` is ignored.
//   4. https://www.getsmartpr.com
//
// The token is verified by whichever portal opens it, so that portal must
// share CHATGPT_HANDOFF_SECRET with the server that signed it.

export const PORTAL_DEFAULT = "https://www.getsmartpr.com";

const TUNNEL_SUFFIXES = [
  "ngrok-free.app", "ngrok-free.dev", "ngrok.app", "ngrok.dev", "ngrok.io",
  "loca.lt", "localtunnel.me", "trycloudflare.com",
];

function parse(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h.endsWith(".localhost") || h === "0.0.0.0" || h === "::1" ||
    /^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".");
}

export function isTunnelHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return TUNNEL_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`));
}

const isSmartprHost = (hostname: string) => {
  const h = hostname.toLowerCase();
  return h === "getsmartpr.com" || h.endsWith(".getsmartpr.com");
};

/** https + public + not a dev tunnel. */
export function isPublicPortal(u: URL): boolean {
  return u.protocol === "https:" && !isLocalHost(u.hostname) && !isTunnelHost(u.hostname);
}

const origin = (u: URL) => `${u.protocol}//${u.host}`;

export interface PortalUrlInputs {
  portalOverride?: string | null; // CHATGPT_PORTAL_URL
  siteUrl?: string | null; // NEXT_PUBLIC_SITE_URL
  requestHost?: string | null; // x-forwarded-host || host
}

export function resolvePortalUrl(i: PortalUrlInputs): string {
  const reqHost = (i.requestHost || "").split(",")[0].trim();
  const reqHostname = reqHost.replace(/:\d+$/, "");
  const requestIsPublic = !!reqHostname && !isLocalHost(reqHostname);

  const override = parse(i.portalOverride);
  if (override && (!isLocalHost(override.hostname) || !requestIsPublic)) return origin(override);

  // Production is https-only; ignore an internal hop's x-forwarded-proto=http.
  if (requestIsPublic && isSmartprHost(reqHostname)) return `https://${reqHostname}`;

  const site = parse(i.siteUrl);
  if (site && isPublicPortal(site)) return origin(site);

  return PORTAL_DEFAULT;
}

/** Resolve from the live process env + an incoming request's headers. */
export function portalUrlForRequest(request: Request): string {
  const h = request.headers;
  return resolvePortalUrl({
    portalOverride: process.env.CHATGPT_PORTAL_URL,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    requestHost: h.get("x-forwarded-host") || h.get("host"),
  });
}
