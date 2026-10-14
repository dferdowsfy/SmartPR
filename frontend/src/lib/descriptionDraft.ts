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
  /**
   * When the in-flight interpretation started (pending drafts only). A
   * reload resumes the SAME analysis budget instead of starting a new
   * 35-second wait, so the whole analysis stays bounded.
   */
  startedAt?: number;
}

/** The matter key of a fresh "New Business" entry: no business, no matter yet. */
export const FRESH_ENTRY_MATTER_KEY = "|";

export function currentMatterKey(): string {
  if (typeof window === "undefined") return "|";
  const sp = new URLSearchParams(window.location.search);
  return `${sp.get("business") ?? ""}|${sp.get("matter") ?? ""}`;
}

/**
 * Pure: whether a stored description may restore on this page.
 *
 * Every fresh ?entry=new-business page shares the same empty matter key, so
 * on that page a description restores ONLY on a genuine browser reload.
 * Without that, the previous case's text prefilled every new intake (live
 * 2026-10-14, E4). A page that already names its business/matter restores
 * its own description on any load.
 */
export function restorableDescription(
  draft: DescriptionDraft | null,
  matterKey: string,
  now: number,
  isReload = false
): DescriptionDraft | null {
  if (!draft || typeof draft.text !== "string" || !draft.text.trim()) return null;
  if (draft.matterKey !== matterKey) return null;
  if (matterKey === FRESH_ENTRY_MATTER_KEY && !isReload) return null;
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

export function writeDescriptionDraft(text: string, pending: boolean, startedAt?: number): void {
  try {
    if (!text.trim()) {
      window.localStorage.removeItem(DESCRIPTION_DRAFT_KEY);
      return;
    }
    const draft: DescriptionDraft = {
      text,
      pending,
      matterKey: currentMatterKey(),
      savedAt: Date.now(),
      ...(pending && typeof startedAt === "number" ? { startedAt } : {}),
    };
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
