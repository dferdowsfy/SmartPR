/**
 * In-memory agency_runs store.
 *
 * Persistence is a process-local Map (keyed by run id).
 * Worker: Browser Use Cloud when BROWSER_USE_API_KEY is set; otherwise mock timeline.
 */
import { randomUUID } from "crypto";
import {
  createBrowserUseSession,
  dispatchBrowserUseTask,
  getBrowserUseSession,
  isBrowserUseConfigured,
  listBrowserUseMessages,
  sanitizeError,
  stopBrowserUseSession,
  type BuSession,
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

function messageText(msg: { summary?: string | null; data?: unknown; role?: string }): string {
  if (msg.summary && String(msg.summary).trim()) return String(msg.summary).trim();
  if (typeof msg.data === "string") return msg.data.trim();
  if (msg.data && typeof msg.data === "object") {
    const d = msg.data as Record<string, unknown>;
    if (typeof d.text === "string") return d.text.trim();
    if (typeof d.content === "string") return d.content.trim();
    try {
      return JSON.stringify(msg.data).slice(0, 400);
    } catch {
      return "";
    }
  }
  return "";
}

function applySessionStatus(run: AgencyRun, session: BuSession): void {
  if (session.liveUrl) run.live_url = session.liveUrl;

  // Privacy: while the user has taken over for portal login/MFA, never persist
  // live screenshots. The credential-entry flow must not be stored in the
  // event log, shown in the filmstrip, or visible to anyone but the owner —
  // admins included. A neutral placeholder is recorded instead.
  const loginTakeover =
    run.pause_reason === "USER_LOGIN" ||
    (session.lastStepSummary
      ? /PAUSE_USER_LOGIN/.test(session.lastStepSummary.toUpperCase())
      : false);

  const shot = loginTakeover
    ? PLACEHOLDER_SHOTS.login
    : session.screenshotUrl ||
      run.events[run.events.length - 1]?.screenshot_url ||
      PLACEHOLDER_SHOTS.home;

  if (session.lastStepSummary && session.lastStepSummary !== run.bu_last_step) {
    run.bu_last_step = session.lastStepSummary;
    pushEvent(run, {
      message: session.lastStepSummary,
      message_es: session.lastStepSummary,
      screenshot_url: shot,
      kind: "info",
    });
    const marker = detectMarker(session.lastStepSummary);
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

  if (run.status === "queued" && (session.status === "running" || session.status === "created")) {
    run.status = "running";
  }

  if (session.status === "running" && run.status !== "paused" && run.status !== "review") {
    run.status = "running";
    run.pause_reason = null;
  }

  if (
    (session.status === "idle" || session.status === "stopped") &&
    run.status !== "paused" &&
    run.status !== "review" &&
    run.status !== "stopped"
  ) {
    const out =
      typeof session.output === "string"
        ? session.output
        : session.output
          ? JSON.stringify(session.output)
          : "";
    const marker = detectMarker(`${out}\n${session.lastStepSummary || ""}`);
    if (marker.status === "paused") {
      run.status = "paused";
      run.pause_reason = marker.pause_reason ?? null;
      pushEvent(run, {
        message: out || "Paused — waiting for your action on the live browser",
        message_es: out || "Pausado — esperando su acción en el navegador en vivo",
        screenshot_url: shot,
        kind: "pause",
      });
    } else if (marker.status === "review" || session.isTaskSuccessful === true) {
      run.status = "review";
      run.pause_reason = null;
      pushEvent(run, {
        message: out || "Review ready — you submit on the portal. Agent never clicks final submit.",
        message_es: out || "Revisión lista — usted envía en el portal. El agente nunca hace clic en enviar.",
        screenshot_url: shot,
        kind: "review",
      });
    } else if (session.status === "idle" && (session.stepCount || 0) > 0) {
      // keepAlive idle after task without explicit marker — land on review
      run.status = "review";
      run.pause_reason = null;
      const portal = getFilingConfig(run.filing_type).portalEn;
      pushEvent(run, {
        message: out || `Session idle — review the live browser before submitting on ${portal}.`,
        message_es: out || `Sesión inactiva — revise el navegador en vivo antes de enviar en ${portal}.`,
        screenshot_url: shot,
        kind: "review",
      });
    } else if (session.status === "stopped") {
      run.status = "stopped";
      run.pause_reason = null;
      run.live_url = null;
    }
  }

  if (session.status === "error" || session.status === "timed_out") {
    run.status = "failed";
    run.pause_reason = null;
    pushEvent(run, {
      message: `Browser Use session ${session.status}`,
      message_es: `Sesión Browser Use: ${session.status}`,
      screenshot_url: shot,
      kind: "info",
    });
  }

  run.updated_at = nowIso();
}

async function syncBrowserUse(run: AgencyRun): Promise<AgencyRun> {
  if (!run.browser_use_session_id) return run;
  if (run.status === "stopped" || run.status === "failed") return run;

  try {
    const session = await getBrowserUseSession(run.browser_use_session_id);
    applySessionStatus(run, session);

    // Append new AI messages as step-log events when feasible.
    try {
      const { items } = await listBrowserUseMessages(run.browser_use_session_id, {
        after: run.bu_message_cursor || undefined,
        limit: 20,
      });
      for (const msg of items) {
        run.bu_message_cursor = msg.id;
        if (String(msg.role).toLowerCase() === "human") continue;
        const text = messageText(msg);
        if (!text) continue;
        // Skip duplicates of lastStepSummary we already logged.
        if (text === run.bu_last_step) continue;
        const shot =
          session.screenshotUrl ||
          run.events[run.events.length - 1]?.screenshot_url ||
          PLACEHOLDER_SHOTS.home;
        const marker = detectMarker(text);
        pushEvent(run, {
          message: text.slice(0, 500),
          message_es: text.slice(0, 500),
          screenshot_url: shot,
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
    } catch {
      // Messages endpoint optional — session poll still drives status.
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
    live_url: null,
    owner_user_id: input.owner_user_id || null,
    bu_message_cursor: null,
    bu_last_step: null,
    passport_snapshot: input.passport || null,
  };

  if (useBu) {
    const filingConfig = getFilingConfig(input.filing_type);
    pushEvent(run, {
      message: `Starting Browser Use Cloud session for ${filingConfig.portalEn}…`,
      message_es: `Iniciando sesión de Browser Use Cloud para ${filingConfig.portalEs}…`,
      screenshot_url: PLACEHOLDER_SHOTS.home,
      kind: "info",
    });
    try {
      const task = buildAgencyTaskPrompt({
        config: filingConfig,
        passport: input.passport || null,
      });
      const session = await createBrowserUseSession({ task, keepAlive: true });
      run.browser_use_session_id = session.id;
      run.live_url = session.liveUrl || null;
      run.status = session.status === "running" || session.status === "created" ? "running" : "queued";
      pushEvent(run, {
        message: session.liveUrl
          ? "Live browser ready — embed preview active"
          : "Browser Use session created — waiting for live preview",
        message_es: session.liveUrl
          ? "Navegador en vivo listo — vista previa activa"
          : "Sesión Browser Use creada — esperando vista previa",
        screenshot_url: session.screenshotUrl || PLACEHOLDER_SHOTS.home,
        kind: "info",
      });
      if (session.lastStepSummary) {
        run.bu_last_step = session.lastStepSummary;
        pushEvent(run, {
          message: session.lastStepSummary,
          message_es: session.lastStepSummary,
          screenshot_url: session.screenshotUrl || PLACEHOLDER_SHOTS.home,
          kind: "info",
        });
      }
    } catch (err) {
      run.status = "failed";
      pushEvent(run, {
        message: `Failed to start Browser Use: ${sanitizeError(err)}`,
        message_es: `No se pudo iniciar Browser Use: ${sanitizeError(err)}`,
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
    if (run.browser_use_session_id) {
      try {
        const session = await getBrowserUseSession(run.browser_use_session_id);
        if (session.status === "idle") {
          await dispatchBrowserUseTask(
            run.browser_use_session_id,
            buildResumeTaskPrompt({
              config: getFilingConfig(run.filing_type),
              pauseReason: prevPause,
            })
          );
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
  if (run.status === "stopped" || run.status === "review") {
    if (run.worker === "browser_use" && run.status === "review" && run.browser_use_session_id) {
      try {
        await stopBrowserUseSession(run.browser_use_session_id, "session");
      } catch {
        // best-effort cleanup
      }
      run.status = "stopped";
      run.updated_at = nowIso();
    }
    return toPublic(run);
  }

  if (run.worker === "browser_use" && run.browser_use_session_id) {
    try {
      await stopBrowserUseSession(run.browser_use_session_id, "session");
    } catch (err) {
      pushEvent(run, {
        message: `Stop warning: ${sanitizeError(err)}`,
        message_es: `Aviso al detener: ${sanitizeError(err)}`,
        screenshot_url: PLACEHOLDER_SHOTS.stopped,
        kind: "info",
      });
    }
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
