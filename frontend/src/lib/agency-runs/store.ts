/**
 * In-memory agency_runs store.
 *
 * Persistence is a process-local Map (keyed by run id).
 * Worker: agent provider (Browser Use Cloud by default, or the self-hosted
 * browser-agent worker when AGENT_PROVIDER=self_hosted); otherwise mock timeline.
 */
import { randomUUID } from "crypto";
import type { SubmissionObjective } from "./types";
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
import {
  displayMessagesForAgentText,
  humanizePauseEvent,
  mergeSuppliedFieldIds,
  resolvePendingFields,
} from "./pendingFields";
import {
  buildResumeTaskPrompt,
  buildAgencyTaskPrompt,
  mergeResumeFields,
  type ResumeCredentials,
  type ResumeFields,
} from "./taskPrompt";
import { mergeFieldsWithPassportPrefill } from "./prefillFromPassport";
import type { GoalBrief } from "./goalBrief";
import { setPortalAccountStatus } from "./portalAccounts";
import type {
  AgencyFilingType,
  AgencyPauseReason,
  AgencyPendingField,
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
    pause_streak: run.pause_streak,
    // Labels/types/ids only — never values.
    pending_fields: run.pending_fields ?? [],
    // Ids only — never values. Safe for the public payload.
    supplied_field_ids: [...(run.supplied_field_ids ?? [])],
    // GoalBrief is labels-only by construction — safe for public payloads.
    goal_brief: run.goal_brief ?? null,
    // SubmissionObjective is ids/labels only — safe for public payloads.
    submission_objective: run.submission_objective ?? null,
    // Owner-gated API already; used for Assistant non-sensitive prefill only.
    passport_snapshot: run.passport_snapshot ?? null,
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

function clearPendingFields(run: AgencyRun): void {
  run.pending_fields = [];
}

function applyPendingFields(
  run: AgencyRun,
  text: string,
  reason: AgencyPauseReason
): void {
  run.pending_fields = resolvePendingFields(text, reason);
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
      trackPause(run, beat.pause_reason ?? null, PLACEHOLDER_SHOTS.home, beat.message);
      break;
    }
    if (beat.kind === "review") {
      run.status = "review";
      run.pause_reason = null;
      clearPendingFields(run);
      resetPauseStreak(run);
      break;
    }
    run.status = "running";
    run.pause_reason = null;
    clearPendingFields(run);
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
 * Combine result + lastStepSummary + recent event texts so multi-line
 * REQUIRED_FIELDS blocks are not lost when the marker and fields span lines
 * or arrive across result vs events.
 */
function latestAgentBlob(bu: BuRun, events: BuEvent[]): string {
  const chunks: string[] = [];
  const seen = new Set<string>();
  const push = (t: string | null | undefined) => {
    if (!t || !t.trim()) return;
    if (seen.has(t)) return;
    seen.add(t);
    chunks.push(t);
  };
  // Prefer result first (completed turn final message often holds the full block).
  push(bu.result);
  push(bu.lastStepSummary);
  for (const e of events) push(e.text);
  return chunks.join("\n");
}

/**
 * Track a pause marker on the run, counting consecutive same-reason pauses.
 * When the user is stuck in a pause loop (same reason 3+ times), an extra
 * diagnostic event is logged so the UI can show escalated guidance instead
 * of the identical popup.
 */
function trackPause(
  run: AgencyRun,
  reason: AgencyPauseReason,
  shot: string,
  sourceText?: string
): void {
  if (reason && reason === run.prev_pause_reason) {
    run.pause_streak += 1;
  } else {
    run.pause_streak = 1;
    run.prev_pause_reason = reason;
  }
  run.status = "paused";
  run.pause_reason = reason;
  applyPendingFields(run, sourceText || "", reason);
  run.updated_at = nowIso();
  // A login gate proves the business has a portal account — remember the
  // label (never credentials) so the pre-flight question is asked once.
  if (reason === "USER_LOGIN") {
    const agencyId = getFilingConfig(run.filing_type).agencyId;
    if (agencyId) {
      void setPortalAccountStatus(run.business_id, agencyId, true);
    }
  }
  if (run.pause_streak === 3) {
    pushEvent(run, {
      message: `Still blocked on the same step after ${run.pause_streak} attempts. If you already completed it in the live browser, the page may not have saved — look for a Save or Confirm button on the portal page, or press Reconnect and try again.`,
      message_es: `Sigue bloqueado en el mismo paso después de ${run.pause_streak} intentos. Si ya lo completó en el navegador en vivo, es posible que la página no haya guardado — busque un botón de Guardar o Confirmar en la página del portal, o pulse Reconectar e inténtelo de nuevo.`,
      screenshot_url: shot,
      kind: "pause",
    });
  }
}

/** Clear the pause-loop counter when the run moves past the pause. */
function resetPauseStreak(run: AgencyRun): void {
  run.pause_streak = 0;
  run.prev_pause_reason = null;
}

/**
 * v4 run → SmartPR run mapping. The run is one agent turn; terminal statuses
 * are decided by the marker protocol in the result/events (PAUSE_*,
 * REVIEW_READY, FAILED:) so the agent never clicks final submit unapproved.
 */
function applyRunStatus(run: AgencyRun, bu: BuRun, events: BuEvent[]): void {
  if (bu.liveUrl) run.live_url = bu.liveUrl;

  const blob = latestAgentBlob(bu, events);

  // Display / dedupe cursor: prefer lastStepSummary, else latest event text.
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
    (blob ? /PAUSE_USER_LOGIN/.test(blob.toUpperCase()) : false);

  const shot = loginTakeover
    ? PLACEHOLDER_SHOTS.login
    : bu.screenshotUrl ||
      run.events[run.events.length - 1]?.screenshot_url ||
      PLACEHOLDER_SHOTS.home;

  // Detect markers against the richest blob so REQUIRED_FIELDS is not missed
  // when the marker and field lines span result vs lastStepSummary vs events.
  const detectText = blob || latestText || "";

  if (latestText && latestText !== run.bu_last_step) {
    run.bu_last_step = latestText;
    const marker = detectMarker(detectText);
    // Parse fields before display so pause events stay human-readable (no raw
    // REQUIRED_FIELDS spam in the Assistant panel).
    const previewFields =
      marker.status === "paused"
        ? resolvePendingFields(detectText, marker.pause_reason ?? null)
        : [];
    const display = displayMessagesForAgentText(
      latestText,
      marker.pause_reason ?? run.pause_reason,
      previewFields
    );
    pushEvent(run, {
      message: display.message,
      message_es: display.message_es,
      screenshot_url: shot,
      kind: marker.status === "paused" ? "pause" : "info",
    });
    if (marker.status === "paused") {
      trackPause(run, marker.pause_reason ?? null, shot, detectText);
    } else if (marker.status === "review") {
      run.status = "review";
      run.pause_reason = null;
      clearPendingFields(run);
      resetPauseStreak(run);
    } else if (marker.status === "failed") {
      run.status = "failed";
      run.pause_reason = null;
      clearPendingFields(run);
      resetPauseStreak(run);
    }
  }

  if (run.status === "queued" && (bu.status === "running" || bu.status === "dispatching")) {
    run.status = "running";
  }

  if (bu.status === "running" && run.status !== "paused" && run.status !== "review") {
    run.status = "running";
    run.pause_reason = null;
    clearPendingFields(run);
  }

  if (bu.status === "completed") {
    // Marker already decided (paused/review/failed from step text) — leave it.
    // Still refresh pending_fields from the full blob if we are paused, in case
    // REQUIRED_FIELDS only appeared in `result` after the first detect.
    if (run.status === "paused") {
      applyPendingFields(run, detectText, run.pause_reason);
    } else if (run.status !== "review" && run.status !== "failed") {
      const out = detectText || `${bu.result || ""}\n${latestText || ""}`;
      const marker = detectMarker(out);
      if (marker.status === "paused") {
        trackPause(run, marker.pause_reason ?? null, shot, out);
        const pauseFields = resolvePendingFields(out, marker.pause_reason ?? null);
        const pauseDisplay = humanizePauseEvent(
          marker.pause_reason ?? null,
          pauseFields,
          out
        );
        pushEvent(run, {
          message: pauseDisplay.message,
          message_es: pauseDisplay.message_es,
          screenshot_url: shot,
          kind: "pause",
        });
      } else if (marker.status === "failed") {
        run.status = "failed";
        run.pause_reason = null;
        clearPendingFields(run);
        resetPauseStreak(run);
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
        clearPendingFields(run);
        resetPauseStreak(run);
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
    clearPendingFields(run);
    resetPauseStreak(run);
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
    clearPendingFields(run);
    resetPauseStreak(run);
  }

  run.updated_at = nowIso();
}

async function syncBrowserUse(run: AgencyRun): Promise<AgencyRun> {
  if (!run.browser_use_run_id) return run;
  if (run.status === "stopped" || run.status === "failed") return run;

  try {
    const bu = await getAgentRun(run.browser_use_run_id);

    // Append new agent events as Assistant events when feasible.
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
      const blob = latestAgentBlob(bu, events);
      const parseText = blob || ev.text;
      const evFields =
        marker.status === "paused"
          ? resolvePendingFields(parseText, marker.pause_reason ?? null)
          : [];
      const evDisplay = displayMessagesForAgentText(
        ev.text,
        marker.pause_reason ?? run.pause_reason,
        evFields
      );
      pushEvent(run, {
        message: evDisplay.message,
        message_es: evDisplay.message_es,
        screenshot_url: run.events[run.events.length - 1]?.screenshot_url || PLACEHOLDER_SHOTS.home,
        kind: marker.status === "paused" ? "pause" : marker.status === "review" ? "review" : "info",
      });
      if (marker.status === "paused") {
        // Prefer the full blob (result + events) for REQUIRED_FIELDS when available.
        trackPause(run, marker.pause_reason ?? null, PLACEHOLDER_SHOTS.home, parseText);
      } else if (marker.status === "review") {
        run.status = "review";
        run.pause_reason = null;
        clearPendingFields(run);
      } else if (marker.status === "failed") {
        run.status = "failed";
        run.pause_reason = null;
        clearPendingFields(run);
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
  /** Labels-only goal brief from POST /api/agency-actions — drives the agent brief block. */
  goalBrief?: GoalBrief | null;
  /**
   * Structured submission objective for this run. No browser session starts
   * without a ready, specific filing objective: SmartPR decides what needs
   * to be filed; the browser agent only executes the selected filing.
   */
  submissionObjective?: SubmissionObjective | null;
  /**
   * Up-front sensitive field values from the pre-flight step (ephemeral).
   * Passed ONLY into the task prompt's FIELDS FILL block — never persisted
   * on the run, never written into events or chat.
   */
  fields?: ResumeFields | null;
}): Promise<AgencyRunPublic> {
  // Hard gate: never create a run for an objective that isn't ready to
  // start (already submitted, or blocking SmartPR information missing).
  if (input.submissionObjective && !input.submissionObjective.ready_to_start) {
    throw new Error(
      "Submission objective is not ready to start — resolve the missing information first."
    );
  }
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
    pause_streak: 0,
    prev_pause_reason: null,
    pending_fields: [],
    // Seed from up-front (pre-flight) field ids so the agent never re-asks
    // for values the human already provided at start. Ids only — never values.
    supplied_field_ids: mergeSuppliedFieldIds([], input.fields),
    goal_brief: input.goalBrief ?? null,
    submission_objective: input.submissionObjective ?? null,
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
        goalBrief: input.goalBrief ?? null,
        fields: input.fields ?? null,
        submissionObjective: input.submissionObjective ?? null,
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

/**
 * Read-only list of prior runs for a business (filing type + status only).
 * Used by agency-action resolution to mark completed/blocked filings.
 */
export function listRunsForBusiness(
  businessId: string
): { filing_type: AgencyFilingType; status: AgencyRunStatus }[] {
  const out: { filing_type: AgencyFilingType; status: AgencyRunStatus }[] = [];
  for (const run of runs().values()) {
    if (run.business_id !== businessId) continue;
    out.push({ filing_type: run.filing_type, status: run.status });
  }
  return out;
}

export type ResumeRunOptions = {
  /** Ephemeral only — passed into the Browser Use follow-up prompt; never stored on the run. */
  fields?: ResumeFields | null;
  /** @deprecated Prefer `fields`. Merged into fields when both are sent. */
  credentials?: ResumeCredentials | null;
};

function sanitizeFields(raw: ResumeFields | null | undefined): ResumeFields | null {
  if (!raw || typeof raw !== "object") return null;
  const out: ResumeFields = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof k !== "string" || typeof v !== "string") continue;
    const id = k.trim();
    const val = v.trim();
    if (!id || !val) continue;
    // Cap length to avoid prompt abuse; never log these.
    out[id.slice(0, 64)] = val.slice(0, 500);
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function resumeRun(
  id: string,
  options?: ResumeRunOptions
): Promise<AgencyRunPublic | null> {
  const run = runs().get(id);
  if (!run) return null;

  // Field values are ephemeral for this call only — never assign onto `run`.
  // Merge submitted values with passport prefill for still-empty non-sensitive
  // pending fields so the agent gets a complete fill set.
  const submitted =
    mergeResumeFields(sanitizeFields(options?.fields), options?.credentials) || {};
  // Remember which field ids the human just supplied so a later re-ask of the
  // same fields becomes a confirm card instead of blank re-entry. Ids only —
  // never values.
  run.supplied_field_ids = mergeSuppliedFieldIds(run.supplied_field_ids, submitted);
  const pendingSnapshot = [...(run.pending_fields ?? [])];
  const mergedMap = mergeFieldsWithPassportPrefill(
    pendingSnapshot,
    submitted,
    run.passport_snapshot
  );
  const fields = Object.keys(mergedMap).length > 0 ? mergedMap : null;

  if (run.worker === "browser_use") {
    if (run.status !== "paused" && run.status !== "running") {
      return toPublic(await syncBrowserUse(run));
    }
    const prevPause = run.pause_reason;
    run.status = "running";
    run.pause_reason = null;
    // Clear metadata optimistically; restore on queue failure when fields were sent
    // so the user can retry instead of silently losing their first Fill & continue.
    clearPendingFields(run);
    run.updated_at = nowIso();
    if (fields) {
      pushEvent(run, {
        message: "User provided required fields from Assistant — filling and continuing",
        message_es: "El usuario proporcionó los campos requeridos desde Asistente — rellenando y continuando",
        screenshot_url: run.events[run.events.length - 1]?.screenshot_url || PLACEHOLDER_SHOTS.home,
        kind: "info",
      });
    } else {
      pushEvent(run, {
        message: "Resumed by user — continuing assisted filing",
        message_es: "Reanudado por el usuario — continuando el trámite asistido",
        screenshot_url: run.events[run.events.length - 1]?.screenshot_url || PLACEHOLDER_SHOTS.home,
        kind: "info",
      });
    }
    if (run.browser_use_session_id && run.browser_use_run_id) {
      try {
        const bu = await getAgentRun(run.browser_use_run_id);
        const terminal =
          bu.status === "completed" ||
          bu.status === "failed" ||
          bu.status === "cancelled";
        // CRITICAL: when the human supplied field values, ALWAYS queue the
        // FIELDS FILL prompt — even if the BU run is still running/idle/queued.
        // SmartPR may mark paused while the cloud run is still "running"; skipping
        // the queue made Fill & continue appear to succeed without sending values
        // (user had to type twice). Prefer interrupt so the agent applies fills now.
        // Plain Resume / I'm done (no fields): keep prior behavior — queue only
        // when the turn is terminal.
        const shouldQueue = Boolean(fields) || terminal;
        if (shouldQueue) {
          // Field values go only into the task message — never logged.
          const queued = await queueAgentMessage(
            run.browser_use_session_id,
            buildResumeTaskPrompt({
              config: getFilingConfig(run.filing_type),
              pauseReason: prevPause,
              passport: run.passport_snapshot ?? null,
              fields,
            }),
            { interrupt: Boolean(fields) && !terminal }
          );
          if (queued.runId) run.browser_use_run_id = queued.runId;
        }
      } catch (err) {
        if (fields) {
          // Keep pending_fields so the user can retry; do not silently clear.
          run.pending_fields = pendingSnapshot;
          run.status = "paused";
          run.pause_reason = prevPause;
          pushEvent(run, {
            message: `Could not send your fields to the agent — try Fill & continue again. (${sanitizeError(err)})`,
            message_es: `No se pudieron enviar los campos al agente — intente Llenar y continuar de nuevo. (${sanitizeError(err)})`,
            screenshot_url: run.events[run.events.length - 1]?.screenshot_url || PLACEHOLDER_SHOTS.home,
            kind: "info",
          });
        } else {
          pushEvent(run, {
            message: `Resume dispatch warning: ${sanitizeError(err)}`,
            message_es: `Aviso al reanudar: ${sanitizeError(err)}`,
            screenshot_url: run.events[run.events.length - 1]?.screenshot_url || PLACEHOLDER_SHOTS.home,
            kind: "info",
          });
        }
      }
    } else if (fields) {
      // No session to deliver to — restore so the user can retry after reconnect.
      run.pending_fields = pendingSnapshot;
      run.status = "paused";
      run.pause_reason = prevPause;
      pushEvent(run, {
        message: "Could not send your fields — the browser session is missing. Try again or Reconnect.",
        message_es: "No se pudieron enviar los campos — falta la sesión del navegador. Intente de nuevo o Reconectar.",
        screenshot_url: run.events[run.events.length - 1]?.screenshot_url || PLACEHOLDER_SHOTS.home,
        kind: "info",
      });
    }
    return toPublic(await syncBrowserUse(run));
  }

  if (run.status !== "paused") {
    return toPublic(advanceMock(run));
  }
  run.status = "running";
  run.pause_reason = null;
  clearPendingFields(run);
  run.segment_started_at = nowIso();
  run.updated_at = nowIso();
  if (fields) {
    pushEvent(run, {
      message: "User provided required fields from Assistant — filling and continuing",
      message_es: "El usuario proporcionó los campos requeridos desde Asistente — rellenando y continuando",
      screenshot_url: run.events[run.events.length - 1]?.screenshot_url || PLACEHOLDER_SHOTS.home,
      kind: "info",
    });
  } else {
    pushEvent(run, {
      message: "Resumed by user — continuing assisted filing",
      message_es: "Reanudado por el usuario — continuando el trámite asistido",
      screenshot_url: run.events[run.events.length - 1]?.screenshot_url || PLACEHOLDER_SHOTS.home,
      kind: "info",
    });
  }
  return toPublic(advanceMock(run));
}

/**
 * Record that the user took over the live browser. The run status itself is
 * unchanged (still paused/running) — this only logs the handoff so the
 * Assistant panel ("notifications") reflects the takeover.
 */
export function takeoverRun(id: string): AgencyRunPublic | null {
  const run = runs().get(id);
  if (!run) return null;
  const reasonLabel =
    run.pause_reason === "USER_LOGIN"
      ? "login / profile"
      : run.pause_reason === "USER_UPLOAD"
        ? "document upload"
        : run.pause_reason === "CAPTCHA"
          ? "captcha"
          : run.pause_reason === "PAYMENT"
            ? "payment"
            : "manual control";
  run.updated_at = nowIso();
  pushEvent(run, {
    message: `User took over the browser (${reasonLabel}) — completing the step directly in the live browser`,
    message_es: `El usuario tomó el control del navegador (${reasonLabel}) — completando el paso directamente en el navegador en vivo`,
    screenshot_url: PLACEHOLDER_SHOTS.login,
    kind: "info",
  });
  return toPublic(run);
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
  clearPendingFields(run);
  run.updated_at = nowIso();
  resetPauseStreak(run);
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

export type { AgencyRunStatus, AgencyPendingField };
