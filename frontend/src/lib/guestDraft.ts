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
