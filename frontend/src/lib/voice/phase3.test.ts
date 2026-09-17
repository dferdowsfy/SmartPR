/**
 * SmartPR Voice Phase 3 tests.
 *
 * Proves the authenticated action tools are safe:
 * - nothing persists without an explicit confirmation of a server-stored
 *   pending action (opaque id, frozen payload, same-session binding, expiry)
 * - confirmations are atomic and idempotent (no double execution)
 * - ambiguous/tampered/foreign confirmations fail safely
 * - fact updates use canonical keys, record provenance, and rerun the
 *   authoritative rules engine with a real before/after diff
 * - deliverables are plan-gated; emails go only to the verified address
 * - secure links are hashed, scoped, expiring, and single-purpose
 * - role-based and cross-user denials hold; errors never leak internals
 *
 * The database is a fake in-memory query router — no live Supabase needed.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { executeMcpTool, sanitizeArgs, MCP_TOOL_MAP } from "./mcp";
import { setComplianceMailerForTests } from "../compliance-reminders";
import { setUploadDeliverableForTests } from "./deliverables";
import { lookupSecureLink } from "./secureLinks";

/* ------------------------------------------------------------------ */
/* In-memory fake database                                             */
/* ------------------------------------------------------------------ */

const FUTURE = new Date(Date.now() + 30 * 60_1000).toISOString();

interface Mem {
  sessionId: string;
  userId: string;
  email: string;
  plan: string;
  businesses: Map<string, Record<string, unknown>>;
  allowedBiz: Set<string>; // "userId:bizId"
  matters: Array<Record<string, unknown>>;
  pending: Map<string, Record<string, unknown>>;
  links: Map<string, Record<string, unknown>>; // keyed by token_hash
  notes: Array<Record<string, unknown>>;
  provenance: Array<Record<string, unknown>>;
  deliverables: Array<Record<string, unknown>>;
  audit: Array<{ action: string; details: Record<string, unknown> }>;
  obligations: Array<Record<string, unknown>>;
}

function baseMem(): Mem {
  return {
    sessionId: "sess-1",
    userId: "user-1",
    email: "owner@example.com",
    plan: "core",
    businesses: new Map([
      [
        "biz-allowed",
        {
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
          passport_json: { alcohol_sold: false },
        },
      ],
    ]),
    allowedBiz: new Set(["user-1:biz-allowed"]),
    matters: [],
    pending: new Map(),
    links: new Map(),
    notes: [],
    provenance: [],
    deliverables: [],
    audit: [],
    obligations: [],
  };
}

const sentEmails: Array<{ to: string; subject: string; text: string }> = [];

