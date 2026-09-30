/**
 * Server-only client for teach sessions on the self-hosted browser worker
 * (workers/browser-agent, /api/v4/teach/*). The worker opens a headed
 * browser on the same display the live viewer already streams, injects
 * RECORDER_SCRIPT into every page, and queues the recorder's events.
 *
 * Teach mode needs the self-hosted worker: Browser Use Cloud has no way to
 * inject a recorder. `teachAvailability()` says why when it's off.
 */
import { agentProvider } from "../browserUseClient";
import { RECORDER_SCRIPT } from "./recorderScript";

export type TeachAvailability = { ok: true } | { ok: false; reason: "provider" | "config" };

export function teachAvailability(): TeachAvailability {
  if (agentProvider() !== "self_hosted") return { ok: false, reason: "provider" };
  if (!process.env.SELF_HOSTED_AGENT_URL?.trim() || !process.env.WORKER_API_TOKEN?.trim()) return { ok: false, reason: "config" };
  return { ok: true };
}

function base(): string {
  return `${process.env.SELF_HOSTED_AGENT_URL!.trim().replace(/\/$/, "")}/api/v4/teach`;
}

function headers(): HeadersInit {
  return {
    Authorization: `Bearer ${process.env.WORKER_API_TOKEN!.trim()}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${base()}${path}`, { ...init, headers: headers(), cache: "no-store" });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`teach worker ${res.status}: ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function startWorkerTeach(input: { startUrl: string; allowedDomains: string[] }): Promise<{ sessionId: string; liveUrl: string | null }> {
  return call("", {
    method: "POST",
    body: JSON.stringify({ startUrl: input.startUrl, allowedDomains: input.allowedDomains, recorderScript: RECORDER_SCRIPT }),
  });
}

export async function fetchWorkerTeachEvents(sessionId: string, after: number): Promise<{ items: { seq: number; event: unknown }[]; nextAfter: number; status: string }> {
  return call(`/${encodeURIComponent(sessionId)}/events?after=${after}`, { method: "GET" });
}

export async function stopWorkerTeach(sessionId: string): Promise<void> {
  await call(`/${encodeURIComponent(sessionId)}/stop`, { method: "POST", body: "{}" });
}
