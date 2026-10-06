const KEY = "smartpr-guest-draft-v1";

export interface GuestDraft {
  profile: Record<string, unknown>;
  discoveryAnswers: Record<string, unknown>;
  potentialDecisions: Record<string, string>;
  requirements?: unknown[];
  incentiveFacts?: Record<string, string | number | boolean | string[] | null | undefined>;
  incentiveAssessmentHistory?: unknown[];
  pursuedIncentives?: unknown[];
  /** Confirmed intake site (IntakeSite JSON; revalidated by restoreIntakeSite). */
  intakeSite?: unknown;
  currentStep: number;
  language: string;
  savedAt: number;
  /**
   * Matter identity (`business|matter`) of the URL this draft was saved
   * from. The intake only restores a draft whose key matches the current
   * URL — a stale draft from another matter must never hydrate into the
   * wrong intake (REG-LIVE-CROSSMATTER-LEAK-001).
   */
  matterKey?: string;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadGuestDraft(): GuestDraft | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuestDraft;
    if (!parsed || typeof parsed !== "object" || !parsed.profile) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveGuestDraft(draft: Omit<GuestDraft, "savedAt">): void {
  if (!canUseStorage()) return;
  try {
    const payload: GuestDraft = { ...draft, savedAt: Date.now() };
    window.localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

export function clearGuestDraft(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function hasGuestDraft(): boolean {
  return loadGuestDraft() !== null;
}

/**
 * Matter identity for a URL search string: `business|matter`. Two mounts
 * for the same matter share a key; anything else (another matter, a fresh
 * intake, a legacy param-less URL) does not.
 */
export function matterKeyForSearch(search: string): string {
  const sp = new URLSearchParams(search);
  return `${sp.get("business") ?? ""}|${sp.get("matter") ?? ""}`;
}

/**
 * Whether a saved guest draft may hydrate on a page with the given URL
 * search string. A draft restores only for the matter identity it was saved
 * from; legacy drafts (no key) are treated as param-less sessions.
 * (REG-LIVE-CROSSMATTER-LEAK-001)
 */
export function draftMatchesUrl(draft: GuestDraft, search: string): boolean {
  return (draft.matterKey ?? "|") === matterKeyForSearch(search);
}

// ---------------------------------------------------------------------------
// One-time ChatGPT handoff draft.
//
// The ChatGPT "continue in SmartPR" handoff saves the scenario and navigates
// to `/?entry=new-business&source=chatgpt` via a full page load. That draft
// must hydrate exactly once, on the immediate next mount — it must never be
// confused with a stale guest draft from an earlier intake, and it must not
// linger to contaminate a later one (REG-LIVE-CROSSMATTER-LEAK-001). A
// separate key with read-and-delete semantics gives both guarantees.
// ---------------------------------------------------------------------------
const HANDOFF_KEY = "smartpr-handoff-draft-v1";

export function saveHandoffDraft(draft: Omit<GuestDraft, "savedAt">): void {
  if (!canUseStorage()) return;
  try {
    const payload: GuestDraft = { ...draft, savedAt: Date.now() };
    window.localStorage.setItem(HANDOFF_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

/** Read the handoff draft and delete it so it can never hydrate twice. */
export function takeHandoffDraft(): GuestDraft | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(HANDOFF_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(HANDOFF_KEY);
    const parsed = JSON.parse(raw) as GuestDraft;
    if (!parsed || typeof parsed !== "object" || !parsed.profile) return null;
    return parsed;
  } catch {
    return null;
  }
}