function makeFakeDb(mem: Mem) {
  const queries: string[] = [];
  const fake = {
    queries,
    mem,
    async query(sql: string, params: unknown[] = []) {
      queries.push(sql);
      const s = sql.replace(/\s+/g, " ");
      if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") return { rows: [] };
      // -- session / identity (mirrors mcp.test.ts) --
      if (s.includes("FROM voice_sessions WHERE token_hash")) {
        return {
          rows: [
            {
              id: mem.sessionId,
              user_id: mem.userId,
              phone_e164: "+17870000001",
              expires_at: FUTURE,
              revoked_at: null,
            },
          ],
        };
      }
      if (s.includes("UPDATE voice_sessions SET last_used_at")) return { rows: [] };
      if (s.includes("FROM voice_access WHERE user_id")) {
        return { rows: [{ email: mem.email }] };
      }
      if (s.includes("FROM workspaces w")) return { rows: [{ id: "ws-1" }] };
      if (s.includes("FROM workspace_subscriptions")) {
        return {
          rows: [
            { plan: mem.plan, status: "active", current_period_end: null, stripe_subscription_id: null },
          ],
        };
      }
      // -- business access --
      if (s.includes("SELECT 1") && s.includes("FROM businesses b")) {
        const ok = mem.allowedBiz.has(`${params[1]}:${params[0]}`);
        return { rows: ok ? [{ ok: 1 }] : [] };
      }
      if (s.includes("FROM businesses b") && s.includes("LEFT JOIN workspace_members")) {
        return { rows: [...mem.businesses.values()] };
      }
      if (s.includes("SELECT passport_json, municipality, business_type, physical_address")) {
        const b = mem.businesses.get(String(params[0]));
        return { rows: b ? [b] : [] };
      }
      if (s.includes("FROM businesses WHERE id")) {
        const b = mem.businesses.get(String(params[0]));
        return { rows: b ? [b] : [] };
      }
      if (s.includes("UPDATE businesses SET passport_json")) {
        const b = mem.businesses.get(String(params[0]));
        if (b) {
          const cur = (b.passport_json as Record<string, unknown>) ?? {};
          b.passport_json = { ...cur, ...(JSON.parse(String(params[1])) as Record<string, unknown>) };
        }
        return { rows: [] };
      }
      if (s.includes("UPDATE businesses SET physical_address")) {
        const b = mem.businesses.get(String(params[0]));
        if (b) b.physical_address = String(params[1]);
        return { rows: [] };
      }
      // -- pending actions --
      if (s.includes("UPDATE voice_pending_actions SET status = 'expired'")) {
        for (const p of mem.pending.values()) {
          if (p.status === "pending" && new Date(String(p.expires_at)).getTime() <= Date.now()) {
            p.status = "expired";
          }
        }
        return { rows: [] };
      }
      if (s.includes("INSERT INTO voice_pending_actions")) {
        const row = {
          id: String(params[0]),
          voice_session_id: String(params[1]),
          user_id: String(params[2]),
          workspace_id: String(params[3]),
          business_id: params[4] ? String(params[4]) : null,
          matter_id: params[5] ? String(params[5]) : null,
          action_type: String(params[6]),
          payload_json: JSON.parse(String(params[7])),
          confirmation_summary: String(params[8]),
          status: "pending",
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + Number(params[10]) * 60_1000).toISOString(),
          confirmed_at: null,
          executed_at: null,
        };
        mem.pending.set(row.id, row);
        return { rows: [{ id: row.id, expires_at: row.expires_at }] };
      }
      if (s.includes("SET status = 'confirmed'") && s.includes("voice_pending_actions")) {
        const p = mem.pending.get(String(params[0]));
        if (
          p &&
          p.status === "pending" &&
          p.voice_session_id === params[1] &&
          p.user_id === params[2] &&
          new Date(String(p.expires_at)).getTime() > Date.now()
        ) {
          p.status = "confirmed";
          p.confirmed_at = new Date().toISOString();
          return { rows: [{ ...p }] };
        }
        return { rows: [] };
      }
      if (s.includes("SELECT * FROM voice_pending_actions WHERE id")) {
        const p = mem.pending.get(String(params[0]));
        return { rows: p ? [{ ...p }] : [] };
      }
      if (s.includes("SELECT voice_session_id, user_id, status FROM voice_pending_actions")) {
        const p = mem.pending.get(String(params[0]));
        return {
          rows: p
            ? [{ voice_session_id: p.voice_session_id, user_id: p.user_id, status: p.status }]
            : [],
        };
      }
      if (s.includes("SET status = 'cancelled'") && s.includes("voice_pending_actions")) {
        const p = mem.pending.get(String(params[0]));
        if (p && p.status === "pending" && p.voice_session_id === params[1] && p.user_id === params[2]) {
          p.status = "cancelled";
          return { rows: [{ id: p.id }] };
        }
        return { rows: [] };
      }
      if (s.includes("SET status = 'executed'") && s.includes("voice_pending_actions")) {
        const p = mem.pending.get(String(params[0]));
        if (p) {
          p.status = "executed";
          p.executed_at = new Date().toISOString();
        }
        return { rows: [] };
      }
      if (s.includes("SET status = 'failed'") && s.includes("voice_pending_actions")) {
        const p = mem.pending.get(String(params[0]));
        if (p) p.status = "failed";
        return { rows: [] };
      }
      // -- matters --
      if (s.includes("INSERT INTO matters")) {
        const row = {
          id: String(params[0]),
          business_id: String(params[1]),
          title: String(params[5]),
          status: "DRAFT",
          matter_type: String(params[4]),
          facts_json: {},
          opened_at: new Date().toISOString(),
        };
        mem.matters.push(row);
        return { rows: [] };
      }
      if (s.includes("SELECT title, facts_json FROM matters")) {
        const m = mem.matters.find((m) => m.id === params[0] && m.business_id === params[1]);
        return { rows: m ? [{ title: m.title, facts_json: m.facts_json }] : [] };
      }
      if (s.includes("SELECT id, title FROM matters")) {
        const open = mem.matters
          .filter((m) => m.business_id === params[0] && !["ARCHIVED", "COMPLETED"].includes(String(m.status)))
          .sort((a, b) => String(b.opened_at).localeCompare(String(a.opened_at)));
        return { rows: open.slice(0, 1).map((m) => ({ id: m.id, title: m.title })) };
      }
      if (s.includes("SELECT id, title, status, readiness_score") && s.includes("FROM matters")) {
        return { rows: mem.matters.filter((m) => m.business_id === params[0]) };
      }
      if (s.includes("UPDATE matters SET facts_json")) {
        const m = mem.matters.find((m) => m.id === params[0] && m.business_id === params[1]);
        if (m) {
          m.facts_json = { ...(m.facts_json as Record<string, unknown>), ...(JSON.parse(String(params[2])) as Record<string, unknown>) };
        }
        return { rows: [] };
      }
      // -- obligations / evidence (for links + deliverables) --
      if (s.includes("FROM obligations o") && s.includes("JOIN documents d")) {
        const o = mem.obligations.find((o) => o.id === params[0] && o.business_id === params[1]);
        return { rows: o ? [{ id: o.id, name: o.name }] : [] };
      }
      if (s.includes("FROM obligations o") && s.includes("LEFT JOIN matters m")) {
        return { rows: mem.obligations.filter((o) => o.business_id === params[0]) };
      }
      if (s.includes("FROM evidence e")) return { rows: [] };
      if (s.includes("FROM notifications")) return { rows: [] };
      // -- obligations projection (voice fact-confirm reuses the intake
      //    projection; params mirror the VALUES order) --
      if (s.includes("INSERT INTO obligations")) {
        const row: Record<string, unknown> = {
          id: String(params[0]),
          business_id: String(params[1]),
          matter_id: params[2] ? String(params[2]) : null,
          requirement_id: String(params[3]),
          graph_entity_id: params[4] ? String(params[4]) : null,
          name: String(params[5]),
          agency: params[6] ? String(params[6]) : null,
          status: "MISSING",
          mandatory: params[7] !== false,
          source: "REGULATORY_GRAPH",
          source_reference: params[8] ? String(params[8]) : null,
        };
        const existing = mem.obligations.find(
          (o) => o.matter_id === row.matter_id && o.requirement_id === row.requirement_id
        );
        if (existing) Object.assign(existing, row);
        else mem.obligations.push(row);
        return { rows: [{ id: row.id }] };
      }
      // -- notes / provenance / links / deliverables --
      if (s.includes("INSERT INTO business_notes")) {
        const row = { id: `note-${mem.notes.length + 1}`, business_id: params[0], note_text: params[4], source: "voice" };
        mem.notes.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (s.includes("INSERT INTO voice_fact_provenance")) {
        mem.provenance.push({
          business_id: params[0],
          matter_id: params[1],
          fact_key: params[2],
          fact_value: JSON.parse(String(params[3])),
          voice_session_id: params[4],
          user_id: params[5],
        });
        return { rows: [] };
      }
      if (s.includes("INSERT INTO voice_action_links")) {
        const row = {
          token_hash: String(params[0]),
          purpose: String(params[1]),
          user_id: String(params[2]),
          workspace_id: String(params[3]),
          business_id: params[4] ? String(params[4]) : null,
          matter_id: params[5] ? String(params[5]) : null,
          obligation_id: params[6] ? String(params[6]) : null,
          action_type: params[7] ? String(params[7]) : null,
          label: String(params[8]),
          payload_json: JSON.parse(String(params[9])),
          expires_at: new Date(Date.now() + Number(params[10]) * 60_1000).toISOString(),
          max_uses: Number(params[11]),
          uses: 0,
        };
        mem.links.set(row.token_hash, row);
        return { rows: [{ expires_at: row.expires_at }] };
      }
      if (s.includes("FROM voice_action_links WHERE token_hash")) {
        const l = mem.links.get(String(params[0]));
        return { rows: l ? [{ ...l }] : [] };
      }
      if (s.includes("UPDATE voice_action_links")) {
        const l = mem.links.get(String(params[0]));
        if (l) l.uses = Number(l.uses) + 1;
        return { rows: [] };
      }
      if (s.includes("FROM deliverables") && s.includes("WHERE id = $1")) {
        const d = mem.deliverables.find(
          (d) => d.id === params[0] && d.user_id === params[1] && d.business_id === params[2]
        );
        return { rows: d ? [{ id: d.id, filename: d.filename, kind: d.kind }] : [] };
      }
      if (s.includes("FROM deliverables") && s.includes("WHERE user_id")) {
        const rows = mem.deliverables.filter(
          (d) =>
            d.user_id === params[0] &&
            d.business_id === params[1] &&
            d.kind === params[2] &&
            new Date(String(d.generated_at)).getTime() > Date.now() - 10 * 60_1000
        );
        return { rows };
      }
      if (s.includes("INSERT INTO deliverables")) {
        mem.deliverables.push({
          id: String(params[0]),
          user_id: String(params[1]),
          business_id: String(params[2]),
          kind: String(params[3]),
          filename: String(params[4]),
          size_bytes: params[6] == null ? null : Number(params[6]),
          generated_at: new Date().toISOString(),
        });
        return { rows: [] };
      }
      // -- observability --
      if (s.includes("INSERT INTO voice_audit_log")) {
        mem.audit.push({ action: String(params[2]), details: JSON.parse(String(params[3])) });
        return { rows: [] };
      }
      if (s.includes("INSERT INTO voice_usage") || s.includes("INSERT INTO voice_tool_calls")) {
        return { rows: [] };
      }
      throw new Error(`unmocked query: ${s.slice(0, 100)}`);
    },
  };
  return fake;
}

