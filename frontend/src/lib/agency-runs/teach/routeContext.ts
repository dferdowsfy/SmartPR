/**
 * Shared plumbing for the teach-session and skill-library API routes:
 * who is asking (signed-in viewer, admin?, Partner plan?), where skills are
 * stored, the worker client, and error → HTTP mapping.
 */
import { getCurrentUser } from "../../supabase/server";
import { isUserAdmin } from "../../admin";
import { MemorySkillRepo, PgSkillRepo, SkillLibraryError, type SkillRepo, type SkillViewer } from "../skills/skillLibrary";
import { TeachSessionError, type TeachWorker } from "./teachSessions";
import { fetchWorkerTeachEvents, fetchWorkerTeachShot, secureFillWorker, startWorkerTeach, stopWorkerTeach } from "./teachWorkerClient";
import type { TeachTier } from "./teachSession";

export interface RouteViewer extends SkillViewer {
  tier: TeachTier;
}

/**
 * The signed-in viewer. The Partner-plan lookup (workspace bootstrap + plan
 * query) only runs when `withTier` is set — i.e. when a teach session
 * starts; the tier is stored on the session, so polls skip it.
 */
export async function currentViewer(opts: { withTier?: boolean } = {}): Promise<RouteViewer | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const isAdmin = await isUserAdmin(user.email);
  let tier: TeachTier = isAdmin ? "admin" : "user";
  if (!isAdmin && opts.withTier) {
    try {
      const { bootstrapPlatformUser } = await import("../../auth/bootstrap");
      const { getPool } = await import("../../../app/graph/db");
      const { getWorkspacePlanState } = await import("../../billing/access");
      const pool = getPool();
      const { workspaceId } = await bootstrapPlatformUser(user);
      if (pool && workspaceId) {
        const plan = await getWorkspacePlanState(pool, workspaceId);
        if (plan.planId === "partner" || plan.planId === "enterprise") tier = "partner";
      }
    } catch {
      // No database / workspace: teach as a regular user (private skills).
    }
  }
  return { userId: user.id, isAdmin, tier };
}

const globalRepo = globalThis as typeof globalThis & { __smartprSkillMemoryRepo?: MemorySkillRepo };

/** Postgres when configured; an in-process store otherwise (dev only). */
export async function skillRepo(): Promise<SkillRepo> {
  const { getPool, isEnabled } = await import("../../../app/graph/db");
  if (isEnabled()) {
    const { ensureSchema } = await import("../../../app/graph/store");
    await ensureSchema();
    const pool = getPool();
    if (pool) return new PgSkillRepo(pool);
  }
  if (!globalRepo.__smartprSkillMemoryRepo) globalRepo.__smartprSkillMemoryRepo = new MemorySkillRepo();
  return globalRepo.__smartprSkillMemoryRepo;
}

export const workerDeps: { worker: TeachWorker } = {
  worker: { start: startWorkerTeach, events: fetchWorkerTeachEvents, stop: stopWorkerTeach, secureFill: secureFillWorker, shot: fetchWorkerTeachShot },
};

export function unauthorized(): Response {
  return Response.json(
    { error: "sign_in_required", message: { en: "Sign in to teach Clara.", es: "Entra a tu cuenta para enseñarle a Clara." } },
    { status: 401 }
  );
}

export function errorResponse(err: unknown): Response {
  if (err instanceof TeachSessionError) {
    return Response.json({ error: err.code, message: err.message, detail: err.detail ?? null }, { status: err.status });
  }
  if (err && typeof err === "object" && (err as { name?: string }).name === "ReplayError") {
    const e = err as unknown as { status: number; code: string; message: string };
    return Response.json({ error: e.code, message: e.message }, { status: e.status });
  }
  if (err instanceof SkillLibraryError) {
    return Response.json({ error: err.code, message: err.message }, { status: err.status });
  }
  console.error("[teach] unexpected error:", (err as Error)?.message);
  return Response.json({ error: "server_error", message: "Something went wrong." }, { status: 500 });
}

export async function replayDeps(): Promise<import("../replay/replaySessions").ReplayDeps> {
  const { startWorkerDrive, stopWorkerDrive, WorkerDriver } = await import("../replay/workerDriver");
  const { agentRelocator } = await import("../replay/relocate");
  const { secureFillWorker } = await import("./teachWorkerClient");
  return { repo: await skillRepo(), startDrive: startWorkerDrive, stopDrive: stopWorkerDrive, driver: (id) => new WorkerDriver(id), relocate: agentRelocator(await modelPrompter(80)), secureFill: secureFillWorker };
}

/**
 * Labels-only model call for the routine reviewer and the drift relocator
 * (xAI, when configured). null when no model is configured.
 */
export async function modelPrompter(maxOutputTokens = 400): Promise<((p: { system: string; user: string }) => Promise<string>) | null> {
  const { isXaiConfigured, requestXaiText } = await import("../../../app/ai/xai");
  if (!isXaiConfigured()) return null;
  return async ({ system, user }) =>
    requestXaiText({
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxOutputTokens,
      temperature: 0,
      signal: AbortSignal.timeout(15_000),
    });
}
