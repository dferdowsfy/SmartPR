import test from "node:test";
import assert from "node:assert/strict";
import { restorableDescription, type DescriptionDraft } from "./descriptionDraft.ts";

const now = 1_800_000_000_000;
const base: DescriptionDraft = { text: "Solar warehouse in Carolina", pending: true, matterKey: "|", savedAt: now - 60_000 };

test("a fresh description for the same matter restores (with its pending flag)", () => {
  assert.deepEqual(restorableDescription(base, "|", now), base);
});

test("a description never restores into a different matter", () => {
  assert.equal(restorableDescription(base, "biz-1|m-1", now), null);
  assert.equal(restorableDescription({ ...base, matterKey: "biz-1|m-1" }, "|", now), null);
});

test("stale or empty descriptions are ignored", () => {
  assert.equal(restorableDescription({ ...base, savedAt: now - 7 * 60 * 60 * 1000 }, "|", now), null);
  assert.equal(restorableDescription({ ...base, text: "   " }, "|", now), null);
  assert.equal(restorableDescription(null, "|", now), null);
});
