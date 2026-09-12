// Phase 8 tests: domain validation + status machine (mocked DNS),
// branding publish-side validation, and demo-seed idempotency (fake DB).
// Run with:
//   npx tsx --test src/lib/__tests__/enterprise-phase8.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  normalizeDomain,
  isValidHostname,
  challengeHostname,
  verifyDomainDns,
  checkTls,
  transitionOnDnsResult,
  transitionAfterTls,
  canAttemptVerification,
} from "../enterprise-domain";
import {
  isLogoKind,
  logoExtensionForMime,
  isPublishableLogoPath,
  sanitizeEmailHeaderHtml,
  validateTerminology,
  validateLoginBranding,
  isHexColor,
} from "../enterprise-branding";
import {
  seedEnterpriseDemo,
  findDemoWorkspace,
  demoUserId,
  DEMO_WORKSPACE_NAME,
  type Queryable,
} from "../demo-enterprise-seed";

// ---------------------------------------------------------------------------
// Domain hostname validation
// ---------------------------------------------------------------------------

test("normalizeDomain accepts and normalizes valid hostnames", () => {
  assert.equal(normalizeDomain("Portal.ACME.com "), "portal.acme.com");
  assert.equal(normalizeDomain("https://portal.acme.com/some/path"), "portal.acme.com");
  assert.equal(normalizeDomain("http://portal.acme.com:8443"), "portal.acme.com");
  assert.equal(normalizeDomain("sub-domain.example.co.uk"), "sub-domain.example.co.uk");
});

test("normalizeDomain rejects invalid hostnames", () => {
  assert.equal(normalizeDomain(""), null);
  assert.equal(normalizeDomain("   "), null);
  assert.equal(normalizeDomain("not a domain"), null);
  assert.equal(normalizeDomain("-bad.com"), null);
  assert.equal(normalizeDomain("bad-.com"), null);
  assert.equal(normalizeDomain("192.168.1.1"), null); // IP literal: no letter TLD
  assert.equal(normalizeDomain("123.456"), null);
  assert.equal(normalizeDomain("single"), null); // no dot
  assert.equal(normalizeDomain("a".repeat(64) + ".com"), null); // label too long
  assert.equal(normalizeDomain(null), null);
  assert.equal(normalizeDomain(123), null);
});

test("isValidHostname mirrors normalizeDomain", () => {
  assert.equal(isValidHostname("portal.acme.com"), true);
  assert.equal(isValidHostname("nope..com"), false);
});

test("challengeHostname builds the TXT host", () => {
  assert.equal(challengeHostname("portal.acme.com"), "_smartpr-challenge.portal.acme.com");
});

// ---------------------------------------------------------------------------
// DNS verification (mocked resolver)
// ---------------------------------------------------------------------------

test("verifyDomainDns matches when the token is in the TXT records", async () => {
  const out = await verifyDomainDns("portal.acme.com", "tok123", async (host) => {
    assert.equal(host, "_smartpr-challenge.portal.acme.com");
    return [["v=spf1"], ["tok123"]];
  });
  assert.equal(out.matched, true);
  assert.equal(out.error, null);
});

test("verifyDomainDns fails when the token is absent", async () => {
  const out = await verifyDomainDns("portal.acme.com", "tok123", async () => [["something-else"]]);
  assert.equal(out.matched, false);
  assert.match(out.error || "", /_smartpr-challenge\.portal\.acme\.com/);
});

test("verifyDomainDns reports resolver errors without matching", async () => {
  const out = await verifyDomainDns("portal.acme.com", "tok123", async () => {
    throw new Error("ENOTFOUND");
  });
  assert.equal(out.matched, false);
  assert.match(out.error || "", /ENOTFOUND/);
});

// ---------------------------------------------------------------------------
// TLS check (mocked prober)
// ---------------------------------------------------------------------------

test("checkTls records ok when the probe succeeds", async () => {
  const out = await checkTls("portal.acme.com", async () => {});
  assert.equal(out.tlsStatus, "ok");
});

