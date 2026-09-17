/**
 * Phase 2 MCP security tests.
 *
 * Proves the MCP adapter cannot weaken Phase 1 security:
 * - identity fields (userId, workspaceId, role, plan) can never be overridden
 * - no arbitrary email recipient is possible
 * - cross-user / cross-workspace business access is denied
 * - expired and revoked voice tokens fail
 * - every tool call writes audit + usage + observability rows
 * - failures never leak internals (SQL, stack traces, secrets)
 *
 * The database is a fake query router — no live Supabase needed.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  executeMcpTool,
  extractMcpToken,
  handleMcpRequest,
  mapMcpError,
  sanitizeArgs,
  MCP_TOOLS,
  MCP_TOOL_MAP,
  McpSelectionRequired,
  type McpFailure,
} from "./mcp";
import { VoiceAuthError } from "./context";
import {
  setComplianceMailerForTests,
} from "../compliance-reminders";

/* ------------------------------------------------------------------ */
/* Fake database                                                       */
/* ------------------------------------------------------------------ */

interface FakeSession {
  id: string;
  user_id: string;
  phone_e164: string;
  expires_at: string;
  revoked_at: string | null;
}

interface Scenario {
  session: FakeSession | null;
  email: string | null;
  plan?: string;
  businesses?: Array<Record<string, unknown>>;
}

const FUTURE = new Date(Date.now() + 20 * 60_1000).toISOString();
const PAST = new Date(Date.now() - 60_1000).toISOString();

function validSession(overrides: Partial<FakeSession> = {}): FakeSession {
  return {
    id: "sess-1",
    user_id: "user-1",
    phone_e164: "+17870000001",
    expires_at: FUTURE,
    revoked_at: null,
    ...overrides,
  };
}

function makeFakeDb(scenario: Scenario) {
  const queries: Array<{ sql: string; params: unknown[] | undefined }> = [];
  const fake = {
    queries,
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      const s = sql.replace(/\s+/g, " ");
      if (s.includes("FROM voice_sessions WHERE token_hash")) {
        return { rows: scenario.session ? [scenario.session] : [] };
      }
      if (s.includes("UPDATE voice_sessions SET last_used_at")) return { rows: [] };
      if (s.includes("FROM voice_access WHERE user_id")) {
        return { rows: [{ email: scenario.email }] };
      }
      if (s.includes("FROM workspaces w")) return { rows: [{ id: "ws-1" }] };
      if (s.includes("FROM workspace_subscriptions")) {
        return {
          rows: [
            {
              plan: scenario.plan ?? "free",
              status: "active",
              current_period_end: null,
              stripe_subscription_id: null,
            },
          ],
        };
      }
      if (s.includes("SELECT 1") && s.includes("FROM businesses b")) {
        // userCanAccessBusiness — only "biz-allowed" belongs to this user.
        return { rows: params?.[0] === "biz-allowed" ? [{ ok: 1 }] : [] };
      }
      if (s.includes("FROM businesses b") && s.includes("LEFT JOIN workspace_members")) {
        return { rows: scenario.businesses ?? [] };
      }
      if (s.includes("FROM businesses WHERE id")) {
        const row = (scenario.businesses ?? []).find((b) => b.id === params?.[0]);
        return { rows: row ? [row] : [] };
      }
      if (s.includes("FROM obligations o")) return { rows: [] };
      if (s.includes("FROM evidence e")) return { rows: [] };
      if (s.includes("FROM matters")) return { rows: [] };
      if (s.includes("FROM notifications")) return { rows: [] };
      if (s.includes("INSERT INTO voice_audit_log")) return { rows: [] };
      if (s.includes("INSERT INTO voice_usage")) return { rows: [] };
      if (s.includes("INSERT INTO voice_tool_calls")) return { rows: [] };
      throw new Error(`unmocked query: ${s.slice(0, 90)}`);
    },
  };
  return fake;
}

const BIZ_A = {
  id: "biz-allowed",
  public_id: "BIZ-A",
  name: "Café Luna",
  legal_name: "Cafe Luna LLC",
  business_structure: "LLC",
  business_type: "restaurant",
  industry: "food",
  municipality: "San Juan",
  physical_address: "Calle Luna 123",
  archived: false,
  created_at: "2026-01-01",
};
const BIZ_B = { ...BIZ_A, id: "biz-2", public_id: "BIZ-B", name: "Taller Sol" };