type FakeDb = ReturnType<typeof makeFakeDb>;

async function call(
  db: FakeDb,
  tool: string,
  args: Record<string, unknown>,
  authz = "Bearer vs_phase3_test_token_xyz"
) {
  return executeMcpTool(db as never, authz, tool, args);
}

function okData(res: Awaited<ReturnType<typeof call>>): Record<string, unknown> {
  assert.equal(res.ok, true, `expected ok, got ${JSON.stringify(res.payload).slice(0, 300)}`);
  const payload = res.payload as { success: true; data: Record<string, unknown> };
  return payload.data;
}

function failCode(res: Awaited<ReturnType<typeof call>>): string {
  assert.equal(res.ok, false);
  return (res.payload as { success: false; code: string }).code;
}

beforeEach(() => {
  delete process.env.ADMIN_EMAILS; // open default: platform admin in most tests
  sentEmails.length = 0;
  setComplianceMailerForTests({
    sendMail: async (opts: Record<string, unknown>) => {
      sentEmails.push({
        to: String((opts.to as string) ?? ""),
        subject: String(opts.subject ?? ""),
        text: String(opts.text ?? ""),
      });
      return { ok: true };
    },
  });
  setUploadDeliverableForTests(async (fileName: string) => ({
    bucket: "deliverables",
    objectPath: `test/${fileName}`,
  }));
});