test("checkTls records failed when the probe throws a TLS error", async () => {
  const out = await checkTls("portal.acme.com", async () => {
    const err = new Error("certificate expired") as Error & { code?: string };
    err.code = "CERT_HAS_EXPIRED";
    throw err;
  });
  assert.equal(out.tlsStatus, "failed");
  assert.match(out.detail, /certificate expired/);
});

test("checkTls records unchecked when the domain does not resolve", async () => {
  const out = await checkTls("portal.acme.com", async () => {
    const err = new Error("getaddrinfo ENOTFOUND portal.acme.com") as Error & { code?: string };
    err.code = "ENOTFOUND";
    throw err;
  });
  assert.equal(out.tlsStatus, "unchecked");
  assert.match(out.detail, /does not resolve/);
});

// ---------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------

test("DNS mismatch transitions to failed", () => {
  for (const from of ["pending", "verifying", "failed"] as const) {
    const t = transitionOnDnsResult(from, false);
    assert.equal(t.to, "failed");
  }
});

test("DNS match transitions to verifying; active requires TLS ok (or documented unchecked)", () => {
  const step1 = transitionOnDnsResult("pending", true);
  assert.equal(step1.to, "verifying");
  const ok = transitionAfterTls("ok");
  assert.equal(ok.to, "active");
  assert.equal(ok.tlsStatus, "ok");
  const unchecked = transitionAfterTls("unchecked");
  assert.equal(unchecked.to, "active");
  assert.equal(unchecked.tlsStatus, "unchecked");
  assert.ok(unchecked.note && unchecked.note.length > 0); // documented reason required
});

test("TLS failure NEVER yields active: domain stays verifying", () => {
  for (const t of [transitionAfterTls("failed")]) {
    assert.equal(t.to, "verifying");
    assert.equal(t.tlsStatus, "failed");
    assert.notEqual(t.to, "active");
  }
  // Unknown TLS states fail closed too.
  const unknown = transitionAfterTls("unknown");
  assert.notEqual(unknown.to, "active");
});

test("verification can be attempted from pending/verifying/failed only", () => {
  assert.equal(canAttemptVerification("pending"), true);
  assert.equal(canAttemptVerification("verifying"), true);
  assert.equal(canAttemptVerification("failed"), true);
  assert.equal(canAttemptVerification("active"), false);
});

// ---------------------------------------------------------------------------
// Branding publish-side validation
// ---------------------------------------------------------------------------

test("logo kind and MIME mapping", () => {
  assert.equal(isLogoKind("primary"), true);
  assert.equal(isLogoKind("banner"), false);
  assert.equal(logoExtensionForMime("image/png"), "png");
  assert.equal(logoExtensionForMime("image/jpeg"), "jpg");
  assert.equal(logoExtensionForMime("image/svg+xml"), "svg");
  assert.equal(logoExtensionForMime("application/pdf"), null);
});

test("isPublishableLogoPath binds paths to the upload step and workspace", () => {
  const ws = randomUUID();
  const good = `${ws}/primary-1757779200000-ab12cd34.png`;
  assert.equal(isPublishableLogoPath(good, ws, "primary"), true);
  assert.equal(isPublishableLogoPath(good, ws, "compact"), false); // kind mismatch
  assert.equal(isPublishableLogoPath(good, randomUUID(), "primary"), false); // workspace mismatch
  assert.equal(isPublishableLogoPath(`${ws}/primary-123-deadbeef.png`, ws, "primary"), true);
  assert.equal(isPublishableLogoPath(`/etc/passwd`, ws, "primary"), false);
  assert.equal(isPublishableLogoPath(`${ws}/../../evil.png`, ws, "primary"), false);
  assert.equal(isPublishableLogoPath(null, ws, "primary"), false);
});

test("sanitizeEmailHeaderHtml strips scripts, handlers, and javascript URLs", () => {
  const dirty = `<div onclick="steal()"><script>alert(1)</script><a href="javascript:evil()">x</a><a href="https://acme.com">ok</a></div>`;
  const clean = sanitizeEmailHeaderHtml(dirty);
  assert.ok(clean && !clean.includes("<script>"));
  assert.ok(clean && !clean.includes("onclick"));
  assert.ok(clean && !clean.includes("javascript:"));
  assert.ok(clean && clean.includes("https://acme.com"));
  assert.equal(sanitizeEmailHeaderHtml(""), null);
  assert.equal(sanitizeEmailHeaderHtml(null), null);
  assert.equal(sanitizeEmailHeaderHtml(42), null);
});

