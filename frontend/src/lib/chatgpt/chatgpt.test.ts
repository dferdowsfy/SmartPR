/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-RPC test payloads */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeScenario, assessScenario, FREE_PREVIEW_LIMIT, resolveSite } from "./assessment";
import { createHandoffToken, verifyHandoffToken, HANDOFF_TTL_SECONDS } from "./handoff";
import { handleChatgptMcp, TOOLS, widgetResourceMeta } from "./mcp";
import { WIDGET_URI, WIDGET_MIME, widgetHtml, MAP_TILE_ORIGIN } from "./widget";
import { municipioFocus } from "../../app/locations/boundaries";
import { restoreIntakeSite } from "../../app/locations/intakeLocation";
import { resolvePortalUrl, portalUrlForRequest, PORTAL_DEFAULT } from "./portalUrl";
import { handoffActions, scenarioToGuestDraft, HANDOFF_INTAKE_PATH } from "./handoffActions";
import { sanitizeNext, guestContinuePath, authCallbackPath } from "../safeNext";

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
  assert.ok(!/<script[^>]+src=|https?:\/\/(?!www\.w3\.org|server\.arcgisonline\.com\/ArcGIS\/rest\/services\/(World_Street_Map|World_Imagery)\/)/.test(widgetHtml()), "widget loads nothing external except basemap tile images");
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

test("portal URL: production by default, never localhost or the dev tunnel", () => {
  const NGROK = "passenger-hence-sprinkler.ngrok-free.dev";
  // The reported bug: NEXT_PUBLIC_SITE_URL inlined as localhost (or set to the tunnel), MCP via ngrok.
  assert.equal(resolvePortalUrl({ siteUrl: "http://localhost:3000", requestHost: NGROK }), PORTAL_DEFAULT);
  assert.equal(resolvePortalUrl({ siteUrl: `https://${NGROK}`, requestHost: NGROK }), PORTAL_DEFAULT);
  assert.equal(resolvePortalUrl({ siteUrl: "http://localhost:3000", requestHost: "localhost:3000" }), PORTAL_DEFAULT);
  assert.equal(resolvePortalUrl({}), "https://www.getsmartpr.com");
  // Public NEXT_PUBLIC_SITE_URL is honoured (origin only).
  assert.equal(resolvePortalUrl({ siteUrl: "https://www.getsmartpr.com/" }), "https://www.getsmartpr.com");
  assert.equal(resolvePortalUrl({ siteUrl: "https://staging.smartpr.example", requestHost: NGROK }), "https://staging.smartpr.example");
  // Explicit runtime override wins; a localhost override only for local-only requests.
  assert.equal(resolvePortalUrl({ portalOverride: "https://www.getsmartpr.com", siteUrl: `https://${NGROK}`, requestHost: NGROK }), PORTAL_DEFAULT);
  assert.equal(resolvePortalUrl({ portalOverride: "http://localhost:3000", requestHost: "localhost:3000" }), "http://localhost:3000");
  assert.equal(resolvePortalUrl({ portalOverride: "http://localhost:3000", requestHost: NGROK }), PORTAL_DEFAULT);
  assert.equal(resolvePortalUrl({ portalOverride: "http://127.0.0.1:3000", requestHost: `${NGROK}, 10.0.0.2` }), PORTAL_DEFAULT);
  assert.equal(resolvePortalUrl({ portalOverride: "not a url", requestHost: NGROK }), PORTAL_DEFAULT);
  // Served from production: stay on the host that signed the token (https).
  assert.equal(resolvePortalUrl({ siteUrl: "http://localhost:3000", requestHost: "www.getsmartpr.com" }), "https://www.getsmartpr.com");
  assert.equal(resolvePortalUrl({ requestHost: "evil.example" }), PORTAL_DEFAULT, "arbitrary Host header is not reflected");
});

test("portal URL from a live request (forwarded headers + runtime env)", () => {
  const saved = { o: process.env.CHATGPT_PORTAL_URL, s: process.env.NEXT_PUBLIC_SITE_URL };
  try {
    delete process.env.CHATGPT_PORTAL_URL;
    process.env.NEXT_PUBLIC_SITE_URL = "http://localhost:3000";
    const viaNgrok = new Request("http://localhost:3000/api/mcp/chatgpt", { method: "POST", headers: { host: "localhost:3000", "x-forwarded-host": "abc.ngrok-free.dev", "x-forwarded-proto": "https" } });
    assert.equal(portalUrlForRequest(viaNgrok), PORTAL_DEFAULT);
    process.env.CHATGPT_PORTAL_URL = "http://localhost:3000";
    assert.equal(portalUrlForRequest(viaNgrok), PORTAL_DEFAULT);
    assert.equal(portalUrlForRequest(new Request("http://localhost:3000/api/mcp/chatgpt", { headers: { host: "localhost:3000" } })), "http://localhost:3000");
  } finally {
    if (saved.o === undefined) delete process.env.CHATGPT_PORTAL_URL; else process.env.CHATGPT_PORTAL_URL = saved.o;
    if (saved.s === undefined) delete process.env.NEXT_PUBLIC_SITE_URL; else process.env.NEXT_PUBLIC_SITE_URL = saved.s;
  }
});