afterEach(() => {
  delete process.env.ADMIN_EMAILS;
  setComplianceMailerForTests(null);
  setUploadDeliverableForTests(null);
});

/* ------------------------------------------------------------------ */
/* create_draft_project: propose -> confirm                            */
/* ------------------------------------------------------------------ */

describe("create_draft_project", () => {
  it("proposes without persisting, then creates the draft on confirmation", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    const proposed = okData(
      await call(db, "create_draft_project", {
        businessId: "biz-allowed",
        projectType: "PERMISO_UNICO_RENEWAL",
        description: "Renew permiso único",
      })
    );
    assert.equal(proposed.status, "pending_confirmation");
    assert.ok(proposed.pending_action_id);
    assert.match(String(proposed.confirmation_summary), /Café Luna/);
    assert.equal(mem.matters.length, 0, "nothing persisted before confirmation");

    const confirmed = okData(
      await call(db, "confirm_pending_action", {
        pendingActionId: proposed.pending_action_id,
      })
    );
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.matter_type, "PERMISO_UNICO_RENEWAL");
    assert.equal(mem.matters.length, 1);
    assert.equal(mem.matters[0].status, "DRAFT");
    const actions = mem.audit.map((a) => a.action);
    for (const want of ["pending_action_created", "pending_action_confirmed", "pending_action_executed", "project_created"]) {
      assert.ok(actions.includes(want), `audit has ${want}`);
    }
  });

  it("a tampered confirmation payload cannot change the frozen proposal", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    const proposed = okData(
      await call(db, "create_draft_project", {
        businessId: "biz-allowed",
        projectType: "OTHER",
        description: "Original description",
      })
    );
    // The attacker model tries to smuggle new arguments into the confirm call.
    const confirmed = okData(
      await call(db, "confirm_pending_action", {
        pendingActionId: proposed.pending_action_id,
        projectType: "ANNUAL_REPORT",
        description: "Smuggled description",
      })
    );
    assert.equal(confirmed.matter_type, "OTHER");
    assert.equal(mem.matters[0].title, "Original description");
  });

  it("confirming the same pending action twice does not double-execute", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    const proposed = okData(
      await call(db, "create_draft_project", {
        businessId: "biz-allowed",
        projectType: "OTHER",
      })
    );
    okData(await call(db, "confirm_pending_action", { pendingActionId: proposed.pending_action_id }));
    const retry = okData(
      await call(db, "confirm_pending_action", { pendingActionId: proposed.pending_action_id })
    );
    assert.equal(retry.status, "already_confirmed");
    assert.equal(mem.matters.length, 1, "no duplicate matter");
  });

  it("confirming an unknown pending action fails safely with no side effects", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    const res = await call(db, "confirm_pending_action", { pendingActionId: "nope" });
    assert.equal(failCode(res), "NOT_FOUND");
    assert.equal(mem.matters.length, 0);
  });

  it("an expired pending action cannot be confirmed", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    const proposed = okData(
      await call(db, "create_draft_project", { businessId: "biz-allowed", projectType: "OTHER" })
    );
    const stored = mem.pending.get(String(proposed.pending_action_id))!;
    stored.expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await call(db, "confirm_pending_action", {
      pendingActionId: proposed.pending_action_id,
    });
    assert.equal(failCode(res), "VALIDATION_ERROR");
    assert.equal(mem.matters.length, 0);
  });

  it("a different session cannot confirm another session's pending action", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    const proposed = okData(
      await call(db, "create_draft_project", { businessId: "biz-allowed", projectType: "OTHER" })
    );
    // Attacker takes over the session slot with their own session+user.
    mem.sessionId = "sess-attacker";
    mem.userId = "user-2";
    const res = await call(db, "confirm_pending_action", {
      pendingActionId: proposed.pending_action_id,
    });
    assert.equal(failCode(res), "FORBIDDEN");
    assert.equal(mem.matters.length, 0);
  });

  it("cancel settles the proposal without executing it", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    const proposed = okData(
      await call(db, "create_draft_project", { businessId: "biz-allowed", projectType: "OTHER" })
    );
    const cancelled = okData(
      await call(db, "cancel_pending_action", { pendingActionId: proposed.pending_action_id })
    );
    assert.equal(cancelled.status, "cancelled");
    const res = await call(db, "confirm_pending_action", {
      pendingActionId: proposed.pending_action_id,
    });
    assert.equal(failCode(res), "VALIDATION_ERROR");
    assert.equal(mem.matters.length, 0);
    assert.ok(mem.audit.some((a) => a.action === "pending_action_cancelled"));
  });
});

