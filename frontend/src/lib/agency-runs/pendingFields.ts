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

/**
 * Hints that look like portal validation failures (when error= was not used).
 * Used by Assistant UI to surface a prominent alert banner.
 */
export const VALIDATION_HINT_RE =
  /error|invalid|inválid|incorrect|no es válido|formato|rejected|must |debe /i;

/** Fallback when USER_LOGIN pause has no parsed REQUIRED_FIELDS (preserves #88 UX). */
export const DEFAULT_LOGIN_PENDING_FIELDS: AgencyPendingField[] = [
  { id: "email", label: "Email", type: "email", sensitive: false },
  { id: "password", label: "Password", type: "password", sensitive: true },
  { id: "mfa", label: "MFA code", type: "text", sensitive: true, optional: true },
];

/**
 * Subset of pending fields the human already supplied once (by id). When the
 * agent re-requests these after a resume, the Assistant shows a confirm card
 * ("you already provided this") instead of blank inputs — the user only
 * re-types when a value was actually wrong or rejected.
 */
export function fieldsAskedAgain(
  pending: AgencyPendingField[],
  suppliedIds: readonly string[] | null | undefined
): AgencyPendingField[] {
  if (!pending.length || !suppliedIds || suppliedIds.length === 0) return [];
  const supplied = new Set(suppliedIds);
  return pending.filter((f) => supplied.has(f.id));
}

/**
 * Value-backed variant of fieldsAskedAgain. The "you already provided this"
 * banner (and its pre-filled value) may ONLY render when we actually retain
 * a previously-submitted non-empty value for that field id in this run —
 * otherwise the card renders as the normal empty prompt. Guards against the
 * misfire where an id is marked supplied (e.g. seeded from pre-flight) but
 * no value was ever retained client-side.
 */
export function askedAgainWithValues(
  pending: AgencyPendingField[],
  suppliedIds: readonly string[] | null | undefined,
  valuesById: Record<string, string> | null | undefined
): AgencyPendingField[] {
  if (!pending.length || !suppliedIds || suppliedIds.length === 0) return [];
  if (!valuesById || typeof valuesById !== "object") return [];
  const supplied = new Set(suppliedIds);
  return pending.filter(
    (f) => supplied.has(f.id) && Boolean((valuesById[f.id] || "").trim())
  );
}

/**
 * Ids of a fields map that actually carry a non-empty string value.
 * Pure — ids only, never values.
 */
export function suppliedFieldIdsFrom(
  fields: Record<string, unknown> | null | undefined
): string[] {
  if (!fields || typeof fields !== "object") return [];
  return Object.keys(fields).filter((id) => {
    if (typeof id !== "string" || id.trim() === "") return false;
    const v = (fields as Record<string, unknown>)[id];
    return typeof v === "string" && v.trim() !== "";
  });
}

/**
 * Merge newly submitted field ids into the run's supplied list (dedup,
 * insertion order). Ids only — never values. Pure for tests.
 */
export function mergeSuppliedFieldIds(
  existing: readonly string[] | null | undefined,
  submitted: Record<string, unknown> | null | undefined
): string[] {
  const next = [...(existing ?? [])];
  for (const id of suppliedFieldIdsFrom(submitted)) {
    if (!next.includes(id)) next.push(id);
  }
  return next;
}

/**
 * Parse a REQUIRED_FIELDS block from agent text.
 *
 * Expected format (line-based, LLM-reliable):
 * ```
 * REQUIRED_FIELDS:
 * - id=email; label=Email; type=email; sensitive=false
 * - id=password; label=Password; type=password; sensitive=true
 * - id=mfa; label=MFA code; type=text; sensitive=true; optional=true
 * - id=ssn; label=SSN; type=text; sensitive=true; hint=9 digits as shown on the portal
 * - id=ssn; label=SSN; type=text; sensitive=true; hint=9 digits; error=Portal: el número de ID no es válido
 * ```
 * Hints and errors must not contain `;` (they are the value after `hint=` / `error=` on that segment).
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
    const hint = map.hint?.trim() || undefined;
    const error = map.error?.trim() || undefined;

    const field: AgencyPendingField = { id, label, type, sensitive };
    if (optional) field.optional = true;
    if (hint) field.hint = hint.slice(0, 240);
    if (error) field.error = error.slice(0, 240);
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

/** True when a field has an explicit error= or a hint that looks like validation failure. */
export function fieldHasValidationIssue(field: AgencyPendingField): boolean {
  if (field.error?.trim()) return true;
  if (field.hint?.trim() && VALIDATION_HINT_RE.test(field.hint)) return true;
  return false;
}

/**
 * Unique portal validation messages for the Assistant alert banner.
 * Prefers error=; falls back to validation-looking hints.
 */
