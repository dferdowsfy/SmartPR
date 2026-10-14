/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-RPC test payloads */
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeScenario, assessScenario, FREE_PREVIEW_LIMIT, resolveSite, describeAnswers, matchName } from "./assessment";
import { createHandoffToken, verifyHandoffToken, HANDOFF_TTL_SECONDS } from "./handoff";
import { handleChatgptMcp, TOOLS, widgetResourceMeta } from "./mcp";
import { WIDGET_URI, WIDGET_URI_ALIASES, WIDGET_MIME, widgetHtml, MAP_MAX_ZOOM, SVG_MAP_MAX_ZOOM, TILE_TIMEOUT_MS } from "./widget";
import { tileAllowed, tileTemplates, upstreamUrl } from "./tiles";
import { chipsFromLayers, siteDetailsFor, _resetSiteDetailsCache, type SiteLookups } from "./siteLookup";
import { PR_MUNICIPIO_SHAPES } from "./prMapShapes";
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

test("assess: generic manufacturing → partial, activity unresolved, real engine output", async () => {
  const { scenario } = normalizeScenario(GUAYNABO);
  const a = assessScenario(scenario);
  assert.equal(a.status, "partial");
  assert.equal(a.scenario.business_type, null);
  assert.ok(a.scenario.business_type_candidates.length > 1);
  assert.deepEqual(a.clarifying_questions.slice(0, 3).map((q) => q.id), ["activity", "business_status", "structural"]);
  assert.ok(a.requirements.length >= 5, `free preview must surface ≥5 requirements when engine has them (got ${a.requirements.length})`);
  assert.ok(a.requirements.length <= FREE_PREVIEW_LIMIT);
  assert.ok(a.requirements.some((r) => r.name.includes("Patente")), "municipal patente from Guaynabo");
  for (const r of a.requirements) {
    assert.ok(["supported", "conditional", "unresolved"].includes(r.applicability));
    for (const c of r.citations) assert.ok(c.label.trim().length > 0 && (c.url === null || /^https?:\/\//.test(c.url)));
  }
  assert.match(a.versions.kb, /^pr-kg@[0-9a-f]{12}$/);
  assert.ok(!("readiness" in a) && !JSON.stringify(a).includes("readiness_percent"));
});

test("missing facts are unresolved, never a silent no", async () => {
  const { scenario } = normalizeScenario({ business_type: "Furniture Manufacturing", municipality: "Guaynabo" });
  const a = assessScenario(scenario);
  const imp = a.requirements.find((r) => r.dependencies.includes("Q_IMPORT_EXPORT"));
  assert.ok(imp && imp.applicability === "unresolved");
  assert.ok(a.unresolved_facts.length > 0);
});

test("clarifying answers change applicability and refine preserves prior answers", async () => {
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

test("unsupported activity", async () => {
  const a = assessScenario(normalizeScenario({ business_type: "zzqx" }).scenario);
  assert.equal(a.status, "unsupported");
  assert.equal(a.requirements.length, 0);
});

test("handoff token: roundtrip, tamper, expiry", async () => {
  const { scenario } = normalizeScenario(GUAYNABO);
  const { token } = createHandoffToken(scenario, "continue", 1_000_000);
  assert.equal(verifyHandoffToken(token, 1_000_000 + 1000).scenario.municipality, "Guaynabo");
  assert.throws(() => verifyHandoffToken(token.slice(0, -2) + "xx", 1_000_000), /bad_signature|malformed/);
  assert.throws(() => verifyHandoffToken(token, 1_000_000 + HANDOFF_TTL_SECONDS * 1000 + 1), /expired/);
  assert.ok(!token.includes("@"));
});

test("MCP: initialize, tools/list, resources, tools/call", async () => {
  const init = (await rpc("initialize", { protocolVersion: "2025-06-18" })).body as Body;
  assert.equal(init.result.protocolVersion, "2025-06-18");
  const tools = ((await rpc("tools/list")).body as Body).result.tools;
  assert.deepEqual(tools.map((t: any) => t.name), ["assess_scenario", "refine_scenario", "create_portal_handoff"]);
  assert.equal((TOOLS[0]._meta as { ui: { resourceUri: string } }).ui.resourceUri, WIDGET_URI);
  assert.equal((TOOLS[0]._meta as Record<string, unknown>)["openai/outputTemplate"], WIDGET_URI);
  assert.equal(WIDGET_URI, "ui://smartpr/requirements-v7.html");
  const listed = ((await rpc("resources/list")).body as Body).result.resources.map((r: any) => r.uri);
  assert.deepEqual(listed, [...WIDGET_URI_ALIASES]);
  const res = ((await rpc("resources/read", { uri: WIDGET_URI })).body as Body).result.contents[0];
  assert.equal(res.mimeType, WIDGET_MIME);
  assert.ok(!/<script[^>]+src=|<link[\s>]/i.test(res.text), "Leaflet + widget JS/CSS are inlined (no external script or stylesheet)");
  const a = ((await rpc("tools/call", { name: "assess_scenario", arguments: GUAYNABO })).body as Body).result;
  assert.equal(a.structuredContent.status, "partial");
  const r = ((await rpc("tools/call", { name: "refine_scenario", arguments: { scenario: a.structuredContent.scenario, answers: { activity: "Furniture Manufacturing" } } })).body as Body).result;
  assert.equal(r.structuredContent.scenario.business_type, "Furniture Manufacturing");
  const h = ((await rpc("tools/call", { name: "create_portal_handoff", arguments: { scenario: r.structuredContent.scenario } })).body as Body).result;
  assert.match(h.structuredContent.url, /^https:\/\/smartpr\.example\/chatgpt\/handoff\?t=/);
  assert.equal(((await rpc("tools/call", { name: "run_sql", arguments: {} })).body as Body).error?.code, -32602);
  assert.equal((await rpc("notifications/initialized", {}, undefined)).status, 202);
});

test("handoff fails closed without secret", async () => {
  const saved = process.env.CHATGPT_HANDOFF_SECRET;
  delete process.env.CHATGPT_HANDOFF_SECRET;
  const out = ((await rpc("tools/call", { name: "create_portal_handoff", arguments: { scenario: normalizeScenario(GUAYNABO).scenario } })).body as Body).result;
  process.env.CHATGPT_HANDOFF_SECRET = saved;
  assert.equal(out.isError, true);
});

test("portal URL: production by default, never localhost or the dev tunnel", async () => {
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

test("portal URL from a live request (forwarded headers + runtime env)", async () => {
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

test("Unlock / Use my plan / Continue: server-built handoff URL carries intent + scenario", async () => {
  const prod = { siteUrl: resolvePortalUrl({ siteUrl: "http://localhost:3000", requestHost: "x.ngrok-free.dev" }) };
  const scenario = normalizeScenario({ ...GUAYNABO, business_type: "Furniture Manufacturing" }).scenario;
  for (const intent of ["unlock", "use_plan", "continue"] as const) {
    const out = ((await handleChatgptMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "create_portal_handoff", arguments: { scenario, intent } } }, prod)).body as Body).result;
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
  const html = widgetHtml({ assetOrigin: "https://smartpr.example" });
  assert.ok(!/localhost|127\.0\.0\.1|ngrok|getsmartpr\.com/.test(html), "widget never hard-codes a portal host (tile origin is injected)");
  // v7: the CURRENT scenario (incl. pin) plus any unsent dropdown answers.
  assert.match(html, /callTool\("create_portal_handoff",\{scenario:scenarioPayload\(\)\|\|r\.scenario,intent:kind,answers:drafts\(\)\}\)/);
  assert.match(html, /var u=sc&&sc\.url;if\(u\)\{[\s\S]{0,120}?openLink\(u\)/);
  for (const k of ["unlock", "use_plan", "continue"]) assert.ok(html.includes(`act("${k}")`), `button wired: ${k}`);
});

test("handoff review: sign-in round trip + intake prefill", async () => {
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

test("map pin: resolved server-side, authoritative for municipality, carried to the portal intake", async () => {
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
  const r = ((await rpc("tools/call", { name: "refine_scenario", arguments: { scenario: first.scenario, site: { latitude: g.latitude, longitude: g.longitude } } })).body as Body).result;
  assert.equal(r.structuredContent.scenario.site.municipality, "Guaynabo");
  assert.match(r.content[0].text, /Site \(map pin\):.*Guaynabo/);
  const h = ((await rpc("tools/call", { name: "create_portal_handoff", arguments: { scenario: r.structuredContent.scenario, intent: "unlock" } })).body as Body).result;
  const payload = verifyHandoffToken(new URL(h.structuredContent.url).searchParams.get("t"));
  assert.equal(payload.scenario.site?.municipality, "Guaynabo");
  const draft = scenarioToGuestDraft(payload.scenario) as ReturnType<typeof scenarioToGuestDraft> & { intakeSite?: unknown };
  const restored = restoreIntakeSite(draft.intakeSite);
  assert.ok(restored && restored.municipality.name === "Guaynabo" && restored.coordinate_source === "MAP_PIN");
  assert.equal(Math.round(restored!.latitude * 1e5), Math.round(g.latitude * 1e5));
});

test("widget CSP v7: only the portal origin, declared in resource + connect (+redirect) and as widget domain", async () => {
  const portal = "https://www.getsmartpr.com";
  const meta = widgetResourceMeta(portal);
  assert.deepEqual(meta.ui.csp, { connectDomains: [portal], resourceDomains: [portal] });
  assert.equal(meta.ui.domain, portal);
  assert.equal(meta["openai/widgetDomain"], portal);
  assert.deepEqual(meta["openai/widgetCSP"], { connect_domains: [portal], resource_domains: [portal], redirect_domains: [portal] });
  const res = ((await rpc("resources/read", { uri: WIDGET_URI })).body as Body).result.contents[0];
  assert.deepEqual(res._meta.ui.csp, { connectDomains: [SITE.siteUrl], resourceDomains: [SITE.siteUrl] });
  // Every absolute URL the widget can request is on the declared origin.
  const tpl = tileTemplates(SITE.siteUrl);
  assert.ok(res.text.includes(JSON.stringify(tpl.streets).slice(1, -1)), "streets template injected");
  assert.ok(res.text.includes(JSON.stringify(tpl.satellite).slice(1, -1)), "satellite template injected");
  for (const t of [tpl.streets, tpl.satellite]) assert.equal(new URL(t.replace(/[{}]/g, "")).origin, SITE.siteUrl);
  assert.ok(!/arcgisonline|tile\.openstreetmap|openfreemap|mapbox|googleapis|unpkg|jsdelivr|cdnjs/i.test(res.text), "no third-party hosts in the widget");
  assert.ok(!/url\((?!["']?(?:data:|#))[^)]*\)/.test(res.text), "no CSS urls (Leaflet image refs stripped)");
  assert.ok(!res.text.includes("__CFG__"), "config injected");
  assert.match(res.text, /L\.tileLayer/);
  const site = (TOOLS[1].inputSchema.properties as Record<string, any>).site;
  assert.deepEqual(site.required, ["latitude", "longitude"]);
});

test("tile proxy: Puerto Rico only, zoom-bounded, upstream overridable server-side", async () => {
  assert.ok(tileAllowed(15, 10362, 14679), "Bayamón tile");
  assert.ok(tileAllowed(7, 39, 57), "PR at z7");
  assert.ok(!tileAllowed(15, 0, 0), "outside PR");
  assert.ok(!tileAllowed(6, 19, 28) && !tileAllowed(20, 1, 1), "zoom bounds");
  assert.ok(!tileAllowed(15.5, 10362, 14679) && !tileAllowed(15, -1, 14679));
  assert.match(upstreamUrl("streets", 15, 10362, 14679, {}), /World_Street_Map\/MapServer\/tile\/15\/14679\/10362$/);
  assert.match(upstreamUrl("satellite", 15, 10362, 14679, {}), /World_Imagery\/MapServer\/tile\/15\/14679\/10362$/);
  assert.equal(upstreamUrl("streets", 9, 1, 2, { CHATGPT_TILE_URL_STREETS: "https://t.example/{z}/{x}/{y}.png?key=k" }), "https://t.example/9/1/2.png?key=k");
  assert.equal(TILE_TIMEOUT_MS, 3000);
});
test("widget map data: 78 municipios, decodable polyline rings inside Puerto Rico", async () => {
  assert.equal(PR_MUNICIPIO_SHAPES.length, 78);
  const names = new Set(PR_MUNICIPIO_SHAPES.map((m) => m[0]));
  for (const n of ["San Juan", "Guaynabo", "Mayagüez", "Bayamón", "Vieques", "Culebra"]) assert.ok(names.has(n), n);
  const decode = (str: string) => {
    const pts: [number, number][] = [];
    let i = 0, lat = 0, lng = 0;
    const next = () => { let r = 0, sh = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32 && i < str.length); return r & 1 ? ~(r >> 1) : r >> 1; };
    while (i < str.length) { lat += next(); lng += next(); pts.push([lng / 1e4, lat / 1e4]); }
    return pts;
  };
  for (const [name, lx, ly, rings] of PR_MUNICIPIO_SHAPES) {
    assert.ok(lx > -68.1 && lx < -65.1 && ly > 17.8 && ly < 18.6, `${name} label in PR`);
    for (const ring of rings.split(" ")) {
      const pts = decode(ring);
      assert.ok(pts.length >= 3, `${name} ring has points`);
      for (const [x, y] of pts) assert.ok(x > -68.1 && x < -65.1 && y > 17.8 && y < 18.6, `${name} point in PR`);
    }
  }
});

test("widget v7: map visible after assess, auto-pin for a named municipality (approximate), map_focus in schema", async () => {
  assert.equal(WIDGET_URI, "ui://smartpr/requirements-v7.html");
  assert.equal((TOOLS[0]._meta as Record<string, unknown>)["openai/outputTemplate"], WIDGET_URI);
  assert.equal(MAP_MAX_ZOOM, 19);
  assert.equal(SVG_MAP_MAX_ZOOM, 14);
  const html = widgetHtml();
  assert.match(html, /ui\/notifications\/size-changed/);
  assert.match(html, /notifyIntrinsicHeight/);
  assert.match(html, /Where is the site\?/);
  assert.match(html, /touch-action:none/);
  assert.match(html, /draggable:true/);
  const schema = TOOLS[0].outputSchema as { required: string[]; properties: Record<string, unknown> };
  assert.ok(schema.required.includes("map_focus"));
  assert.ok(schema.properties.map_focus && schema.properties.approximate_site && schema.properties.site_details);
  const a = assessScenario(normalizeScenario({ business_type: "Furniture Manufacturing" }).scenario);
  assert.ok(a.clarifying_questions.some((q) => q.id === "municipality"));
  assert.equal(a.map_focus.zoom, 8);
  assert.equal(a.approximate_site, null, "no municipality → no pin; user taps the map");
  // "I want to open a bar in Bayamón" → pin already dropped downtown Bayamón, flagged approximate.
  const bar = ((await rpc("tools/call", { name: "assess_scenario", arguments: { business_type: "bar", municipality: "Bayamón" } })).body as Body).result;
  const ap = bar.structuredContent.approximate_site;
  assert.ok(ap && ap.approximate === true && ap.municipality === "Bayamón", JSON.stringify(ap));
  assert.ok(Math.abs(ap.latitude - 18.39) < 0.05 && Math.abs(ap.longitude + 66.16) < 0.05, "downtown Bayamón");
  assert.equal(bar.structuredContent.scenario.site, null, "approximate pin is not a confirmed site");
  assert.match(bar.content[0].text, /approximate/i);
  assert.match(html, /approximate_site/);
  const withMuni = ((await rpc("tools/call", { name: "assess_scenario", arguments: { business_type: "restaurant", municipality: "San Juan" } })).body as Body).result;
  assert.equal(withMuni.structuredContent.map_focus.zoom, 13);
});
test("widget URI aliases: resources/read serves current HTML + v7 CSP for v1–v7; tools advertise v7 only", async () => {
  assert.deepEqual([...WIDGET_URI_ALIASES], [1, 2, 3, 4, 5, 6, 7].map((n) => `ui://smartpr/requirements-v${n}.html`));
  assert.equal(WIDGET_URI, WIDGET_URI_ALIASES[WIDGET_URI_ALIASES.length - 1]);
  for (const t of TOOLS.slice(0, 2)) {
    const meta = t._meta as Record<string, unknown>;
    assert.equal((meta.ui as { resourceUri: string }).resourceUri, WIDGET_URI);
    assert.equal(meta["openai/outputTemplate"], WIDGET_URI);
  }
  const current = widgetHtml({ assetOrigin: SITE.siteUrl });
  const expected = widgetResourceMeta(SITE.siteUrl);
  const listed = ((await rpc("resources/list")).body as Body).result.resources;
  for (const r of listed) assert.deepEqual(r._meta["openai/widgetCSP"], expected["openai/widgetCSP"]);
  for (const uri of WIDGET_URI_ALIASES) {
    const out = (await rpc("resources/read", { uri })).body as Body;
    assert.ok(!out.error, `resources/read ${uri}`);
    const c = out.result.contents[0];
    assert.equal(c.uri, uri, "echo requested alias so cached template_pointer binds");
    assert.equal(c.mimeType, WIDGET_MIME);
    assert.equal(c.text, current, `${uri} serves current widget HTML`);
    assert.deepEqual(c._meta.ui.csp, expected.ui.csp);
    assert.deepEqual(c._meta["openai/widgetCSP"], expected["openai/widgetCSP"]);
    assert.equal(c._meta["openai/widgetDomain"], SITE.siteUrl);
  }
  assert.equal(((await rpc("resources/read", { uri: "ui://smartpr/requirements-v0.html" })).body as Body).error?.code, -32602);
  assert.equal(((await rpc("resources/read", { uri: "ui://smartpr/requirements-v8.html" })).body as Body).error?.code, -32602);
});

test("free preview surfaces at least 5 requirements for a typical restaurant scenario", async () => {
  const a = assessScenario(normalizeScenario({
    business_type: "restaurant", municipality: "San Juan", square_feet: 2500, employees: 12, renovation: "interior",
  }).scenario);
  assert.ok(a.counts.total >= 5, `engine total ${a.counts.total}`);
  assert.ok(a.requirements.length >= 5, `visible ${a.requirements.length}`);
  assert.ok(a.requirements.length <= FREE_PREVIEW_LIMIT);
  assert.equal(FREE_PREVIEW_LIMIT >= 5, true);
});

test("widget v7 state model: forward-only results, pin/answers survive host globals, persisted via setWidgetState", async () => {
  const html = widgetHtml();
  // Root cause of "tap doesn't stick": v5 re-applied the ORIGINAL toolOutput on every openai:set_globals.
  assert.match(html, /function rTime\(/);
  assert.match(html, /addEventListener\("openai:set_globals",function\(\)\{fromGlobals\(\)\}/);
  assert.match(html, /function fromGlobals\(/);
  assert.match(html, /setWidgetState\(ws\)/);
  assert.match(html, /\{v:6,at:state\.result\.versions\.generated_at,scenario:scenarioPayload\(\),pin:state\.pin,answers:drafts\(\)\}/);
  assert.match(html, /function restore\(/);
  // Drag end and tap share movePin → refine_scenario with the site.
  assert.match(html, /function movePin\(/);
  assert.match(html, /callTool\("refine_scenario",\{scenario:scenarioPayload\(\)\|\|state\.result\.scenario,site:\{latitude:lat,longitude:lng\},answers:drafts\(\)/);
  assert.match(html, /on\("dragend"/);
  assert.match(html, /map\.on\("click"/);
  // Production-style location panel; unresolved chips say "See full report", never invented.
  for (const t of ["Location confirmed", "Approximate location", "Project location", "View full property report", "See full report", "Municipality", "Barrio", "Coordinates"]) assert.ok(html.includes(t), t);
  // Fallbacks: outline map when tiles don't load, SVG map if Leaflet itself fails.
  assert.match(html, /function toOutline\(/);
  assert.match(html, /function svgInit\(/);
  // Refine with nothing selected must say so instead of silently doing nothing (v5 bug).
  assert.ok(!/if\(!Object\.keys\(ans\)\.length\)return;/.test(html));
});

test("refine_scenario with a pin returns site_details from the portal layer lookups (never invented)", async () => {
  _resetSiteDetailsCache();
  let layerCalls = 0;
  const lookups: SiteLookups = {
    layers: async () => { layerCalls++; return { results: [
      { layer: "zoning", status: "resolved", code: "C-L", name: "Comercial Liviano", tags: [], source: { name: "JP" } },
      { layer: "flood_zone", status: "resolved", code: "AE", tags: ["SFHA"], source: { name: "FEMA" } },
      { layer: "terrain", status: "unavailable", code: null, tags: [] },
      { layer: "coastal_zone", status: "none", code: null, tags: [] },
      { layer: "parcel", status: "resolved", code: "085-015-036-01", tags: [] },
    ] } as any; },
    reverse: async () => ({ address_line_1: "Calle Degetau", formatted_address: "Calle Degetau, Bayamón, PR 00961", postal_code: "00961", place_source: "openstreetmap" } as any),
  };
  const g = municipioFocus("Bayamón")!;
  const first = normalizeScenario({ business_type: "bar", municipality: "Bayamón" }).scenario;
  const r = ((await handleChatgptMcp({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "refine_scenario", arguments: { scenario: first, site: { latitude: g.latitude, longitude: g.longitude } } } }, { ...SITE, siteLookups: lookups })).body as Body).result;
  const d = r.structuredContent.site_details;
  assert.equal(d.pending, false);
  assert.equal(d.street, "Calle Degetau");
  assert.equal(d.parcel, "085-015-036-01");
  assert.deepEqual(d.chips.map((c: any) => [c.id, c.value]), [["zoning", "C-L"], ["flood", "Zone AE"], ["landslide", null], ["coastal", "Outside coastal zone"]]);
  assert.equal(d.complete, false, "an unavailable layer stays unknown (widget shows 'See full report')");
  assert.match(r.content[0].text, /Zoning: C-L/);
  // Without lookups configured (or no pin) there are no site details at all.
  const none = ((await rpc("tools/call", { name: "refine_scenario", arguments: { scenario: first, site: { latitude: g.latitude, longitude: g.longitude } } })).body as Body).result;
  assert.equal(none.structuredContent.site_details, null);
  assert.equal(layerCalls, 1);
  // Never invent: empty / failed layer results give null chips.
  assert.ok(chipsFromLayers(null).chips.every((c) => c.value === null && c.status === "unavailable"));
  assert.ok(chipsFromLayers({ results: [{ layer: "zoning", status: "error", code: "X", tags: [] }] } as any).chips.every((c) => c.value === null));
});

test("site details: slow lookups return pending, then the finished result on the next refine", async () => {
  _resetSiteDetailsCache();
  let release!: () => void;
  const gate = new Promise<void>((res) => { release = res; });
  const lookups: SiteLookups = { layers: async () => { await gate; return { results: [{ layer: "flood_zone", status: "resolved", code: "X", tags: [] }] } as any; } };
  const p1 = await siteDetailsFor(18.4, -66.15, lookups, { waitMs: 20 });
  assert.equal(p1.pending, true);
  assert.ok(p1.chips.every((c) => c.value === null));
  release();
  await new Promise((r) => setTimeout(r, 10));
  const p2 = await siteDetailsFor(18.4, -66.15, lookups, { waitMs: 20 });
  assert.equal(p2.pending, false);
  assert.equal(p2.chips.find((c) => c.id === "flood")!.value, "Zone X");
});

test("handoff carries the CURRENT answers + pin (Darius demo bug: 'Not pinned' / 'Not provided')", async () => {
  const g = municipioFocus("Bayamón")!;
  const first = ((await rpc("tools/call", { name: "assess_scenario", arguments: { business_type: "bar", municipality: "Bayamón" } })).body as Body).result.structuredContent;
  // Widget sends the scenario plus unsent dropdown answers and the pin in one call.
  const h = ((await rpc("tools/call", { name: "create_portal_handoff", arguments: {
    scenario: first.scenario, intent: "unlock",
    answers: { business_status: "new", structural: "none", Q_ALCOHOL_SOLD: "yes" },
    site: { latitude: g.latitude, longitude: g.longitude },
  } })).body as Body).result;
  assert.ok(!h.isError, JSON.stringify(h.content));
  const p = verifyHandoffToken(new URL(h.structuredContent.url).searchParams.get("t"));
  assert.equal(p.intent, "unlock");
  assert.equal(p.scenario.business_status, "new");
  assert.equal(p.scenario.renovation, "none");
  assert.equal(p.scenario.answers.Q_ALCOHOL_SOLD, true);
  assert.equal(p.scenario.site?.municipality, "Bayamón");
  assert.deepEqual(h.structuredContent.carried, { site: true, answers: 1, business_status: "new", renovation: "none" });
  // The review page renders each answer (question → value), not "Not provided".
  const rows = describeAnswers(p.scenario);
  const alc = rows.find((r) => r.id === "Q_ALCOHOL_SOLD");
  assert.ok(alc && alc.answer === "Yes" && /alcohol/i.test(alc.question), JSON.stringify(rows));
  // Intake prefill keeps both.
  const draft = scenarioToGuestDraft(p.scenario) as ReturnType<typeof scenarioToGuestDraft> & { intakeSite?: unknown };
  assert.equal(draft.discoveryAnswers.Q_ALCOHOL_SOLD, true);
  assert.ok(restoreIntakeSite(draft.intakeSite));
  // A prior pin in the scenario survives a handoff with no extra args.
  const pinned = ((await rpc("tools/call", { name: "refine_scenario", arguments: { scenario: first.scenario, site: { latitude: g.latitude, longitude: g.longitude }, answers: { Q_ALCOHOL_SOLD: "yes" } } })).body as Body).result.structuredContent;
  const h2 = ((await rpc("tools/call", { name: "create_portal_handoff", arguments: { scenario: pinned.scenario, intent: "continue" } })).body as Body).result;
  const p2 = verifyHandoffToken(new URL(h2.structuredContent.url).searchParams.get("t"));
  assert.equal(p2.scenario.site?.municipality, "Bayamón");
  assert.equal(p2.scenario.answers.Q_ALCOHOL_SOLD, true);
});
test("refine_scenario keeps site lat/lng and place labels after pin", async () => {
  const first = normalizeScenario({ business_type: "coffee shop", municipality: "Orocovis" }).scenario;
  const site = resolveSite({ latitude: 18.2, longitude: -66.4 })!;
  assert.equal(site.municipality, "Orocovis");
  assert.ok(site.barrio);
  const r = ((await rpc("tools/call", {
    name: "refine_scenario",
    arguments: { scenario: first, site: { latitude: site.latitude, longitude: site.longitude } },
  })).body as Body).result;
  const sc = r.structuredContent;
  assert.equal(sc.scenario.site.municipality, "Orocovis");
  assert.equal(sc.scenario.site.barrio, site.barrio);
  assert.equal(sc.scenario.site.latitude, site.latitude);
  assert.equal(sc.scenario.site.longitude, site.longitude);
  assert.equal(sc.map_focus.latitude, site.latitude);
  assert.equal(sc.map_focus.longitude, site.longitude);
  // Further refine with answers must preserve the pin.
  const r2 = ((await rpc("tools/call", {
    name: "refine_scenario",
    arguments: { scenario: sc.scenario, answers: { business_status: "new" } },
  })).body as Body).result;
  assert.equal(r2.structuredContent.scenario.site.latitude, site.latitude);
  assert.equal(r2.structuredContent.scenario.site.municipality, "Orocovis");
  assert.ok(r2.structuredContent.requirements.length >= 5);
});

test("matchName tolerates typos ('resturant' -> Restaurant) but stays strict on junk", () => {
  const items = [{ name: "Restaurant" }, { name: "Bar" }, { name: "Cafe" }];
  const typo = matchName(items, "resturant");
  assert.equal(typo.kind, "fuzzy");
  if (typo.kind === "fuzzy") assert.equal(typo.value.name, "Restaurant");
  const exact = matchName(items, "bar");
  assert.equal(exact.kind, "exact");
  const junk = matchName(items, "xyzqqq");
  assert.equal(junk.kind, "candidates");
  if (junk.kind === "candidates") assert.deepEqual(junk.candidates, []);
});

test("assess_scenario recovers from a typo'd business_type instead of unsupported", () => {
  const { scenario } = normalizeScenario({ business_type: "resturant", activity_description: "open a resturant in bayamon", municipality: "Bayam\u00f3n", business_status: "unknown" });
  assert.equal(scenario.business_type, "Restaurant");
  const r = assessScenario(scenario);
  assert.notEqual(r.status, "unsupported");
  assert.ok(r.requirements.length > 0);
});
