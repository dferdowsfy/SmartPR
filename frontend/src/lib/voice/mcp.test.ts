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
  extractArgToken,
  extractMcpToken,
  handleMcpRequest,
  isConsoleMcpRequest,
  mapMcpError,
  sanitizeArgs,
  MCP_TOOLS,
  MCP_TOOL_MAP,
  McpSelectionRequired,
  type McpFailure,
} from "./mcp";
import { VoiceAuthError } from "./context";
import { hashPin, pinIdentifier } from "./pin";
import { hashSessionToken } from "./session";
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

interface FakeVoiceAccess {
  pin_uid: string;
  user_id: string;
  phone_e164: string;
  pin_hash: string;
  enabled: boolean;
  failed_attempts: number;
  locked_until: string | null;
}

interface Scenario {
  session: FakeSession | null;
  email: string | null;
  plan?: string;
  businesses?: Array<Record<string, unknown>>;
  voiceAccess?: FakeVoiceAccess | null;
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
      if (s.includes("FROM voice_access WHERE pin_uid")) {
        const row = scenario.voiceAccess ?? null;
        return { rows: row && params?.[0] === row.pin_uid ? [row] : [] };
      }
      if (s.includes("UPDATE voice_access") && s.includes("failed_attempts + 1")) {
        const row = scenario.voiceAccess;
        if (!row) throw new Error("voice_access increment with no access row");
        row.failed_attempts += 1;
        if (row.failed_attempts >= 5) {
          row.locked_until = new Date(Date.now() + 15 * 60_1000).toISOString();
        }
        return {
          rows: [{ failed_attempts: row.failed_attempts, locked_until: row.locked_until }],
        };
      }
      if (s.includes("UPDATE voice_access")) return { rows: [] }; // reset branch
      if (s.includes("UPDATE voice_sessions SET revoked_at")) return { rows: [] };
      if (s.includes("INSERT INTO voice_sessions")) return { rows: [{ id: "sess-new" }] };
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
  it("exposes exactly the twenty Phase 1–3 tools", () => {
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
        "get_general_requirements",
        "get_missing_items",
        "get_readiness",
        "get_requirements",
        "list_my_businesses",
        "propose_project_fact_update",
        "send_secure_action_link",
        "send_secure_upload_link",
        "verify_voice_pin",
      ].sort()
    );
  });
  it("flags exactly the anonymous tools (zero account data)", () => {
    const anonymous = MCP_TOOLS.filter((t) => t.anonymous);
    assert.deepEqual(
      anonymous.map((t) => t.name).sort(),
      ["get_general_requirements", "verify_voice_pin"].sort()
    );
  });
  it("declares no identity fields in any input schema", () => {
    const banned = ["userId", "workspaceId", "role", "plan", "email", "to", "recipient", "user_id"];
    for (const tool of MCP_TOOLS) {
      const props = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
      for (const key of Object.keys(props)) {
        // Identity is always derived server-side from the issued session
        // token — no tool may accept an identity override, and since the
        // PIN-only change verify_voice_pin takes no email either.
        assert.ok(!banned.includes(key), `${tool.name} declares banned arg ${key}`);
      }
      const text = JSON.stringify(tool.inputSchema);
      for (const b of banned) {
        assert.ok(!text.includes(`"${b}"`), `${tool.name} schema mentions ${b}`);
      }
    }
  });
  it("keeps descriptions concise and free of RBAC internals", () => {
    for (const tool of MCP_TOOLS) {
      // verify_voice_pin carries load-bearing PIN-handling safety rules
      // (keypad entry, never read the token aloud); it gets a wider budget.
      const limit = tool.name === "verify_voice_pin" ? 800 : 200;
      assert.ok(tool.description.length < limit, tool.name);
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
  it("lists all twenty tools with schemas, unauthenticated (missing header keeps historical behavior)", async () => {
    const res = await handleMcpRequest(db, { jsonrpc: "2.0", id: 2, method: "tools/list" }, null);
    const body = res.body as { result: { tools: Array<{ name: string; inputSchema: unknown }> } };
    assert.equal(body.result.tools.length, 20);
    assert.ok(body.result.tools.every((t) => t.inputSchema));
  });
  it("lists only the anonymous tools for the pre-auth marker", async () => {
    const res = await handleMcpRequest(
      db,
      { jsonrpc: "2.0", id: 3, method: "tools/list" },
      "anonymous"
    );
    const body = res.body as { result: { tools: Array<{ name: string }> } };
    assert.deepEqual(body.result.tools.map((t) => t.name).sort(), ["get_general_requirements", "verify_voice_pin"].sort());
  });
  it("lists only the anonymous tools for an invalid token", async () => {
    const res = await handleMcpRequest(
      db,
      { jsonrpc: "2.0", id: 4, method: "tools/list" },
      "Bearer vs_bogus_token"
    );
    const body = res.body as { result: { tools: Array<{ name: string }> } };
    assert.deepEqual(body.result.tools.map((t) => t.name).sort(), ["get_general_requirements", "verify_voice_pin"].sort());
  });
  it("lists all tools for a valid token", async () => {
    const authedDb = makeFakeDb({ session: validSession(), email: "a@b.co" }) as never;
    const res = await handleMcpRequest(
      authedDb,
      { jsonrpc: "2.0", id: 5, method: "tools/list" },
      "Bearer vs_test_session_token"
    );
    const body = res.body as { result: { tools: Array<{ name: string }> } };
    assert.equal(body.result.tools.length, 20);
    assert.ok(body.result.tools.some((t) => t.name === "get_account_context"));
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
/* Anonymous knowledge-graph tool                                    */
/* ------------------------------------------------------------------ */

describe("get_general_requirements (anonymous)", () => {
  it("runs the deterministic engine without a token", async () => {
    const db = makeFakeDb({ session: null, email: null });
    const res = await executeMcpTool(db as never, null, "get_general_requirements", {
      business_type: "restaurant",
      municipality: "San Juan",
    });
    assert.equal(res.ok, true);
    const data = (res.payload as { success: true; data: Record<string, unknown> }).data;
    assert.equal(data.matched, true);
    assert.equal(data.matched_business_type, "Restaurant");
    assert.equal(data.matched_municipality, "San Juan");
    assert.ok((data.engine as { rules_evaluated: number }).rules_evaluated > 300);
    const reqs = data.requirements as Array<{ name: string; agency: string; posture: string }>;
    assert.ok(reqs.length > 0, "engine should produce requirements for a restaurant");
    for (const r of reqs) {
      assert.ok(r.name && r.agency, "each requirement names the document and agency");
      assert.ok(
        ["required", "likely_required", "conditional", "verify_existing", "needs_more_information", "supporting_evidence", "recommended"].includes(r.posture),
        `unexpected posture ${r.posture}`
      );
    }
    // No account identity touched the database.
    assert.ok(!db.queries.some((q) => q.sql.includes("voice_sessions")));
  });
  it("fuzzy-matches a close business type and reports the match", async () => {
    const db = makeFakeDb({ session: null, email: null });
    const res = await executeMcpTool(db as never, "anonymous", "get_general_requirements", {
      business_type: "food truck",
    });
    assert.equal(res.ok, true);
    const data = (res.payload as { success: true; data: Record<string, unknown> }).data;
    assert.equal(data.matched, true);
    assert.equal(data.matched_business_type, "Food Truck");
    assert.equal(data.business_type_match, "exact");
  });
  it("returns candidates instead of guessing an unknown business type", async () => {
    const db = makeFakeDb({ session: null, email: null });
    const res = await executeMcpTool(db as never, null, "get_general_requirements", {
      business_type: "quantum teleportation",
    });
    assert.equal(res.ok, true);
    const data = (res.payload as { success: true; data: Record<string, unknown> }).data;
    assert.equal(data.matched, false);
    assert.ok(Array.isArray(data.candidates));
  });
  it("accepts refinement answers and surfaces follow-up questions", async () => {
    const db = makeFakeDb({ session: null, email: null });
    const res = await executeMcpTool(db as never, null, "get_general_requirements", {
      business_type: "bar",
      municipality: "Ponce",
      answers: { Q_FAKE_QUESTION: "yes" },
    });
    assert.equal(res.ok, true);
    const data = (res.payload as { success: true; data: Record<string, unknown> }).data;
    assert.equal(data.matched, true);
    assert.deepEqual(data.dropped_answers, ["Q_FAKE_QUESTION"]);
    const followUps = data.follow_up_questions as Array<{ id: string; question: string }>;
    assert.ok(followUps.length > 0 && followUps.length <= 5);
    assert.ok(followUps.every((q) => q.id && q.question));
  });
  it("works with a valid token too (authed path)", async () => {
    const db = makeFakeDb({ session: validSession(), email: "a@b.co" });
    const res = await executeMcpTool(db as never, "Bearer vs_test_session_token", "get_general_requirements", {
      business_type: "bakery",
    });
    assert.equal(res.ok, true);
    const data = (res.payload as { success: true; data: Record<string, unknown> }).data;
    assert.equal(data.matched_business_type, "Bakery");
  });
  it("still denies account tools without a token", async () => {
    const db = makeFakeDb({ session: null, email: null });
    for (const name of ["get_requirements", "get_account_context", "list_my_businesses"]) {
      const res = await executeMcpTool(db as never, null, name, {});
      assert.equal(res.ok, false);
      assert.equal((res.payload as McpFailure).code, "AUTH_REQUIRED", name);
    }
  });
  it("rejects a missing business_type as a validation error", async () => {
    const db = makeFakeDb({ session: null, email: null });
    const res = await executeMcpTool(db as never, null, "get_general_requirements", {});
    assert.equal(res.ok, false);
    assert.equal((res.payload as McpFailure).code, "VALIDATION_ERROR");
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

/* ------------------------------------------------------------------ */
/* verify_voice_pin (console-agent account unlock)                     */
/* ------------------------------------------------------------------ */

describe("verify_voice_pin", () => {
  // PIN-only verification: the 6-digit PIN is the account identifier — no
  // email is ever requested or required.
  const PEPPER = "test-pepper-0123456789abcdef";
  const PIN = "123456";
  const pinUid = (pin: string) => pinIdentifier(pin, PEPPER);

  let savedPepper: string | undefined;
  beforeEach(() => {
    savedPepper = process.env.VOICE_PIN_PEPPER;
    process.env.VOICE_PIN_PEPPER = PEPPER;
  });
  afterEach(() => {
    if (savedPepper === undefined) delete process.env.VOICE_PIN_PEPPER;
    else process.env.VOICE_PIN_PEPPER = savedPepper;
  });

  async function accessRow(
    overrides: Partial<FakeVoiceAccess> = {}
  ): Promise<FakeVoiceAccess> {
    return {
      pin_uid: pinUid(PIN),
      user_id: "user-9",
      phone_e164: "+17870000009",
      pin_hash: await hashPin(PIN),
      enabled: true,
      failed_attempts: 0,
      locked_until: null,
      ...overrides,
    };
  }

  async function verify(
    db: ReturnType<typeof makeFakeDb>,
    args: Record<string, unknown>
  ) {
    const res = await executeMcpTool(db as never, null, "verify_voice_pin", args);
    assert.equal(res.ok, true);
    return res.payload as { success: boolean; data: Record<string, unknown> };
  }

  it("issues a session token for a correct PIN with no email", async () => {
    const db = makeFakeDb({
      session: null,
      email: null,
      voiceAccess: await accessRow(),
    });
    const payload = await verify(db, { pin: PIN });
    assert.equal(payload.data.ok, true);
    assert.ok(
      typeof payload.data.session_token === "string" &&
        (payload.data.session_token as string).startsWith("vs_")
    );
    assert.equal(payload.data.expires_in_minutes, 30);
    // The account was resolved by the PIN's unique identifier.
    assert.ok(
      db.queries.some(
        (q) =>
          q.sql.includes("FROM voice_access WHERE pin_uid") &&
          (q.params as unknown[])[0] === pinUid(PIN)
      ),
      "expected a pin_uid lookup"
    );
    // No email lookup happened at all.
    assert.ok(!db.queries.some((q) => q.sql.includes("lower(email)")));
    // A fresh session row was persisted and the attempt counter reset.
    assert.equal(insertsOf(db, "voice_sessions").length, 1);
    assert.ok(
      db.queries.some(
        (q) => q.sql.includes("UPDATE voice_access") && q.sql.includes("failed_attempts = 0")
      )
    );
    // Audit recorded the issuance without the PIN or token.
    const audits = insertsOf(db, "voice_audit_log");
    assert.ok(audits.some((q) => JSON.stringify(q.params).includes("session_issued")));
    assert.ok(
      !db.queries.some((q) => JSON.stringify(q.params ?? []).includes(PIN))
    );
  });

  it("accepts a PIN with separators or spoken digit words", async () => {
    const db = makeFakeDb({
      session: null,
      email: null,
      voiceAccess: await accessRow(),
    });
    for (const pin of ["123 456", "123-456", "1 2 3 4 5 6", "one two three four five six"]) {
      const payload = await verify(db, { pin });
      assert.equal(payload.data.ok, true, `pin variant: ${pin}`);
    }
  });

  it("ignores a supplied email argument — the PIN alone identifies the account", async () => {
    const db = makeFakeDb({
      session: null,
      email: null,
      voiceAccess: await accessRow(),
    });
    const payload = await verify(db, { pin: PIN, email: "someone@else.example" });
    assert.equal(payload.data.ok, true);
  });

  it("unlocks account tools with the issued session_token argument", async () => {
    const scenario: Scenario = {
      session: null,
      email: null,
      voiceAccess: await accessRow(),
      businesses: [BIZ_A],
    };
    const db = makeFakeDb(scenario);
    const payload = await verify(db, { pin: PIN });
    const token = payload.data.session_token as string;
    // The session lookup now resolves for the issued token's hash.
    scenario.session = {
      id: "sess-new",
      user_id: "user-9",
      phone_e164: "+17870000009",
      expires_at: FUTURE,
      revoked_at: null,
    };
    const res = await executeMcpTool(db as never, null, "get_account_context", {
      session_token: token,
    });
    assert.equal(res.ok, true);
    // The raw token never appears in any query params — only its hash and,
    // server-side, the resolved identity do.
    assert.ok(
      !db.queries.some((q) => JSON.stringify(q.params ?? []).includes(token))
    );
    assert.ok(
      db.queries.some(
        (q) =>
          q.sql.includes("FROM voice_sessions WHERE token_hash") &&
          (q.params as unknown[])[0] === hashSessionToken(token)
      )
    );
  });

  it("rejects an unknown PIN with the generic response and no counter writes", async () => {
    const db = makeFakeDb({
      session: null,
      email: null,
      voiceAccess: await accessRow(),
    });
    // A wrong PIN matches no account row, so it cannot be attributed to the
    // enrolled user: generic response, no session, no attempt-counter write.
    const payload = await verify(db, { pin: "000000" });
    assert.deepEqual(payload.data, {
      ok: false,
      error: "invalid_credentials",
      message: "That PIN was not recognized. Please try again.",
    });
    assert.equal(insertsOf(db, "voice_sessions").length, 0);
    assert.ok(!db.queries.some((q) => q.sql.includes("UPDATE voice_access")));
    const audits = insertsOf(db, "voice_audit_log");
    assert.ok(
      audits.some((q) => JSON.stringify(q.params).includes("not_enrolled_or_disabled"))
    );
  });

  it("returns the generic response for a disabled PIN row", async () => {
    const disabledDb = makeFakeDb({
      session: null,
      email: null,
      voiceAccess: await accessRow({ enabled: false }),
    });
    const disabled = await verify(disabledDb, { pin: PIN });
    assert.deepEqual(disabled.data, {
      ok: false,
      error: "invalid_credentials",
      message: "That PIN was not recognized. Please try again.",
    });
    assert.equal(insertsOf(disabledDb, "voice_sessions").length, 0);
    assert.ok(!disabledDb.queries.some((q) => q.sql.includes("UPDATE voice_access")));
  });

  it("refuses verification while the row is locked", async () => {
    const db = makeFakeDb({
      session: null,
      email: null,
      voiceAccess: await accessRow({
        locked_until: new Date(Date.now() + 15 * 60_1000).toISOString(),
      }),
    });
    const locked = await verify(db, { pin: PIN });
    assert.equal(locked.data.ok, false);
    assert.equal(locked.data.error, "locked");
    assert.ok((locked.data.retry_after_seconds as number) > 0);
    assert.equal(insertsOf(db, "voice_sessions").length, 0);
  });

  it("fails closed when the PIN pepper is not configured", async () => {
    delete process.env.VOICE_PIN_PEPPER;
    const db = makeFakeDb({
      session: null,
      email: null,
      voiceAccess: await accessRow(),
    });
    const payload = await verify(db, { pin: PIN });
    assert.equal(payload.data.ok, false);
    assert.equal(payload.data.error, "temporarily_unavailable");
    assert.equal(insertsOf(db, "voice_sessions").length, 0);
    const audits = insertsOf(db, "voice_audit_log");
    assert.ok(
      audits.some((q) => JSON.stringify(q.params).includes("server_misconfigured")),
      "expected a server_misconfigured audit row"
    );
  });

  it("rejects a malformed PIN without touching account rows", async () => {
    const db = makeFakeDb({
      session: null,
      email: null,
      voiceAccess: await accessRow(),
    });
    for (const args of [{ pin: "12" }, { pin: "abcdef" }, { pin: "" }, {}]) {
      const payload = await verify(db, args);
      assert.equal(payload.data.ok, false);
      assert.equal(payload.data.error, "invalid_credentials");
    }
    assert.ok(!db.queries.some((q) => q.sql.includes("voice_access")));
  });

  it("audits malformed verify_voice_pin calls without touching account rows", async () => {
    const db = makeFakeDb({
      session: null,
      email: null,
      voiceAccess: await accessRow(),
    });
    const payload = await verify(db, { pin: "12" });
    assert.equal(payload.data.error, "invalid_credentials");
    const audits = insertsOf(db, "voice_audit_log");
    assert.ok(
      audits.some((q) => JSON.stringify(q.params).includes("malformed_input")),
      "expected a malformed_input audit row"
    );
    assert.ok(!db.queries.some((q) => q.sql.includes("voice_access")));
  });

  it("denies account tools for a revoked session token", async () => {
    const scenario: Scenario = {
      session: validSession({ revoked_at: new Date().toISOString() }),
      email: null,
      businesses: [BIZ_A],
    };
    const db = makeFakeDb(scenario);
    const res = await executeMcpTool(db as never, null, "get_account_context", {
      session_token: "vs_revoked",
    });
    assert.equal((res.payload as McpFailure).code, "AUTH_REQUIRED");
  });
});

/* Console-agent MCP mode (static xAI Authorization + arg token)        */
/* ------------------------------------------------------------------ */

describe("console-agent MCP mode", () => {
  const CONSOLE_KEY = "test-console-key-123";

  beforeEach(() => {
    process.env.XAI_CONSOLE_MCP_KEY = CONSOLE_KEY;
  });
  afterEach(() => {
    delete process.env.XAI_CONSOLE_MCP_KEY;
  });

  it("recognizes the configured console key, raw or Bearer <redacted>", () => {
    assert.equal(isConsoleMcpRequest(CONSOLE_KEY), true);
    assert.equal(isConsoleMcpRequest(`Bearer ${CONSOLE_KEY}`), true);
    assert.equal(isConsoleMcpRequest("wrong-key"), false);
    assert.equal(isConsoleMcpRequest(null), false);
    assert.equal(isConsoleMcpRequest(""), false);
  });

  it("ignores everything when no console key is configured", () => {
    delete process.env.XAI_CONSOLE_MCP_KEY;
    assert.equal(isConsoleMcpRequest(CONSOLE_KEY), false);
  });

  it("extracts a session_token argument only when well-formed", () => {
    assert.equal(extractArgToken({ session_token: "vs_abc123" }), "vs_abc123");
    assert.equal(extractArgToken({}), null);
    assert.equal(extractArgToken(null), null);
    assert.equal(extractArgToken({ session_token: 42 }), null);
    assert.equal(extractArgToken({ session_token: "Bearer <redacted>" }), null);
    assert.equal(extractArgToken({ session_token: "  vs_abc123  " }), "vs_abc123");
  });

  it("lists the full catalog for the console key", async () => {
    const db = makeFakeDb({ session: null, email: null }) as never;
    const res = await handleMcpRequest(
      db,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      `Bearer ${CONSOLE_KEY}`
    );
    const body = res.body as { result: { tools: Array<{ name: string }> } };
    assert.equal(body.result.tools.length, 20);
    assert.ok(body.result.tools.some((t) => t.name === "verify_voice_pin"));
    assert.ok(body.result.tools.some((t) => t.name === "get_account_context"));
  });

  it("lists only anonymous tools for a wrong console key", async () => {
    const db = makeFakeDb({ session: null, email: null }) as never;
    const res = await handleMcpRequest(
      db,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      "wrong-key"
    );
    const body = res.body as { result: { tools: Array<{ name: string }> } };
    assert.deepEqual(
      body.result.tools.map((t) => t.name).sort(),
      ["get_general_requirements", "verify_voice_pin"].sort()
    );
  });

  it("authenticates account tools from the session_token argument under the console key", async () => {
    const db = makeFakeDb({
      session: validSession(),
      email: "a@b.co",
      businesses: [BIZ_A],
    }) as never;
    const res = await executeMcpTool(db, `Bearer ${CONSOLE_KEY}`, "get_account_context", {
      session_token: "vs_abc123",
    });
    assert.equal(res.ok, true);
  });

  it("denies account tools with an invalid session_token argument", async () => {
    const db = makeFakeDb({ session: null, email: null }) as never;
    const res = await executeMcpTool(db, `Bearer ${CONSOLE_KEY}`, "get_account_context", {
      session_token: "vs_bogus_token",
    });
    assert.equal((res.payload as McpFailure).code, "AUTH_REQUIRED");
  });

  it("denies account tools with no token at all, even with the console key", async () => {
    const db = makeFakeDb({ session: null, email: null }) as never;
    const res = await executeMcpTool(db, `Bearer ${CONSOLE_KEY}`, "get_account_context", {});
    assert.equal((res.payload as McpFailure).code, "AUTH_REQUIRED");
  });

  it("tells the console agent to call verify_voice_pin when no session token is provided", async () => {
    const db = makeFakeDb({ session: null, email: null }) as never;
    const res = await executeMcpTool(db, `Bearer ${CONSOLE_KEY}`, "get_account_context", {});
    const failure = res.payload as McpFailure;
    assert.equal(failure.code, "AUTH_REQUIRED");
    assert.ok(failure.message.includes("verify_voice_pin"));
    assert.ok(failure.message.includes("not verified"));
  });

  it("keeps the generic auth message outside console mode", async () => {
    const db = makeFakeDb({ session: null, email: null }) as never;
    const res = await executeMcpTool(db, null, "get_account_context", {});
    const failure = res.payload as McpFailure;
    assert.equal(failure.code, "AUTH_REQUIRED");
    assert.ok(!failure.message.includes("verify_voice_pin"));
  });
});
