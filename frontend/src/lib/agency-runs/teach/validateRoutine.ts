/**
 * Validation of a recorded routine — the system check that a Teach Clara
 * recording is a real, repeatable process before it becomes "Learned".
 *
 * Deterministic rules decide pass / issues (each issue carries a one-line
 * fix, EN/ES):
 *   - starts_at_entry   the recording begins on the portal's entry page
 *   - has_work          at least one screen Clara actually does something on
 *   - ends_at_review    it ends on the review screen before the final submit
 *   - never_submits     the routine contains no submit click (final submit
 *                       is always the person's)
 *   - inputs_bound      every typed / picked value is bound to a Business
 *                       Passport field, "always choose", or "ask each time"
 *   - questions_done    every pause / choice question was answered
 *   - pauses_marked     login, code, upload, payment, ID screens are human pauses
 *   - no_duplicates     no screen recorded twice in a row, no back-and-forth
 *   - no_dead_ends      every middle screen has a way forward
 *   - no_accidental     no stray clicks (help, home, language, print …)
 *   - stable_selectors  every control can be found again (stable selector
 *                       or a clear label)
 *   - safe_content      no values / PII / credentials (sanitizationCheck)
 *   - dry_run           the routine replays end-to-end on a simulated copy of
 *                       the portal with a test passport (virtualReplayCheck)
 *
 * The LLM review (llmReviewRoutine) is advisory: it can add warnings, it
 * never turns a pass into a fail and never sees values (labels only).
 */
import type { BilingualText, Skill } from "../skills/skill";
import { sanitizationCheck } from "../skills/reviewChecks";
import { isSubmitTarget } from "../skills/skillValidate";
import { virtualReplayCheck } from "../replay/virtualPortal";
import { normalizeLabel } from "./passportCatalog";
import type { RecordedAction } from "./recording";
import type { DraftStep, TeachState } from "./teachSession";

/** "1 step" / "2 steps" — no "step(s)". */
const pl = (n: number, one: string, many: string) => (n === 1 ? one : many);

export type RoutineCheckId =
  | "starts_at_entry"
  | "has_work"
  | "ends_at_review"
  | "never_submits"
  | "inputs_bound"
  | "questions_done"
  | "pauses_marked"
  | "no_duplicates"
  | "no_dead_ends"
  | "no_accidental"
  | "stable_selectors"
  | "safe_content"
  | "dry_run"
  | "llm_review";

export interface RoutineCheck {
  id: RoutineCheckId;
  ok: boolean;
  /** error = blocks "Learned"; warning = shown, doesn't block. */
  severity: "error" | "warning";
  title: BilingualText;
  /** One-line fix when !ok. */
  fix: BilingualText | null;
  stepId?: string | null;
}

export interface RoutineValidation {
  status: "pass" | "issues";
  checks: RoutineCheck[];
  errors: number;
  warnings: number;
  llm: { status: "ok" | "skipped" | "error"; notes: BilingualText[] };
  checkedAt: string;
}

const REVIEW_SCREEN = /(revis|review|resumen|summary|confirm|verific|preview|vista previa|antes de enviar|before (you )?submit)/i;
const LOGIN_SCREEN = /(iniciar sesi|inicio de sesi|sign ?in|log ?in|acceder|entrar a (su|tu) cuenta|contrase[nñ]a|password)/i;
const MFA_SCREEN = /(c[oó]digo de verificaci|verification code|one[- ]time|autenticaci[oó]n|two[- ]factor|2fa|mfa)/i;
const UPLOAD_SCREEN = /(subir documentos|cargar documentos|anejar|anejos|documentos requeridos|upload (your )?documents|attach(ments)?)/i;
const PAYMENT_SCREEN = /(pago|pagar|payment|checkout|tarjeta|card details)/i;
const ACCIDENTAL = /^(ayuda|help|faq|preguntas frecuentes|inicio|home|english|espa[nñ]ol|imprimir|print|contact(o|enos|e?nos| us)?|cerrar sesi[oó]n|log ?out|sign ?out|t[eé]rminos|terms|privacidad|privacy|accesibilidad|accessibility|mapa del sitio|sitemap)$/i;
const UNSTABLE_SELECTOR = [
  /#[A-Za-z_-]*\d{5,}/, // auto-numbered ids
  /[0-9a-f]{10,}/i, // hashes
  /:r[0-9a-z]+:/, // React useId
  /\b(ember|ext-gen|mui-|react-select-|j_idt|ctl\d\d|__BVID__|gwt-uid-)\d*/i,
  /(:nth-(child|of-type)\(\d+\).*){3,}/, // deep positional paths
];