/* ------------------------------------------------------------------ */
/* Authorization: cross-user, cross-workspace, role-based              */
/* ------------------------------------------------------------------ */

describe("authorization", () => {
  it("a different user cannot propose on a business they cannot access", async () => {
    const mem = baseMem();
    mem.userId = "user-2"; // attacker identity, same session plumbing
    const db = makeFakeDb(mem);
    const res = await call(db, "create_draft_project", {
      businessId: "biz-allowed",
      projectType: "OTHER",
    });
    assert.equal(failCode(res), "FORBIDDEN");
    assert.equal(mem.pending.size, 0);
  });

  it("a non-writer role is denied voice writes", async () => {
    process.env.ADMIN_EMAILS = "someone-else@example.com"; // kills the open default
    const mem = baseMem();
    const db = makeFakeDb(mem);
    const res = await call(db, "create_draft_project", {
      businessId: "biz-allowed",
      projectType: "OTHER",
    });
    assert.equal(failCode(res), "FORBIDDEN");
    assert.equal(mem.pending.size, 0);
  });

  it("identity override arguments are stripped before dispatch", () => {
    const tool = MCP_TOOL_MAP.get("create_draft_project")!;
    const out = sanitizeArgs(tool, {
      businessId: "biz-allowed",
      projectType: "OTHER",
      userId: "evil-user",
      workspaceId: "evil-ws",
      role: "OWNER",
      plan: "enterprise",
      to: "evil@x.com",
    });
    assert.deepEqual(out, { businessId: "biz-allowed", projectType: "OTHER" });
  });
});

/* ------------------------------------------------------------------ */
/* propose_project_fact_update: canonical facts + engine rerun         */
/* ------------------------------------------------------------------ */

