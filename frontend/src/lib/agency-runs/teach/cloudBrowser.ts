/**
 * Teach Clara and strict replay on a Browser Use Cloud browser (server only).
 *
 * The same contract as the self-hosted worker (teachWorkerClient.ts /
 * replay/workerDriver.ts), backed by Browser Use's Browser Infrastructure
 * API with the app's existing BROWSER_USE_API_KEY:
 *
 *   POST  /api/v4/browsers          → { id, cdpUrl, liveUrl }  (a cloud browser)
 *   PATCH /api/v4/browsers/{id}     { action: "stop" }
 *   GET   /api/v4/browsers/{id}     (status, cdpUrl — reconnect after a restart)
 *
 * SmartPR connects to the browser over CDP (playwright-core), injects the
 * same structure-only recorder (teach) or driver (replay), and pulls the
 * recorder's queued events on each poll. The person works in Browser Use's
 * live view. Values are never read from the page: the recorder reports
 * value KINDS, masks sensitive fields, and a one-time secure value is typed
 * by `secureFill` and kept nowhere. Navigation outside the allowed domains is
 * blocked while SmartPR is connected, and checked on every poll.
 */
import type { Browser, BrowserContext, Page } from "playwright-core";
import { RECORDER_SCRIPT } from "./recorderScript";
import { DRIVER_SCRIPT } from "../replay/driverScript";
import type { LocateResult, PageSnapshot, PortalDriver } from "../replay/engine";

type Mode = "teach" | "drive";

interface CloudLive {
  id: string;
  cdpUrl: string;
  liveUrl: string | null;
  mode: Mode;
  allowed: string[];
  startUrl: string;
  browser: Browser | null;
  context: BrowserContext | null;
  connecting: Promise<BrowserContext> | null;
  events: { seq: number; event: Record<string, unknown>; shot: boolean }[];
  seq: number;
  shots: Map<number, Buffer>;
  status: "running" | "stopped";
}

const MAX_EVENTS = 5000;
const MAX_SHOTS = 150;
const g = globalThis as typeof globalThis & { __smartprCloudBrowsers?: Map<string, CloudLive> };
const lives = () => (g.__smartprCloudBrowsers ??= new Map());

export class CloudBrowserError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "TeachWorkerError"; // same shape the teach/replay error mapping reads
  }
}

function base(): string {
  return (process.env.BROWSER_USE_BASE_URL?.trim() || "https://api.browser-use.com").replace(/\/$/, "");
}

function apiKey(): string | null {
  return process.env.BROWSER_USE_API_KEY?.trim() || null;
}

export function cloudBrowserConfigured(): boolean {
  return Boolean(apiKey());
}

