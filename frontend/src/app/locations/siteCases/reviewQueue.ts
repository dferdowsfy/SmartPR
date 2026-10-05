// ============================================================================
// Review queue: reads the most recent stored result of `npm run geo:drift`
// (written to $GEO_DRIFT_OUT, default /tmp/geo-drift.json) and groups its items
// by who handles them. Read-only by design: the admin page never runs a live
// lookup, never changes rules or fixtures, and never routes anything to the
// product owner. Map questions go to a qualified land-use reviewer.
// ============================================================================

import { readFileSync } from "node:fs";
import { ROUTE_TEXT, type DriftItem, type DriftRoute } from "./drift.ts";

export const DEFAULT_DRIFT_PATH = "/tmp/geo-drift.json";

/** Display order: things people must look at first. */
export const ROUTE_ORDER: DriftRoute[] = ["land_use_reviewer", "engineering", "auto_resolve"];

export const ROUTE_HELP: Record<DriftRoute, string> = {
  land_use_reviewer: "An official government answer changed. A qualified land-use reviewer decides what it means before any report wording or rule changes.",
  engineering: "The app could not read a live answer the way it reads the record. Engineering fixes it through normal review.",
  auto_resolve: "A government source did not answer. The next scheduled check retries it; repeated failures move to engineering.",
};

export interface ReviewGroup {
  route: DriftRoute;
  title: string;
  help: string;
  items: DriftItem[];
}

export type ReviewQueue =
  | { status: "missing"; path: string }
  | { status: "invalid"; path: string; reason: string }
  | { status: "ok"; path: string; checked_at: string | null; cases: string[]; total: number; dropped: number; groups: ReviewGroup[] };

const str = (v: unknown): v is string => typeof v === "string";

function isDriftItem(v: unknown): v is DriftItem {
  if (!v || typeof v !== "object") return false;
  const i = v as Record<string, unknown>;
  const e = i.evidence as Record<string, unknown> | undefined;
  return str(i.case_id) && str(i.case_label) && str(i.route) && (ROUTE_ORDER as string[]).includes(i.route)
    && str(i.what_changed) && str(i.affects) && str(i.recommended_action)
    && !!e && typeof e === "object" && str(e.source) && str(e.recorded) && str(e.live);
}

/** Group a parsed drift result. Items with an unknown route or shape are dropped and counted. */
export function buildReviewQueue(raw: unknown, path = DEFAULT_DRIFT_PATH): ReviewQueue {
  const doc = Array.isArray(raw) ? { items: raw } : (raw as Record<string, unknown> | null);
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.items)) return { status: "invalid", path, reason: "no items list" };
  const all = doc.items as unknown[];
  const items = all.filter(isDriftItem);
  const groups = ROUTE_ORDER.map((route) => ({
    route, title: ROUTE_TEXT[route], help: ROUTE_HELP[route],
    items: items.filter((i) => i.route === route).sort((a, b) => a.case_label.localeCompare(b.case_label)),
  })).filter((g) => g.items.length > 0);
  return {
    status: "ok", path,
    checked_at: str(doc.checked_at) ? doc.checked_at : null,
    cases: Array.isArray(doc.cases) ? (doc.cases as unknown[]).filter(str) : [],
    total: items.length, dropped: all.length - items.length, groups,
  };
}

/** Read the stored drift result from disk (no network). */
export function loadReviewQueue(path = process.env.GEO_DRIFT_OUT || DEFAULT_DRIFT_PATH): ReviewQueue {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return { status: "missing", path }; }
  try { return buildReviewQueue(JSON.parse(text), path); } catch (err) {
    return { status: "invalid", path, reason: String((err as Error)?.message ?? err).slice(0, 200) };
  }
}
