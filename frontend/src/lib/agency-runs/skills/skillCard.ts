/**
 * Human-readable skill card (Teach Clara spec §5 step 6): the steps,
 * what Clara fills from the business's info, what she asks each time, the
 * choices she always makes, the "only sometimes" screens, and where the
 * human takes over. No selectors, no JSON — something a non-technical
 * teacher or an admin reviewer can check at a glance.
 */
import type { BilingualText, Skill } from "./skill";
import { DEFAULT_GATES } from "./gateCopy";
import { ADDITIONAL_PREFIX, catalogEntry, isAdditionalPath } from "../teach/passportCatalog";
import { CANONICAL_LABELS } from "../canonicalFields";

export interface SkillCardStep {
  id: string;
  title: string;
  observed: boolean;
  gate: string | null;
  gateText: BilingualText | null;
  fromPassport: { field: string; source: BilingualText }[];
  askEachTime: string[];
  alwaysChoose: string[];
  onlyWhen: BilingualText[];
  notes: string[];
}

export interface SkillCard {
  title: string;
  portal: string;
  form: string;
  status: Skill["status"];
  scope: Skill["scope"];
  steps: SkillCardStep[];
  humanGates: { id: string; text: BilingualText }[];
  counts: { screens: number; fromPassport: number; askEachTime: number; humanSteps: number; notDemonstrated: number };
}

export const GATE_NAMES: Record<string, BilingualText> = {
  login: { en: "Sign in", es: "Entrar al portal" },
  mfa: { en: "Verification code", es: "Código de verificación" },
  captcha: { en: "CAPTCHA", es: "CAPTCHA" },
  certification: { en: "Legal certification", es: "Certificación legal" },
  signature: { en: "Signature", es: "Firma" },
  payment: { en: "Payment", es: "Pago" },
  submit: { en: "Final submit", es: "Envío final" },
  upload: { en: "Documents", es: "Documentos" },
  identity: { en: "Social Security / ID number", es: "Seguro Social / identificación" },
  parcel: { en: "Property parcel", es: "Parcela de la propiedad" },
};

export function passportFieldName(path: string): BilingualText {
  const entry = catalogEntry(path);
  if (entry) return { en: entry.en, es: entry.es };
  const canon = CANONICAL_LABELS[path as keyof typeof CANONICAL_LABELS];
  if (canon) return { en: canon.en, es: canon.es };
  if (isAdditionalPath(path)) {
    // A detail the teacher added from a portal label ("business.additional.numero_de_socios").
    const words = path.slice(ADDITIONAL_PREFIX.length).replace(/_/g, " ");
    const name = words.charAt(0).toUpperCase() + words.slice(1);
    return { en: name, es: name };
  }
  return { en: path, es: path };
}

function describeCondition(passportPath: string, equals: unknown): BilingualText {
  const name = passportFieldName(passportPath);
  if (equals === undefined) return { en: `the business has "${name.en}"`, es: `el negocio tiene "${name.es}"` };
  if (equals === true) return { en: `"${name.en}" is Yes`, es: `"${name.es}" es Sí` };
  if (equals === false) return { en: `"${name.en}" is No`, es: `"${name.es}" es No` };
  return { en: `"${name.en}" is ${String(equals)}`, es: `"${name.es}" es ${String(equals)}` };
}

export function skillCard(skill: Skill): SkillCard {
  const onlyWhen = new Map<string, BilingualText[]>();
  for (const step of skill.steps) {
    for (const b of step.branches ?? []) {
      onlyWhen.set(b.goto_step, [...(onlyWhen.get(b.goto_step) ?? []), describeCondition(b.when.passport_has, b.when.equals)]);
    }
  }
  const steps: SkillCardStep[] = skill.steps.map((s) => ({
    id: s.id,
    title: s.label.es || s.label.en,
    observed: s.observed,
    gate: s.gate ?? null,
    gateText: s.gate ? GATE_NAMES[s.gate] ?? { en: s.gate, es: s.gate } : null,
    fromPassport: s.fields
      .filter((f) => f.passport_path)
      .map((f) => ({ field: f.portal_field.label, source: passportFieldName(f.passport_path!) })),
    askEachTime: s.fields.filter((f) => !f.passport_path).map((f) => f.portal_field.label),
    alwaysChoose: s.actions.filter((a) => a.rule?.startsWith("Always choose") || /always choose/i.test(a.rule ?? "")).map((a) => a.target.label_contains),
    onlyWhen: onlyWhen.get(s.id) ?? [],
    notes: [...(s.rules ?? []), ...(s.note ? [s.note] : [])],
  }));
  const humanGates = skill.gates
    .filter((g) => g.type === "human" || skill.steps.some((s) => s.gate === g.id))
    .map((g) => ({ id: g.id, text: GATE_NAMES[g.id] ?? { en: g.id, es: g.id } }));
  return {
    title: `${skill.portal.name} — ${skill.form}`,
    portal: skill.portal.name,
    form: skill.form,
    status: skill.status,
    scope: skill.scope,
    steps,
    humanGates,
    counts: {
      screens: steps.length,
      fromPassport: steps.reduce((n, s) => n + s.fromPassport.length, 0),
      askEachTime: steps.reduce((n, s) => n + s.askEachTime.length, 0),
      humanSteps: steps.filter((s) => s.gate).length,
      notDemonstrated: steps.filter((s) => !s.observed).length,
    },
  };
}

export { DEFAULT_GATES };
