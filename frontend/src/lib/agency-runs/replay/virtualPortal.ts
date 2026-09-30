/**
 * Virtual portal built from a skill — the automated replay check of the
 * review-and-promote flow (Teach Clara spec §8, step 3) for portals with no
 * hand-built simulator. Every step becomes a screen with the recorded
 * labels; gate screens need the (scripted) human; conditional screens show
 * only when their branch fires on the test passport. The same engine runs
 * against it, so the check proves: every mapped field resolves and fills,
 * every gate on the path pauses, nothing clicks submit, nothing drifts.
 *
 * Hand-built simulators (public/simulators/*) remain the stronger check for
 * the portals that have one.
 */
import type { Skill, SkillStep } from "../skills/skill";
import { catalogEntry, normalizeLabel } from "../teach/passportCatalog";
import { advanceReplay, newReplayState, type LocateResult, type PageSnapshot, type PortalDriver, type ReplayState } from "./engine";
import { isSubmitTarget } from "../skills/skillValidate";

interface VControl {
  ref: string;
  role: string;
  label: string;
  value: string;
  nav: boolean;
}

interface VPage {
  steps: SkillStep[];
  url: string;
  heading: string;
  gate: string | null;
  controls: VControl[];
}

export class VirtualPortal implements PortalDriver {
  pages: VPage[] = [];
  index = 0;
  clicks: string[] = [];
  submitClicked = false;
  private refSeq = 0;

  constructor(private skill: Skill, private visibleStepIds: Set<string>) {
    const base = skill.portal.base_url.replace(/\/$/, "");
    for (const step of skill.steps) {
      if (!visibleStepIds.has(step.id)) continue;
      const same = this.pages.at(-1);
      const key = JSON.stringify(step.page_match);
      if (same && JSON.stringify(same.steps[0].page_match) === key) {
        same.steps.push(step);
        if (step.gate) same.gate = step.gate;
        same.controls.push(...this.controlsFor(step));
        continue;
      }
      const heading = step.page_match.title_contains ?? step.label.es;
      const url = `${base}/${step.page_match.url_contains ?? `#${step.id}`}`.replace(/([^:])\/\//g, "$1/");
      this.pages.push({ steps: [step], url, heading, gate: step.gate ?? null, controls: this.controlsFor(step) });
    }
  }

  private controlsFor(step: SkillStep): VControl[] {
    const out: VControl[] = [];
    for (const f of step.fields) out.push({ ref: `v${++this.refSeq}`, role: f.portal_field.role === "combobox" ? "combobox" : "textbox", label: f.portal_field.label, value: "", nav: false });
    step.actions.forEach((a, i) => {
      const isLast = i === step.actions.length - 1;
      out.push({ ref: `v${++this.refSeq}`, role: a.target.role, label: a.target.label_contains, value: "", nav: isLast });
    });
    return out;
  }

  private get page(): VPage | undefined {
    return this.pages[this.index];
  }

  /** The scripted human finishes the current screen (gate / navigate). */
  humanAdvance(): void {
    this.index += 1;
  }

  async snapshot(): Promise<PageSnapshot> {
    const p = this.page;
    if (!p) return { url: `${this.skill.portal.base_url}#end`, title: "", heading: "Fin", hasPassword: false, hasCaptcha: false, errors: [] };
    return { url: p.url, title: "", heading: p.heading, hasPassword: p.gate === "login", hasCaptcha: p.gate === "captcha", errors: [] };
  }

  async locate(target: { role: string; label: string; selector?: string | null }): Promise<LocateResult> {
    const p = this.page;
    if (!p) return { ok: false, reason: "not_found", seen: [] };
    const want = normalizeLabel(target.label);
    if (target.role === "option") {
      // Options open under a combobox; the virtual list has what's asked for.
      return { ok: true, ref: `opt:${target.label}`, via: "label", tag: "li", type: "", value: target.label };
    }
    const hits = p.controls.filter((c) => (c.role === target.role || (target.role === "textbox" && c.role === "textbox")) && normalizeLabel(c.label) === want);
    if (hits.length === 1) return { ok: true, ref: hits[0].ref, via: "label", tag: hits[0].role === "combobox" ? "div" : "input", type: "", value: hits[0].value };
    return hits.length > 1 ? { ok: false, reason: "ambiguous", seen: [] } : { ok: false, reason: "not_found", seen: p.controls.map((c) => c.label) };
  }

  async fill(ref: string, value: string): Promise<void> {
    const c = this.page?.controls.find((x) => x.ref === ref);
    if (c) c.value = value;
  }

  async selectOption(): Promise<boolean> {
    return true;
  }

