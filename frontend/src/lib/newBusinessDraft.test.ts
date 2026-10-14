import test from "node:test";
import assert from "node:assert/strict";
import { saveNewBusinessDraft, loadNewBusinessDraft, clearNewBusinessDraft, NEW_BUSINESS_DRAFT_TTL_MS } from "./newBusinessDraft.ts";

const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

const state = { profile: { business_type: "Solar Installer", municipality: "Carolina" }, intakeDescription: "warehouse with rooftop solar in Carolina" };

test("draft round-trips for the same user", () => {
  saveNewBusinessDraft("u1", state, 1000);
  assert.deepEqual(loadNewBusinessDraft("u1", 2000)?.state, state);
});

test("draft never restores for another user", () => {
  saveNewBusinessDraft("u1", state, 1000);
  assert.equal(loadNewBusinessDraft("u2", 2000), null);
});

test("stale or cleared drafts are ignored", () => {
  saveNewBusinessDraft("u1", state, 1000);
  assert.equal(loadNewBusinessDraft("u1", 1000 + NEW_BUSINESS_DRAFT_TTL_MS + 1), null);
  clearNewBusinessDraft("u1");
  assert.equal(loadNewBusinessDraft("u1", 2000), null);
});
