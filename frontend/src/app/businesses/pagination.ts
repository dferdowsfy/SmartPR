/**
 * Compact pagination: first, last, and a window around the current page,
 * with "gap" markers for skipped ranges. Never more than 7 page numbers.
 *   pageItems(25, 49) → [1, "gap", 23, 24, 25, 26, 27, "gap", 49]
 */
export type PageItem = number | "gap";

export function pageItems(page: number, total: number): PageItem[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const current = Math.min(Math.max(1, page), total);
  let start = current - 2;
  let end = current + 2;
  if (start <= 3) { start = 2; end = 6; }
  else if (end >= total - 2) { end = total - 1; start = total - 5; }
  const out: PageItem[] = [1];
  if (start > 2) out.push("gap");
  for (let n = start; n <= end; n++) out.push(n);
  if (end < total - 1) out.push("gap");
  out.push(total);
  return out;
}
