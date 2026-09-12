// Unit tests for the Phase 2 work-queue + evidence-approval helpers.
// Run with:
//   npx tsx --test src/lib/__tests__/enterprise-work.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  canTransitionTo,
  canEvidenceTransitionTo,
  enforceSeparationOfDuties,
  SeparationOfDutiesError,
  recomputeMatterReadiness,
  getNextVersionNumber,
  evidenceIsApproved,
  obligationHasApprovedEvidence,
  type Queryable,
} from "../enterprise-work";

// ---------------------------------------------------------------------------
// Transition guards
// ---------------------------------------------------------------------------

test("cannot complete work without approved evidence or an exception", () => {
  const r = canTransitionTo("approved", "completed", {
    hasApprovedEvidence: false,
    hasException: false,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /approved evidence or an audited exception/i);
});

test("completion is allowed with approved evidence", () => {
  const r = canTransitionTo("approved", "completed", {
    hasApprovedEvidence: true,
    hasException: false,
  });
  assert.equal(r.ok, true);
});

test("completion is allowed via audited exception", () => {
  const r = canTransitionTo("in_progress", "completed", {
    hasApprovedEvidence: false,
    hasException: true,
  });
  assert.equal(r.ok, true);
});

test("approval requires approved evidence even with an exception flag", () => {
  const r = canTransitionTo("under_review", "approved", {
    hasApprovedEvidence: false,
    hasException: true,
  });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /approved evidence/i);
});

test("illegal transitions are rejected with a reason", () => {
  const r = canTransitionTo("completed", "blocked", {
    hasApprovedEvidence: true,
    hasException: false,
  });
  assert.equal(r.ok, false);
});

test("reopening completed work is allowed", () => {
  const r = canTransitionTo("completed", "in_progress", {
    hasApprovedEvidence: true,
    hasException: false,
  });
  assert.equal(r.ok, true);
});

test("evidence state machine: draft cannot jump to approved", () => {
  assert.equal(canEvidenceTransitionTo("draft", "approved").ok, false);
  assert.equal(canEvidenceTransitionTo("draft", "submitted_for_review").ok, true);
});

test("evidence state machine: review outcomes and re-submission", () => {
  assert.equal(canEvidenceTransitionTo("under_review", "approved").ok, true);
  assert.equal(canEvidenceTransitionTo("under_review", "changes_requested").ok, true);
  assert.equal(canEvidenceTransitionTo("under_review", "rejected").ok, true);
  assert.equal(canEvidenceTransitionTo("changes_requested", "submitted_for_review").ok, true);
  assert.equal(canEvidenceTransitionTo("approved", "draft").ok, false);
  assert.equal(canEvidenceTransitionTo("approved", "superseded").ok, true);
});

// ---------------------------------------------------------------------------
// Separation of duties
// ---------------------------------------------------------------------------

function fakePool(extractedValue: string | null): Queryable {
  // The real query returns COALESCE(terminology->>'separation_of_duties','true'),
  // i.e. the extracted scalar, not the JSON document.
  return {
    query: async () => ({
      rows: extractedValue === null ? [] : [{ v: extractedValue }],
    }),
  };
}

test("separation of duties blocks self-approval by default (no branding row)", async () => {
  const pool = fakePool(null); // no workspace_branding row -> default true
  await assert.rejects(
    enforceSeparationOfDuties(pool, "ws-1", "user-1", "user-1"),
    (e: unknown) => e instanceof SeparationOfDutiesError
  );
});

test("separation of duties blocks self-approval when explicitly enabled", async () => {
  const pool = fakePool("true");
  await assert.rejects(
    enforceSeparationOfDuties(pool, "ws-1", "user-1", "user-1"),
    SeparationOfDutiesError
  );
});

test("separation of duties allows a different reviewer", async () => {
  const pool = fakePool("true");
  await enforceSeparationOfDuties(pool, "ws-1", "user-1", "user-2");
});

test("separation of duties can be disabled per workspace", async () => {
  const pool = fakePool("false");
  await enforceSeparationOfDuties(pool, "ws-1", "user-1", "user-1");
});

// ---------------------------------------------------------------------------
// Readiness from approved evidence only
// ---------------------------------------------------------------------------

interface FakeReadinessRow {
  obligation_id: string;
  mandatory: boolean;
  obligation_status: string;
  work_status: string | null;
  has_approved_evidence: boolean;
  has_pending_evidence: boolean;
  has_evidence: boolean;
}

