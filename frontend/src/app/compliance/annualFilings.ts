// Pure helpers for the annual-filings surface. An "annual filing" is an
// obligation whose renewal cadence is 12 months — Informe Anual, Patente
// municipal, CRIM and friends. The cadence itself comes from the structured
// renewal graph; nothing here invents a deadline.

export interface FilingLike {
  id: string;
  business_id: string;
  business_name: string;
  name: string;
  agency: string | null;
  due_date: string | null;
  status: string;
  renewal_frequency_months: number | null;
  cycle_index?: number | null;
  item_type?: string;
}

export function isAnnualFiling(item: FilingLike): boolean {
  return item.item_type !== "MATTER" && item.renewal_frequency_months === 12;
}

/** Calendar year the filing belongs to, from its due date. */
export function filingYear(dueDate: string | null): string | null {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return null;
  return dueDate.slice(0, 4);
}

export function sortFilings<T extends FilingLike>(filings: T[]): T[] {
  return [...filings].sort((a, b) => {
    if (!a.due_date && !b.due_date) return a.name.localeCompare(b.name);
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
}

export interface BusinessFilingGroup {
  business_id: string;
  business_name: string;
  filings: FilingLike[];
}

export function groupAnnualFilings(items: FilingLike[]): BusinessFilingGroup[] {
  const groups = new Map<string, BusinessFilingGroup>();
  for (const item of items) {
    if (!isAnnualFiling(item)) continue;
    const existing = groups.get(item.business_id);
    if (existing) existing.filings.push(item);
    else groups.set(item.business_id, { business_id: item.business_id, business_name: item.business_name, filings: [item] });
  }
  const out = [...groups.values()];
  for (const group of out) group.filings = sortFilings(group.filings);
  out.sort((a, b) => a.business_name.localeCompare(b.business_name));
  return out;
}

export interface FilingCounts {
  total: number;
  overdue: number;
  dueSoon: number; // due within 30 days, not overdue
  filed: number; // completed
  upcoming: number; // everything else with a known status
}

export function countFilings(filings: FilingLike[]): FilingCounts {
  const counts: FilingCounts = { total: 0, overdue: 0, dueSoon: 0, filed: 0, upcoming: 0 };
  for (const filing of filings) {
    if (!isAnnualFiling(filing)) continue;
    counts.total += 1;
    if (filing.status === "COMPLETED") counts.filed += 1;
    else if (filing.status === "OVERDUE") counts.overdue += 1;
    else if (filing.status === "DUE_SOON") counts.dueSoon += 1;
    else counts.upcoming += 1;
  }
  return counts;
}
