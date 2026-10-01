/**
 * Replay engine (Teach Clara spec §6, §9) — replays a skill for a new
 * business, step by step, from the Business Passport.
 *
 * Contract (never regress):
 *  - Fills only mapped fields. An unmapped field, or a required value the
 *    passport doesn't have, pauses and asks the human (all available
 *    fields on the screen are filled first).
 *  - Pauses at every gate with an explicit handoff; login, codes, CAPTCHA,
 *    certification, signature, payment and submit are always the human's.
 *  - Never clicks submit. Even if a skill somehow contained a submit
 *    click, the engine refuses it here too.
 *  - On any deviation — an unexpected screen, a control it can't find
 *    (or finds twice), a portal validation error — it pauses, reports what
 *    it sees, and asks. It never improvises. Selector misses and unexpected
 *    screens are skill drift: `onDrift` fires so the caller marks the skill
 *    needs_reteach (the skill itself is never edited here).
 *
 * The state is plain JSON so a replay can be resumed across requests.
 * Entered values (passport values, the human's answers) live only in the
 * caller's memory for the run: milestones and pause reports carry labels,
 * never values.
 */
import { applyTransform, type BilingualText, type Skill, type SkillField, type SkillStep, type SkillTarget } from "../skills/skill";
import { isSubmitTarget } from "../skills/skillValidate";
import { defaultGate } from "../skills/gateCopy";
import { normalizeLabel, readPassportPath } from "../teach/passportCatalog";

export interface PageSnapshot {
  url: string;
  title: string;
  heading: string;
  hasPassword: boolean;
  hasCaptcha: boolean;
  errors: string[];
}

export type LocateResult =
  | { ok: true; ref: string; via: "label" | "selector"; tag: string; type: string; value: string }
  | { ok: false; reason: "not_found" | "ambiguous"; seen: string[] };

export interface PortalDriver {
  snapshot(): Promise<PageSnapshot>;
  locate(target: { role: string; label: string; selector?: string | null }): Promise<LocateResult>;
  fill(ref: string, value: string): Promise<void>;
  selectOption(ref: string, optionLabel: string): Promise<boolean>;
  click(ref: string): Promise<void>;
  /** Wait for the page to settle after an action (navigation, SPA update). */
  settle(): Promise<void>;
}

export type ReplayPause =
  | { kind: "gate"; gate: string; stepId: string; handoff: BilingualText; standing: boolean }
  | { kind: "ask"; stepId: string; fields: { key: string; label: string; ask: BilingualText; required: boolean }[] }
  | { kind: "drift"; reason: "unexpected_screen" | "control_not_found" | "control_ambiguous"; stepId: string | null; expected: string; seen: { title: string; heading: string; url: string }; detail: string }
  | { kind: "portal_error"; stepId: string; errors: string[] }
  | { kind: "navigate"; stepId: string; handoff: BilingualText }
  | { kind: "option_missing"; stepId: string; field: string };

export interface ReplayMilestone {
  at: string;
  stepId: string | null;
  text: BilingualText;
}

export interface ReplayState {
  skillId: string;
  version: number;
  stepIndex: number;
  status: "running" | "paused" | "done" | "stopped";
  pause: ReplayPause | null;
  /** Steps entered because a branch fired on the passport. */
  branchTargets: string[];
  done: string[];
  filled: { stepId: string; label: string }[];
  milestones: ReplayMilestone[];
  submitClicks: number;
  /** Fingerprint of the screen when the last step finished / when paused. */
  lastStepScreen: string | null;
  pauseScreen: string | null;
}

export interface ReplayContext {
  skill: Skill;
  passport: unknown;
  driver: PortalDriver;
  /** Human answers for "ask" fields, keyed by field key. Ephemeral. */
  answers?: Record<string, string>;
  onDrift?: (pause: Extract<ReplayPause, { kind: "drift" }>) => void | Promise<void>;
  /**
   * Strict replay: when a recorded control isn't found, name the same
   * control among the labels the page shows (see replay/relocate.ts), or
   * null to pause. Never consulted for ambiguous matches.
   */
  relocate?: (target: { role: string; label: string; selector?: string | null }, seen: string[]) => Promise<string | null>;
  now?: () => string;
  maxLoops?: number;
}

