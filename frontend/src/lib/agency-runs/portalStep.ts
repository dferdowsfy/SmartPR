/**
 * Portal step model — what the live browser is showing when the agent
 * pauses, and therefore what (if anything) the chat may ask for.
 *
 * The chat must always match the visible browser step. Before this model,
 * any human-typed pause was a generic USER_LOGIN and an unparsed field list
 * fell back to a hard-coded email/password/MFA form — so a certification
 * page showed a login form in chat. Now:
 *
 * - The agent reports the visible step on every pause:
 *     PORTAL_STEP: kind=<kind>; title=<visible heading>; missing=<labels, comma-separated>
 * - Only ordinary data steps (form, identity) ever render inline inputs, and
 *   never credential fields.
 * - Human-only steps (login, MFA, captcha, certification, signature,
 *   payment, review, submission) render a "do this in the browser" card
 *   with Take over — SmartPR never collects government credentials and
 *   Mita never certifies, signs, pays or submits.
 * - Anything inconsistent or unidentified resolves to "unknown", which
 *   pauses safely and offers Take over instead of guessing.
 *
 * Metadata only — never values.
 */
import type { AgencyPauseReason, AgencyPendingField } from "./types";
import { parseRequiredFields } from "./pendingFields";

export type PortalStepKind =
  | "login"
  | "mfa"
  | "captcha"
  | "form"
  | "identity"
  | "upload"
  | "certification"
  | "signature"
  | "payment"
  | "review"
  | "submission"
  | "unknown";

export interface PortalStep {
  kind: PortalStepKind;
  /** Visible page heading as reported by the agent (labels only). */
  title: string | null;
  /** Labels of required items still empty on a human-only step (e.g. "Signature (printed name)"). */
  missing: string[];
  /** True when the agent (or the page itself) declared the step; false when inferred. */
  declared: boolean;
}

const KINDS = new Set<PortalStepKind>([
  "login", "mfa", "captcha", "form", "identity", "upload", "certification",
  "signature", "payment", "review", "submission", "unknown",
]);

/** Steps the human completes in the browser. The chat never renders inputs for these. */
export const HUMAN_ONLY_STEPS: ReadonlySet<PortalStepKind> = new Set<PortalStepKind>([
  "login", "mfa", "captcha", "certification", "signature", "payment",
  "review", "submission", "unknown",
]);

/** Steps where the chat may collect ordinary (non-credential) values. */
export const INLINE_STEPS: ReadonlySet<PortalStepKind> = new Set<PortalStepKind>(["form", "identity"]);

const CREDENTIAL_ID_RE = /^(password|pass|passwd|pwd|mfa|otp|totp|pin|username|user_name|login|verification_code|security_code|one_time_code)$/i;
const CREDENTIAL_LABEL_RE = /password|contrase[ñn]a|\bmfa\b|\botp\b|one[\s-]?time|c[óo]digo de verificaci[óo]n|verification code|2fa|two[\s-]?factor/i;

/** Credential fields are never collected in SmartPR chat — authentication happens via takeover. */
export function isCredentialField(field: AgencyPendingField): boolean {
  return (
    field.type === "password" ||
    CREDENTIAL_ID_RE.test(field.id) ||
    CREDENTIAL_LABEL_RE.test(field.label)
  );
}

