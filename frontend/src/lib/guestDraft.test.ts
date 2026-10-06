import test from "node:test";
import assert from "node:assert/strict";
import {
  saveGuestDraft,
  loadGuestDraft,
  clearGuestDraft,
  saveHandoffDraft,
  takeHandoffDraft,
  matterKeyForSearch,
  draftMatchesUrl,
  type GuestDraft,
} from "./guestDraft.ts";

// Minimal browser-env stub: guestDraft guards on window/localStorage.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

function blankDraft(over: Partial<GuestDraft> = {}): Omit<GuestDraft, "savedAt"> {
  return {
    profile: { business_type: "bakery" },
    discoveryAnswers: {},
    potentialDecisions: {},
    currentStep: 1,
    language: "en",
    ...over,
  };
}

test("matterKeyForSearch builds business|matter identity", () => {
  assert.equal(matterKeyForSearch("?business=abc&matter=xyz"), "abc|xyz");
  assert.equal(matterKeyForSearch("?business=abc"), "abc|");
  assert.equal(matterKeyForSearch(""), "|");
  assert.equal(matterKeyForSearch("?entry=new-business"), "|");
});

test("draftMatchesUrl: same matter restores (REG-LIVE-CROSSMATTER-LEAK-001)", () => {
  const d = blankDraft({ matterKey: "bizA|matA" });
  assert.equal(draftMatchesUrl(d as GuestDraft, "?business=bizA&matter=matA"), true);
});

test("draftMatchesUrl: different matter never restores (REG-LIVE-CROSSMATTER-LEAK-001)", () => {
  const d = blankDraft({ matterKey: "bizA|matA" });
  assert.equal(draftMatchesUrl(d as GuestDraft, "?business=bizB&matter=matB"), false);
  assert.equal(draftMatchesUrl(d as GuestDraft, "?business=bizA"), false);
  assert.equal(draftMatchesUrl(d as GuestDraft, ""), false);
});

test("draftMatchesUrl: business-param URL rejects param-less draft (REG-LIVE-CROSSMATTER-LEAK-001)", () => {
  const d = blankDraft({ matterKey: "|" });
  assert.equal(draftMatchesUrl(d as GuestDraft, "?business=bizA&matter=matA"), false);
  assert.equal(draftMatchesUrl(d as GuestDraft, ""), true);
});

test("draftMatchesUrl: legacy draft without key treated as param-less session", () => {
  const d = blankDraft();
  assert.equal(draftMatchesUrl(d as GuestDraft, ""), true);
  assert.equal(draftMatchesUrl(d as GuestDraft, "?business=bizA"), false);
});

test("guest draft round-trip preserves matterKey", () => {
  clearGuestDraft();
  saveGuestDraft(blankDraft({ matterKey: "bizA|matA" }));
  const loaded = loadGuestDraft();
  assert.ok(loaded);
  assert.equal(loaded.matterKey, "bizA|matA");
  clearGuestDraft();
  assert.equal(loadGuestDraft(), null);
});

test("takeHandoffDraft is read-and-delete: hydrates exactly once", () => {
  takeHandoffDraft(); // clear any prior
  saveHandoffDraft(blankDraft({ profile: { business_type: "restaurant" } }));
  const first = takeHandoffDraft();
  assert.ok(first);
  assert.equal((first.profile as Record<string, unknown>).business_type, "restaurant");
  assert.equal(takeHandoffDraft(), null, "second take must be null — no double hydrate");
});

test("takeHandoffDraft returns null when empty and on malformed data", () => {
  takeHandoffDraft();
  assert.equal(takeHandoffDraft(), null);
  (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage.setItem(
    "smartpr-handoff-draft-v1",
    "not-json{{{"
  );
  assert.equal(takeHandoffDraft(), null);
});
