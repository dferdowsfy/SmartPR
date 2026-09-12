// ============================================================================
// Enterprise branding helpers — Phase 8 (pure functions; safe to unit-test).
//
// Two-step logo flow: POST /api/enterprise/branding/logo uploads a file into
// the private `brand-assets` bucket and returns a signed preview URL plus the
// storage path. PUT /api/enterprise/branding then publishes by referencing
// those paths. This module validates the publish-side inputs.
// ============================================================================

export const LOGO_KINDS = ["primary", "compact", "favicon"] as const;
export type LogoKind = (typeof LOGO_KINDS)[number];

export function isLogoKind(v: unknown): v is LogoKind {
  return typeof v === "string" && (LOGO_KINDS as readonly string[]).includes(v);
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

/** Extension for an uploaded logo from its MIME type; null when unsupported. */
export function logoExtensionForMime(mime: string): string | null {
  return MIME_TO_EXT[mime.toLowerCase()] ?? null;
}

export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/**
 * Validate a logo storage path for publishing. Paths must be exactly the
 * shape the upload step produces, scoped to the workspace being branded —
 * this binds the two-step flow (a client cannot publish an arbitrary path).
 */
export function isPublishableLogoPath(
  path: unknown,
  workspaceId: string,
  kind: LogoKind
): boolean {
  if (typeof path !== "string" || !path) return false;
  const uuid = workspaceId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${uuid}/${kind}-\\d+-[0-9a-f]+\\.[a-z0-9]{2,4}$`).test(path);
}

// ---------------------------------------------------------------------------
// email_header_html sanitization
// ---------------------------------------------------------------------------

/**
 * Basic server-side sanitizer for the branded email header HTML.
 * Strips <script>/<style>/<iframe>/<object>/<embed> blocks, event-handler
 * attributes (on*), and javascript:/data: URLs. This is a defense-in-depth
 * measure for admin-authored HTML — not a full XSS sanitizer for untrusted
 * input, and it is documented as such.
 */
export function sanitizeEmailHeaderHtml(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null;
  if (typeof input !== "string") return null;
  let html = input;
  // Remove dangerous element blocks entirely.
  html = html.replace(
    /<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    ""
  );
  html = html.replace(/<\s*(script|iframe|object|embed)[^>]*\/?>/gi, "");
  // Remove event-handler attributes (onclick, onerror, ...).
  html = html.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Neutralize javascript:/data:/vbscript: URLs in href/src attributes.
  html = html.replace(
    /\s+(href|src|xlink:href)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (_m, attr, _q, d1, d2, d3) => {
      const url = (d1 ?? d2 ?? d3 ?? "").trim().toLowerCase();
      if (/^(javascript|data|vbscript):/.test(url)) return ` ${attr}="#"`;
      return _m;
    }
  );
  html = html.trim();
  return html || null;
}

// ---------------------------------------------------------------------------
// login_branding / terminology validation
// ---------------------------------------------------------------------------

const TERMINOLOGY_KEYS = [
  "project_label",
  "requirement_label",
  "facility_label",
  "evidence_label",
  "workspace_label",
] as const;

export type TerminologyKey = (typeof TERMINOLOGY_KEYS)[number];

/**
 * Validate the terminology overrides object. Returns the cleaned map
 * (string values only, trimmed, max 60 chars) or null when invalid.
 */
export function validateTerminology(input: unknown): Record<string, string> | null {
  if (input === null || input === undefined) return {};
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!(TERMINOLOGY_KEYS as readonly string[]).includes(k)) continue;
    if (typeof v !== "string") return null;
    const trimmed = v.trim().slice(0, 60);
    if (trimmed) out[k] = trimmed;
  }
  return out;
}

/** login_branding must be a plain JSON object when provided. */
export function validateLoginBranding(input: unknown): Record<string, unknown> | null {
  if (input === null || input === undefined) return {};
  if (typeof input !== "object" || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

export function isHexColor(v: unknown): v is string {
  return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
}
