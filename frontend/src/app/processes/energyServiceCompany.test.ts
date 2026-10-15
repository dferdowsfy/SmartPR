// Live Run 5 I2 / Run 6: energy service company intake scoping.
import test from "node:test";
import assert from "node:assert/strict";
import {
  describesEnergyServiceCompany,
  scopeEnergyServiceCompanyContext,
  withoutSiteSystemQuestions,
  withoutSiteSystemAnswers,
  isSiteSystemQuestion,
} from "./energyServiceCompany.ts";

test("Guayama residential solar sales+install company is a service company", () => {
  assert.equal(
    describesEnergyServiceCompany(
      "Opening a new residential rooftop solar sales and installation company in Guayama"
    ),
    true
  );
});

test("Spanish instalador company is a service company", () => {
  assert.equal(
    describesEnergyServiceCompany(
      "Abrimos una compañía de instalación y venta de paneles solares en Guayama"
    ),
    true
  );
});

test("own-site rooftop on the company's warehouse is NOT a service company", () => {
  assert.equal(
    describesEnergyServiceCompany(
      "We run a warehouse in Caguas and want to install rooftop solar on our warehouse"
    ),
    false
  );
});

test("utility-scale solar farm is NOT a service company", () => {
  assert.equal(
    describesEnergyServiceCompany("A 5 MW solar farm with battery storage in Santa Isabel"),
    false
  );
});

test("bare rooftop install without company noun stays a project", () => {
  assert.equal(
    describesEnergyServiceCompany("Rooftop solar installation, Guaynabo"),
    false
  );
});

test("scope drops plant facts and sets installer role", () => {
  const scoped = scopeEnergyServiceCompanyContext({
    generation_technology: { value: "solar", confidence: 0.9, evidence: "solar" },
    mounting_type: { value: "roof", confidence: 0.85, evidence: "rooftop" },
    generation_capacity_kw: { value: 8, confidence: 0.7, evidence: "residential" },
    parallel_operation: { value: true, confidence: 0.7, evidence: "grid" },
    energy_incentive_interest: { value: true, confidence: 0.8, evidence: "incentives" },
  });
  assert.equal(scoped.generation_technology, undefined);
  assert.equal(scoped.mounting_type, undefined);
  assert.equal(scoped.generation_capacity_kw, undefined);
  assert.equal(scoped.parallel_operation, undefined);
  assert.equal(scoped.energy_applicant_role?.value, "installer");
  assert.equal(scoped.energy_incentive_interest?.value, true);
  assert.equal(scoped.proposed_energy_services?.value, "installation");
});

test("site-system discovery questions are filtered", () => {
  const qs = [
    { id: "Q_EMPLOYEES_HIRED" },
    { id: "Q_SOLAR_MOUNTING" },
    { id: "Q_SOLAR_SIZE" },
    { id: "Q_HAZARDOUS_MATERIALS" },
    { id: "solar_battery" },
  ];
  const kept = withoutSiteSystemQuestions(qs).map((q) => q.id);
  assert.deepEqual(kept, ["Q_EMPLOYEES_HIRED", "Q_HAZARDOUS_MATERIALS"]);
  assert.equal(isSiteSystemQuestion("Q_SOLAR_OWNERSHIP"), true);
  assert.deepEqual(
    withoutSiteSystemAnswers({ Q_SOLAR_SIZE: "1 MW or less", Q_EMPLOYEES_HIRED: true }),
    { Q_EMPLOYEES_HIRED: true }
  );
});
