/**
 * Server-only client for teach sessions on the self-hosted browser worker
 * (workers/browser-agent, /api/v4/teach/*). The worker opens a headed
 * browser on the same display the live viewer already streams, injects
 * RECORDER_SCRIPT into every page, and queues the recorder's events.
 *
 * Teach mode and strict replay run on a browser SmartPR can inject its
 * recorder / driver into: a Browser Use Cloud browser over CDP (default when
 * BROWSER_USE_API_KEY is set — see cloudBrowser.ts) or the self-hosted
 * worker (when SELF_HOSTED_AGENT_URL + WORKER_API_TOKEN are set).
 * TEACH_BROWSER_PROVIDER=browser_use_cloud|self_hosted forces one.
 *
 * `teachAvailability()` is the cheap config check; `probeTeachWorker()`
 * actually reaches the worker (health + authenticated capabilities: can it
 * launch the recorder's browser, is the live view wired) and says exactly
 * what is wrong when it can't record.
 */
import { RECORDER_SCRIPT } from "./recorderScript";
import { cloudBrowserConfigured, probeCloudBrowser } from "./cloudBrowser";

export type TeachUnavailableReason = "config" | "unreachable" | "unauthorized" | "outdated" | "no_browser" | "no_live_view" | "no_credits";
export type TeachBrowserProvider = "browser_use_cloud" | "self_hosted";

export type TeachAvailability = { ok: true } | { ok: false; reason: "config" };

/** The worker protocol this SmartPR build expects (secure fill, proxied screenshots). */
export const TEACH_PROTOCOL = 2;

function workerUrl(): string | null {
  const url = process.env.SELF_HOSTED_AGENT_URL?.trim();
  return url ? url.replace(/\/$/, "") : null;
}

function workerToken(): string | null {
  return process.env.WORKER_API_TOKEN?.trim() || null;
}

/** Which browser Teach Clara / Fill with Clara use here (null = none configured). */
export function teachBrowserProvider(): TeachBrowserProvider | null {
  const forced = process.env.TEACH_BROWSER_PROVIDER?.trim();
  const selfHosted = Boolean(workerUrl() && workerToken());
  if (forced === "self_hosted") return selfHosted ? "self_hosted" : null;
  if (forced === "browser_use_cloud") return cloudBrowserConfigured() ? "browser_use_cloud" : null;
  if (cloudBrowserConfigured()) return "browser_use_cloud";
  return selfHosted ? "self_hosted" : null;
}

export function teachAvailability(): TeachAvailability {
  return teachBrowserProvider() ? { ok: true } : { ok: false, reason: "config" };
}

export interface TeachProbe {
  ok: boolean;
  reason: TeachUnavailableReason | null;
  /** Someone's teach/replay session holds the worker right now (pilot: one at a time). */
  busy: boolean;
  /** Person-facing explanation (bilingual) — no secrets, no internal URLs. */
  message: { en: string; es: string } | null;
  /** For the operator: which setting or service to fix. Never a secret value. */
  operator_hint: string | null;
  checked_at: string;
}