function insertsOf(fake: ReturnType<typeof makeFakeDb>, table: string) {
  return fake.queries.filter((q) => q.sql.includes(`INSERT INTO ${table}`));
}

/* ------------------------------------------------------------------ */
/* Token extraction                                                    */
/* ------------------------------------------------------------------ */

describe("extractMcpToken", () => {
  it("accepts Bearer tokens", () => {
    assert.equal(extractMcpToken("Bearer vs_abc123"), "vs_abc123");
  });
  it("accepts bearer case-insensitively", () => {
    assert.equal(extractMcpToken("bearer vs_abc123"), "vs_abc123");
  });
  it("accepts the raw token (xAI sends the configured value as-is)", () => {
    assert.equal(extractMcpToken("vs_abc123"), "vs_abc123");
  });
  it("rejects missing, empty, and wrong-prefix values", () => {
    assert.equal(extractMcpToken(null), null);
    assert.equal(extractMcpToken(undefined), null);
    assert.equal(extractMcpToken(""), null);
    assert.equal(extractMcpToken("Bearer abc123"), null);
    assert.equal(extractMcpToken("gateway-secret"), null);
  });
});

/* ------------------------------------------------------------------ */
/* Argument sanitization — identity can never be overridden            */
/* ------------------------------------------------------------------ */

describe("sanitizeArgs", () => {
  const tool = MCP_TOOL_MAP.get("get_missing_items")!;
  it("strips identity and recipient override attempts", () => {
    const out = sanitizeArgs(tool, {
      businessId: "biz-1",
      userId: "evil-user",
      workspaceId: "evil-ws",
      role: "OWNER",
      plan: "enterprise",
      email: "evil@x.com",
      to: "evil@x.com",
      recipient: "evil@x.com",
    });
    assert.deepEqual(out, { businessId: "biz-1" });
  });
  it("drops empty businessId and non-object args", () => {
    assert.deepEqual(sanitizeArgs(tool, { businessId: "  " }), {});
    assert.deepEqual(sanitizeArgs(tool, null), {});
    assert.deepEqual(sanitizeArgs(tool, "biz-1"), {});
  });
  it("drops businessId for tools that declare no args", () => {
    const noArgs = MCP_TOOL_MAP.get("list_my_businesses")!;
    assert.deepEqual(sanitizeArgs(noArgs, { businessId: "biz-1" }), {});
  });
});

