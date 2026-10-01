/**
 * Chat model for the Clara workspace's Teach Clara / Fill with Clara modes
 * (client-safe, pure). The chat shows what matters — the stage, one line
 * per screen (not every click), the mapping questions, the human-only
 * steps, and progress — derived from the teach-session / replay views the
 * server already returns. Nothing here ever holds an entered value.
 */
import type { BilingualText } from "../skills/skill";

type Bi = BilingualText;

export type WorkspaceGate = "login" | "mfa" | "captcha" | "certification" | "signature" | "payment" | "submit" | "upload" | "identity";

export const GATE_LABEL: Record<string, Bi> = {
  login: { en: "Sign-in", es: "Entrar" },
  mfa: { en: "Verification code", es: "Código de verificación" },
  captcha: { en: "CAPTCHA", es: "CAPTCHA" },
  certification: { en: "Legal certification", es: "Certificación legal" },
  signature: { en: "Signature", es: "Firma" },
  payment: { en: "Payment", es: "Pago" },
  submit: { en: "Final submission", es: "Envío final" },
  upload: { en: "Documents", es: "Documentos" },
  identity: { en: "ID number (SSN)", es: "Número de identificación (SSN)" },
};

/** Why a step is the person's, in plain words (EN/ES). */
export const GATE_EXPLAIN: Record<string, Bi> = {
  login: {
    en: "This is the portal's sign-in. Type your password in the secure box below (it goes straight to the portal and isn't saved), or sign in yourself in the browser.",
    es: "Esta es la entrada del portal. Escribe tu contraseña en la casilla segura de abajo (va directo al portal y no se guarda), o entra tú en el navegador.",
  },
  mfa: {
    en: "The portal sent a verification code. Type it in the secure box below, or enter it yourself in the browser.",
    es: "El portal envió un código de verificación. Escríbelo en la casilla segura de abajo, o entra el código tú en el navegador.",
  },
  identity: {
    en: "This screen asks for an ID number (like an SSN). Type it in the secure box below — it goes only to the portal field, never into the routine.",
    es: "Esta pantalla pide un número de identificación (como el seguro social). Escríbelo en la casilla segura de abajo — va solo al campo del portal, nunca a la rutina.",
  },
  captcha: {
    en: "The portal shows a CAPTCHA. Only you can solve it — do it in the browser. Clara never tries to get around it.",
    es: "El portal muestra un CAPTCHA. Solo tú lo puedes resolver — hazlo en el navegador. Clara nunca intenta saltarlo.",
  },
  certification: {
    en: "This is a legal certification. It has to be you who reads and accepts it, in the browser.",
    es: "Esta es una certificación legal. Tienes que leerla y aceptarla tú, en el navegador.",
  },
  signature: {
    en: "The portal needs your signature. Sign it yourself in the browser — Clara never signs for you.",
    es: "El portal necesita tu firma. Fírmalo tú en el navegador — Clara nunca firma por ti.",
  },
  payment: {
    en: "This is the payment step. You enter payment details yourself in the browser — Clara never pays or types card numbers.",
    es: "Este es el paso del pago. Entras los datos de pago tú en el navegador — Clara nunca paga ni escribe números de tarjeta.",
  },
  upload: {
    en: "The portal wants documents. Upload them yourself in the browser.",
    es: "El portal pide documentos. Súbelos tú en el navegador.",
  },
  submit: {
    en: "This is the final submission. Clara never submits — review everything in the browser and press the portal's submit button yourself when you're ready.",
    es: "Este es el envío final. Clara nunca envía — revisa todo en el navegador y dale tú al botón de enviar del portal cuando estés listo.",
  },
};

/** Gates where a masked one-time secure input card is offered. Payment never is. */
export const SECURE_INPUT_GATES = new Set(["login", "mfa", "identity"]);

export interface SecretFieldView {
  label: string;
  selector: string | null;
  kind: "password" | "ssn" | "code" | "payment";
}

