// New Business Wizard acceptance matrix (entity type, F&B export decree,
// implied food questions, San Juan municipal review) — the three scenarios
// from the 2026-10 wizard fix, run through the same engine path as the
// intake (kgScenarios harness), the incentive engine, the municipality
// advisories and the intake fact resolver.
// Run: npx tsx --test src/app/qa/wizardAcceptance.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { runKgScenario, type KgScenario } from "./kgScenarios/harness.ts";
import { evaluateIncentives } from "../incentives/engine.ts";
import { normalizeProjectProfileForIncentives } from "../incentives/profile.ts";
import { PR_ACT60_CATALOG } from "../incentives/prCatalog.ts";
import { confirmedPotentialRequirements, potentialItemsForFlags, potentialQuestionsFor } from "../potentialRequirements.ts";
import { resolveIntakeFacts } from "../ai/intake/relationships.ts";
import { KB, INTAKE_INDUSTRIES } from "../kb.ts";
import { ENTITY_REGISTRATION_DOC, normalizeEntityFormationRequirements } from "../forms/engine/requirementAugment.ts";

const scenario = (s: Partial<KgScenario> & Pick<KgScenario, "profile" | "answers" | "description">): KgScenario =>
  ({ id: "ACC", title: "acceptance", matrix: {}, projectIntent: "new_business", expect: { mustInclude: [], mustNotInclude: [] }, ...s }) as unknown as KgScenario;

const visible = (s: KgScenario) => runKgScenario(s).items;
const keys = (s: KgScenario) => new Set(visible(s).map((i) => i.key));
const decreeFor = (profile: Record<string, unknown>, facts: Record<string, boolean> = {}) =>
  evaluateIncentives(normalizeProjectProfileForIncentives(profile, facts), PR_ACT60_CATALOG).opportunities.find((o) => o.programId === "PR_ACT60_FOOD_MANUFACTURING") ?? null;
const sanJuanFlags = () => (KB.municipalities.find((m) => m.name === "San Juan")!.flags as string[]);

// ---------------------------------------------------------------------------
// 1. San Juan brick-and-mortar restaurant (LLC)
// ---------------------------------------------------------------------------
const restaurantProfile = { business_type: "Restaurant", industry: "Food & Beverage", municipality: "San Juan", location_type: "Commercial Space", number_of_employees: 10, business_structure: "llc" };
const restaurant = scenario({
  description: "I want to open a new brick-and-mortar LLC restaurant in San Juan that serves food and alcoholic beverages, has a physical commercial location with outdoor seating, will renovate the space, and hires employees",
  profile: restaurantProfile,
  answers: { Q_ALCOHOL_SOLD: true, Q_ALCOHOL_SERVED: true, Q_EMPLOYEES_HIRED: true, Q_PHYSICAL_LOCATION: true, Q_RENOVATIONS: true, Q_OUTDOOR_SEATING: true },
  modelProjectContext: { renovation: { value: true, confidence: 0.9, evidence: "will renovate the space" } } as never,
});

test("1. San Juan restaurant (LLC): only the Certificate of Organization", () => {
  const k = keys(restaurant);
  assert.ok(k.has("DOC_CERT_ORGANIZATION"));
  assert.ok(!k.has("DOC_CERT_INCORPORATION"));
  assert.ok(!k.has("DOC_BUSINESS_ENTITY_REGISTRATION"));
});

test("1. San Juan restaurant: the F&B export decree does not trigger", () => {
  assert.equal(decreeFor(restaurantProfile), null);
});

test("1. San Juan restaurant: overlapping food questions are settled by implication, not asked", () => {
  const facts = resolveIntakeFacts({ profile: restaurantProfile, answers: {} }, { kb: KB, allowedIndustries: INTAKE_INDUSTRIES });
  for (const q of ["Q_FOOD_PREPARED", "Q_FOOD_SERVED", "Q_FOOD_SOLD", "Q_ON_SITE_CONSUMPTION", "Q_CUSTOMERS_VISIT"]) {
    assert.equal(facts.questionValues[q], true, q);
    assert.equal(facts.resolvedQuestionOrigins[q], "derived", `${q} is a deterministic implication (skipped)`);
  }
});

test("1. San Juan: one San Juan-Specific Municipal Review, no generic review, no 'operate in San Juan?' question", () => {
  const defs = potentialItemsForFlags(sanJuanFlags());
  assert.ok(!potentialQuestionsFor(defs).some((d) => d.flag === "capital"), "no San Juan confirmation question");
  const items = confirmedPotentialRequirements(defs, {});
  assert.deepEqual(items.map((i) => i.name), ["San Juan-Specific Municipal Review"]);
  assert.ok(!defs.some((d) => d.document === "Additional Municipal Review"));
});