describe("tool registry", () => {
  it("exposes exactly the eighteen Phase 1–3 tools", () => {
    assert.deepEqual(
      MCP_TOOLS.map((t) => t.name).sort(),
      [
        "add_note",
        "cancel_pending_action",
        "confirm_pending_action",
        "create_draft_project",
        "email_deliverable",
        "email_my_summary",
        "generate_deliverable",
        "get_account_context",
        "get_business_summary",
        "get_deadlines",
        "get_evidence_status",
        "get_missing_items",
        "get_readiness",
        "get_requirements",
        "list_my_businesses",
        "propose_project_fact_update",
        "send_secure_action_link",
        "send_secure_upload_link",
      ].sort()
    );
  });
  it("declares no identity fields in any input schema", () => {
    const banned = ["userId", "workspaceId", "role", "plan", "email", "to", "recipient", "user_id"];
    for (const tool of MCP_TOOLS) {
      const props = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(props)) {
        assert.ok(!banned.includes(key), `${tool.name} declares banned arg ${key}`);
      }
      const text = JSON.stringify(tool.inputSchema);
      for (const b of banned) assert.ok(!text.includes(`"${b}"`), `${tool.name} schema mentions ${b}`);
    }
  });
  it("keeps descriptions concise and free of RBAC internals", () => {
    for (const tool of MCP_TOOLS) {
      assert.ok(tool.description.length < 200, tool.name);
      assert.ok(!/RBAC|policy matrix/i.test(tool.description), tool.name);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Safe error contract                                                 */
/* ------------------------------------------------------------------ */

describe("mapMcpError", () => {
  it("maps token failures to AUTH_REQUIRED", () => {
    for (const code of ["missing_token", "invalid_token", "session_expired", "session_revoked"]) {
      const { failure, denialKind } = mapMcpError(new VoiceAuthError(code, "x", 401));
      assert.equal((failure as McpFailure).code, "AUTH_REQUIRED");
      assert.equal(denialKind, "auth");
    }
  });
  it("maps forbidden to FORBIDDEN without leaking the internal message", () => {
    const { failure } = mapMcpError(new VoiceAuthError("forbidden", "internal detail", 403));
    assert.equal((failure as McpFailure).code, "FORBIDDEN");
    assert.equal((failure as McpFailure).message, "You do not have access to that business.");
  });
  it("maps plan denials with an available alternative", () => {
    const { failure, denialKind } = mapMcpError(
      new VoiceAuthError("plan_not_entitled", "needs operator", 403)
    );
    assert.equal((failure as McpFailure).code, "PLAN_NOT_ENTITLED");
    assert.equal((failure as McpFailure).available_alternative, "email_my_summary");
    assert.equal(denialKind, "plan");
  });
  it("maps selection requests with business options", () => {
    const { failure, denialKind } = mapMcpError(
      new McpSelectionRequired([{ id: "a", name: "A" }])
    );
    assert.equal((failure as McpFailure).code, "BUSINESS_SELECTION_REQUIRED");
    assert.deepEqual((failure as McpFailure).options, [{ id: "a", name: "A" }]);
    assert.equal(denialKind, "selection");
  });
  it("never leaks internals from unexpected errors", () => {
    const { failure } = mapMcpError(new Error('relation "users" does not exist; secret=abc'));
    const f = failure as McpFailure;
    assert.equal(f.code, "INTERNAL_ERROR");
    assert.ok(!f.message.includes("users"));
    assert.ok(!f.message.includes("secret"));
  });
});

/* ------------------------------------------------------------------ */
/* Protocol                                                            */
/* ------------------------------------------------------------------ */

describe("handleMcpRequest", () => {
  const db = makeFakeDb({ session: null, email: null }) as never;
  it("negotiates the protocol version", async () => {
    const res = await handleMcpRequest(db, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {} },
    }, null);
    const body = res.body as { result: { protocolVersion: string } };
    assert.equal(body.result.protocolVersion, "2025-03-26");
  });
  it("falls back to the latest version for unknown versions", async () => {
    const res = await handleMcpRequest(db, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    }, null);
    const body = res.body as { result: { protocolVersion: string } };
    assert.equal(body.result.protocolVersion, "2025-06-18");
  });
  it("lists the eighteen tools with schemas, unauthenticated", async () => {
    const res = await handleMcpRequest(db, { jsonrpc: "2.0", id: 2, method: "tools/list" }, null);
    const body = res.body as { result: { tools: Array<{ name: string; inputSchema: unknown }> } };
    assert.equal(body.result.tools.length, 18);
    assert.ok(body.result.tools.every((t) => t.inputSchema));
  });
  it("answers ping and rejects unknown methods", async () => {
    const ping = await handleMcpRequest(db, { jsonrpc: "2.0", id: 3, method: "ping" }, null);
    assert.deepEqual((ping.body as { result: unknown }).result, {});
    const unknown = await handleMcpRequest(db, { jsonrpc: "2.0", id: 4, method: "tools/banana" }, null);
    assert.equal((unknown.body as { error: { code: number } }).error.code, -32601);
  });
  it("acknowledges notifications with an empty body", async () => {
    const res = await handleMcpRequest(db, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }, null);
    assert.equal(res.status, 202);
    assert.equal(res.body, null);
  });
  it("rejects batches and malformed payloads", async () => {
    const batch = await handleMcpRequest(db, [], null);
    assert.equal(batch.status, 400);
    const bad = await handleMcpRequest(db, { method: "ping" }, null);
    assert.equal(bad.status, 400);
  });
});

/* ------------------------------------------------------------------ */
/* Authentication enforcement                                          */
/* ------------------------------------------------------------------ */

