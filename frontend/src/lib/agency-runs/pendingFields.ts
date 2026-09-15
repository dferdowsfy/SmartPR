/**
 * Parse and resolve REQUIRED_FIELDS blocks from Browser Use agent output.
 * Metadata only — never values.
 */
import type {
  AgencyPauseReason,
  AgencyPendingField,
  AgencyPendingFieldType,
} from "./types";

const FIELD_TYPES = new Set<AgencyPendingFieldType>([
  "text",
  "email",
  "password",
  "tel",
  "number",
]);

/** Fallback when USER_LOGIN pause has no parsed REQUIRED_FIELDS (preserves #88 UX). */
export const DEFAULT_LOGIN_PENDING_FIELDS: AgencyPendingField[] = [
  { id: "email", label: "Email", type: "email", sensitive: false },
  { id: "password", label: "Password", type: "password", sensitive: true },
  { id: "mfa", label: "MFA code", type: "text", sensitive: true, optional: true },
];

/**
 * Parse a REQUIRED_FIELDS block from agent text.
 *
 * Expected format (line-based, LLM-reliable):
 * ```
 * REQUIRED_FIELDS:
 * - id=email; label=Email; type=email; sensitive=false
 * - id=password; label=Password; type=password; sensitive=true
 * - id=mfa; label=MFA code; type=text; sensitive=true; optional=true
 * ```
 */
export function parseRequiredFields(text: string): AgencyPendingField[] {
  if (!text || typeof text !== "string") return [];

  // Allow marker and fields to span multiple lines; tolerate optional blank lines
  // after the header and slight casing/spacing drift from the LLM.
  const header = /REQUIRED_FIELDS\s*:/i.exec(text);
  if (!header || header.index === undefined) return [];

  const after = text.slice(header.index + header[0].length);
  const lines = after.split(/\r?\n/);
  const fields: AgencyPendingField[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      // Blank line after header is fine; stop once we've started collecting
      // and hit a blank that isn't just spacing — keep reading while lines
      // look like field entries or are empty before the first entry.
      if (fields.length > 0) break;
      continue;
    }
    if (!line.startsWith("-")) {
      // Non-field content ends the block (e.g. next paragraph).
      if (fields.length > 0) break;
      continue;
    }

    const body = line.replace(/^-\s*/, "");
    const map: Record<string, string> = {};
    for (const part of body.split(";")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim().toLowerCase();
      const val = trimmed.slice(eq + 1).trim();
      if (key) map[key] = val;
    }

    const idRaw = map.id || "";
    const id = idRaw
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_-]/g, "");
    if (!id) continue;

    const label = map.label?.trim() || id;
    const typeRaw = (map.type || "text").toLowerCase() as AgencyPendingFieldType;
    const type: AgencyPendingFieldType = FIELD_TYPES.has(typeRaw) ? typeRaw : "text";
    const sensitive = /^(true|1|yes)$/i.test(map.sensitive || "");
    const optional = /^(true|1|yes)$/i.test(map.optional || "");

    const field: AgencyPendingField = { id, label, type, sensitive };
    if (optional) field.optional = true;
    fields.push(field);
  }

  return fields;
}

/**
 * Resolve pending fields for a pause: prefer parsed REQUIRED_FIELDS;
 * fall back to default email/password/mfa for USER_LOGIN (preserve #88 UX).
 */
export function resolvePendingFields(
  text: string,
  pauseReason: AgencyPauseReason
): AgencyPendingField[] {
  const parsed = parseRequiredFields(text);
  if (parsed.length > 0) return parsed;
  if (pauseReason === "USER_LOGIN") return [...DEFAULT_LOGIN_PENDING_FIELDS];
  return [];
}
