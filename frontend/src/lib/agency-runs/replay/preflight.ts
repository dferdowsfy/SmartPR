/**
 * Preflight plan (Teach Clara spec §6 step 2), shown before Clara acts:
 * what she'll fill from THIS business's passport (and from which fields),
 * what she'll ask, which conditional screens apply, and where the human is
 * needed. Labels and passport field names only — never values.
 */
import type { BilingualText, Skill } from "../skills/skill";
import { GATE_NAMES, passportFieldName } from "../skills/skillCard";
import { catalogEntry, passportHas, readPassportPath } from "../teach/passportCatalog";

export interface PreflightPlan {
  fromPassport: { step: string; field: string; source: BilingualText }[];
  askEachTime: { step: string; field: string }[];
  missingRequired: { step: string; field: string; source: BilingualText }[];
  branches: { screen: string; applies: boolean }[];
  humanSteps: { step: string; gate: string; name: BilingualText }[];
  health: { status: "ok" | "portal_changed" | "unreachable" | "needs_reteach"; detail: string | null };
  summary: BilingualText;
}

const has = (v: unknown) => v !== undefined && v !== null && v !== "";

export function planReplay(skill: Skill, passport: unknown, health: PreflightPlan["health"] = { status: "ok", detail: null }): PreflightPlan {
  const plan: PreflightPlan = { fromPassport: [], askEachTime: [], missingRequired: [], branches: [], humanSteps: [], health, summary: { en: "", es: "" } };
  const title = (id: string) => skill.steps.find((s) => s.id === id)?.label.es ?? id;
  for (const s of skill.steps) {
    const step = s.label.es || s.label.en;
    if (s.gate) plan.humanSteps.push({ step, gate: s.gate, name: GATE_NAMES[s.gate] ?? { en: s.gate, es: s.gate } });
    for (const f of s.fields) {
      if (!f.passport_path) plan.askEachTime.push({ step, field: f.portal_field.label });
      else if (catalogEntry(f.passport_path)?.sensitive ? passportHas(passport, f.passport_path) : has(readPassportPath(passport, f.passport_path))) plan.fromPassport.push({ step, field: f.portal_field.label, source: passportFieldName(f.passport_path) });
      else if (f.required) plan.missingRequired.push({ step, field: f.portal_field.label, source: passportFieldName(f.passport_path) });
    }
    for (const b of s.branches ?? []) {
      const v = readPassportPath(passport, b.when.passport_has);
      const applies = b.when.equals === undefined ? has(v) && v !== false && v !== 0 : String(v ?? "").toLowerCase() === String(b.when.equals).toLowerCase();
      plan.branches.push({ screen: title(b.goto_step), applies });
    }
  }
  const gates = [...new Set(plan.humanSteps.map((g) => g.gate))];
  const n = plan.fromPassport.length;
  plan.summary = {
    en: `I'll fill ${n} field(s) from the business's info${plan.askEachTime.length + plan.missingRequired.length ? `, ask you ${plan.askEachTime.length + plan.missingRequired.length}` : ""}, then pause for your review. I'll need you at: ${gates.map((g) => (GATE_NAMES[g] ?? { en: g }).en).join(", ")}.`,
    es: `Voy a llenar ${n} campo(s) con la información del negocio${plan.askEachTime.length + plan.missingRequired.length ? `, te pregunto ${plan.askEachTime.length + plan.missingRequired.length}` : ""} y me detengo para que lo revises. Te voy a necesitar en: ${gates.map((g) => (GATE_NAMES[g] ?? { es: g }).es).join(", ")}.`,
  };
  return plan;
}
