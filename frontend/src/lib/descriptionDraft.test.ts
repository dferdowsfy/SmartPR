import test from "node:test";
import assert from "node:assert/strict";
import { restorableDescription, type DescriptionDraft } from "./descriptionDraft.ts";

const now = 1_800_000_000_000;
const base: DescriptionDraft = { text: "Solar warehouse in Carolina", pending: true, matterKey: "|", savedAt: now - 60_000 };

test("on a fresh New Business entry the description restores only on a reload", () => {
  assert.deepEqual(restorableDescription(base, "|", now, true), base);
  // E4 (live 2026-10-14): a new ?entry=new-business visit must start empty.
  assert.equal(restorableDescription(base, "|", now, false), null);
  assert.equal(restorableDescription({ ...base, pending: false }, "|", now), null);
});

test("a page that names its business/matter restores its own description on any load", () => {
  const own = { ...base, matterKey: "biz-1|m-1" };
  assert.deepEqual(restorableDescription(own, "biz-1|m-1", now), own);
  assert.deepEqual(restorableDescription(own, "biz-1|m-1", now, true), own);
});

test("a description never restores into a different matter", () => {
  assert.equal(restorableDescription(base, "biz-1|m-1", now, true), null);
  assert.equal(restorableDescription({ ...base, matterKey: "biz-1|m-1" }, "|", now, true), null);
});

test("stale or empty descriptions are ignored", () => {
  assert.equal(restorableDescription({ ...base, savedAt: now - 7 * 60 * 60 * 1000 }, "|", now, true), null);
  assert.equal(restorableDescription({ ...base, text: "   " }, "|", now, true), null);
  assert.equal(restorableDescription(null, "|", now, true), null);
});
