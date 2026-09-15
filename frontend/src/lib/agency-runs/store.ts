/**
 * In-memory agency_runs store.
 *
 * Persistence is a process-local Map (keyed by run id).
 * Worker: agent provider (Browser Use Cloud by default, or the self-hosted
 * browser-agent worker when AGENT_PROVIDER=self_hosted); otherwise mock timeline.
 */
import { randomUUID } from "crypto";
import {
  agentProvider,
  agentProviderLabel,
  cancelAgentRun,
  createAgentRun,
  getAgentRun,
  isBrowserUseConfigured,
  listAgentRunEvents,
  queueAgentMessage,
  sanitizeError,
  stopAgentBrowser,
  type BuEvent,
  type BuRun,
} from "./browserUseClient";
import { timelineFor, type MockBeat } from "./mockTimeline";
import { getFilingConfig, AGENCY_FILING_CONFIGS } from "./filingTypes";
import { PLACEHOLDER_SHOTS } from "./placeholders";
import { buildResumeTaskPrompt, buildAgencyTaskPrompt } from "./taskPrompt";
import type {
  AgencyFilingType,
  AgencyPauseReason,
  AgencyRun,
  AgencyRunEvent,
  AgencyRunPublic,
  AgencyRunStatus,
} from "./types";

const globalStore = globalThis as typeof globalThis & {
  __smartprAgencyRuns?: Map<string, AgencyRun>;
};

