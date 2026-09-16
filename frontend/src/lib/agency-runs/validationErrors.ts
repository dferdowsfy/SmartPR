/**
 * Translate portal validation text into human language.
 *
 * Hard rules:
 * - Never invent an explanation that is not present in the raw text.
 * - Never surface secrets (SSN values, passwords, MFA codes) — redacted
 *   before any quoting.
 * - Internal/technical phrasing (selectors, timeouts, DOM, element ids) must
 *   never reach the user; purely technical text falls back to a generic,
 *   honest message.
 * Pure functions only — no I/O.
 */
import type { AgencyPauseReason } from "./types";
import type { Lang as FormsLang } from "../../app/forms/engine/types";

const L = (en: string, es: string, lang: FormsLang): string =>
  lang === "es" ? es : en;

// "ssn" as a standalone token (not part of an element id like #ssn-field).
const SSN_RE = /(?<![a-záéíóúñ-])ssn(?![a-záéíóúñ-])|social security|seguro social|(?<![a-záéíóúñ-])itin(?![a-záéíóúñ-])/i;
const NINE_DIGITS_RE = /9\s*(digit|d[ií]gito)/i;

// Internal automation phrasing that must never be shown to the user.
const TECH_RE =
  /selector|timed?\s*out|\bdom\b|queryselector|xpath|element\s*(id|not found)|stack\s*trace|null\s*reference|::[\w-]+|#[\w-]{2,}/i;

// SSN-shaped values (with separators) must never be echoed back.
const SSN_VALUE_RE = /\b\d{3}[- ]\d{2}[- ]\d{4}\b/g;

function cleanRaw(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(SSN_VALUE_RE, "[removed]")
    .slice(0, 300);
}

/**
 * Humanize a portal validation error. Falls back to quoting the raw text
 * plainly when no specific rule matches — never invents an explanation.
 */
export function humanizeValidationError(
  raw: string | undefined | null,
  lang: FormsLang
): string {
  if (!raw || !raw.trim()) {
    return L(
      "The website is flagging a field, but it did not give a specific reason.",
      "El portal está marcando un campo, pero no dio una razón específica.",
      lang
    );
  }

  const text = raw.trim();

  if (SSN_RE.test(text)) {
    if (NINE_DIGITS_RE.test(text)) {
      return L(
        "The site rejected that value. The Social Security number must contain exactly 9 digits.",
        "El portal rechazó ese valor. El número de Seguro Social debe tener exactamente 9 dígitos.",
        lang
      );
    }
    return L(
      "The site rejected the Social Security number that was entered — it has to match the format the portal expects.",
      "El portal rechazó el número de Seguro Social ingresado — tiene que seguir el formato que espera el portal.",
      lang
    );
  }

  if (TECH_RE.test(text)) {
    return L(
      "SmartPR couldn't complete that step on the website, so I stopped before taking another action.",
      "SmartPR no pudo completar ese paso en el portal, así que me detuve antes de hacer otra cosa.",
      lang
    );
  }

  const quoted = cleanRaw(text);
  return L(
    `The site says: "${quoted}"`,
    `El portal indica: "${quoted}"`,
    lang
  );
}

export interface InterventionHeading {
  title_en: string;
  title_es: string;
  sub_en: string;
  sub_es: string;
}

const INTERVENTION_COPY: Record<string, InterventionHeading> = {
  USER_LOGIN: {
    title_en: "One more item needed",
    title_es: "Falta un dato",
    sub_en:
      "Sign in on the portal so I can keep going — your credentials stay with you.",
    sub_es:
      "Inicia sesión en el portal para poder continuar — tus credenciales se quedan contigo.",
  },
  USER_UPLOAD: {
    title_en: "Documents needed",
    title_es: "Documentos necesarios",
    sub_en: "Upload the requested documents, then resume.",
    sub_es: "Sube los documentos solicitados y luego reanuda.",
  },
  CAPTCHA: {
    title_en: "Quick check on the portal",
    title_es: "Verificación rápida en el portal",
    sub_en:
      "The portal wants to make sure you're human — complete the check in the live browser, then resume.",
    sub_es:
      "El portal quiere confirmar que eres humano — completa la verificación en el navegador en vivo y luego reanuda.",
  },
  PAYMENT: {
    title_en: "Payment authorization needed",
    title_es: "Se necesita autorización de pago",
    sub_en:
      "The portal is asking for payment. SmartPR will never pay anything without your explicit approval — review the amount and authorize it yourself.",
    sub_es:
      "El portal está pidiendo un pago. SmartPR nunca pagará nada sin tu aprobación explícita — revisa el monto y autorízalo tú mismo.",
  },
  NONE: {
    title_en: "Waiting on you",
    title_es: "Esperándote",
    sub_en: "I need one item from you before I can continue.",
    sub_es: "Necesito un dato tuyo antes de poder continuar.",
  },
};

/**
 * Title + subheading for a pause intervention card. Payment copy explicitly
 * states SmartPR never pays without approval (pause-before-irreversible).
 */
export function interventionHeading(
  pauseReason: AgencyPauseReason,
  lang: FormsLang
): InterventionHeading {
  void lang; // Both languages are always returned; signature kept for consistency.
  return INTERVENTION_COPY[pauseReason ?? "NONE"] ?? INTERVENTION_COPY.NONE!;
}