async function bu<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = apiKey();
  if (!key) throw new CloudBrowserError(401, "BROWSER_USE_API_KEY is not set");
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      ...init,
      headers: { "X-Browser-Use-API-Key": key, "Content-Type": "application/json", Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new CloudBrowserError(0, "Browser Use unreachable");
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    // 429 = too many concurrent browsers on this project: same meaning as a busy worker.
    throw new CloudBrowserError(res.status === 429 ? 409 : res.status, `browser-use ${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

/** Can SmartPR use Browser Use's browsers with this key? (No browser is started.) */
export async function probeCloudBrowser(fetchImpl: typeof fetch = fetch, timeoutMs = 6000): Promise<{ ok: true } | { ok: false; status: number }> {
  const key = apiKey();
  if (!key) return { ok: false, status: -1 };
  try {
    const res = await fetchImpl(`${base()}/api/v2/billing/account`, { headers: { "X-Browser-Use-API-Key": key, Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return { ok: true };
    return { ok: false, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

function hostAllowed(url: string, allowed: string[]): boolean {
  let host = "";
  try {
    const u = new URL(url);
    if (u.protocol === "about:" || u.protocol === "data:" || u.protocol === "blob:") return true;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowed.some((p) => {
    const d = p.toLowerCase().replace(/^\*\./, "");
    return host === d || host.endsWith(`.${d}`);
  });
}

async function connect(live: CloudLive): Promise<BrowserContext> {
  if (live.browser?.isConnected() && live.context) return live.context;
  if (live.connecting) return live.connecting;
  live.connecting = (async () => {
    const { chromium } = await import("playwright-core");
    const browser = await chromium.connectOverCDP(live.cdpUrl, { timeout: 30_000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const script = live.mode === "teach" ? RECORDER_SCRIPT : DRIVER_SCRIPT;
    await context.addInitScript({ content: script });
    await context.route("**/*", async (route, request) => {
      const top = request.isNavigationRequest() && request.frame().parentFrame() === null;
      if (top && !hostAllowed(request.url(), live.allowed)) return route.abort("blockedbyclient");
      return route.continue();
    });
    for (const p of context.pages()) await p.evaluate(script).catch(() => undefined);
    browser.on("disconnected", () => {
      live.browser = null;
      live.context = null;
    });
    live.browser = browser;
    live.context = context;
    return context;
  })();
  try {
    return await live.connecting;
  } catch {
    throw new CloudBrowserError(503, "Couldn't connect to the cloud browser");
  } finally {
    live.connecting = null;
  }
}

async function currentPage(live: CloudLive): Promise<Page> {
  const ctx = await connect(live);
  const pages = ctx.pages().filter((p) => !p.isClosed());
  const page = pages.at(-1) ?? (await ctx.newPage());
  // Outside the allowed sites (e.g. a navigation while SmartPR wasn't connected): go back.
  if (!hostAllowed(page.url(), live.allowed)) await page.goto(live.startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
  return page;
}

async function getLive(id: string, mode: Mode): Promise<CloudLive> {
  const known = lives().get(id);
  if (known) return known;
  // After a server restart: rebuild from the browser's own record.
  const s = await bu<{ id: string; cdpUrl?: string | null; liveUrl?: string | null; status?: string; metadata?: Record<string, string> | null }>(`/api/v4/browsers/${encodeURIComponent(id)}`);
  if (!s.cdpUrl || s.status === "stopped") throw new CloudBrowserError(404, "cloud browser not found");
  const live: CloudLive = {
    id,
    cdpUrl: s.cdpUrl,
    liveUrl: s.liveUrl ?? null,
    mode: s.metadata?.smartpr === "drive" ? "drive" : s.metadata?.smartpr === "teach" ? "teach" : mode,
    allowed: (s.metadata?.allowed ?? "").split(",").filter(Boolean),
    startUrl: s.metadata?.start ?? "",
    browser: null,
    context: null,
    connecting: null,
    events: [],
    seq: 0,
    shots: new Map(),
    status: "running",
  };
  lives().set(id, live);
  return live;
}

async function open(mode: Mode, input: { startUrl: string; allowedDomains: string[] }): Promise<{ sessionId: string; liveUrl: string | null }> {
  if (!/^https:\/\//i.test(input.startUrl)) throw new CloudBrowserError(400, "startUrl must be https");
  const allowed = input.allowedDomains.filter((d) => typeof d === "string" && d.trim()).slice(0, 20);
  if (!allowed.length || !hostAllowed(input.startUrl, allowed)) throw new CloudBrowserError(400, "startUrl is outside allowedDomains");
  const s = await bu<{ id: string; cdpUrl?: string | null; liveUrl?: string | null }>("/api/v4/browsers", {
    method: "POST",
    body: JSON.stringify({
      proxyCountryCode: "us",
      timeout: 60,
      metadata: { smartpr: mode, allowed: allowed.join(",").slice(0, 400), start: input.startUrl.slice(0, 400) },
    }),
  });
  if (!s.cdpUrl) throw new CloudBrowserError(503, "The cloud browser did not return a CDP URL");
  const live: CloudLive = { id: s.id, cdpUrl: s.cdpUrl, liveUrl: s.liveUrl ?? null, mode, allowed, startUrl: input.startUrl, browser: null, context: null, connecting: null, events: [], seq: 0, shots: new Map(), status: "running" };
  lives().set(s.id, live);
  try {
    const page = await currentPage(live);
    await page.goto(input.startUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
  } catch (err) {
    await stopCloud(s.id).catch(() => undefined);
    throw err;
  }
  return { sessionId: s.id, liveUrl: live.liveUrl };
}

async function stopCloud(id: string): Promise<void> {
  const live = lives().get(id);
  if (live) {
    live.status = "stopped";
    await live.browser?.close().catch(() => undefined);
    live.browser = null;
    live.context = null;
  }
  await bu(`/api/v4/browsers/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ action: "stop" }) }).catch(() => undefined);
}

