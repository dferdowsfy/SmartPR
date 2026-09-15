/**
 * Server-only agent-provider client (Browser Use Cloud v3, or the self-hosted
 * browser-agent worker that runs the OSS browser-use library on your own xAI
 * model). Never import from client components — keeps API keys off the wire.
 *
 * Provider is chosen with AGENT_PROVIDER:
 *   "browser_use_cloud" (default) → https://api.browser-use.com/api/v3
 *   "self_hosted"               → SELF_HOSTED_AGENT_URL (the worker mirrors
 *                                 the Cloud v3 session paths, so the rest of
 *                                 this client is unchanged)
 */

const CLOUD_BASE_URL = "https://api.browser-use.com/api/v3";

export type AgentProvider = "browser_use_cloud" | "self_hosted";

/** Which agent backend SmartPR talks to. Defaults to Browser Use Cloud. */
export function agentProvider(): AgentProvider {
  return process.env.AGENT_PROVIDER?.trim() === "self_hosted"
    ? "self_hosted"
    : "browser_use_cloud";
}

/** Human label for the active provider (UI copy). */
export function agentProviderLabel(): string {
  return agentProvider() === "self_hosted"
    ? "self-hosted agent (Grok)"
    : "Browser Use Cloud";
}

function selfHostedBase(): string {
  const url = process.env.SELF_HOSTED_AGENT_URL?.trim().replace(/\/$/, "");
  if (!url) {
    throw new Error("SELF_HOSTED_AGENT_URL is not set");
  }
  return url;
}

function baseUrl(): string {
  return agentProvider() === "self_hosted" ? selfHostedBase() : CLOUD_BASE_URL;
}

/** Default model per provider: cheapest Cloud pick, or your own xAI model. */
function defaultModel(): string {
  if (agentProvider() === "self_hosted") {
    return process.env.XAI_MODEL?.trim() || "grok-4.3";
  }
  // Cheapest reliable Cloud model per 2026-09 cost research: gpt-5.6-luna
  // (~2.5x cheaper than bu-mini on output tokens, 78% bench accuracy).
  // Override per environment with BROWSER_USE_MODEL if needed.
  return process.env.BROWSER_USE_MODEL?.trim() || "gpt-5.6-luna";
}

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

/** True when env has what the active provider needs (mock is fallback otherwise). */
export function isBrowserUseConfigured(): boolean {
  if (agentProvider() === "self_hosted") {
    return Boolean(
      process.env.SELF_HOSTED_AGENT_URL?.trim() && process.env.WORKER_API_TOKEN?.trim()
    );
  }
  return Boolean(apiKey());
}

function authHeaders(): HeadersInit {
  if (agentProvider() === "self_hosted") {
    const token = process.env.WORKER_API_TOKEN?.trim();
    if (!token) {
      throw new Error("WORKER_API_TOKEN is not set");
    }
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }
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
  const workerToken = process.env.WORKER_API_TOKEN?.trim();
  if (workerToken) text = text.split(workerToken).join("[redacted]");
  return text.slice(0, 500);
}

async function buFetch<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${baseUrl()}${path}`, {
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
      `Agent ${init?.method || "GET"} ${path} → ${response.status}: ${body.slice(0, 300)}`
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
  /** Deterministic domain allowlist — enforced by the self-hosted worker. */
  allowedDomains?: string[];
}): Promise<BuSession> {
  const raw = await buFetch<Record<string, unknown>>("/sessions", {
    method: "POST",
    body: JSON.stringify({
      task: input.task,
      keepAlive: input.keepAlive ?? true,
      // Puerto Rico Hacienda portal — US residential proxy is appropriate (Cloud).
      proxyCountryCode: input.proxyCountryCode ?? "us",
      model: defaultModel(),
      allowedDomains: input.allowedDomains ?? [],
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