test("1. San Juan restaurant: core permits stay, in their dependency tiers", () => {
  const items = visible(restaurant);
  const byKey = new Map(items.map((i) => [i.key, i]));
  for (const id of ["DOC_PERMISO_UNICO", "DOC_ALCOHOL_LICENSE", "DOC_PATENTE_MUNICIPAL", "DOC_OGPE_CONSTRUCTION_PERMIT", "DOC_WORKERS_COMP", "DOC_FIRE_CERT", "DOC_HEALTH_PERMIT", "DOC_CFPM"]) {
    assert.ok(byKey.has(id), `${id} present`);
  }
  // Patente Municipal comes after the Permiso Único it depends on.
  assert.ok(byKey.get("DOC_PATENTE_MUNICIPAL")!.position > byKey.get("DOC_PERMISO_UNICO")!.position);
});

// ---------------------------------------------------------------------------
// 2. Bayamón hot sauce & beverage exporter (corporation)
// ---------------------------------------------------------------------------
const exporterProfile = { business_type: "Food Manufacturing", industry: "Manufacturing", municipality: "Bayamón", location_type: "Industrial Facility", number_of_employees: 6, business_structure: "corporation", import_export: true, products_manufactured: true };
const exporter = scenario({
  description: "We are a corporation that manufactures hot sauce and bottled beverages in Bayamón and exports them outside Puerto Rico. No dining on site.",
  profile: exporterProfile,
  answers: { Q_PRODUCTS_MANUFACTURED: true, Q_IMPORT_EXPORT: true, Q_ON_SITE_CONSUMPTION: false, Q_OUTDOOR_SEATING: false, Q_EMPLOYEES_HIRED: true },
});

test("2. Bayamón exporter (corp.): only the Certificate of Incorporation", () => {
  const k = keys(exporter);
  assert.ok(k.has("DOC_CERT_INCORPORATION"));
  assert.ok(!k.has("DOC_CERT_ORGANIZATION") && !k.has("DOC_ARTICLES_ORGANIZATION") && !k.has("DOC_BUSINESS_ENTITY_REGISTRATION"));
});

test("2. Bayamón exporter: the F&B export decree (4%) triggers", () => {
  // "Exports outside PR: Yes" (the incentive follow-up; the intake's
  // import/export question alone does not establish exports).
  const d = decreeFor(exporterProfile, { exports_outside_pr: true });
  assert.ok(d);
  assert.equal(d!.eligibility, "likely_eligible");
});

test("2. Bayamón exporter: no on-site dining or outdoor seating permits", () => {
  const k = keys(exporter);
  assert.ok(!k.has("DOC_OUTDOOR_SEATING_AUTH"));
  assert.ok(!k.has("DOC_CFPM"), "no food-service manager certificate for a non-dining plant");
});

// ---------------------------------------------------------------------------
// 3. Undecided-entity retail shop in San Juan, no employees
// ---------------------------------------------------------------------------
const retail = scenario({
  description: "I want to open a small clothing boutique in San Juan. I haven't decided the business structure yet and I won't hire employees.",
  profile: { business_type: "Clothing Store", industry: "Retail", municipality: "San Juan", location_type: "Retail Storefront", number_of_employees: 0, business_structure: "undecided" },
  answers: { Q_EMPLOYEES_HIRED: false, Q_PHYSICAL_LOCATION: true },
});

test("3. Undecided entity: one consolidated Business Entity Registration under Conditional / Needs Information", () => {
  const items = visible(retail);
  const formation = items.filter((i) => ["DOC_CERT_INCORPORATION", "DOC_CERT_ORGANIZATION", "DOC_ARTICLES_ORGANIZATION", "DOC_BUSINESS_ENTITY_REGISTRATION"].includes(i.key));
  assert.deepEqual(formation.map((i) => i.key), ["DOC_BUSINESS_ENTITY_REGISTRATION"]);
  assert.equal(formation[0].group, "conditional");
  assert.match(formation[0].name, /Business Entity Registration/);
});

test("3. Undecided entity, no employees: no employer-only items", () => {
  const k = keys(retail);
  for (const id of ["DOC_WORKERS_COMP", "DOC_DTRH_EMPLOYER_REG", "DOC_HACIENDA_EMPLOYER_WITHHOLDING"]) assert.ok(!k.has(id), id);
});

test("3. Picking the entity after an undecided checklist replaces the placeholder (no duplicate formation step)", () => {
  const placeholder = { document_id: ENTITY_REGISTRATION_DOC, code: "business_entity_registration", name: "Business Entity Registration" };
  const make = (d: { document_id: string; code: string; name: string }) => ({ document_id: d.document_id, code: d.code, name: d.name });
  const formation = (rows: { document_id?: string }[]) => rows.map((r) => r.document_id).filter((id) => /CERT_|ORGANIZATION|ENTITY_REGISTRATION/.test(id ?? ""));
  assert.deepEqual(formation(normalizeEntityFormationRequirements("limited_liability_company", [placeholder], make)), ["DOC_ARTICLES_ORGANIZATION"]);
  assert.deepEqual(formation(normalizeEntityFormationRequirements("stock_corporation", [placeholder], make)), ["DOC_CERT_INCORPORATION"]);
  assert.deepEqual(formation(normalizeEntityFormationRequirements("sole_proprietorship", [placeholder], make)), []);
  assert.deepEqual(formation(normalizeEntityFormationRequirements("other", [placeholder], make)), [ENTITY_REGISTRATION_DOC], "still undecided: placeholder stays");
});
