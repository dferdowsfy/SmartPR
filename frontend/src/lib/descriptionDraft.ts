/**
 * The typed description survives a reload. It is stored only until an
 * interpretation succeeds (after that the intake's own draft / snapshot
 * carries the facts) and only for the same matter URL, so it can never leak
 * into a different intake (REG-LIVE-CROSSMATTER-LEAK-001).
 */
export const DESCRIPTION_DRAFT_KEY = "smartpr-intake-description-v1";
const DESCRIPTION_DRAFT_TTL_MS = 6 * 60 * 60 * 1000;

export interface DescriptionDraft {
  text: string;
  /** True while an interpretation was in flight; a reload re-runs it. */
  pending: boolean;
  matterKey: string;
  savedAt: number;
}

export function currentMatterKey(): string {
  if (typeof window === "undefined") return "|";
  const sp = new URLSearchParams(window.location.search);
  return `${sp.get("business") ?? ""}|${sp.get("matter") ?? ""}`;
}

/** Pure: whether a stored description may restore on this page. */
export function restorableDescription(
  draft: DescriptionDraft | null,
  matterKey: string,
  now: number
): DescriptionDraft | null {
  if (!draft || typeof draft.text !== "string" || !draft.text.trim()) return null;
  if (draft.matterKey !== matterKey) return null;
  if (!Number.isFinite(draft.savedAt) || now - draft.savedAt > DESCRIPTION_DRAFT_TTL_MS) return null;
  return draft;
}

export function readDescriptionDraft(): DescriptionDraft | null {
  try {
    const raw = window.localStorage.getItem(DESCRIPTION_DRAFT_KEY);
    return raw ? (JSON.parse(raw) as DescriptionDraft) : null;
  } catch {
    return null;
  }
}

export function writeDescriptionDraft(text: string, pending: boolean): void {
  try {
    if (!text.trim()) {
      window.localStorage.removeItem(DESCRIPTION_DRAFT_KEY);
      return;
    }
    const draft: DescriptionDraft = { text, pending, matterKey: currentMatterKey(), savedAt: Date.now() };
    window.localStorage.setItem(DESCRIPTION_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* private mode / quota */
  }
}

export function clearDescriptionDraft(): void {
  try {
    window.localStorage.removeItem(DESCRIPTION_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