const t = (en: string, es: string): BilingualText => ({ en, es });
const q = (s: string) => `“${s.slice(0, 60)}”`;

export function selectorUnstable(sel: string | null | undefined): boolean {
  if (!sel) return true;
  return UNSTABLE_SELECTOR.some((re) => re.test(sel));
}

function labelWeak(label: string): boolean {
  const n = normalizeLabel(label);
  return n.length < 2 || /^(x|ok|si|no|\W+|\d+)$/.test(n);
}

function screenName(s: DraftStep): string {
  return s.heading || s.title || s.id;
}

function pageKey(s: { url: string; heading: string; title: string }): string {
  try {
    const u = new URL(s.url);
    return `${u.host}${u.pathname}${u.hash}|${normalizeLabel(s.heading || s.title)}`;
  } catch {
    return `${s.url}|${normalizeLabel(s.heading || s.title)}`;
  }
}

function sameEntry(startUrl: string, url: string): { host: boolean; path: boolean } {
  try {
    const a = new URL(startUrl);
    const b = new URL(url);
    const host = a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");
    const strip = (p: string) => p.replace(/\/+$/, "") || "/";
    const pa = strip(a.pathname);
    const pb = strip(b.pathname);
    // The entry page itself, or the portal's home / a parent section of it
    // (people often open the site's home and click into the sign-in page).
    const path = host && (pa === pb || pb === "/" || pa.startsWith(pb + "/"));
    return { host, path };
  } catch {
    return { host: false, path: false };
  }
}

