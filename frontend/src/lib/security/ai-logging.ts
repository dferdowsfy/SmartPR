/**
 * Central AI logging abstraction — never logs raw confidential content.
 * Callers pass metadata only (ids, model, token counts, outcome).
 */

export type AiLogLevel = "info" | "warn" | "error";

export interface AiLogEvent {
  level?: AiLogLevel;
  /** Stable event name, e.g. "ai.completion" */
  event: string;
  provider?: string;
  model?: string;
  workspace_id?: string | null;
  business_id?: string | null;
  correlation_id?: string | null;
  duration_ms?: number;
  outcome?: "ok" | "error" | "timeout" | "skipped";
  error_code?: string;
  /** Counts only — never prompt/completion text */
  prompt_chars?: number;
  completion_chars?: number;
  /** Free-form metadata; will be scrubbed of secret-like keys */
  meta?: Record<string, unknown>;
}

const SECRETISH = /password|secret|token|api[_-]?key|ssn|passport|ein|credential|prompt|completion|content|body|message/i;

function scrubMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SECRETISH.test(k)) {
      out[k] = typeof v === "string" ? `[redacted:${v.length}chars]` : "[redacted]";
    } else if (typeof v === "string" && v.length > 200) {
      out[k] = `[truncated:${v.length}chars]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Structured AI log line — safe for centralized logging sinks. */
export function logAiEvent(event: AiLogEvent): void {
  const line = {
    ts: new Date().toISOString(),
    channel: "ai",
    level: event.level ?? "info",
    event: event.event,
    provider: event.provider,
    model: event.model,
    workspace_id: event.workspace_id ?? null,
    business_id: event.business_id ?? null,
    correlation_id: event.correlation_id ?? null,
    duration_ms: event.duration_ms,
    outcome: event.outcome,
    error_code: event.error_code,
    prompt_chars: event.prompt_chars,
    completion_chars: event.completion_chars,
    meta: scrubMeta(event.meta),
  };
  console.log(JSON.stringify(line));
}
