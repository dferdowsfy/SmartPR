// Paywall tests: the filled-government-form populate endpoint sits behind the
// deliverables entitlement. Free workspaces get a 402 with an upgrade URL;
// paid workspaces pass through. Uses an in-memory fake pool (no DB).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PlanGateError,
  assertCanUseDeliverables,
  gateJson,
} from "./access.ts";

// Pin the admin allowlist: with ADMIN_EMAILS unset, isAdminEmail() treats
// everyone as an admin and the paywall would never fire.
process.env.ADMIN_EMAILS = "admin@getsmartpr.com";

// Minimal stand-in for pg Pool: only query() is exercised.
function fakeDb(
  rows: Array<{
    plan: string;
    status: string;
    current_period_end?: string | null;
    stripe_subscription_id?: string | null;
  }>
) {
  return {
    query: async () => ({ rows }),
  } as never;
}

test("free workspace is gated with plan_deliverables_locked", async () => {
  const db = fakeDb([]);
  await assert.rejects(
    assertCanUseDeliverables(db, { workspaceId: "ws-1", email: "user@example.com" }),
    (err: unknown) =>
      err instanceof PlanGateError &&
      err.code === "plan_deliverables_locked" &&
      err.status === 402
  );
});

test("paid workspace (core) passes the gate", async () => {
  const db = fakeDb([{ plan: "core", status: "active" }]);
  const state = await assertCanUseDeliverables(db, {
    workspaceId: "ws-1",
    email: "user@example.com",
  });
  assert.equal(state.planId, "core");
});

test("gateJson serializes a PlanGateError as 402 with upgrade URL", async () => {
  const res = gateJson(new PlanGateError("plan_deliverables_locked", "nope"));
  assert.ok(res);
  assert.equal(res.status, 402);
  const body = (await res.json()) as { code: string; upgradeUrl: string };
  assert.equal(body.code, "plan_deliverables_locked");
  assert.equal(body.upgradeUrl, "/pricing");
});

test("gateJson ignores non-gate errors", () => {
  assert.equal(gateJson(new Error("boom")), null);
});

test("pilot grant past its period end is treated as expired (free)", async () => {
  const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const db = fakeDb([
    { plan: "partner", status: "active", current_period_end: past, stripe_subscription_id: null },
  ]);
  await assert.rejects(
    assertCanUseDeliverables(db, { workspaceId: "ws-1", email: "user@example.com" }),
    (err: unknown) => err instanceof PlanGateError && err.code === "plan_deliverables_locked"
  );
});

test("pilot grant within its period passes the gate", async () => {
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const db = fakeDb([
    { plan: "partner", status: "active", current_period_end: future, stripe_subscription_id: null },
  ]);
  const state = await assertCanUseDeliverables(db, {
    workspaceId: "ws-1",
    email: "user@example.com",
  });
  assert.equal(state.planId, "partner");
});

test("stripe-backed subscription past period end is NOT force-expired", async () => {
  const past = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const db = fakeDb([
    { plan: "core", status: "active", current_period_end: past, stripe_subscription_id: "sub_123" },
  ]);
  const state = await assertCanUseDeliverables(db, {
    workspaceId: "ws-1",
    email: "user@example.com",
  });
  assert.equal(state.planId, "core");
});