/** The secure one-time input card for the current screen, if one applies. */
export function secureCardFor(gate: string | null, secretFields: SecretFieldView[]): { gate: string | null; fields: SecretFieldView[] } | null {
  const fields = secretFields.filter((f) => f.kind !== "payment");
  if (gate === "payment") return null;
  if (fields.length) return { gate, fields };
  if (gate && SECURE_INPUT_GATES.has(gate)) return { gate, fields: [] };
  return null;
}

export function secretPrompt(f: SecretFieldView | null, gate: string | null): Bi {
  const kind = f?.kind ?? (gate === "mfa" ? "code" : gate === "identity" ? "ssn" : "password");
  const label = f?.label ? ` (“${f.label}”)` : "";
  switch (kind) {
    case "ssn":
      return { en: `Social Security number${label}`, es: `Número de seguro social${label}` };
    case "code":
      return { en: `Verification code${label}`, es: `Código de verificación${label}` };
    default:
      return { en: `Password${label}`, es: `Contraseña${label}` };
  }
}

/** A label on a replay "ask" field that looks sensitive: mask the input. */
export function looksSensitiveLabel(label: string): boolean {
  return /(passw|contrase|\bpin\b|ssn|social security|seguro social|\bitin\b|verification code|c[oó]digo de (verificaci|seguridad|acceso)|\botp\b|cvv|card number|tarjeta)/i.test(label);
}

// ------------------------------------------------------------------ teach

export type TeachStage = "recording" | "your_turn" | "mapping" | "ready_to_review" | "reviewing" | "saved";

export const TEACH_STAGE: Record<TeachStage, Bi> = {
  recording: { en: "Recording your walkthrough", es: "Grabando tu recorrido" },
  your_turn: { en: "Your part — Clara is waiting", es: "Te toca — Clara espera" },
  mapping: { en: "Clara has a question", es: "Clara tiene una pregunta" },
  ready_to_review: { en: "Ready to review", es: "Listo para revisar" },
  reviewing: { en: "Reviewing the routine", es: "Revisando la rutina" },
  saved: { en: "Learned", es: "Aprendido" },
};

export interface TeachStepView {
  id: string;
  title: string;
  observed: boolean;
  gate: string | null;
  fields: { key: string; label: string; decided: boolean; binding: { kind: string; path?: string; name?: Bi; option?: string } }[];
  clicks?: { key: string; label: string; role: string }[];
}

const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * One chat line per screen of the walkthrough: where the person is, how
 * many fields Clara saw and what they're tied to, and the human-only
 * steps. Updated in place as the recording grows (never a click log).
 */
export function teachNarrative(steps: TeachStepView[]): { id: string; text: Bi; tone: "info" | "gate" | "stop" }[] {
  return steps
    .filter((s) => s.observed)
    .map((s) => {
      const title = s.title;
      if (s.gate) {
        const g = GATE_LABEL[s.gate] ?? { en: s.gate, es: s.gate };
        return {
          id: s.id,
          tone: s.gate === "submit" ? ("stop" as const) : ("gate" as const),
          text:
            s.gate === "submit"
              ? { en: `“${title}” — final submission. I'll always stop here for you.`, es: `“${title}” — envío final. Siempre me detengo aquí para ti.` }
              : { en: `“${title}” — ${g.en.toLowerCase()}: this part is yours. I won't record what you type here.`, es: `“${title}” — ${g.es.toLowerCase()}: esta parte es tuya. No grabo lo que escribas aquí.` },
        };
      }
      const n = s.fields.length;
      const passport = s.fields.filter((f) => f.binding.kind === "passport").length;
      const ask = s.fields.filter((f) => f.binding.kind === "ask").length;
      const always = s.fields.filter((f) => f.binding.kind === "always").length;
      const pending = s.fields.filter((f) => f.binding.kind === "pending").length;
      const clicks = (s.clicks ?? []).length;
      if (!n) {
        return {
          id: s.id,
          tone: "info" as const,
          text: clicks
            ? { en: `“${title}” — ${clicks} ${pl(clicks, "step", "steps")} to move on.`, es: `“${title}” — ${clicks} ${pl(clicks, "paso", "pasos")} para seguir.` }
            : { en: `You're on “${title}”.`, es: `Estás en “${title}”.` },
        };
      }
      const partsEn = [passport && `${passport} from the Business Passport`, ask && `${ask} I'll ask each time`, always && `${always} always the same choice`, pending && `${pending} to confirm`].filter(Boolean);
      const partsEs = [passport && `${passport} del Pasaporte del negocio`, ask && `${ask} que pregunto cada vez`, always && `${always} siempre la misma opción`, pending && `${pending} por confirmar`].filter(Boolean);
      return {
        id: s.id,
        tone: "info" as const,
        text: {
          en: `“${title}” — ${n} ${pl(n, "field", "fields")}: ${partsEn.join(", ")}.`,
          es: `“${title}” — ${n} ${pl(n, "campo", "campos")}: ${partsEs.join(", ")}.`,
        },
      };
    });
}

