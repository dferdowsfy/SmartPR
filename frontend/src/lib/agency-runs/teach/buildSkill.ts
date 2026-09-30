/**
 * Finished teach session → skill (Teach Clara spec §4/§5).
 *
 * Tier rules (spec §7) are applied here, not taken from the client:
 * admin → scope "shared", partner/user → scope "private"; every taught
 * skill starts as a draft. The result is only saveable when there are no
 * open questions and validateSkill returns no errors.
 */
import { REQUIRED_HUMAN_GATES, type Skill, type SkillAction, type SkillBranch, type SkillField, type SkillStep, type SkillTransform } from "../skills/skill";
import { validateSkill } from "../skills/skillValidate";
import { defaultGate } from "../skills/gateCopy";
import type { SchemaError } from "../skills/jsonSchema";
import { normalizeLabel } from "./passportCatalog";
import type { TeachValueKind } from "./events";
import { openQuestions, type DraftStep, type TeachGate, type TeachState } from "./teachSession";

const CUSTOM_DROPDOWN_RULE =
  "CUSTOM DROPDOWN: click the control to open the list, click the option whose visible text matches, then read the shown value back.";
const EXCLUSIVE: TeachGate[] = ["login", "mfa", "captcha"];

export interface BuildResult {
  skill: Skill;
  /** Why the skill can't be saved yet (open questions etc.). */
  blockers: string[];
  errors: SchemaError[];
}

function idPart(text: string): string {
  return normalizeLabel(text).replace(/ñ/g, "n").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "form";
}

/** skill_id = <site>.<form>, e.g. "sbp_ogpe_pr_gov.permiso_unico". */
export function taughtSkillId(startUrl: string, form: string): string {
  const host = new URL(startUrl).hostname.replace(/^www\./, "");
  return `${idPart(host)}.${idPart(form)}`;
}

function transformFor(kind: TeachValueKind): SkillTransform {
  if (kind === "phone") return "strip_formatting";
  if (kind === "option") return null;
  return "trim";
}

function pageMatch(step: DraftStep): SkillStep["page_match"] {
  const match: SkillStep["page_match"] = {};
  const title = (step.heading || step.title).trim();
  if (title) match.title_contains = title.slice(0, 120);
  try {
    const u = new URL(step.url);
    const path = `${u.pathname}${u.hash}`;
    if (path && path !== "/") match.url_contains = path.slice(0, 200);
    else if (!title) match.url_contains = u.host;
  } catch {
    if (!title) match.url_contains = "/";
  }
  return match;
}

function askFor(label: string): { en: string; es: string } {
  return { en: `What should go in "${label}"?`, es: `¿Qué va en "${label}"?` };
}

function workFor(step: DraftStep): { fields: SkillField[]; actions: SkillAction[]; rules: string[] } {
  const fields: SkillField[] = [];
  const actions: SkillAction[] = [];
  const rules = [...step.notes];

  for (const f of step.fields) {
    const portal_field: SkillField["portal_field"] = { label: f.label, selector: f.selector, role: f.role };
    const rule = f.role === "combobox" ? CUSTOM_DROPDOWN_RULE : undefined;
    if (f.decision.kind === "passport") {
      fields.push({ portal_field, passport_path: f.decision.path, transform: transformFor(f.valueKind), required: f.required, ...(rule ? { rule } : {}), fallback: "pause_and_ask" });
    } else if (f.decision.kind === "ask") {
      fields.push({ portal_field, passport_path: null, ask: askFor(f.label), transform: null, required: f.required, fallback: "pause_and_ask" });
    } else if (f.decision.kind === "always") {
      actions.push({ type: "click", target: { role: "combobox", label_contains: f.label, selector: f.selector }, rule: CUSTOM_DROPDOWN_RULE, fallback: "pause_and_ask" });
      actions.push({ type: "click", target: { role: "option", label_contains: f.decision.option, selector: f.optionSelector }, rule: `Always choose '${f.decision.option}'.`, fallback: "pause_and_ask" });
    }
  }

  for (const a of step.actions) {
    if (a.decision === "nav") {
      actions.push({ type: "click", target: { role: a.role, label_contains: a.label, selector: a.selector }, fallback: "pause_and_ask" });
    } else if (a.decision === "always") {
      actions.push({ type: "click", target: { role: a.role, label_contains: a.label, selector: a.selector }, rule: `Always choose '${a.optionText || a.label}'.`, fallback: "pause_and_ask" });
    } else if (a.decision === "ask") {
      rules.push("This screen has a choice Clara asks you about every time — she doesn't pick it on her own.");
    }
  }
  return { fields, actions, rules };
}

