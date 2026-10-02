/**
 * Teach-mode recorder events and their server-side sanitization.
 *
 * The in-page recorder (recorderScript.ts) already reports structure only:
 * page order, control labels, roles and selectors, plus a coarse value
 * *kind* (email / phone / number …) — never a value. The server does not
 * trust that: every event is re-sanitized here before it reaches a teach
 * session. Unknown keys are dropped, URLs lose their query strings, and any
 * text that contains one of the business's passport values, an email
 * address or a long digit run is scrubbed.
 */

export type TeachValueKind =
  | "empty"
  | "text"
  | "email"
  | "phone"
  | "postal"
  | "number"
  | "date"
  | "option"
  | "file"
  | "secret";

export type TeachControlRole =
  | "button"
  | "link"
  | "radio"
  | "checkbox"
  | "combobox"
  | "option"
  | "tab"
  | "textbox";

/** What kind of sensitive value a field takes (never the value itself). */
export type SecretKind = "password" | "ssn" | "code" | "payment";
const SECRET_KINDS: SecretKind[] = ["password", "ssn", "code", "payment"];

/** A visible sensitive input on the screen — where a one-time secure value goes. */
export interface SecretFieldRef {
  label: string;
  selector: string | null;
  kind: SecretKind;
}

/** A visible input on the screen, for typing into it from the chat. */
export interface PageFieldRef {
  label: string;
  selector: string | null;
  kind: "text" | SecretKind;
}

export interface TeachPageEvent {
  kind: "page";
  url: string;
  title: string;
  heading: string;
  hasPassword: boolean;
  hasCaptcha: boolean;
  hasFileInput: boolean;
  /** Visible sensitive inputs (password, SSN, one-time code, card). */
  secretFields: SecretFieldRef[];
  /** Every visible text-like input (sensitive ones carry their secret kind). */
  inputFields: PageFieldRef[];
}

export interface TeachClickEvent {
  kind: "click";
  url: string;
  role: Exclude<TeachControlRole, "textbox">;
  label: string;
  selector: string | null;
  inputType: string;
  /**
   * Visible text of a picked option (custom-dropdown option, radio). Kept
   * in a skill ONLY if the teacher says "always choose this"; scrubbed here
   * when it matches a passport value.
   */
  optionText: string;
}

export interface TeachFillEvent {
  kind: "fill";
  url: string;
  role: "textbox" | "combobox";
  label: string;
  selector: string | null;
  inputType: string;
  valueKind: TeachValueKind;
  required: boolean;
  /** Native <select> only: the picked option's text (same rules as click). */
  optionText: string;
  /** Sensitive field (valueKind "secret"): which kind. */
  secretKind: SecretKind | null;
}

export type TeachEvent = TeachPageEvent | TeachClickEvent | TeachFillEvent;

const MAX_TEXT = 160;
const VALUE_KINDS: TeachValueKind[] = ["empty", "text", "email", "phone", "postal", "number", "date", "option", "file", "secret"];
const CLICK_ROLES = ["button", "link", "radio", "checkbox", "combobox", "option", "tab"] as const;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
const DIGIT_RUN = /\d[\d\s().-]{2,}\d/g;

function str(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT) : "";
}

/** Scrub passport values, emails and 4+ digit runs out of visible text. */
export function scrubVisibleText(text: string, secrets: string[] = []): string {
  return scrubText(str(text), secrets);
}

function scrubText(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    out = out.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "…");
  }
  return out
    .replace(EMAIL, "…")
    .replace(DIGIT_RUN, (m) => (m.replace(/\D/g, "").length >= 4 ? "…" : m));
}