function runs(): Map<string, AgencyRun> {
  if (!globalStore.__smartprAgencyRuns) {
    globalStore.__smartprAgencyRuns = new Map();
  }
  return globalStore.__smartprAgencyRuns;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toPublic(run: AgencyRun): AgencyRunPublic {
  return {
    id: run.id,
    business_id: run.business_id,
    filing_type: run.filing_type,
    status: run.status,
    pause_reason: run.pause_reason,
    created_at: run.created_at,
    updated_at: run.updated_at,
    events: run.events,
    worker: run.worker,
    live_url: run.live_url,
    browser_use_session_id: run.browser_use_session_id,
    provider: run.worker === "browser_use" ? agentProvider() : "mock",
  };
}

function pushEvent(
  run: AgencyRun,
  partial: Omit<AgencyRunEvent, "index" | "created_at"> & { created_at?: string }
): AgencyRunEvent {
  const event: AgencyRunEvent = {
    index: run.events.length,
    message: partial.message,
    message_es: partial.message_es,
    screenshot_url: partial.screenshot_url,
    created_at: partial.created_at || nowIso(),
    kind: partial.kind,
  };
  run.events.push(event);
  return event;
}

function pushBeat(run: AgencyRun, beat: MockBeat): AgencyRunEvent {
  return pushEvent(run, {
    message: beat.message,
    message_es: beat.message_es,
    screenshot_url: PLACEHOLDER_SHOTS[beat.shot],
    kind: beat.kind === "step" ? "info" : beat.kind,
  });
}

/** Apply any mock beats whose delay has elapsed since segment_started_at. */
export function advanceMock(run: AgencyRun): AgencyRun {
  if (run.worker !== "mock") return run;
  if (run.status === "stopped" || run.status === "failed" || run.status === "review") {
    return run;
  }
  if (run.status === "paused") {
    return run;
  }

  const script = timelineFor(getFilingConfig(run.filing_type));
  let cursor = run.mock_cursor;
  let segmentStart = new Date(run.segment_started_at).getTime();
  const now = Date.now();

  if (run.status === "queued") {
    run.status = "running";
    run.updated_at = nowIso();
  }

  while (cursor < script.length) {
    const beat = script[cursor];
    const due = segmentStart + beat.delayMs;
    if (now < due) break;

    pushBeat(run, beat);
    cursor += 1;
    segmentStart = due;
    run.mock_cursor = cursor;
    run.segment_started_at = new Date(segmentStart).toISOString();
    run.updated_at = nowIso();

    if (beat.kind === "pause") {
      run.status = "paused";
      run.pause_reason = beat.pause_reason;
      break;
    }
    if (beat.kind === "review") {
      run.status = "review";
      run.pause_reason = null;
      break;
    }
    run.status = "running";
    run.pause_reason = null;
  }

  return run;
}

function detectMarker(text: string): {
  status?: AgencyRunStatus;
  pause_reason?: AgencyPauseReason;
} {
  const upper = text.toUpperCase();
  if (upper.includes("PAUSE_USER_UPLOAD") || /\bUSER_UPLOAD\b/.test(upper)) {
    return { status: "paused", pause_reason: "USER_UPLOAD" };
  }
  if (
    upper.includes("PAUSE_USER_LOGIN") ||
    /\bUSER_LOGIN\b/.test(upper) ||
    (upper.includes("PAUSE") && (upper.includes("LOGIN") || upper.includes("MFA")))
  ) {
    return { status: "paused", pause_reason: "USER_LOGIN" };
  }
  if (upper.includes("PAUSE_CAPTCHA") || (upper.includes("PAUSE") && upper.includes("CAPTCHA"))) {
    return { status: "paused", pause_reason: "CAPTCHA" };
  }
  if (upper.includes("PAUSE_PAYMENT") || (upper.includes("PAUSE") && upper.includes("PAYMENT"))) {
    return { status: "paused", pause_reason: "PAYMENT" };
  }
  if (upper.includes("REVIEW_READY")) {
    return { status: "review", pause_reason: null };
  }
  if (upper.includes("FAILED:")) {
    return { status: "failed", pause_reason: null };
  }
  return {};
}

/**
 * v4 run → SmartPR run mapping. The run is one agent turn; terminal statuses
 * are decided by the marker protocol in the result/events (PAUSE_*,
 * REVIEW_READY, FAILED:) so the agent never clicks final submit unapproved.
 */
function applyRunStatus(run: AgencyRun, bu: BuRun, events: BuEvent[]): void {
  if (bu.liveUrl) run.live_url = bu.liveUrl;

  // Latest agent text: worker exposes lastStepSummary; Cloud derives from events.
  const latestText =
    bu.lastStepSummary ||
    [...events].reverse().find((e) => e.text)?.text ||
    run.bu_last_step ||
    null;

  // Privacy: while the user has taken over for portal login/MFA, never persist
  // live screenshots. The credential-entry flow must not be stored in the
  // event log, shown in the filmstrip, or visible to anyone but the owner —
  // admins included. A neutral placeholder is recorded instead.
  const loginTakeover =
    run.pause_reason === "USER_LOGIN" ||
    (latestText ? /PAUSE_USER_LOGIN/.test(latestText.toUpperCase()) : false);

  const shot = loginTakeover
    ? PLACEHOLDER_SHOTS.login
    : bu.screenshotUrl ||
      run.events[run.events.length - 1]?.screenshot_url ||
      PLACEHOLDER_SHOTS.home;

  if (latestText && latestText !== run.bu_last_step) {
    run.bu_last_step = latestText;
    pushEvent(run, {
      message: latestText,
      message_es: latestText,
      screenshot_url: shot,
      kind: "info",
    });
    const marker = detectMarker(latestText);
    if (marker.status === "paused") {
      run.status = "paused";
      run.pause_reason = marker.pause_reason ?? null;
    } else if (marker.status === "review") {
      run.status = "review";
      run.pause_reason = null;
    } else if (marker.status === "failed") {
      run.status = "failed";
      run.pause_reason = null;
    }
  }

  if (run.status === "queued" && (bu.status === "running" || bu.status === "dispatching")) {
    run.status = "running";
  }

  if (bu.status === "running" && run.status !== "paused" && run.status !== "review") {
    run.status = "running";
    run.pause_reason = null;
  }

  if (bu.status === "completed") {
    // Marker already decided (paused/review/failed from step text) — leave it.
    if (run.status !== "paused" && run.status !== "review" && run.status !== "failed") {
      const out = `${bu.result || ""}\n${latestText || ""}`;
      const marker = detectMarker(out);
      if (marker.status === "paused") {
        run.status = "paused";
        run.pause_reason = marker.pause_reason ?? null;
        pushEvent(run, {
          message: out.trim() || "Paused — waiting for your action on the live browser",
          message_es: out.trim() || "Pausado — esperando su acción en el navegador en vivo",
          screenshot_url: shot,
          kind: "pause",
        });
      } else if (marker.status === "failed") {
        run.status = "failed";
        run.pause_reason = null;
        pushEvent(run, {
          message: out.trim() || "Agent reported a failure",
          message_es: out.trim() || "El agente reportó un error",
          screenshot_url: shot,
          kind: "info",
        });
      } else {
        // Turn finished with no pause marker — agent prepared the filing;
        // the user reviews and submits on the portal.
        run.status = "review";
        run.pause_reason = null;
        const portal = getFilingConfig(run.filing_type).portalEn;
        pushEvent(run, {
          message: out.trim() || `Turn complete — review the live browser before submitting on ${portal}.`,
          message_es: out.trim() || `Turno completo — revise el navegador en vivo antes de enviar en ${portal}.`,
          screenshot_url: shot,
          kind: "review",
        });
      }
    }
  }

  if (bu.status === "failed") {
    run.status = "failed";
    run.pause_reason = null;
    pushEvent(run, {
      message: bu.error ? `Agent run failed: ${bu.error}` : "Agent run failed",
      message_es: bu.error ? `El agente falló: ${bu.error}` : "El agente falló",
      screenshot_url: shot,
      kind: "info",
    });
  }

  if (bu.status === "cancelled") {
    run.status = "stopped";
    run.pause_reason = null;
    run.live_url = null;
  }

  run.updated_at = nowIso();
}

async function syncBrowserUse(run: AgencyRun): Promise<AgencyRun> {
  if (!run.browser_use_run_id) return run;
  if (run.status === "stopped" || run.status === "failed") return run;

  try {
    const bu = await getAgentRun(run.browser_use_run_id);

    // Append new agent events as step-log events when feasible.
    let events: BuEvent[] = [];
    try {
      const page = await listAgentRunEvents(run.browser_use_run_id, {
        after: run.bu_message_cursor || undefined,
        limit: 25,
      });
      events = page.events;
      if (page.nextAfter) run.bu_message_cursor = page.nextAfter;
      else if (events.length > 0) run.bu_message_cursor = events[events.length - 1].id;
    } catch {
      // Events endpoint optional — run poll still drives status.
    }

    applyRunStatus(run, bu, events);

    for (const ev of events) {
      // Skip the latest-step text we already logged in applyRunStatus.
      if (ev.text === run.bu_last_step) continue;
      const marker = detectMarker(ev.text);
      pushEvent(run, {
        message: ev.text.slice(0, 500),
        message_es: ev.text.slice(0, 500),
        screenshot_url: run.events[run.events.length - 1]?.screenshot_url || PLACEHOLDER_SHOTS.home,
        kind: marker.status === "paused" ? "pause" : marker.status === "review" ? "review" : "info",
      });
      if (marker.status === "paused") {
        run.status = "paused";
        run.pause_reason = marker.pause_reason ?? null;
      } else if (marker.status === "review") {
        run.status = "review";
        run.pause_reason = null;
      } else if (marker.status === "failed") {
        run.status = "failed";
        run.pause_reason = null;
      }
    }
  } catch (err) {
    pushEvent(run, {
      message: `Sync error: ${sanitizeError(err)}`,
      message_es: `Error de sincronización: ${sanitizeError(err)}`,
      screenshot_url: run.events[run.events.length - 1]?.screenshot_url || PLACEHOLDER_SHOTS.home,
      kind: "info",
    });
    // Do not flip to failed on a single poll blip.
    run.updated_at = nowIso();
  }

  return run;
}

export async function createRun(input: {
  business_id: string;
  filing_type: AgencyFilingType;
  owner_user_id?: string | null;
  passport?: Record<string, unknown> | null;
}): Promise<AgencyRunPublic> {
  const created = nowIso();
  const useBu = isBrowserUseConfigured();

  const run: AgencyRun = {
    id: randomUUID(),
    business_id: input.business_id,
    filing_type: input.filing_type,
    status: "queued",
    pause_reason: null,
    created_at: created,
    updated_at: created,
    mock_cursor: 0,
    segment_started_at: created,
    events: [],
    worker: useBu ? "browser_use" : "mock",
    browser_use_session_id: null,
    browser_use_run_id: null,
    live_url: null,
    owner_user_id: input.owner_user_id || null,
    bu_message_cursor: null,
    bu_last_step: null,
    passport_snapshot: input.passport || null,
  };

  if (useBu) {
    const filingConfig = getFilingConfig(input.filing_type);
    pushEvent(run, {
      message: `Starting ${agentProviderLabel()} session for ${filingConfig.portalEn}…`,
      message_es: `Iniciando sesión de ${agentProviderLabel()} para ${filingConfig.portalEs}…`,
      screenshot_url: PLACEHOLDER_SHOTS.home,
      kind: "info",
    });
    try {
      const task = buildAgencyTaskPrompt({
        config: filingConfig,
        passport: input.passport || null,
      });
      const buRun = await createAgentRun({
        task,
        allowedDomains: filingConfig.domains,
      });
      run.browser_use_run_id = buRun.id;
      run.browser_use_session_id = buRun.sessionId;
      run.live_url = buRun.liveUrl || null;
      run.status = buRun.status === "queued" ? "queued" : "running";
      pushEvent(run, {
        message: buRun.liveUrl
          ? "Live browser ready — embed preview active"
          : "Agent run created — waiting for live preview",
        message_es: buRun.liveUrl
          ? "Navegador en vivo listo — vista previa activa"
          : "Ejecución del agente creada — esperando vista previa",
        screenshot_url: buRun.screenshotUrl || PLACEHOLDER_SHOTS.home,
        kind: "info",
      });
      if (buRun.lastStepSummary) {
        run.bu_last_step = buRun.lastStepSummary;
        pushEvent(run, {
          message: buRun.lastStepSummary,
          message_es: buRun.lastStepSummary,
          screenshot_url: buRun.screenshotUrl || PLACEHOLDER_SHOTS.home,
          kind: "info",
        });
      }
    } catch (err) {
      run.status = "failed";
      pushEvent(run, {
        message: `Failed to start ${agentProviderLabel()}: ${sanitizeError(err)}`,
        message_es: `No se pudo iniciar ${agentProviderLabel()}: ${sanitizeError(err)}`,
        screenshot_url: PLACEHOLDER_SHOTS.stopped,
        kind: "info",
      });
    }
    runs().set(run.id, run);
    return toPublic(run);
  }

  // Mock fallback
  pushEvent(run, {
    message: "Run queued — mock agency worker starting…",
    message_es: "Ejecución en cola — el trabajador simulado está iniciando…",
    screenshot_url: PLACEHOLDER_SHOTS.home,
    kind: "info",
  });
  run.mock_cursor = 0;
  runs().set(run.id, run);
  return toPublic(advanceMock(run));
}

export async function getRun(id: string): Promise<AgencyRunPublic | null> {
  const run = runs().get(id);
  if (!run) return null;
  if (run.worker === "browser_use") {
    return toPublic(await syncBrowserUse(run));
  }
  return toPublic(advanceMock(run));
}

/** Internal accessor for ownership checks. */
export function peekRun(id: string): AgencyRun | null {
  return runs().get(id) || null;
}

export async function resumeRun(id: string): Promise<AgencyRunPublic | null> {
  const run = runs().get(id);
  if (!run) return null;

  if (run.worker === "browser_use") {
    if (run.status !== "paused" && run.status !== "running") {
      return toPublic(await syncBrowserUse(run));
    }
    const prevPause = run.pause_reason;
    run.status = "running";
    run.pause_reason = null;
    run.updated_at = nowIso();
    pushEvent(run, {
      message: "Resumed by user — continuing assisted filing",
      message_es: "Reanudado por el usuario — continuando el trámite asistido",
      screenshot_url: run.events[run.events.length - 1]?.screenshot_url || PLACEHOLDER_SHOTS.home,
      kind: "info",
    });
    if (run.browser_use_session_id && run.browser_use_run_id) {
      try {
        const bu = await getAgentRun(run.browser_use_run_id);
        if (bu.status === "completed" || bu.status === "failed" || bu.status === "cancelled") {
          // Follow-up turn on the same session with the resume brief.
          const queued = await queueAgentMessage(
            run.browser_use_session_id,
            buildResumeTaskPrompt({
              config: getFilingConfig(run.filing_type),
              pauseReason: prevPause,
            })
          );
          if (queued.runId) run.browser_use_run_id = queued.runId;
        }
        // If still running, human used live view; keep syncing.
      } catch (err) {
        pushEvent(run, {
          message: `Resume dispatch warning: ${sanitizeError(err)}`,
          message_es: `Aviso al reanudar: ${sanitizeError(err)}`,
          screenshot_url: run.events[run.events.length - 1]?.screenshot_url || PLACEHOLDER_SHOTS.home,
          kind: "info",
        });
      }
    }
    return toPublic(await syncBrowserUse(run));
  }

  if (run.status !== "paused") {
    return toPublic(advanceMock(run));
  }
  run.status = "running";
  run.pause_reason = null;
  run.segment_started_at = nowIso();
  run.updated_at = nowIso();
  pushEvent(run, {
    message: "Resumed by user — continuing assisted filing",
    message_es: "Reanudado por el usuario — continuando el trámite asistido",
    screenshot_url: run.events[run.events.length - 1]?.screenshot_url || PLACEHOLDER_SHOTS.home,
    kind: "info",
  });
  return toPublic(advanceMock(run));
}

export async function stopRun(id: string): Promise<AgencyRunPublic | null> {
  const run = runs().get(id);
  if (!run) return null;

  // Best-effort cleanup: cancel the run, then stop the browser so billing ends.
  // (Cloud keeps billing the browser until it is explicitly stopped.)
  const buRunId = run.browser_use_run_id;
  const buSessionId = run.browser_use_session_id;
  async function cleanupProvider(): Promise<void> {
    if (buRunId) {
      try {
        await cancelAgentRun(buRunId);
      } catch {
        // best-effort cleanup
      }
    }
    if (buSessionId) {
      try {
        await stopAgentBrowser(buSessionId);
      } catch {
        // best-effort cleanup
      }
    }
  }

  if (run.status === "stopped" || run.status === "review") {
    if (run.worker === "browser_use" && run.status === "review") {
      await cleanupProvider();
      run.status = "stopped";
      run.updated_at = nowIso();
    }
    return toPublic(run);
  }

  if (run.worker === "browser_use") {
    await cleanupProvider();
  }

  run.status = "stopped";
  run.pause_reason = null;
  run.updated_at = nowIso();
  pushEvent(run, {
    message: "Run stopped by user",
    message_es: "Ejecución detenida por el usuario",
    screenshot_url: PLACEHOLDER_SHOTS.stopped,
    kind: "info",
  });
  run.live_url = null;
  return toPublic(run);
}

export const FILING_TYPES: AgencyFilingType[] = AGENCY_FILING_CONFIGS.map((c) => c.id);

export function isFilingType(value: string): value is AgencyFilingType {
  return (FILING_TYPES as string[]).includes(value);
}

export function assertRunOwner(run: AgencyRun, userId: string | null): boolean {
  // If we never recorded an owner (auth off / anonymous demo), allow.
  if (!run.owner_user_id) return true;
  // live_url is session-scoped credential — require matching owner when known.
  if (!userId) return false;
  return run.owner_user_id === userId;
}

export type { AgencyRunStatus };
