/**
 * Default handoff copy for skill gates — what Clara says when she stops and
 * hands a step to the human. Puerto Rican Spanish, tú form, outcome first.
 * Taught skills get these; hand-written skills may override per portal.
 */
import type { BilingualText, SkillGate } from "./skill";

export const DEFAULT_GATES: Record<string, { type: SkillGate["type"]; note: string; handoff: BilingualText }> = {
  login: {
    type: "human",
    note: "The human signs in with their own portal account.",
    handoff: {
      en: "Sign in to the portal yourself in the browser. SmartPR never sees or types your password. Tell me when you're in.",
      es: "Entra tú al portal en el navegador. SmartPR nunca ve ni escribe tu contraseña. Avísame cuando estés adentro.",
    },
  },
  mfa: {
    type: "human",
    note: "The human enters the verification code.",
    handoff: {
      en: "The portal needs a verification code. Enter it yourself, then tell me to continue.",
      es: "El portal pide un código de verificación. Escríbelo tú y me dices para seguir.",
    },
  },
  captcha: {
    type: "human",
    note: "Clara never solves CAPTCHAs.",
    handoff: {
      en: "The portal is showing a CAPTCHA. Solve it yourself, then tell me to continue.",
      es: "El portal está pidiendo un CAPTCHA. Resuélvelo tú y me dices para seguir.",
    },
  },
  certification: {
    type: "human",
    note: "Attestation or certification — Clara never checks it.",
    handoff: {
      en: "This is a legal certification only you can make. Read it and check it yourself.",
      es: "Esta es una certificación legal que solo tú puedes hacer. Léela y márcala tú.",
    },
  },
  signature: {
    type: "human",
    note: "Including a typed name used as a signature.",
    handoff: {
      en: "The portal is asking for your signature. Only you can sign.",
      es: "El portal está pidiendo tu firma. Solo tú puedes firmar.",
    },
  },
  payment: {
    type: "human",
    note: "SmartPR never touches payment details.",
    handoff: {
      en: "Time to pay. Check the amount and pay in the portal yourself.",
      es: "Te toca pagar. Verifica el monto y paga tú en el portal.",
    },
  },
  submit: {
    type: "human",
    note: "Final submit — always the human, after review.",
    handoff: {
      en: "Everything is filled in. Review every screen, and when you're sure, submit it yourself. Nothing is filed until you do.",
      es: "Ya está todo lleno. Revisa cada pantalla y, cuando estés seguro, envíalo tú. No se radica nada hasta que tú lo hagas.",
    },
  },
  upload: {
    type: "pause",
    note: "Documents come in through the chat.",
    handoff: {
      en: "The portal needs documents. Upload them here in the chat.",
      es: "El portal necesita documentos. Súbelos aquí en el chat.",
    },
  },
  identity: {
    type: "human",
    note: "Social Security / ID numbers are typed by the human.",
    handoff: {
      en: "The portal is asking for a Social Security or ID number. Type it yourself in the browser.",
      es: "El portal pide un número de Seguro Social o de identificación. Escríbelo tú en el navegador.",
    },
  },
  parcel: {
    type: "pause",
    note: "Parcel/catastro needs verified data — confirm before continuing.",
    handoff: {
      en: "The portal needs your property's parcel. Pick it yourself, then tell me to continue.",
      es: "El portal necesita la parcela de tu propiedad. Escógela tú y me dices para seguir.",
    },
  },
};

export function defaultGate(id: string): SkillGate {
  const g = DEFAULT_GATES[id];
  if (!g) return { id, type: "pause" };
  return { id, type: g.type, note: g.note, handoff: g.handoff };
}
