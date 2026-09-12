import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { buildProject, canonicalFor, evidenceKey, projects, readiness, regulatoryEvent, regulatoryStates, seedEvidence } from "./model";
import { readinessWeightFor } from "../../kb";
import { resolveFormId } from "../../forms/engine/routing";
import { getDefinition } from "../../forms/engine/registry";
import { prefillFromCanonical, writeBackToCanonical } from "../../forms/engine/canonicalMapping";
import { validateForm } from "../../forms/engine/formValidation";
import { middleware } from "../../../middleware";
import { NextRequest } from "next/server";

test("Guaynabo requirements are real matched nodes with supported non-Bayamón sources", () => {
  const p = buildProject("guaynabo");
  assert.deepEqual(p.requirements.map(r => r.document_id).sort(), ["DOC_EIN", "DOC_MERCHANT_REGISTRATION", "DOC_PERMISO_UNICO", "DOC_WORKERS_COMP", "DOC_ZONING"].sort());
  for (const r of p.requirements) {
    assert.equal(r.guidance.status, "VALIDATED");
    assert.ok(r.guidance.sources.length);
    assert.ok(r.guidance.lastVerified);
    assert.ok(p.trace.rulesMatched.some(m => m.document_id === r.document_id));
    assert.ok(!r.guidance.sources.some(s => /bayamon/i.test(s.url)));
  }
  assert.ok(p.reviews.some(r => r.document_id === "DOC_PATENTE_MUNICIPAL"));
  assert.ok(p.reviews.some(r => r.document_id === "DOC_CONTRACTOR_LICENSE"));
});
test("facts change actual rule output without adding static requirements", () => {
  const withWork = buildProject("guaynabo", true), withoutWork = buildProject("guaynabo", false);
  assert.ok(withWork.trace.documentsGenerated.includes("DOC_CONTRACTOR_LICENSE"));
  assert.ok(!withoutWork.trace.documentsGenerated.includes("DOC_CONTRACTOR_LICENSE"));
  assert.equal(withWork.requirements.length, withoutWork.requirements.length);
});
test("evidence review earns no credit; verification changes only its own project; reset restores", () => {
  const p = buildProject("guaynabo"), seeded = seedEvidence();
  assert.equal(readiness(p, seeded).score, 60);
  const key = evidenceKey(p.id, "DOC_ZONING");
  const linked = { ...seeded, [key]: "review" as const };
  assert.equal(readiness(p, linked).score, 60);
  const verified = { ...linked, [key]: "verified" as const };
  assert.equal(readiness(p, verified).score, 80);
  const other = projects.find(p => p.id === "carolina")!;
  assert.equal(readiness(other, verified).score, readiness(other, seeded).score);
  assert.equal(readiness(p, seedEvidence()).score, 60);
  assert.deepEqual(seedEvidence(), seeded);
});
test("shared weighting supports a pinned weighted pack without modifying global KB metadata", () => {
  const rows = [{ document_id: "a" }, { document_id: "b" }];
  const weight = readinessWeightFor(rows, { a: 3, b: 1 });
  assert.equal(weight(rows[0]), 75); assert.equal(weight(rows[1]), 25);
  assert.equal(readinessWeightFor(rows, {})(rows[0]), 50);
});
test("annual form routes from an actual Bayamón requirement and reuses canonical data", () => {
  const p = buildProject("bayamon");
  assert.ok(p.requirements.some(r => r.document_id === "DOC_PATENTE_MUNICIPAL"));
  const canonical = canonicalFor("bayamon");
  const id = resolveFormId("DOC_PATENTE_MUNICIPAL", canonical);
  assert.equal(id, "FORM_PR_PATENTE_ANUAL");
  const def = getDefinition(id!)!;
  assert.equal(def.officialFormNumber, "PA01");
  const data = prefillFromCanonical(def, canonical);
  assert.equal(data.municipality, "Bayamón");
  assert.equal(data.business_activity, canonical.business.activityDescription);
  assert.ok(validateForm(def, data, canonical).some(e => e.fieldId === "filing_year"));
  const edited = { ...data, filing_year: "2026", business_activity: "Warehouse operations" };
  assert.ok(!validateForm(def, edited, canonical).some(e => e.fieldId === "filing_year"));
  const saved = writeBackToCanonical(def, edited, canonical).canonical;
  assert.equal(saved.business.activityDescription, "Warehouse operations");
  assert.notEqual(canonical.business.activityDescription, "Warehouse operations");
});
test("regulatory demonstration never enters applicability or readiness", () => {
  const baseline = JSON.stringify(buildProject("guaynabo"));
  assert.equal(regulatoryEvent.legalStatus, "proposed");
  assert.equal(regulatoryEvent.approvedBy, null);
  for (const state of regulatoryStates) { assert.ok(state.legalStatus); assert.equal(JSON.stringify(buildProject("guaynabo")), baseline); }
});
test("demo has no production data transport or persistence calls", () => {
  const client = readFileSync(new URL("./EnterpriseDemo.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(client, /fetch\(|localStorage|sessionStorage|supabase|\/api\/|captureGraph/);
});
test("the exact synthetic route makes no auth request even with Supabase configured", async () => {
  const oldFetch = globalThis.fetch, oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, oldKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let calls = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
  globalThis.fetch = async () => { calls++; throw new Error("Unexpected network request"); };
  try { const res = await middleware(new NextRequest("https://www.getsmartpr.com/demo/enterprise")); assert.equal(res.status, 200); assert.equal(calls, 0); }
  finally { globalThis.fetch = oldFetch; if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl; if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = oldKey; }
});
