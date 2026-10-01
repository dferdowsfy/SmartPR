// Checklist presentation goldens (Darius's 2026-09-30 live test of #116):
// the default view is a 30-second checklist, wholesale plants never show
// legacy DG / net-metering cards, one construction-permit item, generation
// technology resolved from the user's own words, one project type, no empty
// "why" items, incentives in one place. E01 stays equivalent.
// Run: npx tsx --test src/app/processes/checklist.golden.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { validateProjectContext } from "../ai/intake/projectContext.ts";
import { computeEnergyAssessment } from "./view.ts";
import { processChecklist, unifiedIncentives, type ProcessChecklist } from "./presentation.ts";
import { isProposedEnergyProject, supersededLegacyCards, withoutEnergyVerifyExisting, type LegacyCardRef } from "./legacyCards.ts";
import type { ProcessAssessment } from "./engine.ts";
import { EnergyProcessesSection, ProcessReasoning, energySummaryQuestions, processTraceLines } from "../components/energy/EnergyProcessesSection.tsx";
import { ChecklistSummary } from "../components/checklist/ChecklistParts.tsx";
import { evaluateIncentives } from "../incentives/engine.ts";
import { PR_ACT60_CATALOG } from "../incentives/prCatalog.ts";
import { normalizeProjectProfileForIncentives } from "../incentives/profile.ts";
import { relevantIncentiveOpportunities } from "../incentives/relevance.ts";