export function newReplayState(skill: Skill): ReplayState {
  return {
    skillId: skill.skill_id,
    version: skill.version,
    stepIndex: 0,
    status: "running",
    pause: null,
    branchTargets: [],
    done: [],
    filled: [],
    milestones: [],
    submitClicks: 0,
    lastStepScreen: null,
    pauseScreen: null,
  };
}

/** Which screen is showing — URL (no query) + heading + title. */
export function screenKey(snap: PageSnapshot): string {
  return `${snap.url.split("?")[0]}|${normalizeLabel(snap.heading)}|${normalizeLabel(snap.title)}`;
}

export function fieldKey(step: SkillStep, index: number): string {
  return `${step.id}#${index}`;
}

function pageMatches(step: SkillStep, snap: PageSnapshot): boolean {
  const { title_contains, url_contains } = step.page_match;
  const text = normalizeLabel(`${snap.heading} ${snap.title}`);
  if (title_contains && !text.includes(normalizeLabel(title_contains))) return false;
  if (url_contains && !snap.url.toLowerCase().includes(url_contains.toLowerCase())) return false;
  return Boolean(title_contains || url_contains);
}

function branchTargets(skill: Skill): Set<string> {
  return new Set(skill.steps.flatMap((s) => (s.branches ?? []).map((b) => b.goto_step)));
}

function branchFires(passport: unknown, when: { passport_has: string; equals?: string | number | boolean }): boolean {
  const v = readPassportPath(passport, when.passport_has);
  if (when.equals === undefined) return v !== undefined && v !== null && v !== "" && v !== false && v !== 0;
  if (typeof when.equals === "boolean") return Boolean(v) === when.equals;
  return String(v ?? "").toLowerCase() === String(when.equals).toLowerCase();
}

/** Can the replay pass over this step without the portal showing it? */
function skippable(step: SkillStep, state: ReplayState, conditional: Set<string>): boolean {
  if (step.gate) return true; // a gate screen that doesn't appear needs no human
  if (conditional.has(step.id) && !state.branchTargets.includes(step.id)) return true;
  return step.fields.length === 0 && step.actions.length === 0;
}

/**
 * What a passport value may be called in a portal's option list. Tried in
 * order; the portal's list decides — the engine never picks an option
 * that doesn't match one of these.
 */
const ENTITY_TYPE_OPTIONS: Record<string, string[]> = {
  limited_liability_company: ["Compañía de Responsabilidad Limitada", "Limited Liability Company", "LLC"],
  llc: ["Compañía de Responsabilidad Limitada", "Limited Liability Company", "LLC"],
  corporation: ["Corporación", "Corporation"],
  foreign_corporation: ["Corporación Foránea", "Foreign Corporation"],
  sole_proprietorship: ["Individuo", "Persona natural", "Sole proprietorship", "Sole proprietor"],
  partnership: ["Sociedad", "Partnership"],
  limited_liability_partnership: ["Sociedad de Responsabilidad Limitada", "Limited Liability Partnership", "LLP"],
  nonprofit: ["Sin fines de lucro", "Nonprofit", "Non-profit"],
};

export function optionCandidates(field: SkillField, value: string): string[] {
  const out = [value];
  if (field.passport_path === "business.entityType") out.push(...(ENTITY_TYPE_OPTIONS[value.toLowerCase()] ?? []));
  return [...new Set(out)];
}

function passportValue(passport: unknown, field: SkillField): string | null {
  if (!field.passport_path) return null;
  const v = readPassportPath(passport, field.passport_path);
  if (v === undefined || v === null || v === "") return null;
  return applyTransform(String(v), field.transform);
}

function stamp(ctx: ReplayContext): string {
  return ctx.now ? ctx.now() : new Date().toISOString();
}

function milestone(state: ReplayState, ctx: ReplayContext, stepId: string | null, text: BilingualText) {
  state.milestones.push({ at: stamp(ctx), stepId, text });
}