describe("propose_project_fact_update", () => {
  it("persists a canonical fact, records provenance, and returns the engine diff", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    const proposed = okData(
      await call(db, "propose_project_fact_update", {
        businessId: "biz-allowed",
        factKey: "alcohol_sold",
        factValue: true,
      })
    );
    assert.equal(proposed.status, "pending_confirmation");
    assert.equal(proposed.may_change_requirements, true);
    assert.match(String(proposed.confirmation_summary), /alcohol will be sold/);
    assert.equal((mem.businesses.get("biz-allowed")!.passport_json as Record<string, unknown>).alcohol_sold, false);

    const confirmed = okData(
      await call(db, "confirm_pending_action", {
        pendingActionId: proposed.pending_action_id,
      })
    );
    assert.equal(confirmed.fact_key, "alcohol_sold");
    assert.equal(confirmed.new_value, true);
    assert.equal((mem.businesses.get("biz-allowed")!.passport_json as Record<string, unknown>).alcohol_sold, true);

    const added = confirmed.requirements_added as Array<{ name: string }>;
    assert.ok(added.length > 0, "the engine diff is real");
    assert.ok(
      added.some((r) => r.name.toLowerCase().includes("alcohol")),
      "alcohol license appears in the added requirements"
    );

    assert.equal(mem.provenance.length, 1);
    const prov = mem.provenance[0];
    assert.equal(prov.fact_key, "alcohol_sold");
    assert.equal(prov.fact_value, true);
    assert.equal(prov.voice_session_id, "sess-1");
    assert.equal(prov.user_id, "user-1");
    const actions = mem.audit.map((a) => a.action);
    assert.ok(actions.includes("fact_changed"));
    assert.ok(actions.includes("requirements_recalculated"));
  });

  it("rejects facts that are not voice-editable", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    for (const key of ["ssn", "ein", "bank_account", "password"]) {
      const res = await call(db, "propose_project_fact_update", {
        businessId: "biz-allowed",
        factKey: key,
        factValue: "x",
      });
      assert.equal(failCode(res), "VALIDATION_ERROR", key);
    }
    assert.equal(mem.pending.size, 0);
  });

  it("coerces boolean-like speech values and rejects garbage", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    const yes = okData(
      await call(db, "propose_project_fact_update", {
        businessId: "biz-allowed",
        factKey: "food_prepared_on_site",
        factValue: "yes",
      })
    );
    const confirmed = okData(
      await call(db, "confirm_pending_action", { pendingActionId: yes.pending_action_id })
    );
    assert.equal(confirmed.new_value, true);

    const bad = await call(db, "propose_project_fact_update", {
      businessId: "biz-allowed",
      factKey: "food_prepared_on_site",
      factValue: "maybe someday",
    });
    assert.equal(failCode(bad), "VALIDATION_ERROR");
  });

  it("stores physical_address in the canonical column, not the passport", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    const proposed = okData(
      await call(db, "propose_project_fact_update", {
        businessId: "biz-allowed",
        factKey: "physical_address",
        factValue: "Ave. Muñoz Rivera 456",
      })
    );
    okData(await call(db, "confirm_pending_action", { pendingActionId: proposed.pending_action_id }));
    const biz = mem.businesses.get("biz-allowed")!;
    assert.equal(biz.physical_address, "Ave. Muñoz Rivera 456");
    assert.ok(!("physical_address" in (biz.passport_json as Record<string, unknown>)));
  });

  it("project-scope facts resolve the business's open matter", async () => {
    const mem = baseMem();
    mem.matters.push({
      id: "matter-1",
      business_id: "biz-allowed",
      title: "Permiso único",
      status: "DRAFT",
      facts_json: {},
      opened_at: new Date().toISOString(),
    });
    const db = makeFakeDb(mem);
    const proposed = okData(
      await call(db, "propose_project_fact_update", {
        businessId: "biz-allowed",
        factKey: "renovation",
        factValue: true,
      })
    );
    const confirmed = okData(
      await call(db, "confirm_pending_action", { pendingActionId: proposed.pending_action_id })
    );
    assert.equal(confirmed.fact_key, "renovation");
    assert.equal((mem.matters[0].facts_json as Record<string, unknown>).renovation, true);
    // Parity regression: confirming a requirement-affecting fact must project
    // the engine's requirements into the authoritative obligation store
    // (same projection the intake flow uses), anchored to the open matter.
    assert.ok(mem.obligations.length > 0, "confirmed fact projects obligations");
    assert.ok(
      mem.obligations.every((o) => o.matter_id === "matter-1"),
      "obligations are anchored to the resolved matter"
    );
    // Duplicate confirmation stays idempotent: no duplicate obligations.
    const obligationCount = mem.obligations.length;
    const retry = okData(
      await call(db, "confirm_pending_action", { pendingActionId: proposed.pending_action_id })
    );
    assert.equal(retry.status, "already_confirmed");
    assert.equal(mem.obligations.length, obligationCount, "no duplicate obligations");
  });
});

