// Run 18 (live 2026-10-17, Las Marías barbershop): a flagged ("Needs
// confirmation") headcount settled "Will employees be hired?" in the intake
// while the engine ignored it, so the employer registrations vanished and the
// question was never asked.
// Run: npx tsx --test src/app/ai/intake/settledSources.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { KB, computeRequirementsFromKB } from "../../kb.ts";
import { resolveIntakeFacts } from "./relationships.ts";
import { withoutUnconfirmedSources } from "./settledSources.ts";

const INDUSTRIES = ["Beauty & Personal Care", "Food & Beverage", "Retail", "Other"];
const resolve = (profile: Record<string, unknown>, answers: Record<string, unknown> = {}) =>
  resolveIntakeFacts({ profile, answers }, { kb: KB as never, allowedIndustries: INDUSTRIES });

const profile = {
  business_type: "Barbershop",
  municipality: "Las Marías",
  location_type: "Retail Storefront",
  number_of_employees: 2,
};

test("a flagged headcount does not settle 'Will employees be hired?'", () => {
  const flags = { number_of_employees: true };
  const settled = withoutUnconfirmedSources(profile, {}, flags);
  const r = resolve(settled.profile as Record<string, unknown>, settled.answers);
  assert.equal(r.resolvedQuestionOrigins?.["Q_EMPLOYEES_HIRED"], undefined, "must be asked, not shown as settled");
  assert.equal(r.resolvedQuestionOrigins?.["Q_EMPLOYEE_COUNT"], undefined);
  // The business type is not flagged, so what it settles stays settled.
  assert.equal(r.questionValues["Q_PROFESSIONAL_LICENSES"], true);
  // The visible profile is untouched.
  assert.equal(profile.number_of_employees, 2);
});

test("a confirmed headcount still settles the question", () => {
  const settled = withoutUnconfirmedSources(profile, {}, { number_of_employees: false });
  const r = resolve(settled.profile as Record<string, unknown>, settled.answers);
  assert.equal(r.resolvedQuestionOrigins?.["Q_EMPLOYEES_HIRED"], "derived");
  assert.equal(r.questionValues["Q_EMPLOYEES_HIRED"], true);
});

test("flagged answers are left out by writeKey and by question id", () => {
  const out = withoutUnconfirmedSources({}, { employees_hired: true, alcohol_served: false }, { Q_EMPLOYEES_HIRED: true });
  assert.deepEqual(out.answers, { alcohol_served: false });
});

test("why it matters: the engine ignores the flagged headcount, so the employer registrations only come from an answer", () => {
  const strict = (confirmedKeys: string[], answers: Record<string, unknown>) => {
    const resolved = resolve(profile, answers).questionValues;
    return computeRequirementsFromKB(profile, answers, resolved, {
      projectIntent: "new_business",
      entityType: "limited_liability_company",
      sessionId: "s-run18",
      confirmedKeys,
    }).map((r) => r.document_id);
  };
  const base = ["business_type", "municipality", "location_type", "physical_location", "Q_PHYSICAL_LOCATION"];
  // Flagged headcount, question never asked: no workers' compensation.
  const flagged = strict(base, { physical_location: true });
  const EMPLOYER = ["DOC_WORKERS_COMP", "DOC_DTRH_EMPLOYER_REG", "DOC_HACIENDA_EMPLOYER_WITHHOLDING"];
  for (const d of EMPLOYER) assert.ok(!flagged.includes(d), `inert headcount must not add ${d}`);
  // The user answers Yes to the question the intake now asks.
  const answered = strict([...base, "employees_hired"], { physical_location: true, employees_hired: true });
  for (const d of EMPLOYER) assert.ok(answered.includes(d), `${d} expected, got ${answered.join(", ")}`);
});
