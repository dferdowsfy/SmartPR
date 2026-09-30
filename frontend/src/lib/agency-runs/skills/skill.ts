/**
 * Clara filing skills — types, the human-gate registry, and validation.
 *
 * A skill is the reusable structure of one agency-portal filing: steps,
 * field → passport mappings, conditional branches and declared human gates.
 * It never stores entered values, credentials or PII; values come from the
 * Business Passport at replay. `validateSkill` enforces the JSON schema
 * (skill.schema.json) plus cross-reference invariants a schema cannot state.
 */
import schemaJson from "./skill.schema.json";
import { validateJsonSchema, type JsonSchema, type SchemaError } from "./jsonSchema";

export type SkillGateKind =
  | "login"
  | "mfa"
  | "captcha"
  | "certification"
  | "signature"
  | "payment"
  | "final_submit"
  | "upload"
  | "phone_call"
  | "unknown_screen";

/**
 * Human gates every skill must declare (verified 2026-09-28 — never regress).
 * Clara pauses or refuses at each; the human acts in their own browser.
 */
export const REQUIRED_HUMAN_GATES: readonly SkillGateKind[] = [
  "login",
  "mfa",
  "captcha",
  "certification",
  "signature",
  "payment",
  "final_submit",
  "unknown_screen",
];

/** Gates Clara must decline to perform even when asked. */
export const REFUSE_GATES: readonly SkillGateKind[] = [
  "certification",
  "signature",
  "payment",
  "final_submit",
];

export interface BilingualText {
  en: string;
  es: string;
}

export interface SkillGate {
  kind: SkillGateKind;
  actor: "human";
  channel: "IN_BROWSER" | "INLINE";
  clara: "pause_and_handoff" | "refuse_and_handoff" | "pause_and_ask";
  stepIds?: string[];
  handoff: BilingualText;
}

export interface SkillRule {
  id: string;
  kind: "sequencing" | "control_quirk" | "choice" | "safety";
  text: BilingualText;
  source?: string;
}

export interface SkillTarget {
  label_es: string;
  label_en?: string;
  selector?: string | null;
  control?:
    | "text"
    | "email"
    | "tel"
    | "native_select"
    | "custom_dropdown"
    | "radio"
    | "checkbox"
    | "button"
    | "link"
    | "map"
    | "file";
  role?: "navigation" | "save_draft" | "next" | "choice" | "final_submit";
}

export type SkillFillSource =
  | { kind: "passport"; path: string }
  | { kind: "ask_human"; ask: BilingualText };

export type SkillAction =
  | { type: "fill"; target: SkillTarget; source: SkillFillSource; required: boolean; ruleIds?: string[] }
  | { type: "choose"; target: SkillTarget; option: string; ruleIds?: string[] }
  | { type: "click"; target: SkillTarget; ruleIds?: string[] };

export interface SkillCondition {
  passportPath: string;
  op: "exists" | "missing" | "equals" | "not_equals" | "in";
  value?: string | number | boolean;
  values?: string[];
}

export interface SkillBranch {
  id: string;
  when: SkillCondition;
  then: { gotoStepId?: string; actions?: SkillAction[]; pause?: BilingualText };
  note?: string;
}

export type SkillFallbackTrigger =
  | "selector_miss"
  | "unknown_screen"
  | "validation_error"
  | "empty_options"
  | "unmapped_field"
  | "gate_detected"
  | "timeout";

export interface SkillFallback {
  on: SkillFallbackTrigger;
  do: "relocate_by_label" | "pause_and_ask" | "handoff_to_human" | "report_and_stop";
  message: BilingualText;
}

export interface SkillStep {
  id: string;
  label_en: string;
  label_es: string;
  actor: "clara" | "human";
  channel: "AGENT" | "INLINE" | "VAULT" | "IN_BROWSER";
  gate?: SkillGateKind;
  screen: { pageId: string; headingIncludes?: string[]; urlIncludes?: string[] };
  observed: boolean;
  evidence: "live_verified" | "live_qa" | "official_manual" | "inferred";
  actions: SkillAction[];
  branches?: SkillBranch[];
  fallbacks: SkillFallback[];
  expectedState_en?: string;
  expectedState_es?: string;
  notes_en?: string;
  notes_es?: string;
}