/** The deterministic checks (synchronous part). */
export function routineRuleChecks(state: TeachState, skill: Skill, actions: RecordedAction[] = []): RoutineCheck[] {
  const checks: RoutineCheck[] = [];
  const push = (c: RoutineCheck) => checks.push(c);
  const observed = state.steps.filter((s) => s.observed);

  // starts_at_entry
  const first = observed[0];
  const entry = first ? sameEntry(state.startUrl, first.url) : { host: false, path: false };
  const startsOk = !!first && entry.host && (entry.path || first.gate === "login" || first.gate === "mfa");
  push({
    id: "starts_at_entry",
    ok: startsOk,
    severity: "error",
    title: startsOk ? t("Starts at the portal's entry page", "Empieza en la página de entrada del portal") : t("Doesn't start at the portal's entry page", "No empieza en la página de entrada del portal"),
    fix: startsOk ? null : t("Record again and start from the portal's home or sign-in page.", "Graba otra vez y empieza desde la página principal o de entrada del portal."),
  });

  // has_work
  const working = observed.filter((s) => !s.gate && (s.fields.length || s.actions.length));
  push({
    id: "has_work",
    ok: working.length > 0,
    severity: "error",
    title: working.length ? t(`${working.length} ${pl(working.length, "screen", "screens")} Clara can fill`, `${working.length} ${pl(working.length, "pantalla", "pantallas")} que Clara puede llenar`) : t("Nothing for Clara to fill", "Nada que Clara pueda llenar"),
    fix: working.length ? null : t("Fill in at least one screen of the form while recording.", "Llena por lo menos una pantalla del formulario mientras grabas."),
  });

  // ends_at_review: the last screen is a review screen, or the person reached the submit button there.
  const last = observed.at(-1);
  const submitSeen = state.steps.some((s) => s.gate === "submit") || actions.some((a) => a.submitLike);
  const endsOk = !!last && (submitSeen || REVIEW_SCREEN.test(`${last.heading} ${last.title}`));
  push({
    id: "ends_at_review",
    ok: endsOk,
    severity: "error",
    title: endsOk ? t("Ends at the review screen, before the final submit", "Termina en la pantalla de revisión, antes del envío final") : t("Doesn't reach the review screen", "No llega a la pantalla de revisión"),
    fix: endsOk ? null : t("Keep going until the review screen (just before Submit), then finish.", "Sigue hasta la pantalla de revisión (justo antes de Enviar) y termina."),
    stepId: last?.id ?? null,
  });

  // never_submits
  const submitAction = skill.steps.flatMap((s) => s.actions.map((a) => ({ s, a }))).find(({ a }) => isSubmitTarget(a.target));
  push({
    id: "never_submits",
    ok: !submitAction,
    severity: "error",
    title: submitAction ? t(`The routine would click ${q(submitAction.a.target.label_contains)}`, `La rutina tocaría ${q(submitAction.a.target.label_contains)}`) : t("Never presses the final submit — you do", "Nunca toca el envío final — eso lo haces tú"),
    fix: submitAction ? t("Remove the submit click in Edit steps.", "Quita el clic de envío en Editar pasos.") : null,
    stepId: submitAction?.s.id ?? null,
  });

  // inputs_bound
  const pending = state.steps.flatMap((s) => s.fields.filter((f) => f.decision.kind === "pending").map((f) => ({ s, f })));
  push({
    id: "inputs_bound",
    ok: pending.length === 0,
    severity: "error",
    title: pending.length
      ? t(`${pending.length} ${pl(pending.length, "field", "fields")} not linked to your business info`, `${pending.length} ${pl(pending.length, "campo", "campos")} sin enlazar a la información del negocio`)
      : t("Every field is linked to your business info or asked each time", "Cada campo está enlazado a la información del negocio o se pregunta cada vez"),
    fix: pending.length
      ? t(`Pick a business field or “Ask each time” for ${pending.slice(0, 3).map((p) => q(p.f.label)).join(", ")}.`, `Escoge un dato del negocio o “Preguntar cada vez” para ${pending.slice(0, 3).map((p) => q(p.f.label)).join(", ")}.`)
      : null,
    stepId: pending[0]?.s.id ?? null,
  });

  // questions_done (gate confirmations, always-choose, branch)
  const answered = new Set(state.answered);
  const open = state.questions.filter((x) => !answered.has(x.id) && x.kind !== "mapping");
  push({
    id: "questions_done",
    ok: open.length === 0,
    severity: "error",
    title: open.length ? t(`${open.length} ${pl(open.length, "question", "questions")} left`, `${pl(open.length, "Queda", "Quedan")} ${open.length} ${pl(open.length, "pregunta", "preguntas")}`) : t("All of Clara's questions answered", "Todas las preguntas de Clara contestadas"),
    fix: open.length ? t("Answer the questions above the result.", "Contesta las preguntas que están arriba del resultado.") : null,
  });

  // pauses_marked
  const unmarked = observed.filter((s) => {
    if (s.gate) return false;
    const text = `${s.heading} ${s.title}`;
    return LOGIN_SCREEN.test(text) || MFA_SCREEN.test(text) || UPLOAD_SCREEN.test(text) || PAYMENT_SCREEN.test(text);
  });
  push({
    id: "pauses_marked",
    ok: unmarked.length === 0,
    severity: "error",
    title: unmarked.length
      ? t(`${q(screenName(unmarked[0]))} looks like a step you do yourself`, `${q(screenName(unmarked[0]))} parece un paso que haces tú`)
      : t("Sign-in, codes, uploads and payment are your pauses", "Entrar, códigos, documentos y pagos son tus pausas"),
    fix: unmarked.length ? t(`Mark ${q(screenName(unmarked[0]))} as “I do this part”.`, `Marca ${q(screenName(unmarked[0]))} como “Esto lo hago yo”.`) : null,
    stepId: unmarked[0]?.id ?? null,
  });

  // no_duplicates — same screen twice in a row, or coming back to a screen after leaving it.
  const keys = observed.map((s) => pageKey(s));
  let dupe: DraftStep | null = null;
  let backAndForth: DraftStep | null = null;
  keys.forEach((k, i) => {
    if (i > 0 && keys[i - 1] === k && !dupe) dupe = observed[i];
    if (keys.indexOf(k) < i - 1 && !backAndForth) backAndForth = observed[i];
  });
  const dup = (dupe ?? backAndForth) as DraftStep | null;
  push({
    id: "no_duplicates",
    ok: !dup,
    severity: dupe ? "error" : "warning",
    title: dup ? (dupe ? t(`${q(screenName(dup))} was recorded twice`, `${q(screenName(dup))} se grabó dos veces`) : t(`You went back to ${q(screenName(dup))}`, `Volviste a ${q(screenName(dup))}`)) : t("No repeated screens", "Sin pantallas repetidas"),
    fix: dup ? t("Remove the repeated screen in Edit steps, or record again in one pass.", "Quita la pantalla repetida en Editar pasos, o graba otra vez de corrido.") : null,
    stepId: dup?.id ?? null,
  });

  // no_dead_ends — a middle screen with nothing that moves forward (no click recorded).
  const deadEnd = observed.find((s, i) => i < observed.length - 1 && !s.gate && s.actions.length === 0 && !observed.slice(i + 1).every((n) => n.gate));
  push({
    id: "no_dead_ends",
    ok: !deadEnd,
    severity: "warning",
    title: deadEnd ? t(`Clara won't know how to leave ${q(screenName(deadEnd))}`, `Clara no sabrá cómo salir de ${q(screenName(deadEnd))}`) : t("Every screen has a way forward", "Cada pantalla tiene cómo seguir"),
    fix: deadEnd ? t("Use the portal's own Next/Continue button instead of typing an address.", "Usa el botón Siguiente/Continuar del portal en vez de escribir una dirección.") : null,
    stepId: deadEnd?.id ?? null,
  });

  // no_accidental
  const stray = observed.flatMap((s) => s.actions.filter((a) => ACCIDENTAL.test(normalizeLabel(a.label))).map((a) => ({ s, a })));
  push({
    id: "no_accidental",
    ok: stray.length === 0,
    severity: "error",
    title: stray.length ? t(`${q(stray[0].a.label)} looks like an accidental click`, `${q(stray[0].a.label)} parece un clic por accidente`) : t("No accidental clicks", "Sin clics por accidente"),
    fix: stray.length ? t(`Remove ${q(stray[0].a.label)} in Edit steps.`, `Quita ${q(stray[0].a.label)} en Editar pasos.`) : null,
    stepId: stray[0]?.s.id ?? null,
  });

  // stable_selectors
  const controls = skill.steps.flatMap((s) => [
    ...s.fields.map((f) => ({ s, label: f.portal_field.label, selector: f.portal_field.selector ?? null })),
    ...s.actions.map((a) => ({ s, label: a.target.label_contains, selector: a.target.selector ?? null })),
  ]);
  const lost = controls.filter((c) => selectorUnstable(c.selector) && labelWeak(c.label));
  const shaky = controls.filter((c) => selectorUnstable(c.selector) && !labelWeak(c.label));
  push({
    id: "stable_selectors",
    ok: lost.length === 0 && shaky.length === 0,
    severity: lost.length ? "error" : "warning",
    title: lost.length
      ? t(`${lost.length} ${pl(lost.length, "control", "controls")} Clara can't find again`, `${lost.length} ${pl(lost.length, "control", "controles")} que Clara no podrá encontrar otra vez`)
      : shaky.length
        ? t(`${shaky.length} ${pl(shaky.length, "control", "controls")} found by label only`, `${shaky.length} ${pl(shaky.length, "control", "controles")} ${pl(shaky.length, "se encuentra", "se encuentran")} solo por su nombre`)
        : t("Every control can be found again", "Cada control se puede encontrar otra vez"),
    fix: lost.length
      ? t("Record again and click the field's visible label or text, not an icon.", "Graba otra vez y toca el nombre visible del campo, no un ícono.")
      : shaky.length
        ? t("Fine as is — Clara will look for the label if the page changes.", "Está bien así — Clara buscará el nombre si la página cambia.")
        : null,
    stepId: (lost[0] ?? shaky[0])?.s.id ?? null,
  });

  // safe_content
  const sanitized = sanitizationCheck(skill);
  push({
    id: "safe_content",
    ok: sanitized.ok,
    severity: "error",
    title: sanitized.ok ? t("No passwords, IDs or typed values saved", "No se guardan contraseñas, números ni valores") : t("Something private got into the routine", "Algo privado quedó en la rutina"),
    fix: sanitized.ok ? null : t("Record again; Clara will drop it.", "Graba otra vez; Clara lo quitará."),
  });
  return checks;
}

