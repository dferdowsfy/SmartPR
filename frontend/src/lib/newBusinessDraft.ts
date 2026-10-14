/**
 * Signed-in "New Business" intake draft (?entry=new-business before any
 * business/matter exists). The server snapshot only starts once a business
 * record is created, so until then a reload lost every interpreted fact and
 * answer. This stores the snapshot-shaped intake state per user, in this
 * browser, and restores it ONLY on a page reload of the same entry URL, so a
 * deliberate fresh "New Business" click still starts blank
 * (REG-LIVE-CROSSMATTER-LEAK-001).
 */
const PREFIX = "smartpr-new-business-draft-v1:";
export const NEW_BUSINESS_DRAFT_TTL_MS = 12 * 60 * 60 * 1000;

export interface NewBusinessDraft {
  userId: string;
  savedAt: number;
  state: Record<string, unknown>;
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function saveNewBusinessDraft(userId: string, state: Record<string, unknown>, now = Date.now()): void {
  const s = storage();
  if (!s || !userId) return;
  try {
    s.setItem(PREFIX + userId, JSON.stringify({ userId, savedAt: now, state } satisfies NewBusinessDraft));
  } catch {
    /* quota / private mode */
  }
}

export function loadNewBusinessDraft(userId: string, now = Date.now()): NewBusinessDraft | null {
  const s = storage();
  if (!s || !userId) return null;
  try {
    const raw = s.getItem(PREFIX + userId);
    if (!raw) return null;
    const d = JSON.parse(raw) as NewBusinessDraft;
    if (!d || d.userId !== userId || typeof d.state !== "object" || !d.state) return null;
    if (!Number.isFinite(d.savedAt) || now - d.savedAt > NEW_BUSINESS_DRAFT_TTL_MS) return null;
    return d;
  } catch {
    return null;
  }
}

export function clearNewBusinessDraft(userId: string): void {
  const s = storage();
  if (!s || !userId) return;
  try {
    s.removeItem(PREFIX + userId);
  } catch {
    /* ignore */
  }
}

/** True when the current document was loaded by a browser reload. */
export function isReloadNavigation(): boolean {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === "reload";
  } catch {
    return false;
  }
}