export function defaultRoutineName(ctx: { name: string; agency: string | null; portalHost?: string | null }): string {
  const where = ctx.agency || ctx.portalHost || "";
  return (where ? `${ctx.name} — ${where}` : ctx.name).slice(0, 120);
}

// ------------------------------------------------------------------ fill

export interface ReplayPauseView {
  kind: "gate" | "ask" | "drift" | "portal_error" | "navigate" | "option_missing";
  gate?: string;
  handoff?: Bi;
  fields?: { key: string; label: string; ask: Bi; required: boolean }[];
  reason?: string;
  expected?: string;
  seen?: { title: string; heading: string; url: string };
  detail?: string;
  errors?: string[];
  field?: string;
}

/** The chat's one-line headline for a replay pause. */
export function replayPauseHeadline(p: ReplayPauseView): { text: Bi; tone: "gate" | "ask" | "stop" } {
  switch (p.kind) {
    case "gate":
      if (p.gate === "submit") {
        return { tone: "gate", text: { en: "Everything is filled in. Review it in the browser — the final submission is yours.", es: "Todo está lleno. Revísalo en el navegador — el envío final es tuyo." } };
      }
      return { tone: "gate", text: GATE_EXPLAIN[p.gate ?? ""] ?? p.handoff ?? { en: "Your turn.", es: "Te toca." } };
    case "ask":
      return { tone: "ask", text: { en: "I need a few answers that aren't in the Business Passport.", es: "Necesito unas respuestas que no están en el Pasaporte del negocio." } };
    case "drift":
      return {
        tone: "stop",
        text: {
          en: `The portal looks different from what I learned${p.expected ? ` (I expected “${p.expected}”)` : ""}, so I stopped without touching anything.`,
          es: `El portal se ve distinto a lo que aprendí${p.expected ? ` (esperaba “${p.expected}”)` : ""}, así que me detuve sin tocar nada.`,
        },
      };
    case "portal_error":
      return { tone: "stop", text: { en: "The portal didn't accept that screen, so I stopped so you can see why.", es: "El portal no aceptó esa pantalla, así que me detuve para que veas por qué." } };
    case "navigate":
      return { tone: "gate", text: p.handoff ?? { en: "Please go to the next screen in the portal.", es: "Pasa tú a la próxima pantalla del portal." } };
    case "option_missing":
      return { tone: "ask", text: { en: `“${p.field}” doesn't list the business's answer — pick it yourself in the browser.`, es: `“${p.field}” no tiene la respuesta del negocio — escógela tú en el navegador.` } };
  }
}

/** Gates the person handles in the browser itself: open the browser panel for them. */
export function pauseNeedsBrowser(p: ReplayPauseView | null): boolean {
  if (!p) return false;
  if (p.kind === "gate") return true;
  return p.kind === "navigate" || p.kind === "option_missing" || p.kind === "drift" || p.kind === "portal_error";
}