test("Unlock / Use my plan / Continue: server-built handoff URL carries intent + scenario", () => {
  const prod = { siteUrl: resolvePortalUrl({ siteUrl: "http://localhost:3000", requestHost: "x.ngrok-free.dev" }) };
  const scenario = normalizeScenario({ ...GUAYNABO, business_type: "Furniture Manufacturing" }).scenario;
  for (const intent of ["unlock", "use_plan", "continue"] as const) {
    const out = (handleChatgptMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_portal_handoff", arguments: { scenario, intent } } }, prod).body as Body).result;
    const url = new URL(out.structuredContent.url);
    assert.equal(url.origin, "https://www.getsmartpr.com");
    assert.equal(url.pathname, "/chatgpt/handoff");
    assert.equal(out.structuredContent.intent, intent);
    const p = verifyHandoffToken(url.searchParams.get("t"));
    assert.equal(p.intent, intent);
    assert.equal(p.scenario.municipality, "Guaynabo");
    assert.equal(p.scenario.business_type, "Furniture Manufacturing");
  }
  // Widget opens exactly the URL the server returned — no hard-coded host.
  const html = widgetHtml();
  assert.ok(!/localhost|127\.0\.0\.1|ngrok|getsmartpr\.com/.test(html), "widget never hard-codes a portal host");
  assert.match(html, /callTool\("create_portal_handoff",\{scenario:r\.scenario,intent:kind\}\)/);
  assert.match(html, /var u=res&&res\.structuredContent&&res\.structuredContent\.url;if\(u\)\{openLink\(u\)/);
  for (const k of ["unlock", "use_plan", "continue"]) assert.ok(html.includes(`act("${k}")`), `button wired: ${k}`);
});

test("handoff review: sign-in round trip + intake prefill", () => {
  const { token } = createHandoffToken(normalizeScenario(GUAYNABO).scenario, "use_plan");
  const self = `/chatgpt/handoff?t=${encodeURIComponent(token)}`;
  // /auth/login?next=<self> must send the user back to the handoff page.
  assert.equal(sanitizeNext(self, "/businesses"), self);
  assert.equal(authCallbackPath(self), self);
  assert.equal(guestContinuePath(self), self);
  const loginNext = new URL(`https://www.getsmartpr.com/auth/login?next=${encodeURIComponent(self)}`).searchParams.get("next");
  assert.equal(loginNext, self);
  assert.equal(new URL(`https://x${loginNext}`).searchParams.get("t"), token, "token survives the round trip intact");

  assert.deepEqual(handoffActions("use_plan", false), { primary: "Continue without signing in", signIn: "primary" });
  assert.equal(handoffActions("use_plan", true).signIn, null);
  assert.equal(handoffActions("unlock", false).signIn, "secondary");
  assert.equal(HANDOFF_INTAKE_PATH, "/?entry=new-business&source=chatgpt");

  const s = normalizeScenario({ answers: { business_status: "new", Q_IMPORT_EXPORT: "yes" } }, normalizeScenario({ ...GUAYNABO, business_type: "Furniture Manufacturing" }).scenario).scenario;
  const d = scenarioToGuestDraft(s);
  assert.equal(d.profile.business_type, "Furniture Manufacturing");
  assert.equal(d.profile.municipality, "Guaynabo");
  assert.equal(d.profile.business_stage, "new");
  assert.equal(d.profile.number_of_employees, 28);
  assert.equal(d.discoveryAnswers.Q_IMPORT_EXPORT, true);
});

test("map pin: resolved server-side, authoritative for municipality, carried to the portal intake", () => {
  const g = municipioFocus("Guaynabo")!;
  assert.ok(g && Math.abs(g.latitude - 18.36) < 0.1 && Math.abs(g.longitude + 66.11) < 0.1, "Guaynabo pueblo focus");
  const site = resolveSite({ latitude: g.latitude, longitude: g.longitude })!;
  assert.equal(site.municipality, "Guaynabo");
  assert.equal(resolveSite({ latitude: 40.71, longitude: -74.0 }), null, "outside Puerto Rico");
  assert.equal(resolveSite({ latitude: "x", longitude: 1 }), null);

  // Pin wins over the typed municipality; client-supplied names are ignored.
  const first = normalizeScenario({ ...GUAYNABO, municipality: "Ponce", business_type: "Furniture Manufacturing" });
  assert.equal(first.scenario.municipality, "Ponce");
  const pinned = normalizeScenario({ site: { latitude: g.latitude, longitude: g.longitude, municipality: "Ponce" } as any }, first.scenario).scenario;
  assert.equal(pinned.municipality, "Guaynabo");
  assert.equal(pinned.site?.municipality, "Guaynabo");
  // Tampered prior scenario: name re-derived from coordinates.
  const tampered = normalizeScenario({}, { ...pinned, municipality: "Ponce", site: { ...pinned.site!, municipality: "Ponce" } }).scenario;
  assert.equal(tampered.municipality, "Guaynabo");
  // Outside PR is dropped, null clears, typed change in chat moves off the pin.
  const out = normalizeScenario({ site: { latitude: 40.7, longitude: -74 } }, pinned);
  assert.ok(out.dropped.includes("site") && out.scenario.site === null);
  assert.equal(normalizeScenario({ site: null }, pinned).scenario.site, null);
  assert.equal(normalizeScenario({ municipality: "Ponce" }, pinned).scenario.site, null);
  assert.equal(normalizeScenario({ municipality: "Guaynabo" }, pinned).scenario.site?.municipality, "Guaynabo");

  const a = assessScenario(pinned);
  assert.equal(a.map_focus.zoom, 16);
  assert.ok(a.assumptions.some((x) => x.startsWith("Municipality from map pin")));
  assert.ok(a.coverage_limits.some((x) => /map pin sets the municipality/.test(x)));
  assert.ok(a.gated.locked_features.some((x) => /site analysis/.test(x)));
  assert.equal(assessScenario(first.scenario).map_focus.zoom, 13);
  assert.equal(assessScenario(normalizeScenario({ business_type: "Furniture Manufacturing" }).scenario).map_focus.zoom, 8);

  // MCP: refine with a pin, then handoff carries it; the intake accepts the site.
  const r = (rpc("tools/call", { name: "refine_scenario", arguments: { scenario: first.scenario, site: { latitude: g.latitude, longitude: g.longitude } } }).body as Body).result;
  assert.equal(r.structuredContent.scenario.site.municipality, "Guaynabo");
  assert.match(r.content[0].text, /Site \(map pin\):.*Guaynabo/);
  const h = (rpc("tools/call", { name: "create_portal_handoff", arguments: { scenario: r.structuredContent.scenario, intent: "unlock" } }).body as Body).result;
  const payload = verifyHandoffToken(new URL(h.structuredContent.url).searchParams.get("t"));
  assert.equal(payload.scenario.site?.municipality, "Guaynabo");
  const draft = scenarioToGuestDraft(payload.scenario) as ReturnType<typeof scenarioToGuestDraft> & { intakeSite?: unknown };
  const restored = restoreIntakeSite(draft.intakeSite);
  assert.ok(restored && restored.municipality.name === "Guaynabo" && restored.coordinate_source === "MAP_PIN");
  assert.equal(Math.round(restored!.latitude * 1e5), Math.round(g.latitude * 1e5));
});

test("widget map: tile images only, CSP declares the tile origin and the portal redirect", () => {
  const meta = widgetResourceMeta("https://www.getsmartpr.com");
  assert.deepEqual(meta.ui.csp, { connectDomains: [], resourceDomains: [MAP_TILE_ORIGIN] });
  assert.deepEqual(meta["openai/widgetCSP"], { connect_domains: [], resource_domains: [MAP_TILE_ORIGIN], redirect_domains: ["https://www.getsmartpr.com"] });
  const res = (rpc("resources/read", { uri: WIDGET_URI }).body as Body).result.contents[0];
  assert.deepEqual(res._meta["openai/widgetCSP"].resource_domains, [MAP_TILE_ORIGIN]);
  const html = widgetHtml();
  assert.ok(html.includes(`${MAP_TILE_ORIGIN}/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}`));
  assert.ok(!/fetch\(|XMLHttpRequest|EventSource|WebSocket/.test(html), "no network calls from the widget");
  assert.match(html, /callTool\("refine_scenario",\{scenario:r\.scenario,site:p\?\{latitude:p\.lat,longitude:p\.lng\}:null\}\)/);
  const site = (TOOLS[1].inputSchema.properties as Record<string, any>).site;
  assert.deepEqual(site.required, ["latitude", "longitude"]);
});