export function collectPortalValidationMessages(
  fields: AgencyPendingField[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of fields) {
    const msg = (f.error?.trim() || (f.hint?.trim() && VALIDATION_HINT_RE.test(f.hint) ? f.hint.trim() : "")) || "";
    if (!msg) continue;
    const key = msg.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(msg);
  }
  return out;
}

/** True when agent text is mostly pause/marker protocol (ugly in Assistant). */
export function looksLikePauseMarkerSpam(text: string): boolean {
  if (!text) return false;
  const upper = text.toUpperCase();
  return (
    /PAUSE_USER_LOGIN|PAUSE_USER_UPLOAD|PAUSE_CAPTCHA|PAUSE_PAYMENT|REQUIRED_FIELDS\s*:/i.test(
      upper
    ) || /\bUSER_LOGIN\b/.test(upper)
  );
}

/**
 * Short bilingual Assistant copy for a pause — never dump raw REQUIRED_FIELDS.
 * Raw text stays for internal parsing only.
 */
export function humanizePauseEvent(
  reason: AgencyPauseReason,
  fields: AgencyPendingField[],
  rawText?: string
): { message: string; message_es: string } {
  const hasFieldError = fields.some((f) => fieldHasValidationIssue(f));
  if (hasFieldError) {
    return {
      message: "SURI rejected a value — see the error in Assistant and fix below",
      message_es:
        "SURI rechazó un valor — vea el error en Asistente y corríjalo abajo",
    };
  }

  const labels = fields.map((f) => f.label).filter(Boolean);
  const ids = fields.map((f) => f.id.toLowerCase());
  const hasSsn = ids.some((id) => /^(ssn|itin|tax_id|id_number|numero_id)$/.test(id) || id.includes("ssn"));
  const hasLogin =
    reason === "USER_LOGIN" ||
    ids.some((id) => id === "password" || id === "email" || id === "mfa");

  if (labels.length > 0) {
    const listEn = labels.join(", ");
    const listEs = labels.join(", ");
    if (hasSsn && !hasLogin) {
      return {
        message: `The portal needs your ID / SSN (${listEn}) — enter it in Assistant`,
        message_es: `El portal necesita su ID / SSN (${listEs}) — escríbalo en Asistente`,
      };
    }
    if (hasLogin) {
      return {
        message: `Sign-in needed (${listEn}) — enter it in Assistant`,
        message_es: `Se necesita inicio de sesión (${listEs}) — escríbalo en Asistente`,
      };
    }
    return {
      message: `The portal needs: ${listEn} — enter ${labels.length === 1 ? "it" : "them"} in Assistant`,
      message_es: `El portal necesita: ${listEs} — escríbalo${labels.length === 1 ? "" : "s"} en Asistente`,
    };
  }

  if (reason === "USER_UPLOAD") {
    return {
      message: "Upload required documents, then Resume",
      message_es: "Suba los documentos requeridos y luego Reanudar",
    };
  }
  if (reason === "CAPTCHA") {
    return {
      message: "Complete the captcha in the live browser (Take over)",
      message_es: "Complete el captcha en el navegador en vivo (Tomar el control)",
    };
  }
  if (reason === "PAYMENT") {
    return {
      message: "Complete payment in the live browser (Take over)",
      message_es: "Complete el pago en el navegador en vivo (Tomar el control)",
    };
  }
  if (reason === "USER_LOGIN") {
    return {
      message: "The portal needs your sign-in — enter it in Assistant",
      message_es: "El portal necesita su inicio de sesión — escríbalo en Asistente",
    };
  }

  // Strip protocol lines from any leftover prose so Assistant stays readable.
  const cleaned = (rawText || "")
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trim();
      if (!t) return false;
      if (/^PAUSE_/i.test(t)) return false;
      if (/^REQUIRED_FIELDS\s*:/i.test(t)) return false;
      if (/^-\s*id=/i.test(t)) return false;
      return true;
    })
    .join(" ")
    .trim()
    .slice(0, 280);

  if (cleaned) {
    return { message: cleaned, message_es: cleaned };
  }

  return {
    message: "Paused — waiting for your action",
    message_es: "Pausado — esperando su acción",
  };
}

/**
 * Display messages for Assistant events. When the agent blob is marker spam,
 * return a humanized pause message; otherwise keep a trimmed copy of the text.
 */
export function displayMessagesForAgentText(
  raw: string,
  pauseReason: AgencyPauseReason | undefined,
  fields: AgencyPendingField[]
): { message: string; message_es: string } {
  if (looksLikePauseMarkerSpam(raw)) {
    return humanizePauseEvent(pauseReason ?? null, fields, raw);
  }
  const trimmed = raw.trim().slice(0, 500);
  return { message: trimmed, message_es: trimmed };
}