export function summarize(checks: RoutineCheck[], llm: RoutineValidation["llm"] = { status: "skipped", notes: [] }): RoutineValidation {
  const errors = checks.filter((c) => !c.ok && c.severity === "error").length;
  const warnings = checks.filter((c) => !c.ok && c.severity === "warning").length;
  return { status: errors ? "issues" : "pass", checks, errors, warnings, llm, checkedAt: new Date().toISOString() };
}

/** Full deterministic validation: rules + the simulated dry run. */
export async function validateRoutine(state: TeachState, skill: Skill, actions: RecordedAction[] = []): Promise<RoutineValidation> {
  const checks = routineRuleChecks(state, skill, actions);
  const replay = await virtualReplayCheck(skill);
  checks.push({
    id: "dry_run",
    ok: replay.ok,
    severity: "error",
    title: replay.ok
      ? t(`Replays end to end on a test copy (${replay.filled}/${replay.expectedFills} fields, ${replay.gatesPaused.length} ${pl(replay.gatesPaused.length, "pause", "pauses")})`, `Se repite completa en una copia de prueba (${replay.filled}/${replay.expectedFills} campos, ${replay.gatesPaused.length} ${pl(replay.gatesPaused.length, "pausa", "pausas")})`)
      : t("Didn't replay cleanly on a test copy", "No se repitió bien en una copia de prueba"),
    fix: replay.ok ? null : t("Fix the issues above, then check again.", "Arregla lo de arriba y revisa otra vez."),
  });
  return summarize(checks);
}