async function drift(
  state: ReplayState,
  ctx: ReplayContext,
  reason: Extract<ReplayPause, { kind: "drift" }>["reason"],
  step: SkillStep | null,
  snap: PageSnapshot,
  detail: string
): Promise<ReplayState> {
  const pause: Extract<ReplayPause, { kind: "drift" }> = {
    kind: "drift",
    reason,
    stepId: step?.id ?? null,
    expected: step ? step.label.es || step.label.en : "",
    seen: { title: snap.title, heading: snap.heading, url: snap.url.split("?")[0] },
    detail,
  };
  state.status = "paused";
  state.pause = pause;
  milestone(state, ctx, step?.id ?? null, {
    en: "I found something I didn't expect, so I stopped without touching anything.",
    es: "Encontré algo que no esperaba, así que me detuve sin tocar nada.",
  });
  await ctx.onDrift?.(pause);
  return state;
}

function gatePause(state: ReplayState, ctx: ReplayContext, step: SkillStep | null, gateId: string, standing: boolean): ReplayState {
  const gate = ctx.skill.gates.find((g) => g.id === gateId) ?? defaultGate(gateId);
  const fallback = defaultGate(gateId);
  state.status = "paused";
  state.pause = { kind: "gate", gate: gateId, stepId: step?.id ?? "", handoff: gate.handoff ?? fallback.handoff ?? { en: "Your turn.", es: "Te toca." }, standing };
  milestone(state, ctx, step?.id ?? null, gateId === "submit"
    ? { en: "Everything is filled in and ready for your review.", es: "Todo está lleno y listo para que lo revises." }
    : { en: "This part is yours — I'm waiting for you.", es: "Esta parte te toca a ti — te espero." });
  return state;
}

/** Locate a recorded control; on a miss, let the relocator re-find it once (exact visible label). */
async function locateStrict(ctx: ReplayContext, state: ReplayState, step: SkillStep, target: { role: string; label: string; selector?: string | null }): Promise<LocateResult> {
  const loc = await ctx.driver.locate(target);
  if (loc.ok || loc.reason !== "not_found" || !ctx.relocate || !loc.seen.length) return loc;
  const label = await ctx.relocate(target, loc.seen);
  if (!label || normalizeLabel(label) === normalizeLabel(target.label)) return loc;
  const again = await ctx.driver.locate({ role: target.role, label, selector: null });
  if (!again.ok) return loc;
  milestone(state, ctx, step.id, {
    en: `The portal renamed “${target.label}” to “${label}” — I found it and kept going.`,
    es: `El portal le cambió el nombre a “${target.label}” por “${label}” — lo encontré y seguí.`,
  });
  return again;
}

async function fillField(ctx: ReplayContext, step: SkillStep, field: SkillField, value: string, snap: PageSnapshot, state: ReplayState): Promise<ReplayState | "ok" | "skip"> {
  const role = field.portal_field.role === "combobox" ? "combobox" : "textbox";
  const loc = await locateStrict(ctx, state, step, { role, label: field.portal_field.label, selector: field.portal_field.selector });
  if (!loc.ok) {
    if (!field.required && field.fallback === "skip_step") return "skip";
    return drift(state, ctx, loc.reason === "ambiguous" ? "control_ambiguous" : "control_not_found", step, snap, `"${field.portal_field.label}"`);
  }
  if (role === "textbox") {
    await ctx.driver.fill(loc.ref, value);
    return "ok";
  }
  const candidates = optionCandidates(field, value);
  if (loc.tag === "select") {
    for (const c of candidates) if (await ctx.driver.selectOption(loc.ref, c)) return "ok";
  } else {
    await ctx.driver.click(loc.ref);
    await ctx.driver.settle();
    for (const c of candidates) {
      const opt = await ctx.driver.locate({ role: "option", label: c });
      if (opt.ok) {
        await ctx.driver.click(opt.ref);
        await ctx.driver.settle();
        return "ok";
      }
    }
    // Close the list we opened; nothing was picked.
    await ctx.driver.click(loc.ref);
  }
  // The business's value isn't in the portal's list: that's a question for
  // the human, not skill drift. Never pick something else.
  state.status = "paused";
  state.pause = { kind: "option_missing", stepId: step.id, field: field.portal_field.label };
  milestone(state, ctx, step.id, {
    en: `"${field.portal_field.label}" doesn't list the business's answer — please pick it yourself.`,
    es: `"${field.portal_field.label}" no tiene la respuesta del negocio en la lista — escógela tú.`,
  });
  return state;
}

