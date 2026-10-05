/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-RPC test payloads */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeScenario, assessScenario, FREE_PREVIEW_LIMIT } from "./assessment";
import { createHandoffToken, verifyHandoffToken, HANDOFF_TTL_SECONDS } from "./handoff";
import { handleChatgptMcp, TOOLS } from "./mcp";
import { WIDGET_URI, WIDGET_MIME, widgetHtml } from "./widget";

process.env.CHATGPT_HANDOFF_SECRET = "test-secret-test-secret-test-secret-0123";
const SITE = { siteUrl: "https://smartpr.example" };
// Fixture: the mockup prompt's facts as ChatGPT would extract them.
const GUAYNABO = { business_type: "manufacturing", municipality: "Guaynabo", square_feet: 12000, employees: 28, renovation: "interior" };
const rpc = (method: string, params: Record<string, unknown> = {}, id: number | undefined = 1) => handleChatgptMcp({ jsonrpc: "2.0", id, method, params }, SITE);
type Body = { result: any; error?: { code: number } };

test("assess: generic manufacturing → partial, activity unresolved, real engine output", () => {
  const { scenario } = normalizeScenario(GUAYNABO);
  const a = assessScenario(scenario);
  assert.equal(a.status, "partial");
  assert.equal(a.scenario.business_type, null);
  assert.ok(a.scenario.business_type_candidates.length > 1);
  assert.deepEqual(a.clarifying_questions.slice(0, 3).map((q) => q.id), ["activity", "business_status", "structural"]);
  assert.ok(a.requirements.length > 0 && a.requirements.length <= FREE_PREVIEW_LIMIT);
  assert.ok(a.requirements.some((r) => r.name.includes("Patente")), "municipal patente from Guaynabo");
  for (const r of a.requirements) {
    assert.ok(["supported", "conditional", "unresolved"].includes(r.applicability));
    for (const c of r.citations) assert.ok(c.label.trim().length > 0 && (c.url === null || /^https?:\/\//.test(c.url)));
  }
  assert.match(a.versions.kb, /^pr-kg@[0-9a-f]{12}$/);
  assert.ok(!("readiness" in a) && !JSON.stringify(a).includes("readiness_percent"));
});

test("missing facts are unresolved, never a silent no", () => {
  const { scenario } = normalizeScenario({ business_type: "Furniture Manufacturing", municipality: "Guaynabo" });
  const a = assessScenario(scenario);
  const imp = a.requirements.find((r) => r.dependencies.includes("Q_IMPORT_EXPORT"));
  assert.ok(imp && imp.applicability === "unresolved");
  assert.ok(a.unresolved_facts.length > 0);
});

test("clarifying answers change applicability and refine preserves prior answers", () => {
  const first = assessScenario(normalizeScenario(GUAYNABO).scenario);
  const r1 = normalizeScenario({ answers: { activity: "Furniture Manufacturing", Q_IMPORT_EXPORT: "yes" } }, first.scenario);
  const second = assessScenario(r1.scenario);
  assert.equal(second.scenario.business_type, "Furniture Manufacturing");
  const imp = second.requirements.find((r) => r.id === "DOC_IMPORT_EXPORT_REG");
  // The answer moves the item from "depends on the question" to an engine
  // evaluation grounded in the stated fact (the classifier may still need
  // detail, e.g. import_export_details).
  assert.ok(imp && !imp.dependencies.includes("Q_IMPORT_EXPORT"));
  assert.ok(imp!.evidence.some((e) => e.startsWith("fact:Q_IMPORT_EXPORT=true")));
  const r2 = normalizeScenario({ answers: { business_status: "new", structural: "structural" } }, second.scenario);
  assert.equal(r2.scenario.answers.Q_IMPORT_EXPORT, true, "prior answer preserved");
  assert.equal(r2.scenario.renovation, "structural");
  const third = assessScenario(r2.scenario);
  assert.ok(!third.clarifying_questions.some((q) => ["activity", "business_status", "structural", "Q_IMPORT_EXPORT"].includes(q.id)));
  const r3 = normalizeScenario({ answers: { Q_IMPORT_EXPORT: "no" } }, r2.scenario);
  assert.ok(!assessScenario(r3.scenario).requirements.some((r) => r.id === "DOC_IMPORT_EXPORT_REG"));
  const bogus = normalizeScenario({ answers: { Q_NOT_REAL: "yes" } }, r2.scenario);
  assert.deepEqual(bogus.dropped, ["Q_NOT_REAL"]);
});

test("unsupported activity", () => {
  const a = assessScenario(normalizeScenario({ business_type: "zzqx" }).scenario);
  assert.equal(a.status, "unsupported");
  assert.equal(a.requirements.length, 0);
});

test("handoff token: roundtrip, tamper, expiry", () => {
  const { scenario } = normalizeScenario(GUAYNABO);
  const { token } = createHandoffToken(scenario, "continue", 1_000_000);
  assert.equal(verifyHandoffToken(token, 1_000_000 + 1000).scenario.municipality, "Guaynabo");
  assert.throws(() => verifyHandoffToken(token.slice(0, -2) + "xx", 1_000_000), /bad_signature|malformed/);
  assert.throws(() => verifyHandoffToken(token, 1_000_000 + HANDOFF_TTL_SECONDS * 1000 + 1), /expired/);
  assert.ok(!token.includes("@"));
});

test("MCP: initialize, tools/list, resources, tools/call", () => {
  const init = rpc("initialize", { protocolVersion: "2025-06-18" }).body as Body;
  assert.equal(init.result.protocolVersion, "2025-06-18");
  const tools = (rpc("tools/list").body as Body).result.tools;
  assert.deepEqual(tools.map((t: any) => t.name), ["assess_scenario", "refine_scenario", "create_portal_handoff"]);
  assert.equal((TOOLS[0]._meta as { ui: { resourceUri: string } }).ui.resourceUri, WIDGET_URI);
  const res = (rpc("resources/read", { uri: WIDGET_URI }).body as Body).result.contents[0];
  assert.equal(res.mimeType, WIDGET_MIME);
  assert.ok(!/<script[^>]+src=|https?:\/\/(?!www\.w3\.org)/.test(widgetHtml()), "widget has no external loads");
  const a = (rpc("tools/call", { name: "assess_scenario", arguments: GUAYNABO }).body as Body).result;
  assert.equal(a.structuredContent.status, "partial");
  const r = (rpc("tools/call", { name: "refine_scenario", arguments: { scenario: a.structuredContent.scenario, answers: { activity: "Furniture Manufacturing" } } }).body as Body).result;
  assert.equal(r.structuredContent.scenario.business_type, "Furniture Manufacturing");
  const h = (rpc("tools/call", { name: "create_portal_handoff", arguments: { scenario: r.structuredContent.scenario } }).body as Body).result;
  assert.match(h.structuredContent.url, /^https:\/\/smartpr\.example\/chatgpt\/handoff\?t=/);
  assert.equal((rpc("tools/call", { name: "run_sql", arguments: {} }).body as Body).error?.code, -32602);
  assert.equal(rpc("notifications/initialized", {}, undefined).status, 202);
});

test("handoff fails closed without secret", () => {
  const saved = process.env.CHATGPT_HANDOFF_SECRET;
  delete process.env.CHATGPT_HANDOFF_SECRET;
  const out = (rpc("tools/call", { name: "create_portal_handoff", arguments: { scenario: normalizeScenario(GUAYNABO).scenario } }).body as Body).result;
  process.env.CHATGPT_HANDOFF_SECRET = saved;
  assert.equal(out.isError, true);
});