/** Parse a `PORTAL_STEP:` line. Returns null when absent or malformed. */
export function parsePortalStep(text: string): PortalStep | null {
  if (!text) return null;
  // Last occurrence wins — the final message of the turn describes the page now.
  const matches = [...text.matchAll(/PORTAL_STEP\s*:\s*([^\n\r]+)/gi)];
  const line = matches.at(-1)?.[1];
  if (!line) return null;
  const map: Record<string, string> = {};
  for (const part of line.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    map[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  const kind = (map.kind || "").toLowerCase() as PortalStepKind;
  if (!KINDS.has(kind)) return null;
  const missing = (map.missing || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && !/^(none|n\/a|-)$/i.test(s))
    .slice(0, 8)
    .map((s) => s.slice(0, 120));
  const title = map.title?.trim() ? map.title.trim().slice(0, 160) : null;
  return { kind, title, missing, declared: true };
}

/** Best-effort step when the agent did not declare one (older prompts, mock). */
function inferKind(reason: AgencyPauseReason, fields: AgencyPendingField[]): PortalStepKind {
  if (reason === "USER_UPLOAD") return "upload";
  if (reason === "CAPTCHA") return "captcha";
  if (reason === "PAYMENT") return "payment";
  if (fields.length === 0) return "unknown";
  const creds = fields.filter(isCredentialField);
  if (creds.length === fields.length) return "login";
  if (creds.length > 0) return "unknown"; // credential mixed into a data step — don't guess
  return fields.some((f) => /ssn|itin|tax_id|seguro social/i.test(`${f.id} ${f.label}`))
    ? "identity"
    : "form";
}

export interface PauseState {
  step: PortalStep;
  /** Inline fields the chat may render — empty for every human-only step. */
  fields: AgencyPendingField[];
}

/**
 * Resolve the paused portal step and the inline fields for it. The result
 * is always self-consistent: inline fields exist only for form/identity
 * steps, never include credentials, and any contradiction (e.g. login
 * fields reported on a certification page) becomes "unknown".
 */
export function resolvePauseState(text: string, reason: AgencyPauseReason): PauseState {
  const parsed = parseRequiredFields(text);
  const declared = parsePortalStep(text);
  let kind: PortalStepKind = declared?.kind ?? inferKind(reason, parsed);

  const credentialFields = parsed.filter(isCredentialField);
  const dataFields = parsed.filter((f) => !isCredentialField(f));

  if (INLINE_STEPS.has(kind)) {
    // A data step that lists credentials, or lists nothing, is not a state
    // we can render confidently.
    if (credentialFields.length > 0 || dataFields.length === 0) kind = "unknown";
  }

  const missing = new Set<string>(declared?.missing ?? []);
  if (!INLINE_STEPS.has(kind) && kind !== "login" && kind !== "mfa") {
    // e.g. certification: surface "Signature (printed name)" as a named
    // item to complete in the browser, not as an input.
    for (const f of dataFields) missing.add(f.label);
  }

  return {
    step: {
      kind,
      title: declared?.title ?? null,
      missing: [...missing],
      declared: Boolean(declared),
    },
    fields: INLINE_STEPS.has(kind) ? dataFields : [],
  };
}

/** Short bilingual chat copy for a paused step. */
export function stepPauseMessage(
  step: PortalStep,
  fields: AgencyPendingField[]
): { message: string; message_es: string } {
  const miss = step.missing.length ? ` — missing: ${step.missing.join(", ")}` : "";
  const missEs = step.missing.length ? ` — falta: ${step.missing.join(", ")}` : "";
  switch (step.kind) {
    case "form":
    case "identity": {
      const labels = fields.map((f) => f.label).join(", ");
      return {
        message: `The portal needs: ${labels} — answer in the chat`,
        message_es: `El portal necesita: ${labels} — responde en el chat`,
      };
    }
    case "login":
    case "mfa":
      return {
        message: "Sign in on the portal yourself — take over the browser, then press “I'm done”",
        message_es: "Inicia sesión en el portal tú mismo — toma el control del navegador y luego pulsa “Terminé”",
      };
    case "captcha":
      return {
        message: "Complete the portal's human check in the browser (Take over)",
        message_es: "Completa la verificación humana del portal en el navegador (Tomar el control)",
      };
    case "certification":
    case "signature":
      return {
        message: `Certification step — review and sign it in the browser${miss}`,
        message_es: `Paso de certificación — revísalo y fírmalo en el navegador${missEs}`,
      };
    case "payment":
      return {
        message: "Payment step — review and pay in the browser yourself",
        message_es: "Paso de pago — revisa y paga tú mismo en el navegador",
      };
    case "review":
    case "submission":
      return {
        message: "Final review — check it in the browser and submit it yourself",
        message_es: "Revisión final — revísala en el navegador y envíala tú mismo",
      };
    case "upload":
      return {
        message: "Upload the requested documents, then resume",
        message_es: "Sube los documentos solicitados y luego reanuda",
      };
    case "unknown":
      return {
        message: "I can't tell what this page needs — take over the browser to continue",
        message_es: "No puedo identificar qué pide esta página — toma el control del navegador para continuar",
      };
  }
}