// ------------------------------------------------------------------ teach

const EVENT_KEYS = new Set(["kind", "url", "title", "heading", "hasPassword", "hasCaptcha", "hasFileInput", "role", "label", "selector", "inputType", "valueKind", "required", "optionText", "secretKind", "secretFields", "inputFields"]);

async function drain(live: CloudLive): Promise<void> {
  if (live.status !== "running") return;
  const ctx = await connect(live);
  const fresh: { seq: number; event: Record<string, unknown>; shot: boolean }[] = [];
  for (const page of ctx.pages()) {
    if (page.isClosed()) continue;
    const raw = await page
      .evaluate(`(function(){ if (!window.__claraDrain) { ${RECORDER_SCRIPT} } return window.__claraDrain ? window.__claraDrain() : []; })()`)
      .catch(() => []);
    for (const r of Array.isArray(raw) ? raw : []) {
      if (!r || typeof r !== "object" || live.events.length + fresh.length >= MAX_EVENTS) continue;
      const event = Object.fromEntries(Object.entries(r as Record<string, unknown>).filter(([k]) => EVENT_KEYS.has(k)));
      const sensitive = event.valueKind === "secret" || Boolean(event.secretKind);
      fresh.push({ seq: ++live.seq, event, shot: !sensitive });
    }
  }
  // One screenshot per batch, on its last non-sensitive step (fields on screen are masked).
  const last = [...fresh].reverse().find((e) => e.shot);
  for (const e of fresh) if (e !== last) e.shot = false;
  if (last) {
    const page = ctx.pages().filter((p) => !p.isClosed()).at(-1);
    const shot = page ? await page.screenshot({ type: "jpeg", quality: 45 }).catch(() => null) : null;
    if (shot) {
      live.shots.set(last.seq, shot);
      while (live.shots.size > MAX_SHOTS) live.shots.delete(live.shots.keys().next().value as number);
    } else last.shot = false;
  }
  live.events.push(...fresh);
  await currentPage(live).catch(() => undefined); // re-checks the allowed sites
}

export const cloudTeachWorker = {
  start: (input: { startUrl: string; allowedDomains: string[] }) => open("teach", input),
  async events(sessionId: string, after: number) {
    const live = await getLive(sessionId, "teach");
    try {
      await drain(live);
    } catch {
      // The browser went away (timed out / closed): report it, keep what was recorded.
      live.status = "stopped";
    }
    const items = live.events.filter((e) => e.seq > after).slice(0, 500);
    return { items, nextAfter: items.at(-1)?.seq ?? after, status: live.status };
  },
  stop: (sessionId: string) => stopCloud(sessionId),
  secureFill: (sessionId: string, input: { value: string; selector: string | null }) => secureFillCloud(sessionId, input),
  async shot(sessionId: string, seq: number): Promise<ArrayBuffer | null> {
    const b = lives().get(sessionId)?.shots.get(seq);
    return b ? (b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer) : null;
  },
};

const SECURE_TARGET_JS = `(sel) => {
  const ok = (el) => el && el.tagName && /^(input|textarea)$/i.test(el.tagName) && !el.disabled && !el.readOnly
    && !/^(hidden|checkbox|radio|submit|button|file)$/i.test(el.type || '');
  const mark = (el) => { el.setAttribute('data-clara-secure', '1'); return true; };
  document.querySelectorAll('[data-clara-secure]').forEach((e) => e.removeAttribute('data-clara-secure'));
  if (sel) { try { const el = document.querySelector(sel); if (ok(el)) return mark(el); } catch (e) {} return false; }
  if (ok(document.activeElement)) return mark(document.activeElement);
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const cands = Array.from(document.querySelectorAll('input[type=password], input[autocomplete=one-time-code], input[data-clara-sensitive]'))
    .filter((el) => ok(el) && vis(el) && !el.value);
  return cands.length ? mark(cands[0]) : false;
}`;