/** Labels-only description of the routine for the LLM reviewer (no values, no selectors). */
export function routineOutline(state: TeachState): string {
  return state.steps
    .map((s, i) => {
      const parts = [`${i + 1}. Screen "${screenName(s)}"${s.gate ? ` [human pause: ${s.gate}]` : ""}`];
      for (const f of s.fields) parts.push(`   - field "${f.label}" → ${f.decision.kind === "passport" ? `business field ${f.decision.path}` : f.decision.kind === "ask" ? "ask each time" : f.decision.kind === "always" ? "always same option" : "unbound"}`);
      for (const a of s.actions) parts.push(`   - click ${a.role} "${a.label}"`);
      return parts.join("\n");
    })
    .join("\n")
    .slice(0, 6000);
}

export type LlmReviewer = (prompt: { system: string; user: string }) => Promise<string>;

/**
 * Advisory LLM review. Returns up to 4 short notes (EN/ES). Never throws;
 * "skipped" when no reviewer is configured.
 */
export async function llmReviewRoutine(state: TeachState, reviewer: LlmReviewer | null): Promise<RoutineValidation["llm"]> {
  if (!reviewer) return { status: "skipped", notes: [] };
  const system =
    "You review a recorded government-portal filing routine (labels only, no values). Decide if it is a real, repeatable process: starts at the portal entry, ends at the review screen before final submit, no accidental or duplicate steps, no screen without a way forward. Reply with JSON only: {\"notes\":[{\"en\":\"...\",\"es\":\"...\"}]} — at most 4 one-line notes, empty array if it looks right. Never ask for or mention personal data.";
  try {
    const raw = await reviewer({ system, user: `Portal: ${state.portalName}\nForm: ${state.form}\n${routineOutline(state)}` });
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as { notes?: unknown };
    const notes = (Array.isArray(parsed.notes) ? parsed.notes : [])
      .filter((n): n is { en: string; es: string } => !!n && typeof (n as BilingualText).en === "string" && typeof (n as BilingualText).es === "string")
      .slice(0, 4)
      .map((n) => ({ en: n.en.slice(0, 200), es: n.es.slice(0, 200) }));
    return { status: "ok", notes };
  } catch {
    return { status: "error", notes: [] };
  }
}

