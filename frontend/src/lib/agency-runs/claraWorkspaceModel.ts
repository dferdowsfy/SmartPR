/**
 * Clara workspace model (client-safe, pure) — what the redesigned Clara
 * screens show, derived only from SmartPR data and real run state:
 *
 *  - classifyWorkflows: which filings the CURRENT project can launch now
 *    ("ready") and which apply but are waiting on something ("not ready").
 *    Source: the filing options /api/agency-actions/filings already resolves
 *    from the business's obligations (requirements engine) × the Clara
 *    filing registry × the Business Passport × prior runs. Filings with no
 *    Clara browser definition, unrelated agencies and finished filings are
 *    not shown.
 *  - filingProgress: the 5-step stepper and the progress checklist, mapped
 *    from the agency run's machine status, pause reason, live browser and
 *    events — never from elapsed time.
 */
import type { FilingGroup, FilingOption } from "./agencyActions";
import type { AgencyRunPublic } from "./types";

type Bi = { en: string; es: string };

// ------------------------------------------------------------------ eligibility

export interface ClassifiedWorkflows {
  /** Applies, has a Clara definition, and can start (or resume) now. */
  ready: FilingOption[];
  /** Applies and has a Clara definition, but something is missing first. */
  notReady: FilingOption[];
}

export function classifyWorkflows(groups: readonly FilingGroup[]): ClassifiedWorkflows {
  const all = groups.flatMap((g) => g.filings);
  const ready: FilingOption[] = [];
  const notReady: FilingOption[] = [];
  for (const f of all) {
    if (!f.supported || !f.action) continue; // no Clara/browser definition
    if (f.filing_status === "ready_to_start" || f.filing_status === "in_progress") ready.push(f);
    else if (f.filing_status === "missing_information" || f.filing_status === "blocked") notReady.push(f);
    // submitted / not_available / unsupported: nothing to launch here
  }
  return { ready, notReady };
}

/** Stable identity of one workflow card (an obligation can carry two objectives). */
export function workflowKey(f: FilingOption): string {
  return `${f.id}:${f.obligation_id}:${f.action?.objective_en ?? ""}`;
}

/** What still blocks a not-ready workflow (labels only). */
export function missingCount(f: FilingOption): number {
  return (f.action?.missing_items.length ?? 0) + (f.action?.blocked_by.length ?? 0);
}

// ------------------------------------------------------------------ agency styling

export type AgencyTone = "ogpe" | "health" | "fire" | "hacienda" | "state" | "municipal" | "demo";

export function agencyTone(f: Pick<FilingOption, "agency_id" | "agency_en" | "title_en">): AgencyTone {
  const id = f.agency_id.toUpperCase();
  const text = `${f.agency_en} ${f.title_en}`.toLowerCase();
  if (id === "OGPE" || /ogpe|permiso [úu]nico|gerencia de permisos/.test(text)) return "ogpe";
  if (id.startsWith("HACIENDA") || /hacienda|suri|treasury|merchant/.test(text)) return "hacienda";
  if (id.startsWith("DEPT_STATE") || /department of state|departamento de estado|corporat|llc/.test(text)) return "state";
  if (/salud|health|sanitar/.test(text)) return "health";
  if (/bomberos|fire/.test(text)) return "fire";
  if (/municip/.test(text)) return "municipal";
  return "demo";
}

// ------------------------------------------------------------------ progress

export type StepState = "done" | "current" | "waiting" | "error" | "upcoming";

export const FILING_STEPS: Bi[] = [
  { en: "Prepare", es: "Preparar" },
  { en: "Open portal", es: "Abrir portal" },
  { en: "Complete forms", es: "Completar formularios" },
  { en: "Review package", es: "Revisar paquete" },
  { en: "Ready to submit", es: "Listo para enviar" },
];

/** Normalized Clara phases (the checklist rows; each workflow uses these). */
export type ClaraPhase = "LOAD_PASSPORT" | "MAP_FIELDS" | "PREPARE_RESPONSES" | "OPEN_PORTAL" | "FILL_FIELDS" | "AWAIT_USER";

export interface ProgressInput {
  /** Pre-flight is loading (Passport + requirement data being read). */
  preparing: boolean;
  /** Pre-flight loaded: waiting for the person to confirm the start. */
  awaitingStart: boolean;
  run: Pick<AgencyRunPublic, "status" | "pause_reason" | "live_url" | "events"> | null;
}

export interface FilingProgress {
  /** Index into FILING_STEPS of the step in focus. */
  step: number;
  steps: StepState[];
  phases: Record<ClaraPhase, StepState>;
  /** The run is done (submitted), stopped, or failed. */
  terminal: "submitted" | "stopped" | "failed" | null;
  /** Clara is waiting on the person (pause, pre-flight, or final review). */
  needsYou: boolean;
}

function stepsFor(step: number, focus: StepState): StepState[] {
  return FILING_STEPS.map((_, i) => (i < step ? "done" : i === step ? focus : "upcoming"));
}

