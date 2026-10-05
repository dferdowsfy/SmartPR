// Report outputs — status language and agreement between Copy summary,
// Copy full report and the PDF document model, across representative cases
// (including catastro 225-016-807-10 as an ordinary regression case).
import { test } from "node:test";
import assert from "node:assert/strict";
import { reportCases } from "./reportCases.ts";
import { reportDocument, reportDocumentText } from "./reportDocument.ts";
import { assessmentOf, reportSummaryText, snapshotLine } from "./propertyReport.ts";

const cases = reportCases();
const get = (id: string) => cases.find((c) => c.id === id)!;

test("status language: FEMA Zone X and mapped classifications are findings, never 'no mapped intersection'", () => {
  for (const c of cases) {
    const a = assessmentOf(c.report);
    for (const id of ["flood_zone", "land_class", "put", "terrain"]) assert.ok(!a.clear.some((x) => x.id === id && !/None mapped|Nada mapeado/.test(x.value.en)), `${c.id}: ${id} listed as clear`);
  }
  const a = assessmentOf(get("caguas-225-016-807-10").report);
  assert.ok(a.mapped.some((x) => x.id === "flood_zone" && /Zone X/.test(x.value.en)));
  assert.ok(a.mapped.some((x) => x.id === "put"));
});

test("status language: unavailable is unknown; unperformed is pending; zoning unresolved → compatibility not evaluated", () => {
  const r = get("caguas-zoning-timeout").report;
  const a = assessmentOf(r);
  assert.ok(a.unable.some((x) => x.id === "zoning" && /did not respond/.test(x.value.en)));
  const d = r.land_use!.decision!;
  assert.equal(d.compatibility.status, "undetermined");
  assert.ok(d.compatibility.blockedBy.includes("zoning"));
  assert.equal(d.compatibility.ruleReading, null, "no rule reading without zoning");
  const noAct = get("caguas-225-016-807-10").report;
  assert.match(noAct.findings.find((f) => f.id === "permitted_uses")!.value!.en, /^Pending proposed activity/);
});

test("narrow edge strip is described accurately", () => {
  const f = get("caguas-225-016-807-10").report.findings.find((x) => x.id === "historic_zone")!;
  assert.ok(f.notes!.some((n) => /excluding a strip about 3 m wide along its edge.*would not be detected/.test(n.en)));
});

test("Copy summary, Copy full report and PDF model agree on identity, status, scope, sources and next steps", () => {
  for (const c of cases) {
    const d = reportDocument(c.report, c.lang);
    const full = reportDocumentText(d);
    const sum = reportSummaryText(c.report, c.lang);
    const snap = snapshotLine(c.report, c.lang);
    for (const t of [full, sum]) {
      assert.ok(t.includes(snap), `${c.id}: snapshot`);
      if (c.report.property.catastro.value) assert.ok(t.includes(c.report.property.catastro.value), `${c.id}: catastro`);
    }
    const a = assessmentOf(c.report);
    for (const x of [...a.review, ...a.mapped, ...a.clear, ...a.unable]) for (const t of [full, sum]) assert.ok(t.includes(x.value[c.lang]), `${c.id}: ${x.id}`);
    for (const x of a.actions) assert.ok(full.includes(x.action[c.lang]) && sum.includes(x.action[c.lang]), `${c.id}: action ${x.id}`);
    // Full report keeps every finding with its source and lookup date.
    for (const f of c.report.findings) {
      assert.ok(full.includes(f.title[c.lang]), `${c.id}: finding ${f.id}`);
      if (f.sources[0]) assert.ok(full.includes(f.sources[0].name), `${c.id}: source ${f.id}`);
      if (f.looked_up_at) assert.ok(full.includes(f.looked_up_at.slice(0, 10)), `${c.id}: date ${f.id}`);
    }
  }
});