describe("executeMcpTool authentication", () => {
  const authz = "Bearer vs_validtoken";
  it("rejects unknown tools without touching the database", async () => {
    const db = makeFakeDb({ session: validSession(), email: "a@b.co" });
    const res = await executeMcpTool(db as never, authz, "drop_tables", {});
    assert.equal(res.ok, false);
    assert.equal((res.payload as McpFailure).code, "VALIDATION_ERROR");
    assert.ok(!db.queries.some((q) => q.sql.includes("voice_sessions")));
  });
  it("denies calls with no token", async () => {
    const db = makeFakeDb({ session: validSession(), email: "a@b.co" });
    for (const header of [null, undefined, "", "Bearer not-a-session"]) {
      const res = await executeMcpTool(db as never, header, "get_account_context", {});
      assert.equal((res.payload as McpFailure).code, "AUTH_REQUIRED", String(header));
    }
  });
  it("denies unknown tokens", async () => {
    const db = makeFakeDb({ session: null, email: null });
    const res = await executeMcpTool(db as never, authz, "get_account_context", {});
    assert.equal((res.payload as McpFailure).code, "AUTH_REQUIRED");
  });
  it("denies expired tokens", async () => {
    const db = makeFakeDb({
      session: validSession({ expires_at: PAST }),
      email: "a@b.co",
    });
    const res = await executeMcpTool(db as never, authz, "get_account_context", {});
    assert.equal((res.payload as McpFailure).code, "AUTH_REQUIRED");
  });
  it("denies revoked tokens", async () => {
    const db = makeFakeDb({
      session: validSession({ revoked_at: new Date().toISOString() }),
      email: "a@b.co",
    });
    const res = await executeMcpTool(db as never, authz, "get_account_context", {});
    assert.equal((res.payload as McpFailure).code, "AUTH_REQUIRED");
  });
  it("observes denied calls without user identity", async () => {
    const db = makeFakeDb({ session: null, email: null });
    await executeMcpTool(db as never, "Bearer vs_nope", "get_account_context", {});
    const calls = insertsOf(db, "voice_tool_calls");
    assert.equal(calls.length, 1);
    const params = calls[0].params as unknown[];
    assert.equal(params[0], "get_account_context"); // tool_name
    assert.equal(params[4], false); // success
    assert.equal(params[5], "AUTH_REQUIRED"); // error_code
    assert.equal(params[6], "auth"); // denial_kind
    assert.equal(params[2], null); // user_id unknown
    assert.ok(typeof params[7] === "number"); // latency_ms
  });
});

/* ------------------------------------------------------------------ */
/* Authenticated success, audit, and override resistance               */
/* ------------------------------------------------------------------ */