/**
 * The stepper + checklist from real state. Mapping:
 *   pre-flight loading               → Prepare (current)
 *   pre-flight shown, not confirmed  → Prepare (waiting on you)
 *   run queued / running, no portal yet → Open portal
 *   running with the portal open     → Complete forms
 *   paused (login, upload, CAPTCHA, payment, missing field) → Complete forms, waiting on you
 *   review (agent stopped at the submit gate) → Ready to submit, waiting on you
 *   submitted                        → all done
 *   failed / stopped                 → the step it reached, error / stopped
 */
export function filingProgress(input: ProgressInput): FilingProgress {
  const phases: Record<ClaraPhase, StepState> = {
    LOAD_PASSPORT: "upcoming",
    MAP_FIELDS: "upcoming",
    PREPARE_RESPONSES: "upcoming",
    OPEN_PORTAL: "upcoming",
    FILL_FIELDS: "upcoming",
    AWAIT_USER: "upcoming",
  };
  const done = (...ps: ClaraPhase[]) => ps.forEach((p) => (phases[p] = "done"));
  const run = input.run;
  if (!run) {
    if (input.awaitingStart) {
      done("LOAD_PASSPORT", "MAP_FIELDS");
      phases.PREPARE_RESPONSES = "waiting";
      return { step: 0, steps: stepsFor(0, "waiting"), phases, terminal: null, needsYou: true };
    }
    phases.LOAD_PASSPORT = input.preparing ? "current" : "upcoming";
    return { step: 0, steps: stepsFor(0, input.preparing ? "current" : "upcoming"), phases, terminal: null, needsYou: false };
  }
  done("LOAD_PASSPORT", "MAP_FIELDS", "PREPARE_RESPONSES");
  const portalOpen = Boolean(run.live_url) && run.events.filter((e) => (e.kind ?? "info") === "info").length > 1;
  switch (run.status) {
    case "queued":
      phases.OPEN_PORTAL = "current";
      return { step: 1, steps: stepsFor(1, "current"), phases, terminal: null, needsYou: false };
    case "running":
      if (!portalOpen) {
        phases.OPEN_PORTAL = "current";
        return { step: 1, steps: stepsFor(1, "current"), phases, terminal: null, needsYou: false };
      }
      done("OPEN_PORTAL");
      phases.FILL_FIELDS = "current";
      return { step: 2, steps: stepsFor(2, "current"), phases, terminal: null, needsYou: false };
    case "paused": {
      // Sign-in / CAPTCHA before the portal is open still counts as opening it.
      const atPortal = portalOpen || run.pause_reason === "USER_UPLOAD" || run.pause_reason === "PAYMENT";
      done("OPEN_PORTAL");
      phases.FILL_FIELDS = atPortal ? "waiting" : "upcoming";
      if (!atPortal) phases.OPEN_PORTAL = "waiting";
      const step = atPortal ? 2 : 1;
      return { step, steps: stepsFor(step, "waiting"), phases, terminal: null, needsYou: true };
    }
    case "review":
      done("OPEN_PORTAL", "FILL_FIELDS");
      phases.AWAIT_USER = "waiting";
      return { step: 4, steps: stepsFor(4, "waiting"), phases, terminal: null, needsYou: true };
    case "submitted":
      done("OPEN_PORTAL", "FILL_FIELDS", "AWAIT_USER");
      return { step: 4, steps: FILING_STEPS.map(() => "done"), phases, terminal: "submitted", needsYou: false };
    case "failed":
    case "stopped": {
      const step = portalOpen ? 2 : 1;
      if (portalOpen) done("OPEN_PORTAL");
      const key: ClaraPhase = portalOpen ? "FILL_FIELDS" : "OPEN_PORTAL";
      phases[key] = "error";
      return { step, steps: stepsFor(step, "error"), phases, terminal: run.status, needsYou: false };
    }
  }
}

export const PHASE_COPY: Record<ClaraPhase, { label: Bi; detail: Bi }> = {
  LOAD_PASSPORT: { label: { en: "Loading your business information", es: "Cargando la información de tu negocio" }, detail: { en: "From your Business Passport", es: "Desde tu Pasaporte del negocio" } },
  MAP_FIELDS: { label: { en: "Populating company details", es: "Completando los datos de la empresa" }, detail: { en: "EIN, registrations, NAICS, contact info", es: "EIN, registros, NAICS, contacto" } },
  PREPARE_RESPONSES: { label: { en: "Preparing form responses", es: "Preparando las respuestas" }, detail: { en: "Matching your information to required fields", es: "Relacionando tu información con los campos requeridos" } },
  OPEN_PORTAL: { label: { en: "Opening government portal", es: "Abriendo el portal del gobierno" }, detail: { en: "Launching the agency's submission portal", es: "Abriendo el portal de la agencia" } },
  FILL_FIELDS: { label: { en: "Filling application", es: "Llenando la solicitud" }, detail: { en: "Completing required sections", es: "Completando las secciones requeridas" } },
  AWAIT_USER: { label: { en: "Reviewing before handoff", es: "Revisión antes de entregarte" }, detail: { en: "You'll review and submit — nothing is sent yet", es: "Tú revisas y envías — todavía no se envía nada" } },
};

export const PHASE_ORDER: ClaraPhase[] = ["LOAD_PASSPORT", "MAP_FIELDS", "PREPARE_RESPONSES", "OPEN_PORTAL", "FILL_FIELDS", "AWAIT_USER"];