/** A selector is dropped rather than edited if it carries anything scrubbable. */
function scrubSelector(selector: unknown, secrets: string[]): string | null {
  const s = str(selector);
  if (!s) return null;
  if (EMAIL.test(s)) {
    EMAIL.lastIndex = 0;
    return null;
  }
  EMAIL.lastIndex = 0;
  const lower = s.toLowerCase();
  if (secrets.some((v) => lower.includes(v.toLowerCase()))) return null;
  // Only id / name / tag-path selectors are expected; anything quoting a
  // value attribute is refused.
  if (/\[(value|data-value|placeholder)\b/i.test(s)) return null;
  return s;
}

/** Keep scheme, host, path and the SPA hash route; drop query strings. */
function scrubUrl(url: unknown): string | null {
  try {
    const u = new URL(str(url) || String(url));
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const hash = u.hash.split("?")[0];
    return `${u.protocol}//${u.host}${u.pathname}${hash}`;
  } catch {
    return null;
  }
}

/**
 * Collect the passport's string values (and numbers written out) so they
 * can be scrubbed from recorded labels. Short values (< 3 chars) are
 * skipped — they would scrub ordinary words.
 */
export function passportScrubValues(passport: unknown): string[] {
  const out = new Set<string>();
  const walk = (node: unknown, depth: number) => {
    if (depth > 6 || node == null) return;
    if (typeof node === "string") {
      const v = node.trim();
      if (v.length >= 3) out.add(v);
    } else if (typeof node === "number" && String(node).length >= 3) {
      out.add(String(node));
    } else if (Array.isArray(node)) {
      node.forEach((n) => walk(n, depth + 1));
    } else if (typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach((n) => walk(n, depth + 1));
    }
  };
  walk(passport, 0);
  // Longest first so "Calle Luna 10" is scrubbed before "Luna".
  return [...out].sort((a, b) => b.length - a.length);
}

/**
 * Re-sanitize one raw recorder event. Returns null for anything malformed
 * or of an unknown kind. `secrets` = passportScrubValues(passport).
 */
export function sanitizeTeachEvent(raw: unknown, secrets: string[] = []): TeachEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const url = scrubUrl(r.url);
  if (!url) return null;
  const text = (v: unknown) => scrubText(str(v), secrets);

  switch (r.kind) {
    case "page":
      return {
        kind: "page",
        url,
        title: text(r.title),
        heading: text(r.heading),
        hasPassword: r.hasPassword === true,
        hasCaptcha: r.hasCaptcha === true,
        hasFileInput: r.hasFileInput === true,
        secretFields: (Array.isArray(r.secretFields) ? r.secretFields : [])
          .slice(0, 6)
          .map((f) => (f && typeof f === "object" ? (f as Record<string, unknown>) : {}))
          .map((f) => ({ label: text(f.label), selector: scrubSelector(f.selector, secrets), kind: SECRET_KINDS.find((k) => k === f.kind) ?? "password" }))
          .filter((f) => f.label || f.selector),
        inputFields: (Array.isArray(r.inputFields) ? r.inputFields : [])
          .slice(0, 12)
          .map((f) => (f && typeof f === "object" ? (f as Record<string, unknown>) : {}))
          .map((f) => ({ label: text(f.label), selector: scrubSelector(f.selector, secrets), kind: (SECRET_KINDS.find((k) => k === f.kind) ?? "text") as PageFieldRef["kind"] }))
          .filter((f) => f.selector),
      };
    case "click": {
      const role = CLICK_ROLES.find((x) => x === r.role);
      const label = text(r.label);
      if (!role || !label) return null;
      return {
        kind: "click",
        url,
        role,
        label,
        selector: scrubSelector(r.selector, secrets),
        inputType: str(r.inputType).toLowerCase().slice(0, 24),
        optionText: role === "option" || role === "radio" ? text(r.optionText) : "",
      };
    }
    case "fill": {
      const role = r.role === "combobox" ? "combobox" : "textbox";
      const label = text(r.label);
      if (!label) return null;
      const inputType = str(r.inputType).toLowerCase().slice(0, 24);
      let valueKind = VALUE_KINDS.find((k) => k === r.valueKind) ?? "text";
      let secretKind: SecretKind | null = SECRET_KINDS.find((k) => k === r.secretKind) ?? null;
      if (inputType === "password") secretKind ??= "password";
      if (secretKind) valueKind = "secret";
      else if (valueKind === "secret") secretKind = "password";
      return {
        kind: "fill",
        url,
        role,
        label,
        selector: scrubSelector(r.selector, secrets),
        inputType,
        valueKind,
        required: r.required === true,
        optionText: valueKind === "option" ? text(r.optionText) : "",
        secretKind,
      };
    }
    default:
      return null;
  }
}