async function clickTarget(ctx: ReplayContext, step: SkillStep, target: SkillTarget, snap: PageSnapshot, state: ReplayState): Promise<ReplayState | "ok"> {
  if (isSubmitTarget(target)) {
    // Defense in depth: validated skills can't contain this.
    return gatePause(state, ctx, step, "submit", true);
  }
  const loc = await locateStrict(ctx, state, step, { role: target.role, label: target.label_contains, selector: target.selector });
  if (!loc.ok) return drift(state, ctx, loc.reason === "ambiguous" ? "control_ambiguous" : "control_not_found", step, snap, `"${target.label_contains}"`);
  if (isSubmitTarget({ role: target.role, label_contains: loc.value || target.label_contains, selector: null })) {
    return gatePause(state, ctx, step, "submit", true);
  }
  await ctx.driver.click(loc.ref);
  await ctx.driver.settle();
  return "ok";
}

/** Do the work on one matched step. Returns the paused state, or "done". */
async function runStep(ctx: ReplayContext, state: ReplayState, step: SkillStep, snap: PageSnapshot): Promise<ReplayState | "done"> {
  if (step.gate) return gatePause(state, ctx, step, step.gate, false);

  // 1. Fill everything we can; collect what we must ask.
  const toAsk: Extract<ReplayPause, { kind: "ask" }>["fields"] = [];
  let filledHere = 0;
  for (const [i, field] of step.fields.entries()) {
    const key = fieldKey(step, i);
    const already = state.filled.some((f) => f.stepId === step.id && f.label === field.portal_field.label);
    if (already) continue;
    const value = ctx.answers?.[key] ?? passportValue(ctx.passport, field);
    if (value === null) {
      if (field.passport_path === null || field.required) {
        toAsk.push({
          key,
          label: field.portal_field.label,
          ask: field.ask ?? { en: `What should go in "${field.portal_field.label}"?`, es: `¿Qué va en "${field.portal_field.label}"?` },
          required: field.required,
        });
      }
      continue;
    }
    const r = await fillField(ctx, step, field, value, snap, state);
    if (r === "skip") continue;
    if (r !== "ok") return r;
    state.filled.push({ stepId: step.id, label: field.portal_field.label });
    filledHere += 1;
  }
  if (filledHere) {
    milestone(state, ctx, step.id, {
      en: `Filled ${filledHere} field(s) on "${step.label.en}".`,
      es: `Llené ${filledHere} campo(s) en "${step.label.es}".`,
    });
  }
  if (toAsk.length) {
    state.status = "paused";
    state.pause = { kind: "ask", stepId: step.id, fields: toAsk };
    return state;
  }

  // 2. Branches for THIS business decide which conditional screens to expect.
  for (const b of step.branches ?? []) {
    if (branchFires(ctx.passport, b.when) && !state.branchTargets.includes(b.goto_step)) state.branchTargets.push(b.goto_step);
  }

  // 3. Clicks (choices, then navigation — in recorded order).
  for (const action of step.actions) {
    const r = await clickTarget(ctx, step, action.target, snap, state);
    if (r !== "ok") return r;
  }
  return "done";
}

/**
 * Run until the next pause or the end. Call again (with answers, after the
 * human acts) to continue.
 */
export async function advanceReplay(stateIn: ReplayState, ctx: ReplayContext): Promise<ReplayState> {
  const next = await advanceInner(stateIn, ctx);
  if (next.status === "paused") next.pauseScreen = screenKey(await ctx.driver.snapshot());
  return next;
}