export function buildSkillFromTeach(state: TeachState, opts: { version?: number } = {}): BuildResult {
  const blockers: string[] = [];
  const open = openQuestions(state);
  if (open.length) blockers.push(`${open.length} question(s) still need an answer.`);
  if (state.steps.length === 0) blockers.push("Nothing was recorded yet.");
  const pending = state.steps.flatMap((s) => s.fields.filter((f) => f.decision.kind === "pending"));
  if (pending.length && !open.length) blockers.push(`${pending.length} field(s) have no decision.`);

  const steps: SkillStep[] = [];
  const seenGates = new Set<string>();

  state.steps.forEach((draft) => {
    const base = {
      label: { en: draft.heading || draft.title || draft.id, es: draft.heading || draft.title || draft.id },
      page_match: pageMatch(draft),
      observed: draft.observed,
      fallback: "pause_and_ask" as const,
    };
    const exclusive = draft.gate !== null && EXCLUSIVE.includes(draft.gate);
    const work = exclusive ? { fields: [], actions: [], rules: [] } : workFor(draft);
    const hasWork = work.fields.length > 0 || work.actions.length > 0;

    if (hasWork || !draft.gate) {
      steps.push({
        id: draft.id,
        ...base,
        ...(work.rules.length ? { rules: work.rules } : {}),
        actions: work.actions,
        fields: work.fields,
      });
    }
    if (draft.gate) {
      seenGates.add(draft.gate);
      steps.push({
        id: hasWork ? `${draft.id}-${draft.gate}` : draft.id,
        ...base,
        gate: draft.gate,
        actions: [],
        fields: [],
      });
    }
  });

  // Branches: "this screen only shows up when …" → a branch on the step before it.
  state.steps.forEach((draft, i) => {
    if (!draft.conditional || draft.conditional === "unknown" || i === 0) return;
    const prevDraft = state.steps[i - 1];
    const prev = [...steps].reverse().find((s) => s.id === prevDraft.id || s.id.startsWith(`${prevDraft.id}-`));
    const target = steps.find((s) => s.id === draft.id || s.id.startsWith(`${draft.id}-`));
    if (!prev || !target) return;
    const branch: SkillBranch = {
      when: draft.conditional.equals === undefined ? { passport_has: draft.conditional.path } : { passport_has: draft.conditional.path, equals: draft.conditional.equals },
      goto_step: target.id,
      note: "This screen only shows up for some businesses.",
    };
    prev.branches = [...(prev.branches ?? []), branch];
  });
  state.steps.forEach((draft) => {
    if (draft.conditional !== "unknown") return;
    const target = steps.find((s) => s.id === draft.id);
    if (target) target.note = "Shows up only sometimes — the teacher wasn't sure why. Clara follows the portal.";
  });

  // Every taught skill ends in a human submit, even if the teacher stopped
  // before it.
  if (!steps.some((s) => s.gate === "submit")) {
    steps.push({
      id: "revision-final",
      label: { en: "Final review and submit", es: "Revisión final y envío" },
      page_match: { title_contains: "Revis" },
      gate: "submit",
      observed: false,
      fallback: "pause_and_ask",
      actions: [],
      fields: [],
      note: "Not demonstrated during teaching. The human always reviews and submits.",
    });
    seenGates.add("submit");
  }

  const gateIds = [...new Set<string>([...REQUIRED_HUMAN_GATES, ...seenGates])];
  const skill: Skill = {
    skill_id: taughtSkillId(state.startUrl, state.form),
    version: opts.version ?? 1,
    portal: { name: state.portalName, base_url: `${new URL(state.startUrl).origin}/` },
    form: state.form,
    taught_by: state.tier,
    scope: state.tier === "admin" ? "shared" : "private",
    status: "draft",
    steps,
    gates: gateIds.map(defaultGate),
  };
  return { skill, blockers, errors: validateSkill(skill) };
}
