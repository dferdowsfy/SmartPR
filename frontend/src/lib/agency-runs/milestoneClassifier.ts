/**
 * Turns the fine-grained AgencyRunEvent log into milestone-only chat entries.
 *
 * The event log is noisy by design (every agent micro-step is recorded).
 * The chat surface should only show milestones: the run start, one "stage"
 * entry per burst of consecutive info events, every pause, and every review.
 * Pure functions only — no I/O.
 */
import type {
  AgencyPauseReason,
  AgencyRunEvent,
} from "./types";
import { humanizePauseEvent, parseRequiredFields } from "./pendingFields";

/** Exact shape — a UI builder depends on it. Do not change field names. */
export interface ChatMilestone {
  id: string;
  tone: "info" | "warn" | "success" | "action";
  heading_en: string;
  heading_es: string;
  body_en?: string;
  body_es?: string;
  created_at: string;
  details?: { label_en: string; label_es: string; done: boolean }[];
}

type EventKind = NonNullable<AgencyRunEvent["kind"]>;

const kindOf = (e: AgencyRunEvent): EventKind => e.kind ?? "info";

/** Best-effort pause-reason inference from pause event text. */
function inferPauseReason(text: string): AgencyPauseReason {
  const marker = /PAUSE_(USER_LOGIN|USER_UPLOAD|CAPTCHA|PAYMENT)/i.exec(text);
  if (marker && marker[1]) {
    return marker[1].toUpperCase() as Exclude<AgencyPauseReason, null>;
  }
  if (/captch/i.test(text)) return "CAPTCHA";
  if (/upload|document|adjunto/i.test(text)) return "USER_UPLOAD";
  if (/login|sign[\s-]?in|inicio de sesi[oó]n|password|contrase[ñn]a/i.test(text))
    return "USER_LOGIN";
  if (/pay|pago|payment/i.test(text)) return "PAYMENT";
  return null;
}

/** Messages that clearly name a completed item -> short detail labels. */
const ITEM_PATTERNS = [
  /^(?:completed|done|finished|completad[oa]|list[oa])\s*[:\-–]\s*(.+)$/i,
  /^(?:filled(?: in| out)?|entered|uploaded|rellenad[oa]|ingresad[oa]|subid[oa])\s*(?:[:\-–]\s*)?(.+)$/i,
];

function extractItemLabel(text: string): string | null {
  const t = text.trim().replace(/\s+/g, " ");
  for (const re of ITEM_PATTERNS) {
    const m = re.exec(t);
    if (m && m[1]) {
      const label = m[1].trim().replace(/[.\s]+$/, "");
      if (label.length >= 2) return label.slice(0, 80);
    }
  }
  return null;
}

const ERROR_RE =
  /fail|error|couldn'?t|unable|no se pudo|fall[óo]/i;

function burstHasErrors(events: AgencyRunEvent[]): boolean {
  return events.some(
    (e) => ERROR_RE.test(e.message) || ERROR_RE.test(e.message_es)
  );
}

/**
 * Collapse a burst of consecutive info events into one stage milestone.
 * Per-action noise ("Clicking Continue", "Entering legal entity name", …)
 * is summarized, never emitted verbatim.
 */
function burstMilestone(
  burst: AgencyRunEvent[]
): ChatMilestone {
  const first = burst[0]!;
  const rawMessages = burst.map((e) => e.message);
  const heading = summarizeStage(rawMessages);

  // Attach details only when the raw text clearly names completed items.
  const items: { label_en: string; label_es: string; done: boolean }[] = [];
  for (const e of burst) {
    const en = extractItemLabel(e.message);
    const es = extractItemLabel(e.message_es);
    if (en || es) {
      items.push({ label_en: en ?? es!, label_es: es ?? en!, done: true });
    }
  }

  const milestone: ChatMilestone = {
    id: `m-${first.index}`,
    tone: burstHasErrors(burst) ? "warn" : "info",
    heading_en: heading.heading_en,
    heading_es: heading.heading_es,
    created_at: first.created_at,
  };
  if (items.length >= 2) milestone.details = items;
  return milestone;
}

function startMilestone(
  event: AgencyRunEvent,
  opts: { portalEn: string; portalEs: string }
): ChatMilestone {
  return {
    id: `m-${event.index}`,
    tone: "info",
    heading_en: `I'm starting your ${opts.portalEn} filing. I already have most of the information I need.`,
    heading_es: `Empiezo tu radicación en ${opts.portalEs}. Ya tengo casi toda la información que necesito.`,
    created_at: event.created_at,
  };
}

function pauseMilestone(event: AgencyRunEvent): ChatMilestone {
  const reason = inferPauseReason(event.message);
  const fields = parseRequiredFields(event.message);
  const { message, message_es } = humanizePauseEvent(
    reason,
    fields,
    event.message
  );
  return {
    id: `m-${event.index}`,
    tone: "action",
    heading_en: message,
    heading_es: message_es,
    created_at: event.created_at,
  };
}

