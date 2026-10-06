// Headless smoke for the ChatGPT widget in the sandbox harness (server.mts).
//   npx tsx scripts/chatgpt-harness/server.mts &   # PORT=4100
//   node scripts/chatgpt-harness/smoke.mjs [outDir]
// Proves at 760px (mouse) and 375px (touch): tiles load under the declared
// CSP, the municipality auto-pin, drag → refine_scenario(site), tap → pin,
// pin/answers survive host set_globals + remount, handoff carries answers +
// site, and the SVG fallback takes over when tiles are blocked by CSP.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.HARNESS_URL || "http://localhost:4100";
const OUT = process.argv[2] || "/workspace/shots";
mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, info = "") => { results.push({ name, pass: !!pass, info }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${info ? ` — ${info}` : ""}`); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/usr/bin/google-chrome", args: ["--no-sandbox"] });

async function open(w, touch, q = "") {
  const ctx = await browser.newContext({ viewport: { width: w + 30, height: 1000 }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text()); });
  await page.goto(`${BASE}/host?w=${w}${q}`);
  const f = page.frameLocator("#frame");
  await f.locator(".map").first().waitFor({ timeout: 20000 });
  const frame = () => page.frames().find((x) => x !== page.mainFrame());
  return { ctx, page, f, frame, errors };
}
const dbg = (fr) => fr.evaluate(() => ({ mode: window.__smartpr.mode, tiles: window.__smartpr.tiles, pin: window.__smartpr.state.pin, confirmed: window.__smartpr.state.confirmed && { municipality: window.__smartpr.state.confirmed.municipality, barrio: window.__smartpr.state.confirmed.barrio }, details: window.__smartpr.state.details, events: window.__smartpr.events.slice(-12) }));
const calls = (page, name) => page.evaluate((n) => window.H.calls.filter((c) => c.name === n), name);
async function pinTip(f) { const b = await f.locator(".spr-pin, .spin").first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height * 0.55 }; }
async function drag(page, touch, from, to) {
  if (!touch) { await page.mouse.move(from.x, from.y); await page.mouse.down(); for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12); await page.mouse.up(); return; }
  const cdp = await page.context().newCDPSession(page);
  const pt = (p) => [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(from) });
  for (let i = 1; i <= 12; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt({ x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 }) }); await page.waitForTimeout(16); }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function tap(page, touch, p) { if (touch) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); }
async function settle(page, fr, ms = 12000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const s = await fr.evaluate(() => window.__smartpr.state.siteBusy || window.__smartpr.state.busy); if (!s) return; await page.waitForTimeout(150); } }
async function details(page, fr, ms = 16000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const d = await fr.evaluate(() => window.__smartpr.state.details); if (d && !d.pending) return d; await page.waitForTimeout(250); } return null; }
const shot = (page, name) => page.locator("#frame").screenshot({ path: `${OUT}/chatgpt-v6-${name}.png` });

for (const [w, touch] of [[760, false], [375, true]]) {
  const tag = `${w}`;
  // 1. "I want to open a bar in Bayamón" → auto-pin downtown Bayamón (approximate).
  let s = await open(w, touch);
  await s.page.waitForTimeout(3500);
  let d = await dbg(s.frame());
  ok(`${tag} tiles load under declared CSP`, d.mode === "tiles" && d.tiles.loaded > 0, `mode=${d.mode} loaded=${d.tiles.loaded} errors=${d.tiles.errors}`);
  ok(`${tag} auto-pin for municipality (approximate, Bayamón downtown)`, d.pin && d.pin.approx && Math.abs(d.pin.lat - 18.39) < 0.05 && Math.abs(d.pin.lng + 66.16) < 0.05, JSON.stringify(d.pin));
  ok(`${tag} panel says Approximate location`, (await s.f.locator(".pill-approx").count()) === 1);
  await shot(s.page, `${tag}-autopin`);
  // 2. host globals storm must not wipe anything
  for (let i = 0; i < 4; i++) await s.page.evaluate(() => window.poke("storm"));
  await s.page.waitForTimeout(300);
  d = await dbg(s.frame());
  ok(`${tag} pin survives openai:set_globals storm`, d.pin && d.pin.approx);
  // 3. drag the pin → refine_scenario(site)
  const before = (await calls(s.page, "refine_scenario")).length;
  const from = await pinTip(s.f);
  await drag(s.page, touch, from, { x: from.x + 40, y: from.y + 28 });
  await s.page.waitForTimeout(400);
  let rc = await calls(s.page, "refine_scenario");
  const dragCall = rc[before];
  ok(`${tag} drag end calls refine_scenario with site {latitude, longitude}`, rc.length === before + 1 && dragCall?.arguments?.site?.latitude && dragCall?.arguments?.site?.longitude, dragCall ? JSON.stringify(dragCall.arguments.site) : "no call");
  await settle(s.page, s.frame());
  const det = await details(s.page, s.frame());
  ok(`${tag} site chips arrive (server lookups, no inventions)`, det && det.chips.length === 4 && det.chips.every((c) => c.value === null || c.status !== "unavailable"), det ? det.chips.map((c) => `${c.label}=${c.value ?? "See full report"}`).join(" | ") : "still pending");
  d = await dbg(s.frame());
  ok(`${tag} confirmed panel after drag`, (await s.f.locator(".pill-ok").count()) === 1 && d.confirmed && !d.pin.approx, `${d.confirmed?.barrio}, ${d.confirmed?.municipality}; street=${d.details?.street}; chips=${(d.details?.chips || []).map((c) => `${c.label}:${c.value ?? "—"}`).join(" | ")}`);
  ok(`${tag} pin stays where dropped`, dragCall && Math.abs(d.pin.lat - dragCall.arguments.site.latitude) < 1e-6 && Math.abs(d.pin.lng - dragCall.arguments.site.longitude) < 1e-6);
  await s.page.waitForTimeout(800);
  await shot(s.page, `${tag}-drag-confirmed`);
  // 4. tap elsewhere moves the pin
  const mb = await s.f.locator(".map").first().boundingBox();
  const beforeTap = (await calls(s.page, "refine_scenario")).length; // polls for pending lookups may have added calls
  await tap(s.page, touch, { x: mb.x + mb.width * 0.3, y: mb.y + mb.height * 0.7 });
  await s.page.waitForTimeout(300);
  rc = await calls(s.page, "refine_scenario");
  const tapCall = rc.slice(beforeTap).find((c) => c.arguments?.site && Math.abs(c.arguments.site.latitude - dragCall.arguments.site.latitude) > 1e-5);
  ok(`${tag} tap moves the pin and fires refine`, !!tapCall, tapCall ? JSON.stringify(tapCall.arguments.site) : `no new site call (${rc.length - beforeTap} calls)`);
  await settle(s.page, s.frame());
  // 5. answers survive host globals; Update preview; handoff carries answers + site
  await s.f.locator("#q_business_status").selectOption("new");
  await s.f.locator("#q_structural").selectOption("none");
  if (await s.f.locator("#q_Q_ALCOHOL_SOLD").count()) await s.f.locator("#q_Q_ALCOHOL_SOLD").selectOption("yes");
  await s.page.evaluate(() => window.poke("after answers"));
  await s.page.waitForTimeout(200);
  ok(`${tag} dropdown answers survive set_globals`, (await s.f.locator("#q_business_status").inputValue()) === "new" && (await s.f.locator("#q_structural").inputValue()) === "none");
  await s.f.locator("text=Update preview").click();
  await settle(s.page, s.frame());
  const st = await s.frame().evaluate(() => window.__smartpr.state.result.scenario);
  ok(`${tag} Update preview applies answers`, st.business_status === "new" && st.renovation === "none" && st.answers.Q_ALCOHOL_SOLD === true && !!st.site, JSON.stringify({ business_status: st.business_status, renovation: st.renovation, answers: st.answers, site: !!st.site }));
  await s.page.evaluate(() => window.poke("before unlock"));
  await s.f.locator("text=Unlock full assessment").click();
  await s.page.waitForTimeout(1500);
  const opened = await s.page.evaluate(() => window.H.opened.slice(-1)[0]);
  let payload = null;
  try { payload = JSON.parse(Buffer.from(new URL(opened).searchParams.get("t").split(".")[0], "base64url").toString()); } catch { payload = null; }
  const ps = payload?.scenario;
  ok(`${tag} handoff token carries answers + site`, ps && ps.business_status === "new" && ps.renovation === "none" && ps.answers?.Q_ALCOHOL_SOLD === true && ps.site?.latitude, ps ? JSON.stringify({ intent: payload.intent, business_status: ps.business_status, renovation: ps.renovation, answers: ps.answers, site: ps.site && [ps.site.latitude, ps.site.longitude, ps.site.municipality] }) : `opened=${opened}`);
  // 6. remount (ChatGPT re-renders the widget with the ORIGINAL toolOutput + saved widgetState)
  const pinBefore = (await dbg(s.frame())).pin;
  await s.page.evaluate(() => window.remount());
  await s.page.waitForTimeout(1500);
  await s.f.locator(".map").first().waitFor();
  await settle(s.page, s.frame());
  d = await dbg(s.frame());
  ok(`${tag} pin + answers restored after remount`, d.pin && !d.pin.approx && Math.abs(d.pin.lat - pinBefore.lat) < 1e-6 && (await s.frame().evaluate(() => window.__smartpr.state.result.scenario.business_status)) === "new", JSON.stringify(d.pin));
  ok(`${tag} no page errors`, s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
  await s.ctx.close();

  // 7. No location known → tap anywhere drops the pin, then drag it.
  s = await open(w, touch, `&prompt=${encodeURIComponent(JSON.stringify({ business_type: "bar" }))}`);
  await s.page.waitForTimeout(2500);
  d = await dbg(s.frame());
  ok(`${tag} no municipality → no pin, tap hint`, !d.pin && (await s.f.locator(".map .tip").count()) === 1);
  await shot(s.page, `${tag}-nolocation`);
  const mb2 = await s.f.locator(".map").first().boundingBox();
  await tap(s.page, touch, { x: mb2.x + mb2.width * 0.55, y: mb2.y + mb2.height * 0.42 });
  await s.page.waitForTimeout(300);
  rc = await calls(s.page, "refine_scenario");
  ok(`${tag} tap places pin → refine_scenario(site)`, rc.length === 1 && rc[0].arguments.site, rc[0] ? JSON.stringify(rc[0].arguments.site) : "none");
  await settle(s.page, s.frame());
  d = await dbg(s.frame());
  ok(`${tag} tapped pin resolves municipality`, d.confirmed && d.confirmed.municipality, `${d.confirmed?.barrio}, ${d.confirmed?.municipality}`);
  const f2 = await pinTip(s.f);
  await drag(s.page, touch, f2, { x: f2.x - 30, y: f2.y + 20 });
  await s.page.waitForTimeout(300);
  rc = await calls(s.page, "refine_scenario");
  ok(`${tag} tapped pin is draggable`, rc.length === 2 && rc[1].arguments.site, rc[1] ? JSON.stringify(rc[1].arguments.site) : "none");
  await settle(s.page, s.frame());
  await s.page.waitForTimeout(600);
  await shot(s.page, `${tag}-tap-pin`);
  await s.ctx.close();

  // 8. Tiles blocked by CSP → inline-SVG municipio fallback within ~3 s; pin still works.
  s = await open(w, touch, "&block=tiles");
  const t0 = Date.now();
  let mode = null;
  while (Date.now() - t0 < 6000) { mode = (await dbg(s.frame())).mode; if (mode !== "tiles") break; await s.page.waitForTimeout(100); }
  ok(`${tag} fallback to municipio outlines when tiles blocked`, mode === "outline", `mode=${mode} after ${Date.now() - t0} ms`);
  const before3 = (await calls(s.page, "refine_scenario")).length;
  const f3 = await pinTip(s.f);
  await drag(s.page, touch, f3, { x: f3.x + 25, y: f3.y + 15 });
  await s.page.waitForTimeout(300);
  rc = await calls(s.page, "refine_scenario");
  ok(`${tag} fallback map: drag still refines`, rc.length > before3 && rc[before3].arguments.site);
  await settle(s.page, s.frame());
  await s.page.waitForTimeout(400);
  await shot(s.page, `${tag}-fallback`);
  await s.ctx.close();
}
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