/* ------------------------------------------------------------------ */
/* add_note: confirmation-required, informational only                 */
/* ------------------------------------------------------------------ */

describe("add_note", () => {
  it("requires confirmation and never alters regulatory facts", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    const proposed = okData(
      await call(db, "add_note", { businessId: "biz-allowed", noteText: "Called the landlord." })
    );
    assert.equal(proposed.status, "pending_confirmation");
    assert.equal(mem.notes.length, 0);
    okData(await call(db, "confirm_pending_action", { pendingActionId: proposed.pending_action_id }));
    assert.equal(mem.notes.length, 1);
    assert.equal(mem.notes[0].note_text, "Called the landlord.");
    assert.equal(mem.notes[0].source, "voice");
    // Regulatory facts untouched.
    assert.deepEqual(mem.businesses.get("biz-allowed")!.passport_json, { alcohol_sold: false });
    assert.ok(mem.audit.some((a) => a.action === "note_added"));
  });

  it("rejects empty and oversized notes", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    assert.equal(
      failCode(await call(db, "add_note", { businessId: "biz-allowed", noteText: "   " })),
      "VALIDATION_ERROR"
    );
    assert.equal(
      failCode(await call(db, "add_note", { businessId: "biz-allowed", noteText: "x".repeat(2001) })),
      "VALIDATION_ERROR"
    );
  });
});

/* ------------------------------------------------------------------ */
/* Secure links: verified email only, scoped, expiring, hashed         */
/* ------------------------------------------------------------------ */

describe("secure links", () => {
  it("send_secure_upload_link emails ONLY the verified account email", async () => {
    const mem = baseMem();
    mem.obligations.push({ id: "obl-1", business_id: "biz-allowed", name: "Permiso único" });
    const db = makeFakeDb(mem);
    const res = okData(
      await call(db, "send_secure_upload_link", {
        businessId: "biz-allowed",
        obligationId: "obl-1",
        to: "evil@x.com",
        recipient: "evil@x.com",
      })
    );
    assert.equal(res.status, "link_sent");
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, "owner@example.com");
    assert.ok(!sentEmails[0].text.includes("evil@x.com"));

    // The raw token lives only in the email; the DB stores only its hash.
    const token = sentEmails[0].text.match(/valt_[A-Za-z0-9_-]+/)?.[0];
    assert.ok(token, "email carries the raw token");
    const stored = [...mem.links.values()][0];
    assert.equal(stored.purpose, "upload_evidence");
    assert.equal(stored.business_id, "biz-allowed");
    assert.equal(stored.obligation_id, "obl-1");
    assert.notEqual(stored.token_hash, token);
    assert.ok(new Date(String(stored.expires_at)).getTime() > Date.now());
  });

  it("upload links redeem with scope; forged tokens do not", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    okData(await call(db, "send_secure_upload_link", { businessId: "biz-allowed" }));
    const token = sentEmails[0].text.match(/valt_[A-Za-z0-9_-]+/)?.[0]!;
    const link = await lookupSecureLink(db as never, token);
    assert.ok(link);
    assert.equal(link!.purpose, "upload_evidence");
    assert.equal(link!.businessId, "biz-allowed");
    assert.equal(link!.userId, "user-1");
    assert.equal(await lookupSecureLink(db as never, `${token}x`), null);
    assert.equal(await lookupSecureLink(db as never, "bogus"), null);
  });

  it("send_secure_action_link only prepares linkable prohibited actions", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    const res = okData(
      await call(db, "send_secure_action_link", {
        businessId: "biz-allowed",
        actionType: "government_submission",
      })
    );
    assert.equal(res.status, "link_sent");
    assert.equal(sentEmails[0].to, "owner@example.com");
    const stored = [...mem.links.values()][0];
    assert.equal(stored.purpose, "secure_action");
    assert.equal(stored.action_type, "government_submission");
    assert.equal(stored.max_uses, 1, "action links are single-use");

    // Non-linkable or non-prohibited action names are rejected.
    for (const bad of ["delete_business", "drop_tables", "send_money"]) {
      const r = await call(db, "send_secure_action_link", {
        businessId: "biz-allowed",
        actionType: bad,
      });
      assert.equal(failCode(r), "VALIDATION_ERROR", bad);
    }
  });

  it("arbitrary recipient arguments are stripped from link tools", () => {
    const tool = MCP_TOOL_MAP.get("send_secure_upload_link")!;
    assert.deepEqual(
      sanitizeArgs(tool, { businessId: "b", to: "evil@x.com", recipient: "evil@x.com", email: "e@x.com" }),
      { businessId: "b" }
    );
  });
});