const MESSAGES: Record<TeachUnavailableReason, { en: string; es: string; hint: string }> = {
  config: {
    en: "Teach Clara needs SmartPR's recording browser, and it isn't connected on this site yet.",
    es: "Enseñarle a Clara necesita el navegador de grabación de SmartPR, y todavía no está conectado en este sitio.",
    hint: "Set BROWSER_USE_API_KEY for the SmartPR app (Browser Use Cloud browsers), or SELF_HOSTED_AGENT_URL + WORKER_API_TOKEN for the workers/browser-agent service.",
  },
  no_credits: {
    en: "Clara's recording browser is out of credits right now.",
    es: "El navegador de grabación de Clara no tiene créditos ahora mismo.",
    hint: "Browser Use returned 402 (insufficient credits or the API key's spend limit). Add credits or raise the limit in Browser Use Cloud.",
  },
  unreachable: {
    en: "Clara's recording browser isn't answering right now, so she can't watch you walk the portal.",
    es: "El navegador de grabación de Clara no responde ahora mismo, así que no puede verte recorrer el portal.",
    hint: "SELF_HOSTED_AGENT_URL did not answer GET /healthz. Check that the browser-agent worker is deployed and running.",
  },
  unauthorized: {
    en: "Clara's recording browser refused SmartPR's connection.",
    es: "El navegador de grabación de Clara rechazó la conexión de SmartPR.",
    hint: "WORKER_API_TOKEN in the SmartPR app does not match the worker's WORKER_API_TOKEN.",
  },
  outdated: {
    en: "Clara's recording browser needs an update before it can record safely.",
    es: "El navegador de grabación de Clara necesita una actualización antes de poder grabar de forma segura.",
    hint: "The worker has no /api/v4/capabilities (or an older teach protocol). Redeploy workers/browser-agent from this release.",
  },
  no_browser: {
    en: "Clara's recording browser is online but couldn't open a browser window.",
    es: "El navegador de grabación de Clara está en línea pero no pudo abrir una ventana del navegador.",
    hint: "The worker could not launch Chromium (see browserError in /api/v4/capabilities). Check the Playwright/Chromium install and CHROMIUM_PATH.",
  },
  no_live_view: {
    en: "Clara's recording browser is online, but you wouldn't be able to see it to walk the portal.",
    es: "El navegador de grabación de Clara está en línea, pero no podrías verlo para recorrer el portal.",
    hint: "Set PUBLIC_WORKER_URL on the worker and make sure noVNC (NOVNC_DIR) and the Xvfb display are available.",
  },
};

export function teachUnavailableMessage(reason: TeachUnavailableReason): { en: string; es: string } {
  const m = MESSAGES[reason];
  return { en: m.en, es: m.es };
}

function fail(reason: TeachUnavailableReason, detail?: string): TeachProbe {
  const m = MESSAGES[reason];
  return { ok: false, reason, busy: false, message: { en: m.en, es: m.es }, operator_hint: detail ? `${m.hint} (${detail})` : m.hint, checked_at: new Date().toISOString() };
}

const cache = globalThis as typeof globalThis & { __smartprTeachProbe?: { at: number; probe: TeachProbe } };

/**
 * Reach the worker and confirm it can record: GET /healthz, then the
 * authenticated GET /api/v4/capabilities (browser launch + live view).
 * Cached briefly (30 s when healthy, 10 s otherwise).
 */
