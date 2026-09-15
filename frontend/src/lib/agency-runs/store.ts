/**
 * In-memory agency_runs store for the Phase 2 UI skeleton.
 *
 * Persistence is intentionally a process-local Map (keyed by run id).
 * A later PR can replace this with `agency_runs` / `agency_run_events` tables.
 * Mock worker advances on each GET poll so the UI feels live without Playwright.
 */
import { randomUUID } from "crypto";
import { timelineFor, type MockBeat } from "./mockTimeline";
import { PLACEHOLDER_SHOTS } from "./placeholders";
import type {
  AgencyFilingType,
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
  };
}

function pushEvent(run: AgencyRun, beat: MockBeat): AgencyRunEvent {
  const event: AgencyRunEvent = {
    index: run.events.length,
    message: beat.message,
    message_es: beat.message_es,
    screenshot_url: PLACEHOLDER_SHOTS[beat.shot],
    created_at: nowIso(),
    kind: beat.kind === "step" ? "info" : beat.kind,
  };
  run.events.push(event);
  return event;
}

/** Apply any mock beats whose delay has elapsed since segment_started_at. */
export function advanceMock(run: AgencyRun): AgencyRun {
  if (run.status === "stopped" || run.status === "failed" || run.status === "review") {
    return run;
  }
  if (run.status === "paused") {
    return run;
  }

  const script = timelineFor(run.filing_type);
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

    pushEvent(run, beat);
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

export function createRun(input: {
  business_id: string;
  filing_type: AgencyFilingType;
}): AgencyRunPublic {
  const created = nowIso();
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
    events: [
      {
        index: 0,
        message: "Run queued — mock agency worker starting…",
        message_es: "Ejecución en cola — el trabajador simulado está iniciando…",
        screenshot_url: PLACEHOLDER_SHOTS.home,
        created_at: created,
        kind: "info",
      },
    ],
  };
  // Seed cursor past the queued banner so timeline beats start at 0.
  run.mock_cursor = 0;
  runs().set(run.id, run);
  return toPublic(advanceMock(run));
}

export function getRun(id: string): AgencyRunPublic | null {
  const run = runs().get(id);
  if (!run) return null;
  return toPublic(advanceMock(run));
}

export function resumeRun(id: string): AgencyRunPublic | null {
  const run = runs().get(id);
  if (!run) return null;
  if (run.status !== "paused") {
    return toPublic(advanceMock(run));
  }
  run.status = "running";
  run.pause_reason = null;
  run.segment_started_at = nowIso();
  run.updated_at = nowIso();
  run.events.push({
    index: run.events.length,
    message: "Resumed by user — continuing assisted filing",
    message_es: "Reanudado por el usuario — continuando el trámite asistido",
    screenshot_url: run.events[run.events.length - 1]?.screenshot_url || PLACEHOLDER_SHOTS.home,
    created_at: nowIso(),
    kind: "info",
  });
  return toPublic(advanceMock(run));
}

export function stopRun(id: string): AgencyRunPublic | null {
  const run = runs().get(id);
  if (!run) return null;
  if (run.status === "stopped" || run.status === "review") {
    return toPublic(run);
  }
  run.status = "stopped";
  run.pause_reason = null;
  run.updated_at = nowIso();
  run.events.push({
    index: run.events.length,
    message: "Run stopped by user",
    message_es: "Ejecución detenida por el usuario",
    screenshot_url: PLACEHOLDER_SHOTS.stopped,
    created_at: nowIso(),
    kind: "info",
  });
  return toPublic(run);
}

export const FILING_TYPES: AgencyFilingType[] = [
  "SURI_REGISTER_TAXPAYER",
  "SURI_MERCHANT_REGISTRATION",
];

export function isFilingType(value: string): value is AgencyFilingType {
  return (FILING_TYPES as string[]).includes(value);
}

export type { AgencyRunStatus };