describe("executeMcpTool authenticated calls", () => {
  const authz = "Bearer vs_validtoken";
  const savedAdminEmails = process.env.ADMIN_EMAILS;
  beforeEach(() => {
    // Close the no-DB open-admin default so plan assertions are deterministic.
    process.env.ADMIN_EMAILS = "admin@example.com";
  });
  afterEach(() => {
    if (savedAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = savedAdminEmails;
  });
  function authedDb(overrides: Partial<Scenario> = {}) {
    return makeFakeDb({
      session: validSession(),
      email: "caller@getsmartpr.com",
      businesses: [BIZ_A],
      ...overrides,
    });
  }

  it("returns account context and ignores identity overrides", async () => {
    const db = authedDb();
    const res = await executeMcpTool(db as never, authz, "get_account_context", {
      userId: "evil-user",
      workspaceId: "evil-ws",
      role: "OWNER",
      plan: "enterprise",
    });
    assert.equal(res.ok, true);
    const data = (res.payload as { data: Record<string, unknown> }).data;
    assert.equal(data.email, "caller@getsmartpr.com");
    assert.equal(data.plan, "free"); // derived from session, not the "enterprise" override
    assert.ok(!("userId" in data) && !("workspaceId" in data));
  });

  it("writes audit, usage, and observability rows on success — never secrets", async () => {
    const db = authedDb();
    await executeMcpTool(db as never, authz, "list_my_businesses", {});
    assert.equal(insertsOf(db, "voice_audit_log").length, 1);
    assert.ok(insertsOf(db, "voice_usage").length >= 1);
    const calls = insertsOf(db, "voice_tool_calls");
    assert.equal(calls.length, 1);
    const params = calls[0].params as unknown[];
    assert.deepEqual(
      [params[0], params[4], params[5], params[6], params[8]],
      ["list_my_businesses", true, null, null, false]
    );
    assert.equal(params[2], "user-1");
    assert.ok(typeof params[7] === "number" && (params[7] as number) >= 0);
    // No token material or PINs anywhere in logged params.
    const all = JSON.stringify(db.queries.map((q) => q.params));
    assert.ok(!all.includes("vs_validtoken"));
    assert.ok(!/pin/i.test(all));
  });

  it("auto-selects the caller's single business", async () => {
    const db = authedDb();
    const res = await executeMcpTool(db as never, authz, "get_missing_items", {});
    assert.equal(res.ok, true);
    const data = (res.payload as { data: Record<string, unknown> }).data;
    assert.equal(data.business_name, "Café Luna");
    assert.equal(data.missing_count, 0);
  });

  it("requires explicit selection when several businesses exist", async () => {
    const db = authedDb({ businesses: [BIZ_A, BIZ_B] });
    const res = await executeMcpTool(db as never, authz, "get_missing_items", {});
    assert.equal(res.ok, false);
    const f = res.payload as McpFailure;
    assert.equal(f.code, "BUSINESS_SELECTION_REQUIRED");
    assert.deepEqual(f.options, [
      { id: "biz-allowed", name: "Café Luna" },
      { id: "biz-2", name: "Taller Sol" },
    ]);
  });

  it("denies arbitrary business ids (cross-user access)", async () => {
    const db = authedDb({ businesses: [BIZ_A, BIZ_B] });
    const res = await executeMcpTool(db as never, authz, "get_requirements", {
      businessId: "biz-someone-elses",
    });
    assert.equal(res.ok, false);
    assert.equal((res.payload as McpFailure).code, "FORBIDDEN");
    // The denial itself is audited.
    const audits = insertsOf(db, "voice_audit_log");
    assert.ok(
      audits.some((q) => JSON.stringify(q.params).includes("business_access_denied"))
    );
  });

  it("verifies access even for an explicitly supplied business id", async () => {
    const db = authedDb({ businesses: [BIZ_A, BIZ_B] });
    const res = await executeMcpTool(db as never, authz, "get_readiness", {
      businessId: "biz-allowed",
    });
    assert.equal(res.ok, true);
  });
});

/* ------------------------------------------------------------------ */
/* Email recipient injection resistance                                */
/* ------------------------------------------------------------------ */

describe("email_my_summary", () => {
  const authz = "Bearer vs_validtoken";
  let sentTo: string | null;
  beforeEach(() => {
    sentTo = null;
    setComplianceMailerForTests({
      sendMail: async (opts: Record<string, unknown>) => {
        sentTo = opts.to as string;
      },
    });
  });
  afterEach(() => setComplianceMailerForTests(null));

  it("always sends to the verified account email, ignoring recipient args", async () => {
    const db = makeFakeDb({
      session: validSession(),
      email: "caller@getsmartpr.com",
      businesses: [BIZ_A],
    });
    const res = await executeMcpTool(db as never, authz, "email_my_summary", {
      businessId: "biz-allowed",
      email: "evil@attacker.com",
      to: "evil@attacker.com",
      recipient: "evil@attacker.com",
    });
    assert.equal(res.ok, true);
    assert.equal(sentTo, "caller@getsmartpr.com");
    const calls = insertsOf(db, "voice_tool_calls");
    assert.equal((calls[0].params as unknown[])[8], true); // email_sent
  });

  it("fails closed when no verified email is on file", async () => {
    const db = makeFakeDb({ session: validSession(), email: "not-an-email", businesses: [BIZ_A] });
    const res = await executeMcpTool(db as never, authz, "email_my_summary", {});
    assert.equal((res.payload as McpFailure).code, "NO_VERIFIED_EMAIL");
    assert.equal(sentTo, null);
  });
});
