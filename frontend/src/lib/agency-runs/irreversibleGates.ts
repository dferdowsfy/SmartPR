/**
 * Pause-before-irreversible gates for Agency Assist.
 *
 * Certain portal steps (attestation, certification, signature, payment,
 * final submission) must NEVER happen without the human explicitly
 * approving them in the moment. This module owns the gate registry and the
 * bilingual gate copy shown when a run reaches one. Pure functions only.
 */
import type { Lang } from "../../app/forms/engine/types";

export const IRREVERSIBLE_GATES = [
  "attestation",
  "certification",
  "signature",
  "payment",
  "final_submission",
] as const;

export type IrreversibleGate = (typeof IRREVERSIBLE_GATES)[number];

export interface GateCopy {
  title_en: string;
  title_es: string;
  body_en: string;
  body_es: string;
}

const GATE_COPY: Record<IrreversibleGate, GateCopy> = {
  attestation: {
    title_en: "Please confirm this statement",
    title_es: "Confirma esta declaración",
    body_en:
      "The portal is asking you to attest that the information is true and correct. " +
      "SmartPR can prepare the text, but only you can give that attestation — read it carefully before continuing.",
    body_es:
      "El portal te pide declarar que la información es cierta y correcta. " +
      "SmartPR puede preparar el texto, pero solo tú puedes hacer esa declaración — léela con calma antes de continuar.",
  },
  certification: {
    title_en: "Certification needed",
    title_es: "Certificación necesaria",
    body_en:
      "The portal needs you to certify the filing. SmartPR has everything prepared — " +
      "review it, then certify it yourself.",
    body_es:
      "El portal necesita que certifiques la radicación. SmartPR lo tiene todo preparado — " +
      "revísalo y certifícalo tú mismo.",
  },
  signature: {
    title_en: "Your signature is needed",
    title_es: "Se necesita tu firma",
    body_en:
      "This step requires your signature. SmartPR will never sign on your behalf — " +
      "review the document and sign it yourself.",
    body_es:
      "Este paso requiere tu firma. SmartPR nunca firmará por ti — " +
      "revisa el documento y fírmalo tú mismo.",
  },
  payment: {
    title_en: "Payment authorization needed",
    title_es: "Se necesita autorización de pago",
    body_en:
      "The portal is asking for payment. SmartPR will never charge anything without " +
      "your explicit approval — check the amount, then complete the payment yourself.",
    body_es:
      "El portal está pidiendo un pago. SmartPR nunca hará un cargo sin tu aprobación " +
      "explícita — verifica el monto y completa el pago tú mismo.",
  },
  final_submission: {
    title_en: "Ready to submit — your call",
    title_es: "Lista para enviar — tú decides",
    body_en:
      "SmartPR has prepared everything and it is ready for your review. Nothing " +
      "is submitted until you authorize it — review every field, confirm the " +
      "information is true and correct, then let SmartPR file it for you.",
    body_es:
      "SmartPR preparó todo y está listo para tu revisión. No se envía nada " +
      "hasta que tú lo autorices — revisa cada campo, confirma que la " +
      "información es cierta y correcta, y deja que SmartPR lo radique por ti.",
  },
};

/**
 * Bilingual gate copy. `lang` is accepted for signature consistency with the
 * other agency-runs helpers; both languages are always returned.
 */
export function gateCopy(gate: IrreversibleGate, lang: Lang): GateCopy {
  void lang;
  return GATE_COPY[gate];
}

/** True when the gate id is a known irreversible gate. */
export function isIrreversibleGate(value: string): value is IrreversibleGate {
  return (IRREVERSIBLE_GATES as readonly string[]).includes(value);
}