/** Type a one-time sensitive value into the live page. Never logged or kept. */
async function secureFillCloud(sessionId: string, input: { value: string; selector: string | null }): Promise<{ ok: boolean; reason?: string }> {
  const live = await getLive(sessionId, "teach");
  if (live.status !== "running") throw new CloudBrowserError(404, "browser closed");
  if (!input.value || input.value.length > 256) throw new CloudBrowserError(400, "value missing or too long");
  const page = await currentPage(live);
  try {
    const found = await page.evaluate(`(${SECURE_TARGET_JS})(${JSON.stringify(input.selector)})`);
    if (!found) return { ok: false, reason: "no_field" };
    const loc = page.locator('[data-clara-secure="1"]');
    await loc.fill(input.value);
    await loc.dispatchEvent("change");
    await loc.evaluate((e) => e.removeAttribute("data-clara-secure"));
    return { ok: true };
  } catch {
    return { ok: false, reason: "fill_failed" };
  }
}

// ------------------------------------------------------------------ replay (drive)

export async function startCloudDrive(input: { startUrl: string; allowedDomains: string[] }) {
  return open("drive", input);
}

export async function stopCloudDrive(sessionId: string): Promise<void> {
  await stopCloud(sessionId);
}

export async function secureFillCloudDrive(sessionId: string, input: { value: string; selector: string | null }) {
  return secureFillCloud(sessionId, input);
}

function refSelector(ref: string): string {
  const clean = ref.replace(/[^a-zA-Z0-9]/g, "");
  if (!clean) throw new CloudBrowserError(400, "ref required");
  return `[data-clara-ref="${clean}"]`;
}

/** The replay engine's PortalDriver over a Browser Use cloud browser. */
export class CloudDriver implements PortalDriver {
  constructor(private sessionId: string) {}
  private async page(): Promise<Page> {
    const live = await getLive(this.sessionId, "drive");
    const page = await currentPage(live);
    await page.evaluate(`(function(){ if (!window.__claraDrive) { ${DRIVER_SCRIPT} } })()`).catch(() => undefined);
    return page;
  }
  async snapshot(): Promise<PageSnapshot> {
    return (await this.page()).evaluate("window.__claraDrive.snapshot()") as Promise<PageSnapshot>;
  }
  async locate(target: { role: string; label: string; selector?: string | null }): Promise<LocateResult> {
    const t = { role: String(target.role), label: String(target.label).slice(0, 200), selector: target.selector ?? null };
    return (await this.page()).evaluate(`window.__claraDrive.locate(${JSON.stringify(t)})`) as Promise<LocateResult>;
  }
  async fill(ref: string, value: string): Promise<void> {
    await (await this.page()).locator(refSelector(ref)).fill(value);
  }
  async selectOption(ref: string, optionLabel: string): Promise<boolean> {
    const loc = (await this.page()).locator(refSelector(ref));
    const labels = (await loc.evaluate((s) => Array.from((s as HTMLSelectElement).options).map((o) => o.text.trim()))) as string[];
    const want = optionLabel.toLowerCase();
    const exact = labels.filter((l) => l.toLowerCase() === want);
    const partial = labels.filter((l) => want && l.toLowerCase().includes(want));
    const pick = exact.length === 1 ? exact[0] : !exact.length && partial.length === 1 ? partial[0] : null;
    if (!pick) return false;
    await loc.selectOption({ label: pick });
    return true;
  }
  async click(ref: string): Promise<void> {
    const loc = (await this.page()).locator(refSelector(ref));
    const type = (await loc.evaluate((e) => (e as HTMLInputElement).type || "")) as string;
    if (type === "radio" || type === "checkbox") await loc.check({ force: true });
    else await loc.click();
  }
  async settle(): Promise<void> {
    const page = await this.page();
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(400);
  }
}

/** Test seam. */
export async function resetCloudBrowsersForTests(): Promise<void> {
  for (const live of lives().values()) await live.browser?.close().catch(() => undefined);
  lives().clear();
}
