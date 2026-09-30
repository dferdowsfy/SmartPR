/**
 * Skill validation: skill.schema.json plus the cross-reference invariants
 * of Teach Clara spec §3 and the §8 sanitization check that a schema
 * cannot state. Every skill must pass `validateSkill` before it is saved.
 */
import schemaJson from "./skill.schema.json";
import { validateJsonSchema, type JsonSchema, type SchemaError } from "./jsonSchema";
import { REQUIRED_HUMAN_GATES, type Skill, type SkillTarget } from "./skill";

export const SKILL_SCHEMA = schemaJson as JsonSchema;

/** Visible text that marks a final-submit control on PR portals. */
const SUBMIT_LABEL = /\b(radicar|enviar|someter|submit)\b/i;
/** Controls Clara must never click: certification / attestation boxes. */
const ATTESTATION_LABEL = /\b(juramento|certific|attest|perjur)/i;
/** Fields Clara must never fill, whatever they are mapped to. */
const SECRET_LABEL = /\b(contrase[ñn]a|password|c[óo]digo de verificaci[óo]n|mfa|otp|captcha|ssn|seguro social|tarjeta|card number|cvv|routing|cuenta bancaria|firma|signature)\b/i;

/** True when clicking this target would file the application. */
export function isSubmitTarget(target: SkillTarget): boolean {
  return SUBMIT_LABEL.test(target.label_contains);
}

/** Cross-reference invariants (spec §3) and the §8 sanitization check. */
function checkInvariants(skill: Skill): SchemaError[] {
  const errors: SchemaError[] = [];
  const stepIds = new Set(skill.steps.map((s) => s.id));
  const gates = new Map(skill.gates.map((g) => [g.id, g]));

  if (stepIds.size !== skill.steps.length) errors.push({ path: "/steps", message: "duplicate step ids" });
  if (gates.size !== skill.gates.length) errors.push({ path: "/gates", message: "duplicate gate ids" });

  for (const id of REQUIRED_HUMAN_GATES) {
    const gate = gates.get(id);
    if (!gate) errors.push({ path: "/gates", message: `required gate "${id}" not declared` });
    else if (gate.type !== "human") errors.push({ path: "/gates", message: `gate "${id}" must be type human` });
  }

  skill.steps.forEach((step, i) => {
    const at = `/steps/${i}`;
    if (!step.page_match.url_contains && !step.page_match.title_contains) {
      errors.push({ path: `${at}/page_match`, message: "needs url_contains or title_contains" });
    }
    if (step.gate && !gates.has(step.gate)) {
      errors.push({ path: at, message: `gate "${step.gate}" is not declared in /gates` });
    }
    step.actions.forEach((action, j) => {
      if (isSubmitTarget(action.target)) {
        errors.push({ path: `${at}/actions/${j}`, message: `automates final submit ("${action.target.label_contains}")` });
      }
      if (ATTESTATION_LABEL.test(action.target.label_contains)) {
        errors.push({ path: `${at}/actions/${j}`, message: `clicks a certification control ("${action.target.label_contains}")` });
      }
    });
    step.fields.forEach((field, j) => {
      const fat = `${at}/fields/${j}`;
      if (SECRET_LABEL.test(field.portal_field.label)) {
        errors.push({ path: fat, message: `field "${field.portal_field.label}" is human-only and cannot be in a skill` });
      }
      if (field.passport_path === null) {
        if (!field.ask) errors.push({ path: fat, message: "unmapped field needs an ask" });
        if (field.fallback !== "pause_and_ask") errors.push({ path: fat, message: "unmapped field must pause_and_ask" });
      } else if (field.ask) {
        errors.push({ path: fat, message: "mapped field must not also ask" });
      }
      if (field.required && field.fallback === "skip_step") {
        errors.push({ path: fat, message: "required field cannot skip_step" });
      }
    });
    for (const branch of step.branches ?? []) {
      if (!stepIds.has(branch.goto_step)) {
        errors.push({ path: at, message: `branch goes to unknown step "${branch.goto_step}"` });
      }
    }
  });

  // The submit gate must come after every screen Clara fills or clicks on.
  const submitAt = skill.steps.findIndex((s) => s.gate === "submit");
  const lastWork = skill.steps.reduce((acc, s, i) => (s.actions.length || s.fields.length ? i : acc), -1);
  if (submitAt === -1) errors.push({ path: "/steps", message: "no step is the submit gate" });
  else if (lastWork > submitAt) errors.push({ path: "/steps", message: "Clara acts after the submit gate" });

  return errors;
}

/** Validate a parsed skill against the schema and invariants. [] = valid. */
export function validateSkill(value: unknown): SchemaError[] {
  const schemaErrors = validateJsonSchema(SKILL_SCHEMA, value);
  if (schemaErrors.length) return schemaErrors;
  return checkInvariants(value as Skill);
}