async function advanceInner(stateIn: ReplayState, ctx: ReplayContext): Promise<ReplayState> {
  const state: ReplayState = JSON.parse(JSON.stringify(stateIn));
  if (state.status === "done" || state.status === "stopped") return state;
  const { skill } = ctx;
  const conditional = branchTargets(skill);
  const resumingFrom = state.pause;
  state.status = "running";
  state.pause = null;

  for (let loop = 0; loop < (ctx.maxLoops ?? 60); loop++) {
    if (state.stepIndex >= skill.steps.length) {
      state.status = "done";
      milestone(state, ctx, null, { en: "Done. Nothing was filed by Clara — you submitted it yourself.", es: "Listo. Clara no radicó nada — tú lo enviaste." });
      return state;
    }
    await ctx.driver.settle();
    const snap = await ctx.driver.snapshot();

    // A gate the human is still on (or nothing changed since the pause):
    // keep waiting, don't re-announce.
    if (resumingFrom?.kind === "gate" && loop === 0) {
      const step = skill.steps.find((s) => s.id === resumingFrom.stepId);
      const stillThere =
        screenKey(snap) === state.pauseScreen ||
        (step && pageMatches(step, snap)) ||
        (resumingFrom.gate === "login" && snap.hasPassword) ||
        (resumingFrom.gate === "captcha" && snap.hasCaptcha);
      if (stillThere) {
        state.status = "paused";
        state.pause = resumingFrom;
        return state;
      }
      if (step && !resumingFrom.standing) {
        state.done.push(step.id);
        state.stepIndex = skill.steps.indexOf(step) + 1;
        continue;
      }
    }

    // Find the step this screen is: the next one, or a later one reachable
    // only over steps the portal may legitimately not show.
    let matched: SkillStep | null = null;
    for (let i = state.stepIndex; i < skill.steps.length; i++) {
      const step = skill.steps[i];
      if (pageMatches(step, snap)) {
        matched = step;
        state.stepIndex = i;
        break;
      }
      if (!skippable(step, state, conditional)) break;
    }

    if (!matched) {
      if (snap.hasPassword) return gatePause(state, ctx, null, "login", true);
      if (snap.hasCaptcha) return gatePause(state, ctx, null, "captcha", true);
      const prev = state.done.length ? skill.steps.find((s) => s.id === state.done[state.done.length - 1]) : null;
      if (prev && screenKey(snap) === state.lastStepScreen) {
        // Still on the screen we just finished.
        if (snap.errors.length || prev.actions.length) {
          // The portal rejected it, or our recorded click didn't move on.
          state.status = "paused";
          state.pause = { kind: "portal_error", stepId: prev.id, errors: snap.errors };
          milestone(state, ctx, prev.id, { en: "The portal didn't move on from that screen. I stopped so you can see why.", es: "El portal no pasó de esa pantalla. Me detuve para que veas por qué." });
          return state;
        }
        // Nothing recorded moves past this screen: the human does it. If a
        // gate comes next, that gate is the handoff.
        const next = skill.steps[state.stepIndex];
        if (next?.gate) return gatePause(state, ctx, next, next.gate, false);
        if (resumingFrom?.kind === "navigate" && loop === 0 && screenKey(snap) === state.pauseScreen) {
          state.status = "paused";
          state.pause = resumingFrom;
          return state;
        }
        state.status = "paused";
        state.pause = {
          kind: "navigate",
          stepId: prev.id,
          handoff: { en: "Please go to the next screen in the portal, then tell me to continue.", es: "Pasa tú a la próxima pantalla del portal y me dices para seguir." },
        };
        return state;
      }
      const expected = skill.steps[state.stepIndex];
      return drift(state, ctx, "unexpected_screen", expected ?? null, snap, "This screen isn't part of what I learned.");
    }

    // Standing gates can appear on any screen.
    if (!matched.gate && snap.hasCaptcha) return gatePause(state, ctx, matched, "captcha", true);

    const r = await runStep(ctx, state, matched, snap);
    if (r !== "done") return r;
    state.done.push(matched.id);
    state.stepIndex = skill.steps.indexOf(matched) + 1;
    // The screen this step ran on (before its own navigation click).
    state.lastStepScreen = screenKey(snap);
  }
  state.status = "paused";
  state.pause = null;
  return state;
}

/** Stop a replay (the human can finish by hand). */
export function stopReplay(state: ReplayState): ReplayState {
  return { ...state, status: "stopped", pause: null };
}
