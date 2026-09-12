// ============================================================================
// Enterprise integrations — webhooks (signed delivery) + service accounts.
//
// Server-side ONLY: dispatches signed webhook events, retries failed
// deliveries with exponential backoff, and mints service-account
// credentials. Raw secrets are shown exactly once at creation/rotation and
// never stored in the clear.
//
// Demo-safety rule: endpoints whose URL is non-HTTPS or points at
// localhost / example.com / *.test etc. are marked 'skipped' — recorded in
// webhook_deliveries but never sent. This is how the demo webhook stays inert.
// ============================================================================

import { randomBytes, randomUUID } from "node:crypto";
import { getPool } from "../app/graph/db";
import {
  decryptSecret,
  encryptSecret,
  sha256Hex,
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  type Queryable,
} from "./enterprise-security";

export { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER };
export type { Queryable };

// ---------------------------------------------------------------------------
// Webhook event catalog
// ---------------------------------------------------------------------------

export const WEBHOOK_EVENTS = [
  "requirement.assigned",
  "requirement.status_changed",
  "evidence.submitted",
  "evidence.approved",
  "evidence.rejected",
  "deadline.approaching",
  "requirement.overdue",
  "regulatory.change_affecting_project",
  "readiness.score_changed",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(v: unknown): v is WebhookEventType {
  return typeof v === "string" && (WEBHOOK_EVENTS as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Service-account scopes
// ---------------------------------------------------------------------------

export const SERVICE_ACCOUNT_SCOPES = [
  "scim",
  "webhooks:read",
  "reports:read",
  "work:read",
  "work:write",
] as const;

export type ServiceAccountScope = (typeof SERVICE_ACCOUNT_SCOPES)[number];

export function validateServiceAccountScopes(scopes: unknown): {
  ok: true;
  scopes: ServiceAccountScope[];
} | { ok: false; invalid: string[] } {
  const list = Array.isArray(scopes) ? scopes : [];
  const invalid = list.filter(
    (s) => typeof s !== "string" || !(SERVICE_ACCOUNT_SCOPES as readonly string[]).includes(s)
  );
  if (invalid.length > 0 || list.length === 0) {
    return { ok: false, invalid: invalid.map(String) };
  }
  return { ok: true, scopes: [...new Set(list.map(String))] as ServiceAccountScope[] };
}

// ---------------------------------------------------------------------------
// Inert-URL detection (demo webhooks never fire)
// ---------------------------------------------------------------------------

const INERT_HOSTNAMES = new Set(["localhost", "example.com", "test", "invalid"]);
const INERT_TLDS = new Set(["test", "example", "localhost", "invalid"]);

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True when a webhook URL must never receive traffic: non-HTTPS scheme,
 * unparseable, localhost/loopback, or documentation/test hostnames.
 */
export function isInertWebhookUrl(url: unknown): boolean {
  if (typeof url !== "string" || !url) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (parsed.protocol !== "https:") return true;
  const host = parsed.hostname.toLowerCase();
  if (!host) return true;
  if (INERT_HOSTNAMES.has(host)) return true;
  if (host === "127.0.0.1" || host === "::1" || host.startsWith("127.")) return true;
  if (host.endsWith(".example.com")) return true;
  const tld = host.split(".").pop() ?? "";
  if (INERT_TLDS.has(tld)) return true;
  return false;
}

export function inertReason(url: string): string {
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    parsed = null;
  }
  if (!parsed) return "url is not parseable";
  if (parsed.protocol !== "https:") return `non-https scheme (${parsed.protocol})`;
  return `inert hostname (${parsed.hostname})`;
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/** Mint a webhook signing secret. Raw value is returned ONCE to the caller. */
export function mintWebhookSecret(): { raw: string; encrypted: string; hash: string } {
  const raw = `whsec_${randomBytes(32).toString("base64url")}`;
  return { raw, encrypted: encryptSecret(raw), hash: sha256Hex(raw) };
}

/** Mint a service-account credential. Raw value is returned ONCE. */
export function mintServiceAccountCredential(): { raw: string; hash: string } {
  const raw = `sk_ent_${randomBytes(32).toString("base64url")}`;
  return { raw, hash: sha256Hex(raw) };
}

/** Max delivery attempts before a delivery is left 'failed' (no more retries). */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** Exponential backoff: 5min, 10min, 20min, 40min, 80min (cap 24h). */
export function backoffDelayMs(attempts: number): number {
  const minutes = Math.min(5 * 2 ** Math.max(0, attempts - 1), 24 * 60);
  return minutes * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export interface WebhookEndpoint {
  id: string;
  url: string;
  secret_enc: string | null;
  events: string[];
  active: boolean;
}

export interface DispatchResult {
  endpoint_id: string;
  url: string;
  outcome: "delivered" | "failed" | "skipped";
  status?: number | null;
  detail?: string;
}

export interface Fetcher {
  (url: string, init: RequestInit): Promise<{ status: number; text(): Promise<string> }>;
}

function defaultFetcher(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

/** Build the signed envelope stored in webhook_deliveries.payload. */
export function buildWebhookEnvelope(
  workspaceId: string,
  eventType: string,
  payload: unknown
): Record<string, unknown> {
  return {
    event_id: randomUUID(),
    event_type: eventType,
    workspace_id: workspaceId,
    occurred_at: new Date().toISOString(),
    data: payload ?? {},
  };
}

async function postWebhook(
  url: string,
  secret: string,
  envelope: Record<string, unknown>,
  fetcher: Fetcher
): Promise<{ ok: boolean; status: number | null; detail?: string }> {
  const body = JSON.stringify(envelope);
  try {
    const res = await fetcher(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-smartpr-event": String(envelope.event_type),
        "x-smartpr-delivery": String(envelope.event_id),
        [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(secret, body),
      },
      body,
    });
    await res.text().catch(() => "");
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    return { ok: false, status: res.status, detail: `http_${res.status}` };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "timeout" : (e as Error).message || "fetch_error";
    return { ok: false, status: null, detail: msg.slice(0, 200) };
  }
}

/**
 * Dispatch a webhook event to every active endpoint in the workspace that is
 * subscribed to the event type (or to "*"). Inert URLs are recorded as
 * 'skipped' with no external traffic. Best-effort: never throws on delivery
 * failure; per-endpoint outcomes are returned.
 */
export async function dispatchWebhookEvent(
  workspaceId: string,
  eventType: string,
  payload: unknown,
  opts: { pool?: Queryable | null; fetcher?: Fetcher } = {}
): Promise<DispatchResult[]> {
  const p = opts.pool === undefined ? getPool() : opts.pool;
  if (!p || !isWebhookEvent(eventType)) return [];
  const fetcher = opts.fetcher ?? defaultFetcher;

  let rows: Array<Record<string, unknown>> = [];
  try {
    const res = await p.query(
      `SELECT id::text AS id, url, secret_enc, events, active
         FROM webhook_endpoints
        WHERE workspace_id = $1 AND active = true
          AND (events @> ARRAY[$2]::text[] OR events @> ARRAY['*']::text[])`,
      [workspaceId, eventType]
    );
    rows = res.rows;
  } catch {
    // Table missing (pre-migration): no endpoints to notify.
    return [];
  }

  const results: DispatchResult[] = [];
  for (const r of rows) {
    const endpointId = String(r.id);
    const url = String(r.url ?? "");
    const inert = isInertWebhookUrl(url);

    if (inert) {
      const envelope = buildWebhookEnvelope(workspaceId, eventType, payload);
      await p
        .query(
          `INSERT INTO webhook_deliveries
             (endpoint_id, event_type, payload, signature, status, attempts, next_retry_at, response_status)
           VALUES ($1,$2,$3::jsonb,$4,'skipped',0,NULL,NULL)`,
          [endpointId, eventType, JSON.stringify(envelope), null]
        )
        .catch(() => {});
      results.push({
        endpoint_id: endpointId,
        url,
        outcome: "skipped",
        detail: inertReason(url),
      });
      continue;
    }

    let secret: string | null = null;
    try {
      secret = typeof r.secret_enc === "string" ? decryptSecret(r.secret_enc) : null;
    } catch (e) {
      secret = null;
    }
    const envelope = buildWebhookEnvelope(workspaceId, eventType, payload);
    const body = JSON.stringify(envelope);

    if (!secret) {
      await p
        .query(
          `INSERT INTO webhook_deliveries
             (endpoint_id, event_type, payload, signature, status, attempts, next_retry_at, response_status)
           VALUES ($1,$2,$3::jsonb,$4,'failed',1,$5,NULL)`,
          [
            endpointId,
            eventType,
            body,
            null,
            new Date(Date.now() + backoffDelayMs(1)).toISOString(),
          ]
        )
        .catch(() => {});
      results.push({
        endpoint_id: endpointId,
        url,
        outcome: "failed",
        detail: "signing secret unavailable (encryption key rotated or unset)",
      });
      continue;
    }

    const signature = signWebhookPayload(secret, body);
    const sent = await postWebhook(url, secret, envelope, fetcher);
    if (sent.ok) {
      await p
        .query(
          `INSERT INTO webhook_deliveries
             (endpoint_id, event_type, payload, signature, status, attempts, next_retry_at, response_status)
           VALUES ($1,$2,$3::jsonb,$4,'delivered',1,NULL,$5)`,
          [endpointId, eventType, body, signature, sent.status]
        )
        .catch(() => {});
      results.push({ endpoint_id: endpointId, url, outcome: "delivered", status: sent.status });
    } else {
      await p
        .query(
          `INSERT INTO webhook_deliveries
             (endpoint_id, event_type, payload, signature, status, attempts, next_retry_at, response_status)
           VALUES ($1,$2,$3::jsonb,$4,'failed',1,$5,$6)`,
          [
            endpointId,
            eventType,
            body,
            signature,
            new Date(Date.now() + backoffDelayMs(1)).toISOString(),
            sent.status,
          ]
        )
        .catch(() => {});
      results.push({
        endpoint_id: endpointId,
        url,
        outcome: "failed",
        status: sent.status,
        detail: sent.detail,
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Delivery runner (cron): retry pending/failed deliveries
// ---------------------------------------------------------------------------

export interface SweepResult {
  processed: number;
  delivered: number;
  failed: number;
  skipped: number;
  dead: number;
}

/**
 * Retry due deliveries. A delivery is retried while attempts < 5 and
 * next_retry_at has passed; afterwards it stays 'failed' with
 * next_retry_at NULL (dead-letter). Disabled/missing endpoints mark their
 * deliveries 'disabled'.
 */
export async function runWebhookDeliverySweep(
  opts: { pool?: Queryable | null; fetcher?: Fetcher; limit?: number } = {}
): Promise<SweepResult> {
  const p = opts.pool === undefined ? getPool() : opts.pool;
  const result: SweepResult = { processed: 0, delivered: 0, failed: 0, skipped: 0, dead: 0 };
  if (!p) return result;
  const fetcher = opts.fetcher ?? defaultFetcher;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);

  let rows: Array<Record<string, unknown>> = [];
  try {
    const res = await p.query(
      `SELECT d.id::text AS id, d.endpoint_id::text AS endpoint_id,
              d.payload, d.attempts, d.status,
              we.url, we.secret_enc, we.active AS endpoint_active
         FROM webhook_deliveries d
         JOIN webhook_endpoints we ON we.id = d.endpoint_id
        WHERE d.status IN ('pending','failed')
          AND (d.next_retry_at IS NULL OR d.next_retry_at <= now())
        ORDER BY d.next_retry_at NULLS FIRST, d.created_at
        LIMIT $1`,
      [limit]
    );
    rows = res.rows;
  } catch {
    return result;
  }

  for (const r of rows) {
    const deliveryId = String(r.id);
    const url = String(r.url ?? "");
    result.processed += 1;

    const finish = async (
      status: "delivered" | "failed" | "skipped" | "disabled",
      attempts: number,
      nextRetry: Date | null,
      responseStatus: number | null,
      signature: string | null
    ) => {
      await p
        .query(
          `UPDATE webhook_deliveries
              SET status = $2, attempts = $3, next_retry_at = $4,
                  response_status = $5, signature = COALESCE($6, signature), updated_at = now()
            WHERE id = $1`,
          [deliveryId, status, attempts, nextRetry?.toISOString() ?? null, responseStatus, signature]
        )
        .catch(() => {});
    };

    if (r.endpoint_active !== true) {
      await finish("disabled", Number(r.attempts) || 0, null, null, null);
      result.skipped += 1;
      continue;
    }
    if (isInertWebhookUrl(url)) {
      await finish("skipped", Number(r.attempts) || 0, null, null, null);
      result.skipped += 1;
      continue;
    }

    const attempts = (Number(r.attempts) || 0) + 1;
    if (attempts > MAX_DELIVERY_ATTEMPTS) {
      // Dead-letter: keep 'failed' with no further retries scheduled.
      await finish("failed", Number(r.attempts) || 0, null, null, null);
      result.dead += 1;
      continue;
    }

    let secret: string | null = null;
    try {
      secret = typeof r.secret_enc === "string" ? decryptSecret(r.secret_enc) : null;
    } catch {
      secret = null;
    }
    if (!secret) {
      await finish(
        "failed",
        attempts,
        attempts >= MAX_DELIVERY_ATTEMPTS ? null : new Date(Date.now() + backoffDelayMs(attempts)),
        null,
        null
      );
      result.failed += 1;
      continue;
    }

    const envelope =
      (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<
        string,
        unknown
      >;
    const sent = await postWebhook(url, secret, envelope, fetcher);
    const signature = signWebhookPayload(secret, JSON.stringify(envelope));
    if (sent.ok) {
      await finish("delivered", attempts, null, sent.status, signature);
      result.delivered += 1;
    } else {
      await finish(
        "failed",
        attempts,
        attempts >= MAX_DELIVERY_ATTEMPTS ? null : new Date(Date.now() + backoffDelayMs(attempts)),
        sent.status,
        signature
      );
      result.failed += 1;
    }
  }
  return result;
}