test("validateTerminology keeps known string labels only", () => {
  const t = validateTerminology({ project_label: " Filing ", bogus: "x", requirement_label: "Req" });
  assert.deepEqual(t, { project_label: "Filing", requirement_label: "Req" });
  assert.equal(validateTerminology({ project_label: 5 }), null);
  assert.equal(validateTerminology([1, 2]), null);
  assert.deepEqual(validateTerminology(null), {});
  assert.deepEqual(validateLoginBranding({ headline: "hi" }), { headline: "hi" });
  assert.equal(validateLoginBranding("nope"), null);
});

test("isHexColor", () => {
  assert.equal(isHexColor("#245c5c"), true);
  assert.equal(isHexColor("#245C5C"), true);
  assert.equal(isHexColor("245c5c"), false);
  assert.equal(isHexColor("#245c5"), false);
  assert.equal(isHexColor("#245c5g"), false);
});

// ---------------------------------------------------------------------------
// Demo seed idempotency (stateful fake DB)
// ---------------------------------------------------------------------------

/** Minimal in-memory fake that understands the seed's SQL patterns. */
class FakeDb implements Queryable {
  tables: Record<string, Array<Record<string, unknown>>> = {};
  queries: string[] = [];
  private tbl(name: string) {
    return (this.tables[name] ??= []);
  }
  async query(text: string, params: unknown[] = []) {
    this.queries.push(text);
    const t = text.trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)\b/i.test(t)) return { rows: [] as Array<Record<string, unknown>> };

    if (t.startsWith("SELECT id::text AS id FROM requirement_rules")) {
      const rows = this.tbl("requirement_rules").filter(
        (r) => r.requirement_name === params[0] && r.municipality === params[1] && r.business_type === params[2]
      );
      return { rows: rows.map((r) => ({ id: r.id })) };
    }
    if (t.startsWith("INSERT INTO requirement_rules")) {
      const id = randomUUID();
      this.tbl("requirement_rules").push({
        id, municipality: params[0], business_type: params[2], requirement_name: params[5],
      });
      return { rows: [{ id }] };
    }
    if (t.startsWith("SELECT id::text AS id FROM workspaces WHERE name")) {
      const rows = this.tbl("workspaces").filter((r) => r.name === params[0] && !r.archived_at);
      return { rows: rows.map((r) => ({ id: r.id })) };
    }
    if (t.startsWith("DELETE FROM workspaces")) {
      // Fake cascade: wipes the demo workspace subtree but preserves the
      // shared knowledge-graph requirement_rules (guarded in the real seed).
      for (const k of Object.keys(this.tables)) {
        if (k !== "requirement_rules") this.tables[k] = [];
      }
      return { rows: [] };
    }
    const m = t.match(/^INSERT INTO (\w+)/);
    if (m) {
      const table = m[1];
      const returning = /RETURNING id::text AS id/.test(t);
      const first = params[0];
      const id = typeof first === "string" && /^[0-9a-f-]{36}$/i.test(first) ? first : randomUUID();
      this.tbl(table).push({ id, params, name: typeof params[2] === "string" ? params[2] : undefined });
      if (returning) return { rows: [{ id }] };
      return { rows: [] };
    }
    throw new Error(`FakeDb: unhandled SQL: ${t.slice(0, 90)}`);
  }
  count(table: string) {
    return (this.tables[table] ?? []).length;
  }
}