function readinessPool(rows: FakeReadinessRow[]): { pool: Queryable; updates: unknown[][] } {
  const updates: unknown[][] = [];
  const pool: Queryable = {
    query: async (text: string, params?: unknown[]) => {
      if (/UPDATE matters/.test(text)) {
        updates.push(params ?? []);
        return { rows: [] };
      }
      return { rows: rows as unknown as Array<Record<string, unknown>> };
    },
  };
  return { pool, updates };
}

const MATTER_ID = "11111111-1111-4111-8111-111111111111";

test("approved evidence gives full credit; submitted evidence gives half", async () => {
  const { pool, updates } = readinessPool([
    { obligation_id: "a", mandatory: true, obligation_status: "IN_PROGRESS", work_status: "under_review", has_approved_evidence: true, has_pending_evidence: false, has_evidence: true },
    { obligation_id: "b", mandatory: true, obligation_status: "IN_PROGRESS", work_status: "evidence_submitted", has_approved_evidence: false, has_pending_evidence: true, has_evidence: true },
    { obligation_id: "c", mandatory: true, obligation_status: "MISSING", work_status: "not_started", has_approved_evidence: false, has_pending_evidence: false, has_evidence: true },
    { obligation_id: "d", mandatory: false, obligation_status: "MISSING", work_status: null, has_approved_evidence: false, has_pending_evidence: false, has_evidence: false },
  ]);
  const result = await recomputeMatterReadiness(MATTER_ID, pool);
  assert.ok(result);
  // (1 + 0.5 + 0) / 3 = 50; non-mandatory obligation d is ignored.
  assert.equal(result.score, 50);
  assert.equal(result.mandatoryCount, 3);
  assert.equal(result.fullCount, 1);
  assert.equal(result.partialCount, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0][1], 50);
});

test("enterprise-tracked obligation with no approved evidence gets no credit even if legacy status is CURRENT", async () => {
  const { pool } = readinessPool([
    // Legacy COMPLETED row with no enterprise tracking keeps legacy credit.
    { obligation_id: "legacy", mandatory: true, obligation_status: "COMPLETED", work_status: null, has_approved_evidence: false, has_pending_evidence: false, has_evidence: false },
    // Enterprise-tracked row (work record exists) with legacy CURRENT status: no full credit.
    { obligation_id: "ent", mandatory: true, obligation_status: "CURRENT", work_status: "in_progress", has_approved_evidence: false, has_pending_evidence: false, has_evidence: false },
  ]);
  const result = await recomputeMatterReadiness(MATTER_ID, pool);
  assert.ok(result);
  assert.equal(result.score, 50); // 1 + 0 over 2
});

test("completed work via exception counts as full credit", async () => {
  const { pool } = readinessPool([
    { obligation_id: "x", mandatory: true, obligation_status: "IN_PROGRESS", work_status: "completed", has_approved_evidence: false, has_pending_evidence: false, has_evidence: false },
  ]);
  const result = await recomputeMatterReadiness(MATTER_ID, pool);
  assert.ok(result);
  assert.equal(result.score, 100);
});

test("matter with no mandatory obligations scores 100", async () => {
  const { pool, updates } = readinessPool([]);
  const result = await recomputeMatterReadiness(MATTER_ID, pool);
  assert.ok(result);
  assert.equal(result.score, 100);
  assert.equal(updates[0][1], 100);
});

// ---------------------------------------------------------------------------
// Version numbering + approval checks
// ---------------------------------------------------------------------------

function countPool(count: number): Queryable {
  return {
    query: async () => ({ rows: [{ n: count }] }),
  };
}

test("getNextVersionNumber starts at 1 and increments", async () => {
  assert.equal(await getNextVersionNumber("evidence-1", countPool(0)), 1);
  assert.equal(await getNextVersionNumber("evidence-1", countPool(4)), 5);
});

test("approval checks use enterprise_state = 'approved' only", async () => {
  assert.equal(await evidenceIsApproved("e1", countPool(1)), true);
  assert.equal(await evidenceIsApproved("e1", countPool(0)), false);
  assert.equal(await obligationHasApprovedEvidence("o1", countPool(1)), true);
  assert.equal(await obligationHasApprovedEvidence("o1", countPool(0)), false);
});