/* ------------------------------------------------------------------ */
/* Deliverables: plan-gated, deduped, verified-email-only              */
/* ------------------------------------------------------------------ */

describe("deliverables", () => {
  function memWithObligations(): Mem {
    const mem = baseMem();
    mem.obligations.push({
      id: "obl-1",
      business_id: "biz-allowed",
      name: "Permiso único",
      agency: "OGPe",
      status: "PENDING",
      due_date: null,
      evidence_state: "NONE",
      requirement_id: "REQ-1",
    });
    return mem;
  }

  it("free plans are denied deliverable generation", async () => {
    process.env.ADMIN_EMAILS = "someone-else@example.com";
    const mem = memWithObligations();
    mem.plan = "free";
    const db = makeFakeDb(mem);
    const res = await call(db, "generate_deliverable", {
      businessId: "biz-allowed",
      deliverableType: "readiness_report",
    });
    assert.equal(failCode(res), "PLAN_NOT_ENTITLED");
    assert.equal(mem.deliverables.length, 0);
  });

  it("core plans can generate; a retry inside the window dedupes", async () => {
    const mem = memWithObligations();
    const db = makeFakeDb(mem);
    const first = okData(
      await call(db, "generate_deliverable", {
        businessId: "biz-allowed",
        deliverableType: "readiness_report",
      })
    );
    assert.equal(first.status, "generated");
    assert.ok(String(first.filename).endsWith(".pdf"));
    assert.equal(mem.deliverables.length, 1);

    const second = okData(
      await call(db, "generate_deliverable", {
        businessId: "biz-allowed",
        deliverableType: "readiness_report",
      })
    );
    assert.equal(second.status, "already_generated");
    assert.equal(second.deliverable_id, first.deliverable_id);
    assert.equal(mem.deliverables.length, 1, "no duplicate deliverable");
    assert.ok(mem.audit.some((a) => a.action === "deliverable_generated"));
  });

  it("email_deliverable sends a download link only to the verified email", async () => {
    const mem = memWithObligations();
    const db = makeFakeDb(mem);
    const gen = okData(
      await call(db, "generate_deliverable", {
        businessId: "biz-allowed",
        deliverableType: "requirements_summary",
      })
    );
    const emailed = okData(
      await call(db, "email_deliverable", {
        businessId: "biz-allowed",
        deliverableId: gen.deliverable_id,
        to: "evil@x.com",
      })
    );
    assert.equal(emailed.status, "link_sent");
    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, "owner@example.com");
  });

  it("email_deliverable rejects deliverables from another business", async () => {
    const mem = memWithObligations();
    const db = makeFakeDb(mem);
    const res = await call(db, "email_deliverable", {
      businessId: "biz-allowed",
      deliverableId: "someone-elses-id",
    });
    assert.equal(failCode(res), "NOT_FOUND");
    assert.equal(sentEmails.length, 0);
  });

  it("unknown deliverable types are rejected", async () => {
    const mem = memWithObligations();
    const db = makeFakeDb(mem);
    const res = await call(db, "generate_deliverable", {
      businessId: "biz-allowed",
      deliverableType: "tax_return",
    });
    assert.equal(failCode(res), "VALIDATION_ERROR");
  });
});

/* ------------------------------------------------------------------ */
/* Failure contract                                                    */
/* ------------------------------------------------------------------ */

describe("failure contract", () => {
  it("failures are safe: codes without internals", async () => {
    const mem = baseMem();
    const db = makeFakeDb(mem);
    const res = await call(db, "no_such_tool", {});
    assert.equal(failCode(res), "VALIDATION_ERROR");
    const payload = res.payload as { message: string };
    assert.ok(!/at |Error: |node_modules/.test(payload.message));
  });
});