const here = dirname(fileURLToPath(import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(join(here, "goldens", f), "utf8"));

// The legacy cards the permit-centric rules engine emits for a solar + battery
// project (Q_RENEWABLE_INSTALL / Q_SOLAR_SIZE / Q_SOLAR_BATTERY rules).
const LEGACY: (LegacyCardRef & { name: string })[] = [
  { document_id: "DOC_LUMA_INTERCONNECTION", source_rule: "RULE_0610", name: "LUMA Interconnection Registration" },
  { document_id: "DOC_NET_METERING_AGREEMENT", source_rule: "RULE_0611", name: "Net Metering Agreement" },
  { document_id: "DOC_OGPE_CONSTRUCTION_PERMIT", source_rule: "RULE_0613", name: "OGPe Construction Permit" },
  { document_id: "DOC_FIRE_CERT", source_rule: "RULE_0615", name: "Fire Safety Certification" },
];
const DG_DOCS = ["DOC_LUMA_INTERCONNECTION", "DOC_NET_METERING_AGREEMENT"];

function run(file: string, lang: "en" | "es" = "en") {
  const G = load(file);
  const { context } = validateProjectContext(G.modelProjectContext, G.description);
  const { graph, assessment } = computeEnergyAssessment({ projectContext: context, municipality: G.profile.municipality, answers: G.answers });
  const a = assessment!;
  const cards = (G.legacyCards ?? LEGACY) as typeof LEGACY;
  const sup = supersededLegacyCards(graph, a, cards);
  const ck = processChecklist(a, graph, lang, { suppressedLegacy: [...sup.values()], legacyNames: Object.fromEntries(cards.map((c) => [c.document_id, c.name])) });
  return { G, context, graph, a, sup, cards, ck };
}
const items = (ck: ProcessChecklist) => ck.stages.flatMap((s) => s.items);
/** Legacy cards still rendered as their own requirement card (not absorbed, not suppressed). */
const standalone = (r: ReturnType<typeof run>) => r.cards.filter((c) => !r.sup.has(c.document_id!));

function assertPresentationInvariants(r: ReturnType<typeof run>, label: string) {
  const all = items(r.ck);
  assert.ok(all.length > 0, `${label}: checklist has items`);
  for (const i of all) {
    assert.ok(i.name.trim() && i.why.trim(), `${label}: ${i.id} has a name and a one-line why`);
    assert.ok(!/\bDOC_|RULE_\d|\bPT_[A-Z]/.test(`${i.name} ${i.why} ${i.needs.join(" ")}`), `${label}: ${i.id} default view shows no codes`);
  }
  for (const p of r.a.processes) for (const s of p.explanation) assert.ok(s.label.trim() !== "", `${label}: ${p.process_id} has an empty why step`);
  assert.ok(r.ck.questions.length <= 3, `${label}: at most 3 questions`);
  // Construction permit: one item — the legacy OGPe card folds into the energy process.
  const construction = all.filter((i) => /construction permit|permiso de construcci/i.test(i.name));
  assert.ok(construction.length <= 1, `${label}: one construction-permit item`);
  if (construction.length) assert.ok(r.sup.get("DOC_OGPE_CONSTRUCTION_PERMIT")?.process_id === construction[0].process_id, `${label}: OGPe card absorbed by ${construction[0].process_id}`);
  // Incentives render in one place: never inside the Energy section.
  const html = renderToStaticMarkup(createElement(EnergyProcessesSection, { assessment: r.a, graph: r.graph, checklist: r.ck, legacyCards: {}, suppressedLegacy: [...r.sup.values()], language: "en" }));
  assert.ok(!/incentive/i.test(html), `${label}: no incentives in the Energy section`);
  assert.ok(!/<li[^>]*>\s*<\/li>/.test(html), `${label}: no empty list items`);
}

function assertWholesaleLegacy(r: ReturnType<typeof run>, label: string) {
  for (const d of DG_DOCS) {
    assert.equal(r.sup.get(d)?.suppressed?.id, "LS_WHOLESALE_NOT_DG", `${label}: ${d} suppressed for a wholesale plant`);
    assert.ok(r.ck.not_applicable.some((x) => x.name === r.cards.find((c) => c.document_id === d)!.name && x.source), `${label}: ${d} listed as checked, with its source`);
  }
  assert.deepEqual(standalone(r).map((c) => c.document_id), [], `${label}: no legacy energy card renders on its own`);
  assert.ok(!items(r.ck).some((i) => /PR_ENERGY_(DG|NET_METERING)/.test(i.process_id)));
}

const singleType = (a: ProcessAssessment) => a.project_types.map((p) => [p.id, p.status]);

test("E06 Guayama (Darius's live prompt): hybrid resolved from the text, one project type, one checklist", () => {
  const r = run("E06_developer_solar_bess_guayama.json");
  assert.equal(r.context.generation_technology?.value, "hybrid", "solar farms + battery storage → hybrid (model left it out)");
  assert.equal((r.context as Record<string, { value: unknown } | undefined>).energy_facility_type?.value, "standalone_plant");
  assert.ok(!r.a.questions.some((q) => q.fact === "generation_technology"), "never asks what will generate the energy");
  assert.deepEqual(singleType(r.a), [["PT_UTILITY_HYBRID_SOLAR_BESS", "has_type"]], "single best-matching project type");
  for (const p of r.a.processes) assert.ok(!p.explanation.some((s) => s.kind === "classification" && /^Possibly /.test(s.label)), `${p.process_id} lists no 'possibly' types`);
  assertWholesaleLegacy(r, "E06");
  assertPresentationInvariants(r, "E06");
  assert.equal(r.ck.summary, "Utility-scale solar + battery, 15 MW / 30 MWh, Guayama, selling to LUMA. 12 steps, 3 questions.");
  assert.deepEqual(r.ck.questions.map((q) => q.text), ["Is it in a PREB procurement round (RFP)?", "What voltage will it connect at?", "How is the land zoned?"]);
  assert.deepEqual(r.ck.stages.map((s) => s.name), ["Site, land use & environmental", "Procurement & power sale contract", "Energy Bureau certification", "Interconnection studies & technical requirements", "Interconnection agreement", "Construction permit & build", "Testing, commissioning & commercial operation (COD)"]);
  const names = items(r.ck).map((i) => `${i.name} · ${i.agency} · ${i.status}`);
  for (const n of ["Power purchase contract (PPOA) — PREB approval · PREB · required", "LUMA interconnection studies · LUMA · required", "LUMA technical requirements (MTR) · LUMA · required", "Energy Bureau certification · PREB · required", "Environmental review · OGPe · required", "Site / land-use review · OGPe · required", "Construction permit · OGPe / Municipality · required", "Testing & start of operation · LUMA / OGPe · required", "Competitive procurement (RFP) · PREPA / LUMA · question", "Fire-safety review (batteries) · Bomberos · expert"]) {
    assert.ok(names.includes(n), n);
  }
  // Energy items never read "verify existing" for this proposed plant.
  assert.equal(isProposedEnergyProject(r.a), true);
  const view = withoutEnergyVerifyExisting(r.graph, true, [{ document_id: "DOC_OPPE_INSTALLER_REG", applicability: "verify_existing" }, { document_id: "DOC_MERCHANT_REGISTRATION", applicability: "verify_existing" }]);
  assert.deepEqual(view.map((x) => x.applicability), ["conditional", "verify_existing"], "only energy documents change; business registrations stay 'verify existing'");
  // Incentives: one list, Act 60 never twice.
  const u = unifiedIncentives([{ programId: "PR_ACT60_ENERGY" }], r.a.incentives);
  assert.ok(!u.extra.some((i) => i.program_id === "PR_ACT60_ENERGY"));
  // Spanish labels work end to end.
  const es = run("E06_developer_solar_bess_guayama.json", "es").ck;
  assert.equal(es.summary, "A escala de utilidad solar + baterías, 15 MW / 30 MWh, Guayama, venta a LUMA. 12 pasos, 3 preguntas.");
  assert.ok(items(es).some((i) => i.name === "Contrato de compraventa (PPOA) — aprobación del NEPR"));
  assert.ok(es.questions.every((q) => q.text.startsWith("¿")));
});

test("E06 variant: a model that says 'solar + storage' is normalized to hybrid", () => {
  const G = load("E06_developer_solar_bess_guayama.json");
  for (const v of ["solar + storage", "Solar+Storage", "solar_plus_storage", "PV + BESS"]) {
    const raw = { ...G.modelProjectContext, generation_technology: { value: v, confidence: 0.9, evidence: "solar farms" } };
    const { context, discarded } = validateProjectContext(raw, G.description);
    const val = context.generation_technology?.value;
    // Unrecognized wording is dropped and then recovered from the description itself.
    assert.equal(val, "hybrid", `${v} → ${val} (${JSON.stringify(discarded)})`);
  }
});

test("E02 Salinas: no legacy DG/net-metering cards, one construction item, one project type, no empty why", () => {
  const r = run("E02_utility_hybrid_solar_bess_salinas.json");
  assert.equal(r.context.generation_technology?.value, "solar");
  assert.ok(!r.a.questions.some((q) => q.fact === "generation_technology"));
  assert.deepEqual(singleType(r.a), [["PT_UTILITY_HYBRID_SOLAR_BESS", "has_type"]]);
  assertWholesaleLegacy(r, "E02");
  assertPresentationInvariants(r, "E02");
  assert.match(r.ck.summary, /^Utility-scale solar \+ battery, 20 MW \/ 40 MWh, Salinas, selling to LUMA\. \d+ steps, 3 questions\.$/);
});

test("E05 'we want to build a solar farm': nothing required, technology resolved, legacy DG cards never 'verify existing'", () => {
  const r = run("E05_insufficient_solar_farm.json");
  assert.equal(r.context.generation_technology?.value, "solar");
  assert.ok(!r.a.questions.some((q) => q.fact === "generation_technology"));
  assert.deepEqual(singleType(r.a), [["PT_UTILITY_SOLAR", "possible"]], "only the matching type, never unrelated 'possibly' types");
  assertPresentationInvariants(r, "E05");
  assert.ok(!items(r.ck).some((i) => i.status === "required"));
  assert.equal(r.ck.questions[0].text, "Who buys the power?");
  // Buyer unknown → not known wholesale, so the DG cards are not suppressed —
  // but a proposed energy project never shows them as "already held".
  assert.equal(isProposedEnergyProject(r.a), true);
  const view = withoutEnergyVerifyExisting(r.graph, true, standalone(r).map((c) => ({ document_id: c.document_id, applicability: "verify_existing" })));
  assert.ok(view.every((x) => x.applicability !== "verify_existing"));
  assert.ok(!standalone(r).some((c) => c.document_id === "DOC_OGPE_CONSTRUCTION_PERMIT"), "construction folds into the utility construction process");
});

test("E01 rooftop (DG path): same assessment, now a flat numbered checklist", () => {
  const r = run("E01_warehouse_rooftop_solar_caguas.json");
  assert.deepEqual(r.ck.stages.map((s) => s.step), [null], "DG view: one flat numbered list");
  assertPresentationInvariants(r, "E01");
  assert.ok(items(r.ck).some((i) => i.name === "LUMA interconnection (distributed generation)" && i.status === "required"));
  assert.ok(items(r.ck).some((i) => i.name === "Net metering (optional)" && i.status === "optional"));
  // Customer-side DG keeps its cards absorbed by the DG processes (not suppressed).
  assert.equal(r.sup.get("DOC_LUMA_INTERCONNECTION")?.process_id, "PR_ENERGY_DG_INTERCONNECTION");
  assert.equal(r.sup.get("DOC_LUMA_INTERCONNECTION")?.suppressed, undefined);
  assert.match(r.ck.summary, /^Rooftop solar \+ battery, 400 kW, Caguas\. \d+ steps, \d questions?\.$/);
});

// ---- E07: Darius's live test of #118 ("rooftop solar installation, Guaynabo") ----

/** Every process row rendered expanded with its full reasoning open. */
function expandedHtml(r: ReturnType<typeof run>) {
  return renderToStaticMarkup(createElement(EnergyProcessesSection, {
    assessment: r.a, graph: r.graph, checklist: r.ck, legacyCards: {}, suppressedLegacy: [...r.sup.values()], language: "en",
    defaultOpen: r.a.processes.map((p) => p.process_id),
  }));
}

test("E07 rooftop solar installation: no microgrid or energy sale read into four words", () => {
  const r = run("E07_rooftop_solar_installation_guaynabo.json");
  const G = r.G;
  const { discarded } = validateProjectContext(G.modelProjectContext, G.description);
  assert.equal(r.context.microgrid_configuration, undefined, "microgrid claim dropped");
  assert.equal(r.context.sells_energy_to_third_parties, undefined, "energy sale claim dropped");
  assert.ok(discarded.some((d) => d.field === "projectContext.microgrid_configuration" && /microgrid/.test(d.reason)));
  assert.ok(discarded.some((d) => d.field === "projectContext.sells_energy_to_third_parties" && /selling/.test(d.reason)));
  assert.ok(!r.a.processes.some((p) => /MICROGRID/.test(p.process_id) && p.state === "REQUIRED"), "microgrid never Required");
  assert.ok(!items(r.ck).some((i) => /MICROGRID|ESC_CERTIFICATION/.test(i.process_id)), "no microgrid / ESC rows");
  assert.ok(!r.ck.questions.some((q) => q.fact === "proposed_energy_services"), "no energy-services question");
  assert.ok(r.ck.summary.startsWith("Rooftop solar, Guaynabo."), r.ck.summary);
  assert.deepEqual(items(r.ck).map((i) => `${i.name} · ${i.status}`), [
    "LUMA interconnection (distributed generation) · required",
    "Installer certification · required",
    "Construction permit · may_apply",
    "Net metering (optional) · optional",
  ]);
  assertPresentationInvariants(r, "E07");
});

test("E07 intake guard keeps microgrids and sales the user actually states", () => {
  const G = load("E07_rooftop_solar_installation_guaynabo.json");
  const said = "rooftop solar installation with a microgrid that can island, and we will sell power to our tenants, Guaynabo";
  const model = {
    microgrid_configuration: { value: true, confidence: 0.9, evidence: "microgrid that can island" },
    sells_energy_to_third_parties: { value: true, confidence: 0.9, evidence: "sell power to our tenants" },
  };
  const { context } = validateProjectContext(model, said);
  assert.equal(context.microgrid_configuration?.value, true);
  assert.equal(context.sells_energy_to_third_parties?.value, true);
  const es = validateProjectContext({ microgrid_configuration: { value: true, confidence: 0.9, evidence: "microred" } }, "instalación solar en techo con microred, Guaynabo");
  assert.equal(es.context.microgrid_configuration?.value, true, "Spanish 'microred'");
  const island = validateProjectContext({ microgrid_configuration: { value: true, confidence: 0.9, evidence: "solar" } }, "rooftop solar for a business on the island of Puerto Rico");
  assert.equal(island.context.microgrid_configuration, undefined, "'the island' is not islanding");
  assert.ok(G, "fixture loads");
});

test("DG process rows: full reasoning has real content and no empty or list items (E01, E05, E07)", () => {
  for (const f of ["E01_warehouse_rooftop_solar_caguas.json", "E05_insufficient_solar_farm.json", "E07_rooftop_solar_installation_guaynabo.json"]) {
    const r = run(f);
    const html = expandedHtml(r);
    assert.ok(/Show full reasoning/.test(html) && /ck-trace-line/.test(html), `${f}: reasoning rendered`);
    assert.ok(!/<li[^>]*>\s*<\/li>/.test(html), `${f}: no empty <li>`);
    assert.ok(!/<ol/.test(html), `${f}: no <ol> (rows carry their own number)`);
    assert.ok(!/<p class="ck-trace-line"><span class="ck-trace-kind">[^<]*<\/span> <\/p>/.test(html), `${f}: no trace line without text`);
    for (const p of r.a.processes) {
      const lines = processTraceLines(p);
      assert.ok(lines.length > 0, `${f}: ${p.process_id} has trace lines`);
      for (const l of lines) assert.ok(l.text.trim(), `${f}: ${p.process_id} ${l.kind} line has text`);
      const one = renderToStaticMarkup(createElement(ProcessReasoning, { p, language: "en" }));
      assert.ok(!/<li/.test(one), `${f}: ${p.process_id} reasoning is copy-safe (no list items)`);
      for (const req of p.requirements) assert.ok(one.includes(req.id), `${f}: ${p.process_id} reasoning keeps ${req.id}`);
    }
    // Numbers: one badge per flat row, from 1.
    const nums = [...html.matchAll(/<span class="ck-num">(\d+)<\/span>/g)].map((m) => Number(m[1]));
    assert.deepEqual(nums, nums.map((_, i) => i + 1), `${f}: numbered from 1, consecutive`);
  }
});

test("list questions render their options as multi-select chips", () => {
  // The unguarded E07 reading (installer who "sells energy") asks which services.
  const G = load("E07_rooftop_solar_installation_guaynabo.json");
  const { context } = validateProjectContext(G.modelProjectContext);
  const { graph, assessment } = computeEnergyAssessment({ projectContext: context, municipality: "Guaynabo", answers: G.answers });
  const ck = processChecklist(assessment!, graph, "en");
  const q = ck.questions.find((x) => x.fact === "proposed_energy_services");
  assert.ok(q, "services question asked for the unguarded reading");
  let saved: unknown = null;
  const qs = energySummaryQuestions(ck, "en", (_k, fact) => { saved = fact.value; });
  const sq = qs.find((x) => x.id === "proposed_energy_services")!;
  assert.ok(sq.multi && !sq.input, "multi-select, not a free-text box");
  assert.deepEqual(sq.multi!.options.map((o) => o.value), ["generation_sale", "storage_service", "billing", "resale", "wheeling", "installation", "consulting"]);
  sq.multi!.onSubmit(["installation", "consulting"]);
  assert.equal(saved, "installation,consulting", "stored comma-separated like the intake model");
  const html = renderToStaticMarkup(createElement(ChecklistSummary, { line: "x", questions: [sq], language: "en" }));
  for (const o of sq.multi!.options) assert.ok(html.includes(`>${o.label}</button>`), `chip ${o.label}`);
  assert.ok(/aria-pressed="false"/.test(html) && />Save<\/button>/.test(html));
});

test("incentives: only programs with a real signal show for a solar installer (E07)", () => {
  const profile = normalizeProjectProfileForIncentives({ name: "", municipality: "Guaynabo", industry: "Energy & Utilities", business_type: "Solar Installer" } as never, {});
  const all = evaluateIncentives(profile, PR_ACT60_CATALOG).opportunities;
  const shown = relevantIncentiveOpportunities(all).map((o) => o.programName);
  for (const bad of [/Air and Maritime/, /Export Logistics/, /International Trading/]) assert.ok(!shown.some((n) => bad.test(n)), `${bad.source} hidden (${shown.join(" | ")})`);
  assert.ok(shown.some((n) => /Green Energy/i.test(n)), `green energy kept (${shown.join(" | ")})`);
  // Unknown industry: the engine program has no signal, the process-graph
  // green-energy incentive still shows once.
  const bare = normalizeProjectProfileForIncentives({ name: "", municipality: "Guaynabo" } as never, {});
  const shownBare = relevantIncentiveOpportunities(evaluateIncentives(bare, PR_ACT60_CATALOG).opportunities);
  assert.ok(!shownBare.some((o) => /Air and Maritime|Export Logistics|International Trading/.test(o.programName)));
  const r = run("E07_rooftop_solar_installation_guaynabo.json");
  const { extra } = unifiedIncentives(shownBare, r.a.incentives);
  assert.ok(extra.some((i) => /ENERGY/.test(i.program_id ?? i.incentive_id)), "energy incentive from the process graph");
});

test("energy rows: inline CTA from the covered card, Answer on answer-only rows, May apply only with a portal (E01)", async () => {
  const { requirementRowActions } = await import("../components/checklist/rowActionModel.ts");
  const r = run("E01_warehouse_rooftop_solar_caguas.json");
  const onForm = () => {};
  const legacyCards = {
    DOC_LUMA_INTERCONNECTION: { name: "LUMA Interconnection Registration", rowActions: requirementRowActions({ action: { kind: "form", label: "Complete LUMA form", onClick: onForm } }, "en") },
  };
  const html = renderToStaticMarkup(createElement(EnergyProcessesSection, {
    assessment: r.a, graph: r.graph, checklist: r.ck, legacyCards, suppressedLegacy: [...r.sup.values()], language: "en", onAnswer: () => {},
  }));
  const rowOf = (id: string) => { const i = html.indexOf(`data-testid="energy-process-${id}"`); return html.slice(i, html.indexOf('data-testid="energy-process-', i + 10) === -1 ? undefined : html.indexOf('data-testid="energy-process-', i + 10)); };
  const byProcess = new Map(items(r.ck).map((i) => [i.process_id, i.id]));
  const dgRow = rowOf(byProcess.get("PR_ENERGY_DG_INTERCONNECTION")!);
  // Compact visible label is deliberate (rowActionModel shortCtaLabel: "Complete LUMA
  // form" -> "Complete form" since the card already names LUMA); the covered legacy
  // card's CTA still flows into the row via the full accessible name.
  assert.match(dgRow, /aria-label="Complete LUMA form"[^>]*data-cta="form"/);
  assert.match(dgRow, />Complete form</);
  for (const i of items(r.ck)) {
    const row = rowOf(i.id);
    if (i.status === "question") assert.match(row, /data-cta="answer"/, `${i.id} Answer`);
    // May apply: a button only when there is something to do (the official portal).
    if (i.status === "may_apply") assert.equal(/row-cta/.test(row), !!r.graph.processes.get(i.process_id)?.portal, `${i.id} button iff portal`);
  }
  assert.ok(!/ck-row-body/.test(html), "rows stay collapsed");
});

test("every Required energy row shows an inline action without expanding (E01, E06, E07)", () => {
  for (const file of ["E01_warehouse_rooftop_solar_caguas.json", "E06_developer_solar_bess_guayama.json", "E07_rooftop_solar_installation_guaynabo.json"]) {
    const r = run(file);
    const html = renderToStaticMarkup(createElement(EnergyProcessesSection, {
      assessment: r.a, graph: r.graph, checklist: r.ck, legacyCards: {}, suppressedLegacy: [...r.sup.values()], language: "en", onAnswer: () => {},
    }));
    const starts = [...html.matchAll(/data-testid="energy-process-([^"]+)"/g)].map((m) => ({ id: m[1], at: m.index! }));
    const rowOf = (id: string) => { const i = starts.findIndex((s) => s.id === id); return html.slice(starts[i].at, starts[i + 1]?.at); };
    for (const it of items(r.ck)) {
      const row = rowOf(it.id);
      if (it.status === "required") assert.match(row, /data-testid="row-cta"/, `${file}: ${it.name} has an inline action`);
      if (it.status === "expert") assert.ok(!/row-cta/.test(row), `${file}: ${it.name} (expert, no handler) gets none`);
    }
    assert.ok(!/ck-row-body/.test(html), "rows stay collapsed");
  }
  // The official portals (LUMA DG portal, OGPe SBP, PREB e-filing) are
  // secondary: in the ⋯ menu / row details, never the inline primary.
  const portals = (file: string) => {
    const r = run(file);
    return items(r.ck).map((i) => r.graph.processes.get(i.process_id)?.portal?.url).filter(Boolean).join(" ");
  };
  assert.match(portals("E06_developer_solar_bess_guayama.json"), /sbp\.pr\.gov/);
  assert.match(portals("E06_developer_solar_bess_guayama.json"), /radicacion\.energia\.pr\.gov/);
  assert.match(portals("E07_rooftop_solar_installation_guaynabo.json"), /prep-luma\.lumapr\.com/);
});

// Darius 2026-09-30: "a row whose only button takes the user OUT of the
// platform is a no-go." No requirement in E01 / E06 / E07 — energy process
// rows or the requirement cards beside them — resolves to an external-link
// primary action, in EN or ES; every open row can reach Teach Clara.
test("no requirement in E01/E06/E07 resolves to an external-link primary action (EN/ES)", async () => {
  const { requirementRowActions, energyRowActions, mergeRowActions, isExternalCta, EMPTY_ROW_ACTIONS } = await import("../components/checklist/rowActionModel.ts");
  const { claraSupportFor } = await import("../components/filing/requirementGroups.ts");
  const noop = () => {};
  const handlers = { onGuidedForm: noop, onTeach: noop };
  const EXTERNAL_KINDS = new Set(["portal", "site", "instructions", "download"]);
  for (const file of ["E01_warehouse_rooftop_solar_caguas.json", "E06_developer_solar_bess_guayama.json", "E07_rooftop_solar_installation_guaynabo.json"]) {
    for (const lang of ["en", "es"] as const) {
      const r = run(file, lang);
      // Each legacy card as SmartPRIntake builds it: no SmartPR form, the
      // Clara support level decides the filing action; unsupported ones
      // carry only off-site links (instructions PDF + agency site).
      const cardModel = (doc: string, withHandlers: boolean) => {
        const { support } = claraSupportFor(doc);
        const filing = support === "instructions"
          ? { kind: "instructions" as const, label: "View filing instructions", href: `https://agency.pr.gov/${doc}.pdf`, agencySite: { label: "Open agency site", url: "https://agency.pr.gov" } }
          : { kind: support, label: support === "file" ? "File with Clara" : "Prepare with Clara", onClick: noop, agencySite: { label: "Open agency site", url: "https://agency.pr.gov" } };
        return requirementRowActions({ action: { kind: "none", label: "" }, filing, download: { label: "Download form", url: `https://agency.pr.gov/${doc}-form.pdf`, downloaded: false, downloadedHint: "", onDownload: noop }, ...(withHandlers ? handlers : {}) }, lang);
      };
      for (const c of r.cards) {
        const m = cardModel(c.document_id!, true);
        assert.ok(m.primary, `${file} ${lang}: ${c.name} has an inline action`);
        assert.ok(!isExternalCta(m.primary), `${file} ${lang}: ${c.name} primary stays in SmartPR (${m.primary?.kind})`);
        assert.ok(m.more.some((x) => x.kind === "teach"), `${file} ${lang}: ${c.name} can reach Teach Clara`);
      }
      const legacyCards = Object.fromEntries(r.cards.map((c) => [c.document_id!, { name: c.name, rowActions: cardModel(c.document_id!, false) }]));
      for (const it of items(r.ck)) {
        const p = r.a.processes.find((x) => x.process_id === it.process_id)!;
        const cards = mergeRowActions(p.legacy_document_ids.map((d) => legacyCards[d]?.rowActions ?? EMPTY_ROW_ACTIONS));
        const portal = r.graph.processes.get(it.process_id)?.portal ?? null;
        const m = energyRowActions({ status: it.status, cards, portal, question: it.status === "question" ? { prompt: "?" } : null, ...handlers }, lang);
        assert.ok(!isExternalCta(m.primary), `${file} ${lang}: ${it.name} primary stays in SmartPR (${m.primary?.kind} ${m.primary?.href ?? ""})`);
        if (it.status === "required") assert.ok(m.primary, `${file} ${lang}: ${it.name} (Required) has an inline action`);
        if (portal && it.status !== "expert") assert.ok(m.more.some((x) => x.kind === "portal" && x.href === portal.url), `${file} ${lang}: ${it.name} portal in ⋯`);
        if (it.status !== "expert" && (m.primary || m.answer)) assert.ok(m.more.some((x) => x.kind === "teach"), `${file} ${lang}: ${it.name} can reach Teach Clara`);
      }
      // The rendered rows: the inline primary is a button (never an <a> out).
      const html = renderToStaticMarkup(createElement(EnergyProcessesSection, {
        assessment: r.a, graph: r.graph, checklist: r.ck, legacyCards, suppressedLegacy: [...r.sup.values()], language: lang, onAnswer: () => {},
      }));
      const primaries = [...html.matchAll(/<(a|button)\b[^>]*data-testid="row-cta"[^>]*data-cta="([a-z]+)"/g)];
      assert.ok(primaries.length > 0, `${file} ${lang}: rows render inline actions`);
      for (const m of primaries) {
        assert.ok(!EXTERNAL_KINDS.has(m[2]), `${file} ${lang}: inline ${m[2]} is not an external link`);
        assert.ok(!/target="_blank"/.test(m[0]), `${file} ${lang}: inline action opens no new tab`);
      }
      assert.ok(!/ck-row-body/.test(html), "rows stay collapsed");
    }
  }
});
