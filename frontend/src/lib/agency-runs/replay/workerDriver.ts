/**
 * Server-only PortalDriver over the self-hosted worker's /api/v4/drive
 * endpoints — the replay engine runs in SmartPR's server; the worker only
 * executes primitives in the user's replay browser (live view).
 */
import type { LocateResult, PageSnapshot, PortalDriver } from "./engine";
import { DRIVER_SCRIPT } from "./driverScript";

function base(): string {
  return `${process.env.SELF_HOSTED_AGENT_URL!.trim().replace(/\/$/, "")}/api/v4/drive`;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WORKER_API_TOKEN!.trim()}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`drive worker ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return (await res.json()) as T;
}

export async function startWorkerDrive(input: { startUrl: string; allowedDomains: string[] }): Promise<{ sessionId: string; liveUrl: string | null }> {
  return post("", { startUrl: input.startUrl, allowedDomains: input.allowedDomains, driverScript: DRIVER_SCRIPT });
}

export async function stopWorkerDrive(sessionId: string): Promise<void> {
  await post(`/${encodeURIComponent(sessionId)}/stop`, {});
}

export class WorkerDriver implements PortalDriver {
  constructor(private sessionId: string) {}
  private call<T>(body: Record<string, unknown>): Promise<T> {
    return post<T>(`/${encodeURIComponent(this.sessionId)}/call`, body);
  }
  snapshot(): Promise<PageSnapshot> {
    return this.call({ op: "snapshot" });
  }
  locate(target: { role: string; label: string; selector?: string | null }): Promise<LocateResult> {
    return this.call({ op: "locate", target: { role: target.role, label: target.label, selector: target.selector ?? null } });
  }
  async fill(ref: string, value: string): Promise<void> {
    await this.call({ op: "fill", ref, value });
  }
  async selectOption(ref: string, optionLabel: string): Promise<boolean> {
    return (await this.call<{ ok: boolean }>({ op: "selectOption", ref, value: optionLabel })).ok;
  }
  async click(ref: string): Promise<void> {
    await this.call({ op: "click", ref });
  }
  async settle(): Promise<void> {
    await this.call({ op: "settle" });
  }
}
