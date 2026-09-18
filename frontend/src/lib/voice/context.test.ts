/**
 * Voice context renew tests: successful resolveVoiceContext must slide
 * expires_at (idle TTL) while respecting the absolute cap from issued_at.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveVoiceContext, VoiceAuthError } from "./context";
import {
  MAX_SESSION_ABSOLUTE_MINUTES,
  SESSION_TTL_MINUTES,
  generateSessionToken,
  hashSessionToken,
} from "./session";

interface SessionRow {
  id: string;
  user_id: string;
  phone_e164: string;
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
  token_hash: string;
}

function makeFakeDb(session: SessionRow | null) {
  const updates: Array<{ id: string; expires_at: string }> = [];
  const fake = {
    updates,
    async query(sql: string, params?: unknown[]) {
      const s = sql.replace(/\s+/g, " ");
      if (s.includes("FROM voice_sessions WHERE token_hash")) {
        if (!session || params?.[0] !== session.token_hash) return { rows: [] };
        return {
          rows: [
            {
              id: session.id,
              user_id: session.user_id,
              phone_e164: session.phone_e164,
              issued_at: session.issued_at,
              expires_at: session.expires_at,
              revoked_at: session.revoked_at,
            },
          ],
        };
      }
      if (s.includes("UPDATE voice_sessions") && s.includes("expires_at")) {
        updates.push({ id: String(params?.[0]), expires_at: String(params?.[1]) });
        if (session) session.expires_at = String(params?.[1]);
        return { rows: [] };
      }
      if (s.includes("UPDATE voice_sessions SET last_used_at")) {
        // legacy shape should not be used after the fix
        updates.push({ id: String(params?.[0]), expires_at: "LEGACY_TOUCH_ONLY" });
        return { rows: [] };
      }
      if (s.includes("FROM voice_access WHERE user_id")) {
        return { rows: [{ email: "caller@example.com" }] };
      }
      if (s.includes("FROM workspaces w")) return { rows: [{ id: "ws-1" }] };
      if (s.includes("INSERT INTO workspaces") || s.includes("INSERT INTO workspace_members")) {
        return { rows: [{ id: "ws-1" }] };
      }
      if (s.includes("UPDATE businesses SET workspace_id")) return { rows: [] };
      if (s.includes("FROM workspace_subscriptions")) {
        return {
          rows: [
            {
              plan: "pro",
              status: "active",
              current_period_end: null,
              stripe_subscription_id: null,
            },
          ],
        };
      }
      if (s.includes("INSERT INTO voice_audit_log")) return { rows: [] };
      throw new Error(`unmocked query: ${s.slice(0, 120)}`);
    },
  };
  return fake;
}

describe("resolveVoiceContext session renew", () => {
  it("extends expires_at on successful resolve (sliding idle window)", async () => {
    const token = generateSessionToken();
    const issuedAt = new Date(Date.now() - 10 * 60_000); // 10 min ago
    const initialExpires = new Date(issuedAt.getTime() + SESSION_TTL_MINUTES * 60_000);
    const session: SessionRow & { last_used_at?: string } = {
      id: "sess-renew",
      user_id: "user-1",
      phone_e164: "+17870000001",
      issued_at: issuedAt.toISOString(),
      expires_at: initialExpires.toISOString(),
      revoked_at: null,
      token_hash: hashSessionToken(token),
    };
    const db = makeFakeDb(session);
    const before = Date.now();
    const ctx = await resolveVoiceContext(`Bearer ${token}`, db as never);
    assert.equal(ctx.userId, "user-1");
    assert.equal(db.updates.length, 1);
    assert.equal(db.updates[0].id, "sess-renew");
    const renewedMs = new Date(db.updates[0].expires_at).getTime();
    // Sliding: roughly now + 30m, and later than the initial absolute-from-issue 30m
    assert.ok(renewedMs > initialExpires.getTime() - 1000);
    assert.ok(
      Math.abs(renewedMs - (before + SESSION_TTL_MINUTES * 60_000)) < 5000,
      `expected ~now+${SESSION_TTL_MINUTES}m, got ${new Date(renewedMs).toISOString()}`
    );
    assert.notEqual(db.updates[0].expires_at, "LEGACY_TOUCH_ONLY");
  });

  it("caps renewed expires_at at issued_at + absolute max", async () => {
    const token = generateSessionToken();
    const issuedAt = new Date(Date.now() - 100 * 60_000); // 100 min ago
    // Still valid: last renew left 25 min on the clock
    const initialExpires = new Date(Date.now() + 25 * 60_000);
    const session: SessionRow = {
      id: "sess-cap",
      user_id: "user-1",
      phone_e164: "+17870000001",
      issued_at: issuedAt.toISOString(),
      expires_at: initialExpires.toISOString(),
      revoked_at: null,
      token_hash: hashSessionToken(token),
    };
    const db = makeFakeDb(session);
    await resolveVoiceContext(`Bearer ${token}`, db as never);
    assert.equal(db.updates.length, 1);
    const got = new Date(db.updates[0].expires_at).getTime();
    const absolute =
      issuedAt.getTime() + MAX_SESSION_ABSOLUTE_MINUTES * 60_000;
    assert.ok(Math.abs(got - absolute) < 2000, "must hit absolute cap");
    assert.ok(
      got < Date.now() + SESSION_TTL_MINUTES * 60_000 - 5 * 60_000,
      "absolute cap must be sooner than a full idle renew"
    );
  });

  it("rejects expired sessions without renewing", async () => {
    const token = generateSessionToken();
    const session: SessionRow = {
      id: "sess-expired",
      user_id: "user-1",
      phone_e164: "+17870000001",
      issued_at: new Date(Date.now() - 40 * 60_000).toISOString(),
      expires_at: new Date(Date.now() - 60_000).toISOString(),
      revoked_at: null,
      token_hash: hashSessionToken(token),
    };
    const db = makeFakeDb(session);
    await assert.rejects(
      () => resolveVoiceContext(`Bearer ${token}`, db as never),
      (err: unknown) => {
        assert.ok(err instanceof VoiceAuthError);
        assert.equal(err.code, "session_expired");
        return true;
      }
    );
    assert.equal(db.updates.length, 0);
  });
});