function reviewMilestone(event: AgencyRunEvent): ChatMilestone {
  const milestone: ChatMilestone = {
    id: `m-${event.index}`,
    tone: "success",
    heading_en: "Your application is prepared and ready for final review.",
    heading_es: "Tu solicitud está preparada y lista para la revisión final.",
    created_at: event.created_at,
  };
  const bodyEn = event.message.trim().replace(/\s+/g, " ").slice(0, 280);
  const bodyEs = event.message_es.trim().replace(/\s+/g, " ").slice(0, 280);
  if (bodyEn) milestone.body_en = bodyEn;
  if (bodyEs) milestone.body_es = bodyEs;
  return milestone;
}

function submittedMilestone(event: AgencyRunEvent): ChatMilestone {
  const milestone: ChatMilestone = {
    id: `m-${event.index}`,
    tone: "success",
    heading_en: "Filed — your submission is complete.",
    heading_es: "Enviado — tu radicación está completa.",
    created_at: event.created_at,
  };
  const bodyEn = event.message.trim().replace(/\s+/g, " ").slice(0, 280);
  const bodyEs = event.message_es.trim().replace(/\s+/g, " ").slice(0, 280);
  if (bodyEn) milestone.body_en = bodyEn;
  if (bodyEs) milestone.body_es = bodyEs;
  return milestone;
}

export interface BuildChatMilestonesOpts {
  portalEn: string;
  portalEs: string;
}

/**
 * Build milestone-only chat entries from the event log.
 * Deterministic, id-keyed (`m-${event.index}`), ordered by created_at.
 * Empty input -> [].
 */
export function buildChatMilestones(
  events: AgencyRunEvent[],
  opts: BuildChatMilestonesOpts
): ChatMilestone[] {
  if (!events || events.length === 0) return [];

  // Deterministic order: created_at, then index as tiebreak.
  const ordered = [...events].sort((a, b) =>
    a.created_at < b.created_at
      ? -1
      : a.created_at > b.created_at
        ? 1
        : a.index - b.index
  );

  const milestones: ChatMilestone[] = [];
  let burst: AgencyRunEvent[] = [];

  const flushBurst = () => {
    if (burst.length > 0) {
      milestones.push(burstMilestone(burst));
      burst = [];
    }
  };

  ordered.forEach((event, i) => {
    const kind = kindOf(event);
    if (i === 0 && kind === "info") {
      // The first event is the run-started milestone.
      milestones.push(startMilestone(event, opts));
      return;
    }
    if (kind === "info") {
      burst.push(event);
      return;
    }
    flushBurst();
    milestones.push(
      kind === "pause"
        ? pauseMilestone(event)
        : kind === "submitted"
          ? submittedMilestone(event)
          : reviewMilestone(event)
    );
  });
  flushBurst();

  return milestones;
}

/** Stage themes used by summarizeStage. */
type StageKind = "profile" | "navigation" | "review" | "working";

const STAGE_KEYWORDS: { kind: StageKind; re: RegExp }[] = [
  {
    kind: "profile",
    re: /passport|pre-?fill|profile|business (name|detail|information)|entity|registration detail|legal name|merchant info|datos del negocio|pasaporte/i,
  },
  {
    // Checked before "navigation": "Navigating to pre-submit review" is
    // about the review stage, not about finding a section.
    kind: "review",
    re: /review|verif|pre-?submit|double-?check|confirm|revisi[oó]n|verific/i,
  },
  {
    kind: "navigation",
    re: /opening|navigat|locat|finding|loading|waiting|click(ing|ed)? continue|scroll|abriendo|naveg|localiz|secci[oó]n|esperando/i,
  },
];

const STAGE_HEADINGS: Record<StageKind, { heading_en: string; heading_es: string }> = {
  profile: {
    heading_en:
      "Completing the business and registration details using your SmartPR profile",
    heading_es:
      "Completando los datos del negocio y el registro con tu perfil de SmartPR",
  },
  navigation: {
    heading_en: "Opening the portal and getting to the right section",
    heading_es: "Abriendo el portal y llegando a la sección correcta",
  },
  review: {
    heading_en: "Preparing everything for your final review",
    heading_es: "Preparando todo para tu revisión final",
  },
  working: {
    heading_en: "Working through the filing steps",
    heading_es: "Avanzando con los pasos de la radicación",
  },
};

/**
 * Pick the best-fit stage heading for a burst of raw micro-step messages.
 * Priority on ties: profile > review > navigation; no keyword hits -> "working".
 */
export function summarizeStage(rawMessages: string[]): {
  heading_en: string;
  heading_es: string;
} {
  const text = rawMessages.join(" \n ");
  for (const { kind, re } of STAGE_KEYWORDS) {
    if (re.test(text)) return STAGE_HEADINGS[kind];
  }
  return STAGE_HEADINGS.working;
}
