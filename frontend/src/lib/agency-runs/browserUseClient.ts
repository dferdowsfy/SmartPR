/**
 * Server-only Browser Use Cloud (API v3) client.
 * Never import from client components — keeps BROWSER_USE_API_KEY off the wire.
 */

const BASE_URL = "https://api.browser-use.com/api/v3";

export type BuSessionStatus =
  | "created"
  | "idle"
  | "running"
  | "stopped"
  | "timed_out"
  | "error";

export interface BuSession {
  id: string;
  status: BuSessionStatus;
  liveUrl?: string | null;
  screenshotUrl?: string | null;
  lastStepSummary?: string | null;
  output?: unknown;
  isTaskSuccessful?: boolean | null;
  stepCount?: number;
  title?: string | null;
}

export interface BuMessage {
  id: string;
  sessionId?: string;
  role: string;
  data?: unknown;
  summary?: string | null;
  createdAt?: string;
}

function apiKey(): string | null {
  const key = process.env.BROWSER_USE_API_KEY?.trim();
  return key ? key : null;
}

/** True when Railway / local env has a Browser Use key (mock is fallback otherwise). */
export function isBrowserUseConfigured(): boolean {
  return Boolean(apiKey());
}

function authHeaders(): HeadersInit {
  const key = apiKey();
  if (!key) {
    throw new Error("BROWSER_USE_API_KEY is not set");
  }
  return {
    "X-Browser-Use-API-Key": key,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Strip secrets from error text before logging. */
export function sanitizeError(err: unknown): string {
  let text = err instanceof Error ? err.message : String(err);
  const key = apiKey();
  if (key) text = text.split(key).join("[redacted]");
  return text.slice(0, 500);
}

async function buFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Browser Use ${init?.method || "GET"} ${path} → ${response.status}: ${body.slice(0, 300)}`
    );
  }
  return (await response.json()) as T;
}

function normalizeSession(raw: Record<string, unknown>): BuSession {
  return {
    id: String(raw.id),
    status: raw.status as BuSessionStatus,
    liveUrl: (raw.liveUrl ?? raw.live_url ?? null) as string | null,
    screenshotUrl: (raw.screenshotUrl ?? raw.screenshot_url ?? null) as string | null,
    lastStepSummary: (raw.lastStepSummary ?? raw.last_step_summary ?? null) as string | null,
    output: raw.output ?? null,
    isTaskSuccessful: (raw.isTaskSuccessful ?? raw.is_task_successful ?? null) as boolean | null,
    stepCount: Number(raw.stepCount ?? raw.step_count ?? 0),
    title: (raw.title ?? null) as string | null,
  };
}

export async function createBrowserUseSession(input: {
  task: string;
  keepAlive?: boolean;
  proxyCountryCode?: string;
}): Promise<BuSession> {
  const raw = await buFetch<Record<string, unknown>>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      task: input.task,
      keepAlive: input.keepAlive ?? true,
      // Puerto Rico Hacienda portal — US residential proxy is appropriate.
      proxyCountryCode: input.proxyCountryCode ?? "us",
      // Cheapest reliable model per 2026-09 cost research: gpt-5.6-luna
      // (~2.5x cheaper than bu-mini on output tokens, 78% bench accuracy).
      // Override per environment with BROWSER_USE_MODEL if needed.
      model: process.env.BROWSER_USE_MODEL?.trim() || "gpt-5.6-luna",
    }),
  });
  return normalizeSession(raw);
}

export async function getBrowserUseSession(sessionId: string): Promise<BuSession> {
  const raw = await buFetch<Record<string, unknown>>(`/sessions/${sessionId}`);
  return normalizeSession(raw);
}

/** Destroy the sandbox (default) or stop only the running task. */
export async function stopBrowserUseSession(
  sessionId: string,
  strategy: "session" | "task" = "session"
): Promise<BuSession> {
  const raw = await buFetch<Record<string, unknown>>(`/sessions/${sessionId}/stop`, {
    method: "POST",
    body: JSON.stringify({ strategy }),
  });
  return normalizeSession(raw);
}

/** Dispatch a follow-up task onto an idle keepAlive session. */
export async function dispatchBrowserUseTask(
  sessionId: string,
  task: string
): Promise<BuSession> {
  const raw = await buFetch<Record<string, unknown>>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      sessionId,
      task,
      keepAlive: true,
    }),
  });
  return normalizeSession(raw);
}

export async function listBrowserUseMessages(
  sessionId: string,
  opts?: { after?: string; limit?: number }
): Promise<{ items: BuMessage[]; nextCursor?: string | null }> {
  const params = new URLSearchParams();
  if (opts?.after) params.set("after", opts.after);
  if (opts?.limit) params.set("pageSize", String(opts.limit));
  const qs = params.toString();
  const raw = await buFetch<{
    items?: BuMessage[];
    nextCursor?: string | null;
    next_cursor?: string | null;
  }>(`/sessions/${sessionId}/messages${qs ? `?${qs}` : ""}`);
  return {
    items: raw.items || [],
    nextCursor: raw.nextCursor ?? raw.next_cursor ?? null,
  };
}