/** Add the LLM notes as non-blocking warnings. */
export function withLlmNotes(v: RoutineValidation, llm: RoutineValidation["llm"]): RoutineValidation {
  const checks = v.checks.filter((c) => c.id !== "llm_review");
  if (llm.status === "ok") {
    checks.push({
      id: "llm_review",
      ok: llm.notes.length === 0,
      severity: "warning",
      title: llm.notes.length ? llm.notes[0] : t("Clara's review: looks like a complete filing", "Revisión de Clara: parece un trámite completo"),
      fix: llm.notes.length > 1 ? llm.notes[1] : null,
    });
  }
  return summarize(checks, llm);
}

/**
 * Optional live dry run: open the portal entry in the replay browser, check
 * the first recorded screen (or its sign-in) shows up, and close it — Clara
 * fills nothing and clicks nothing. Stops at the first login pause.
 */
export async function portalEntryCheck(
  drive: {
    start(input: { startUrl: string; allowedDomains: string[] }): Promise<{ sessionId: string }>;
    driver(sessionId: string): { settle(): Promise<void>; snapshot(): Promise<{ url: string; title: string; heading: string; hasPassword: boolean }> };
    stop(sessionId: string): Promise<void>;
  },
  input: { startUrl: string; allowedDomains: string[]; firstStep: Pick<DraftStep, "heading" | "title" | "url" | "gate"> | null }
): Promise<RoutineCheck> {
  let sessionId: string | null = null;
  try {
    sessionId = (await drive.start({ startUrl: input.startUrl, allowedDomains: input.allowedDomains })).sessionId;
    const d = drive.driver(sessionId);
    await d.settle();
    const snap = await d.snapshot();
    const want = input.firstStep ? normalizeLabel(input.firstStep.heading || input.firstStep.title) : "";
    const seen = normalizeLabel(`${snap.heading} ${snap.title}`);
    const ok = snap.hasPassword || (!!want && seen.includes(want)) || (!!input.firstStep && sameEntry(input.firstStep.url, snap.url).path);
    return {
      id: "dry_run",
      ok,
      severity: "error",
      title: ok ? t("Live check: the portal opens where your recording starts", "Prueba en vivo: el portal abre donde empieza tu grabación") : t("Live check: the portal opened somewhere else", "Prueba en vivo: el portal abrió en otro lugar"),
      fix: ok ? null : t("Record again from the page the portal opens on.", "Graba otra vez desde la página donde abre el portal."),
    };
  } catch {
    return { id: "dry_run", ok: true, severity: "warning", title: t("Live check skipped — the portal browser didn't open", "Prueba en vivo omitida — no abrió el navegador del portal"), fix: null };
  } finally {
    if (sessionId) await drive.stop(sessionId).catch(() => undefined);
  }
}