export async function probeTeachWorker(opts: { fresh?: boolean; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<TeachProbe> {
  const hit = cache.__smartprTeachProbe;
  if (!opts.fresh && hit && Date.now() - hit.at < (hit.probe.ok ? 30_000 : 10_000)) return hit.probe;
  const probe = await runProbe(opts.fetchImpl ?? fetch, opts.timeoutMs ?? 6_000);
  cache.__smartprTeachProbe = { at: Date.now(), probe };
  return probe;
}

async function runProbe(fetchImpl: typeof fetch, timeoutMs: number): Promise<TeachProbe> {
  const provider = teachBrowserProvider();
  if (!provider) return fail("config");
  if (provider === "browser_use_cloud") {
    const r = await probeCloudBrowser(fetchImpl, timeoutMs);
    if (r.ok) return { ok: true, reason: null, busy: false, message: null, operator_hint: null, checked_at: new Date().toISOString() };
    if (r.status === 401 || r.status === 403) return { ...fail("unauthorized"), operator_hint: "Browser Use rejected BROWSER_USE_API_KEY (401/403). Check the key in the SmartPR app's environment." };
    if (r.status === 402) return fail("no_credits");
    return { ...fail("unreachable"), operator_hint: `Browser Use (api.browser-use.com) didn't answer (${r.status === 0 ? "network error" : `HTTP ${r.status}`}).` };
  }
  const url = workerUrl();
  const token = workerToken();
  if (!url || !token) return fail("config");
  try {
    const health = await fetchImpl(`${url}/healthz`, { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!health.ok) return fail("unreachable", `healthz HTTP ${health.status}`);
  } catch (err) {
    return fail("unreachable", (err as Error)?.name === "TimeoutError" ? "timed out" : "network error");
  }
  let caps: Record<string, unknown>;
  try {
    const res = await fetchImpl(`${url}/api/v4/capabilities`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs + 20_000), // the first call launches a browser to check it
    });
    if (res.status === 401 || res.status === 403) return fail("unauthorized");
    if (res.status === 404 || res.status === 405) return fail("outdated", "no capabilities endpoint");
    if (!res.ok) return fail("unreachable", `capabilities HTTP ${res.status}`);
    caps = (await res.json()) as Record<string, unknown>;
  } catch (err) {
    return fail("unreachable", (err as Error)?.name === "TimeoutError" ? "capabilities timed out" : "capabilities network error");
  }
  if (caps.teach !== true || caps.drive !== true || caps.secureFill !== true || Number(caps.protocol ?? 0) < TEACH_PROTOCOL) return fail("outdated", `protocol ${String(caps.protocol ?? "none")}`);
  const busy = caps.busy === true;
  // While busy the worker reports its last browser check (null = not checked yet).
  if (caps.browser === false) {
    const why = typeof caps.browserError === "string" ? caps.browserError.slice(0, 80) : undefined;
    return fail("no_browser", why === "no_display" ? "no X display: the worker's Xvfb (start.sh) isn't running or DISPLAY is unset" : why);
  }
  if (caps.liveView !== true) return fail("no_live_view");
  return { ok: true, reason: null, busy, message: null, operator_hint: null, checked_at: new Date().toISOString() };
}

/** Test seam. */
export function resetTeachProbeForTests(): void {
  delete cache.__smartprTeachProbe;
}

function base(): string {
  return `${workerUrl()}/api/v4/teach`;
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${workerToken()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** A worker call failed; `status` is the worker's HTTP status (0 = network). Never carries a value. */
export class TeachWorkerError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "TeachWorkerError";
  }
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, { ...init, headers: headers(), cache: "no-store" });
  } catch {
    throw new TeachWorkerError(0, "teach worker unreachable");
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new TeachWorkerError(res.status, `teach worker ${res.status}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function startWorkerTeach(input: { startUrl: string; allowedDomains: string[] }): Promise<{ sessionId: string; liveUrl: string | null }> {
  return call("", {
    method: "POST",
    body: JSON.stringify({ startUrl: input.startUrl, allowedDomains: input.allowedDomains, recorderScript: RECORDER_SCRIPT }),
  });
}

export async function fetchWorkerTeachEvents(sessionId: string, after: number): Promise<{ items: { seq: number; event: unknown; shot?: boolean }[]; nextAfter: number; status: string }> {
  return call(`/${encodeURIComponent(sessionId)}/events?after=${after}`, { method: "GET" });
}

export async function stopWorkerTeach(sessionId: string): Promise<void> {
  await call(`/${encodeURIComponent(sessionId)}/stop`, { method: "POST", body: "{}" });
}

/**
 * Type a one-time sensitive value into the live portal (the worker fills
 * the given field, else the focused / first empty sensitive field). The
 * value is sent once over the authenticated server-to-worker call and is
 * not kept anywhere.
 */
export async function secureFillWorker(sessionId: string, input: { value: string; selector: string | null }): Promise<{ ok: boolean; reason?: string }> {
  return call(`/${encodeURIComponent(sessionId)}/secure-fill`, { method: "POST", body: JSON.stringify({ value: input.value, selector: input.selector }) });
}

/** One per-step screenshot (JPEG), fetched server-side with the bearer token. */
export async function fetchWorkerTeachShot(sessionId: string, seq: number): Promise<ArrayBuffer | null> {
  const res = await fetch(`${base()}/${encodeURIComponent(sessionId)}/shots/${seq}`, { headers: { Authorization: `Bearer ${workerToken()}` }, cache: "no-store" }).catch(() => null);
  if (!res || !res.ok) return null;
  return res.arrayBuffer();
}
