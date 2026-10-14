import test from "node:test";
import assert from "node:assert/strict";
import { settleWithin } from "./settleWithin.ts";

test("settleWithin returns the value when work finishes in time", async () => {
  assert.equal(await settleWithin(Promise.resolve(7), 50), 7);
});

test("settleWithin gives up after the deadline instead of hanging", async () => {
  const never = new Promise<number>(() => {});
  const started = Date.now();
  assert.equal(await settleWithin(never, 30), undefined);
  assert.ok(Date.now() - started < 1000);
});

test("settleWithin never rejects", async () => {
  assert.equal(await settleWithin(Promise.reject(new Error("boom")), 50), undefined);
});