export interface Skill {
  $schema?: string;
  schemaVersion: 1;
  skillId: string;
  version: number;
  status: "draft" | "in_review" | "active" | "needs_reteach" | "retired";
  scope: "private" | "shared";
  portal: { agencyId: string; name: string; domains: string[]; startUrl: string };
  form: { filingTypeId: string; label_en: string; label_es: string };
  provenance: {
    source: "hand_written" | "teach_session";
    derivedFrom: string;
    createdAt: string;
    verification: {
      status: "observed" | "partially_observed" | "unobserved";
      checkedAt: string;
      evidence: string;
    };
  };
  gates: SkillGate[];
  rules: SkillRule[];
  steps: SkillStep[];
}

export const SKILL_SCHEMA = schemaJson as JsonSchema;

/** Visible text that marks a final-submit control on PR portals. */
const SUBMIT_LABEL = /\b(radicar|enviar|someter|submit|file now)\b/i;

/** Every action in a step, including those nested in branches. */
export function stepActions(step: SkillStep): SkillAction[] {
  return [...step.actions, ...(step.branches ?? []).flatMap((b) => b.then.actions ?? [])];
}

/** True when the action would press a final-submit control. */
export function isSubmitAction(action: SkillAction): boolean {
  return (
    action.target.role === "final_submit" ||
    (action.type === "click" && SUBMIT_LABEL.test(`${action.target.label_es} ${action.target.label_en ?? ""}`))
  );
}

/** Invariants that cross-reference parts of the skill. */
function checkInvariants(skill: Skill): SchemaError[] {
  const errors: SchemaError[] = [];
  const stepIds = new Set(skill.steps.map((s) => s.id));
  const ruleIds = new Set(skill.rules.map((r) => r.id));
  const gateKinds = new Set(skill.gates.map((g) => g.kind));

  if (stepIds.size !== skill.steps.length) errors.push({ path: "/steps", message: "duplicate step ids" });
  if (ruleIds.size !== skill.rules.length) errors.push({ path: "/rules", message: "duplicate rule ids" });
  if (gateKinds.size !== skill.gates.length) errors.push({ path: "/gates", message: "gate kind declared twice" });

  for (const kind of REQUIRED_HUMAN_GATES) {
    if (!gateKinds.has(kind)) errors.push({ path: "/gates", message: `required human gate "${kind}" not declared` });
  }
  skill.gates.forEach((gate, i) => {
    if (REFUSE_GATES.includes(gate.kind) && gate.clara !== "refuse_and_handoff") {
      errors.push({ path: `/gates/${i}`, message: `Clara must refuse_and_handoff at "${gate.kind}"` });
    }
    for (const id of gate.stepIds ?? []) {
      if (!stepIds.has(id)) errors.push({ path: `/gates/${i}`, message: `unknown step "${id}"` });
    }
  });

  skill.steps.forEach((step, i) => {
    const at = `/steps/${i}`;
    if (step.gate && !gateKinds.has(step.gate)) {
      errors.push({ path: at, message: `step gate "${step.gate}" is not declared in /gates` });
    }
    for (const action of stepActions(step)) {
      if (isSubmitAction(action)) {
        errors.push({ path: at, message: `step automates final submit ("${action.target.label_es}")` });
      }
      for (const id of action.ruleIds ?? []) {
        if (!ruleIds.has(id)) errors.push({ path: at, message: `unknown rule "${id}"` });
      }
    }
    for (const branch of step.branches ?? []) {
      const goto = branch.then.gotoStepId;
      if (goto && !stepIds.has(goto)) errors.push({ path: at, message: `branch ${branch.id} goes to unknown step "${goto}"` });
      if (!goto && !branch.then.actions?.length && !branch.then.pause) {
        errors.push({ path: at, message: `branch ${branch.id} does nothing` });
      }
    }
    // A relocate attempt must always be backed by a pause for the same trigger.
    for (const fb of step.fallbacks) {
      if (
        fb.do === "relocate_by_label" &&
        !step.fallbacks.some((other) => other.on === fb.on && other.do !== "relocate_by_label")
      ) {
        errors.push({ path: at, message: `fallback on ${fb.on} relocates without a pausing fallback` });
      }
    }
  });
  return errors;
}

/** Validate a parsed skill against the schema and invariants. [] = valid. */
export function validateSkill(value: unknown): SchemaError[] {
  const schemaErrors = validateJsonSchema(SKILL_SCHEMA, value);
  if (schemaErrors.length) return schemaErrors;
  return checkInvariants(value as Skill);
}
