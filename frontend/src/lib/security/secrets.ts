/**
 * Secrets helpers — detect accidental plaintext, redact for logs, audit when needed.
 * Never log or return raw secrets.
 */
import { createHash, timingSafeEqual } from "node:crypto";

const PLAINTEXT_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "stripe_live_secret", re: /\bsk_live_[0-9a-zA-Z]{20,}\b/ },
  { name: "stripe_test_secret", re: /\bsk_test_[0-9a-zA-Z]{20,}\b/ },
  { name: "github_pat", re: /\bghp_[0-9a-zA-Z]{36}\b/ },
  { name: "supabase_service_role_jwt", re: /\beyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/ },
  { name: "generic_api_key_assignment", re: /\b(api[_-]?key|secret[_-]?key|private[_-]?key)\s*[:=]\s*['\"][^'\"]{12,}['\"]/i },
];

export function findPlaintextSecretHits(text: string): string[] {
  const hits: string[] = [];
  for (const p of PLAINTEXT_PATTERNS) {
    if (p.re.test(text)) hits.push(p.name);
  }
  return hits;
}

export function sha256Fingerprint(value: string): string {
  const hex = createHash("sha256").update(value, "utf8").digest("hex");
  return `sha256:${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

/** Constant-time equality for equal-length buffers/strings. */
export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Keys that must never appear as string values in client/API JSON responses.
 * Used by assertNoClientSecrets.
 */
const FORBIDDEN_RESPONSE_KEYS =
  /service[_-]?role|private[_-]?key|client[_-]?secret|raw[_-]?credential|password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token/i;

export function assertNoClientSecrets(payload: unknown, path = "$"): void {
  if (Array.isArray(payload)) {
    payload.forEach((v, i) => assertNoClientSecrets(v, `${path}[${i}]`));
    return;
  }
  if (payload && typeof payload === "object") {
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (typeof v === "string" && FORBIDDEN_RESPONSE_KEYS.test(k) && v.length > 0 && v !== "[redacted]") {
        throw new Error(`Refusing to expose secret-like field at ${path}.${k}`);
      }
      assertNoClientSecrets(v, `${path}.${k}`);
    }
  }
}

export { PLAINTEXT_PATTERNS };

/**
 * When plaintext secret patterns are found in a string, optionally emit an
 * audit event (superadmin/automation). Never includes the secret material —
 * only pattern names and a fingerprint of the scanned blob.
 */
export async function auditPlaintextSecretHits(
  writeAudit: (event: {
    action: string;
    targetType: string;
    targetId: string | null;
    after?: unknown;
    source?: string;
    reason?: string;
    actorUserId?: string | null;
  }) => Promise<void>,
  text: string,
  context: { source_path?: string; actorUserId?: string | null } = {}
): Promise<string[]> {
  const hits = findPlaintextSecretHits(text);
  if (hits.length === 0) return hits;
  await writeAudit({
    action: "security.plaintext_secret_detected",
    targetType: "secret_scan",
    targetId: context.source_path ?? null,
    actorUserId: context.actorUserId ?? null,
    source: "automation",
    reason: "plaintext secret pattern detected",
    after: {
      patterns: hits,
      content_fingerprint: sha256Fingerprint(text),
      source_path: context.source_path ?? null,
    },
  });
  return hits;
}
