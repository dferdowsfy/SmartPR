// The description settles the entity type when it names one, so the wizard
// does not ask it again. Run: npx tsx --test src/app/ai/intake/scenario/entityType.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { interpretScenario } from "./index.ts";

const entity = (text: string) => interpretScenario(text).business.entityType?.value ?? null;

test("bare LLC / CRL / corporation / sole proprietor mentions set the entity type", () => {
  assert.equal(entity("We're forming an LLC to open a restaurant in San Juan"), "llc");
  assert.equal(entity("Abriremos un restaurante en Ponce como CRL"), "llc");
  assert.equal(entity("Hot sauce maker in Bayamón, we are an Inc. and export to Florida"), "corporation");
  assert.equal(entity("My corporation will open a bakery in Caguas"), "corporation");
  assert.equal(entity("I'll run it as a sole proprietor, a food truck in Carolina"), "sole_proprietorship");
});

test("a legal name with a suffix still wins", () => {
  assert.equal(entity("Caribe Foods LLC is opening a cafe in Guaynabo"), "llc");
});

test("no entity words: nothing is assumed (the wizard asks)", () => {
  assert.equal(entity("I want to open a new brick-and-mortar restaurant in San Juan that serves food and alcoholic beverages, has a physical commercial location, and hires employees"), null);
  assert.equal(entity("A coffee shop near the incubator in Caguas"), null);
});
