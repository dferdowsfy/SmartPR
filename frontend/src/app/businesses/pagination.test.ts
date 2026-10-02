import { test } from "node:test";
import assert from "node:assert/strict";
import { pageItems } from "./pagination.ts";

const nums = (xs: unknown[]) => xs.filter((x) => typeof x === "number").length;

test("middle page", () => assert.deepEqual(pageItems(25, 49), [1, "gap", 23, 24, 25, 26, 27, "gap", 49]));
test("start", () => {
  assert.deepEqual(pageItems(1, 49), [1, 2, 3, 4, 5, 6, "gap", 49]);
  assert.deepEqual(pageItems(4, 49), [1, 2, 3, 4, 5, 6, "gap", 49]);
  assert.deepEqual(pageItems(5, 49), [1, 2, 3, 4, 5, 6, "gap", 49]);
  assert.deepEqual(pageItems(6, 49), [1, "gap", 4, 5, 6, 7, 8, "gap", 49]);
});
test("end", () => {
  assert.deepEqual(pageItems(49, 49), [1, "gap", 44, 45, 46, 47, 48, 49]);
  assert.deepEqual(pageItems(46, 49), [1, "gap", 44, 45, 46, 47, 48, 49]);
});
test("small totals show every page", () => {
  assert.deepEqual(pageItems(1, 1), [1]);
  assert.deepEqual(pageItems(3, 7), [1, 2, 3, 4, 5, 6, 7]);
});
test("never more than 7 numbers, always includes current, first, last", () => {
  for (let total = 1; total <= 60; total++) for (let p = 1; p <= total; p++) {
    const it = pageItems(p, total);
    assert.ok(nums(it) <= 7, `${p}/${total}`);
    assert.ok(it.includes(p) && it.includes(1) && it.includes(total), `${p}/${total}`);
  }
});