test("demoUserId is deterministic and uuid-shaped", () => {
  const a = demoUserId("org_owner");
  const b = demoUserId("org_owner");
  const c = demoUserId("auditor");
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("seed is idempotent: run twice produces no duplicates", async () => {
  const db = new FakeDb();
  const actor = randomUUID();
  const first = await seedEnterpriseDemo(db, actor, "admin@smartpr.test");
  assert.equal(first.reset, false);
  assert.equal(await findDemoWorkspace(db), first.workspaceId);

  const countsAfterFirst: Record<string, number> = {};
  for (const tbl of ["workspaces", "businesses", "facilities", "matters", "obligations",
    "obligation_work", "evidence", "evidence_versions", "evidence_reviews",
    "enterprise_roles", "role_assignments", "deadline_schedules",
    "regulatory_events", "regulatory_impacts", "notifications",
    "webhook_endpoints", "workspace_members", "audit_events", "requirement_rules"]) {
    countsAfterFirst[tbl] = db.count(tbl);
  }

  const second = await seedEnterpriseDemo(db, actor, "admin@smartpr.test");
  assert.equal(second.reset, true);
  assert.notEqual(second.workspaceId, first.workspaceId); // wiped + restored
  assert.equal(await findDemoWorkspace(db), second.workspaceId);

  for (const [tbl, n] of Object.entries(countsAfterFirst)) {
    assert.equal(db.count(tbl), n, `table ${tbl}: expected ${n}, got ${db.count(tbl)} after reseed`);
  }

  // Spot-check the expected shape of one seed.
  assert.equal(db.count("workspaces"), 1);
  assert.equal(db.count("facilities"), 5);
  assert.equal(db.count("obligations"), 8);
  assert.equal(db.count("obligation_work"), 8);
  assert.equal(db.count("evidence"), 8);
  assert.equal(db.count("evidence_versions"), 9); // approved evidence has 2 versions
  assert.equal(db.count("evidence_reviews"), 2); // approve + request_changes
  assert.equal(db.count("enterprise_roles"), 10);
  assert.equal(db.count("role_assignments"), 7); // caller + 6 fictional users
  assert.equal(db.count("deadline_schedules"), 3);
  assert.equal(db.count("regulatory_events"), 1);
  assert.equal(db.count("regulatory_impacts"), 1);
  assert.equal(db.count("webhook_endpoints"), 1);
  assert.equal(db.count("requirement_rules"), 4); // guarded KG inserts, not duplicated
});

test("seeded demo workspace has the expected name", async () => {
  const db = new FakeDb();
  await seedEnterpriseDemo(db, randomUUID(), "admin@smartpr.test");
  const ws = db.tables["workspaces"][0];
  assert.equal((ws.params as unknown[] | undefined)?.[2], DEMO_WORKSPACE_NAME);
});

test("seed literals match the live check constraints", async () => {
  // The live DB enforces enum-style CHECK constraints; the seed must use the
  // exact values or the seed fails. Caught 2026-09-12 (in_app/pending/demo).
  const db = new FakeDb();
  await seedEnterpriseDemo(db, randomUUID(), "admin@smartpr.test");
  const insertFor = (table: string) =>
    db.queries.find((q) => new RegExp(`INSERT INTO ${table}\\b`).test(q));
  const notif = insertFor("notifications") ?? "";
  assert.ok(/'IN_APP'/.test(notif), "notifications channel must be IN_APP");
  assert.ok(/'PENDING'/.test(notif), "notifications status must be PENDING");
  assert.ok(!/'in_app'/.test(notif) && !/'pending'/.test(notif), "no lowercase variants");
  const impact = insertFor("regulatory_impacts") ?? "";
  assert.ok(/'projected'/.test(impact), "impact applicability must be projected");
  assert.ok(!/'demo'/.test(impact), "no 'demo' applicability");
  const sched = insertFor("deadline_schedules") ?? "";
  assert.ok(/'one_time'/.test(sched), "deadline schedule type must be one_time");
  // Evidence rows carry all 8 enterprise states as params (index 7).
  const legalStates = new Set([
    "draft", "submitted_for_review", "under_review", "changes_requested",
    "approved", "rejected", "superseded", "expired",
  ]);
  const evidenceParams = (db.tables["evidence"] ?? []).map(
    (r) => ((r.params as unknown[]) ?? [])[7]
  );
  assert.equal(evidenceParams.length, 8, "8 evidence rows seeded");
  for (const s of evidenceParams) {
    assert.ok(legalStates.has(String(s)), `evidence state must be legal: ${s}`);
  }
  assert.equal(legalStates.size, new Set(evidenceParams).size, "all 8 states distinct");
});