  async click(ref: string): Promise<void> {
    if (ref.startsWith("opt:")) {
      const label = ref.slice(4);
      const recorded = this.page?.controls.find((c) => c.role === "option" && normalizeLabel(c.label) === normalizeLabel(label));
      if (recorded) {
        this.clicks.push(label);
        if (recorded.nav) this.index += 1;
        return;
      }
      const combo = this.page?.controls.filter((c) => c.role === "combobox" && !c.value).at(0);
      if (combo) combo.value = label;
      return;
    }
    const c = this.page?.controls.find((x) => x.ref === ref);
    if (!c) return;
    this.clicks.push(c.label);
    if (isSubmitTarget({ role: "button", label_contains: c.label, selector: null })) this.submitClicked = true;
    if (c.nav && c.role !== "combobox") this.index += 1;
  }

  async settle(): Promise<void> {}

  filledLabels(): string[] {
    return this.pages.flatMap((p) => p.controls.filter((c) => c.value && (c.role === "textbox" || c.role === "combobox")).map((c) => c.label));
  }
}

/** Plausible test values for every passport path a skill reads. */
export function syntheticPassport(skill: Skill): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const set = (path: string, value: unknown) => {
    const parts = path.split(".");
    let node = out;
    for (const p of parts.slice(0, -1)) node = (node[p] ??= {}) as Record<string, unknown>;
    node[parts.at(-1)!] = value;
  };
  for (const step of skill.steps) {
    for (const f of step.fields) {
      if (!f.passport_path) continue;
      const kinds = catalogEntry(f.passport_path)?.kinds ?? ["text"];
      const value =
        f.passport_path === "business.entityType" ? "limited_liability_company"
        : f.passport_path === "addresses.municipality" ? "San Juan"
        : kinds.includes("email") ? "prueba@ejemplo.invalid"
        : kinds.includes("phone") ? "787-555-0100"
        : kinds.includes("postal") ? "00901"
        : kinds.includes("date") ? "2026-01-15"
        : kinds.includes("number") ? "3"
        : "Prueba";
      set(f.passport_path, value);
    }
    for (const b of step.branches ?? []) set(b.when.passport_has, b.when.equals ?? true);
  }
  return out;
}

export interface ReplayCheckResult {
  ok: boolean;
  gatesPaused: string[];
  expectedGates: string[];
  filled: number;
  expectedFills: number;
  submitClicked: boolean;
  problems: string[];
}

/** §8 step 3: replay the skill against its virtual portal with a test passport. */
export async function virtualReplayCheck(skill: Skill): Promise<ReplayCheckResult> {
  const passport = syntheticPassport(skill);
  // Branches all fire on the synthetic passport, so every screen is on the path.
  const portal = new VirtualPortal(skill, new Set(skill.steps.map((s) => s.id)));
  const problems: string[] = [];
  const gatesPaused: string[] = [];
  let state: ReplayState = newReplayState(skill);
  const answers: Record<string, string> = {};
  for (let i = 0; i < 200 && state.status !== "done"; i++) {
    state = await advanceReplay(state, { skill, passport, driver: portal, answers, onDrift: (d) => void problems.push(`${d.reason}: ${d.expected} ${d.detail}`) });
    if (state.status === "done") break;
    const p = state.pause;
    if (!p) {
      problems.push("replay stopped without a reason");
      break;
    }
    if (p.kind === "gate") {
      // The same gate is re-reported while the human is still on it.
      if (gatesPaused.at(-1) !== p.gate) gatesPaused.push(p.gate);
      portal.humanAdvance();
    } else if (p.kind === "navigate") {
      portal.humanAdvance();
    } else if (p.kind === "ask") {
      for (const f of p.fields) answers[f.key] = "Respuesta de prueba";
    } else {
      if (p.kind !== "drift") problems.push(`${p.kind} on ${p.stepId}`);
      break;
    }
  }
  if (state.status !== "done" && !problems.length) problems.push("replay did not finish");
  const expectedGates = skill.steps.filter((s) => s.gate).map((s) => s.gate!);
  const missingGates = expectedGates.filter((g) => !gatesPaused.includes(g));
  if (missingGates.length) problems.push(`gates that never paused: ${missingGates.join(", ")}`);
  if (portal.submitClicked) problems.push("submit was clicked");
  const expectedFills = skill.steps.reduce((n, s) => n + s.fields.length, 0);
  const filled = portal.filledLabels().length;
  if (filled < expectedFills) problems.push(`filled ${filled} of ${expectedFills} fields`);
  return { ok: problems.length === 0, gatesPaused, expectedGates, filled, expectedFills, submitClicked: portal.submitClicked, problems };
}
