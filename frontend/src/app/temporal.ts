// ============================================================================
// Temporal enforcement for the regulatory knowledge graph.
//
// A regulation is only advice while it is *in force*. This module gives the
// platform one deterministic notion of "as of when":
//
//   * Dates are date-only UTC (`YYYY-MM-DD`). No times, no timezones, no
//     ambiguity about what "today" means for a San Juan business.
//   * A record is effective at `asOf` when
//         effective_from <= asOf  AND  (effective_to is null OR asOf < effective_to)
//     `effective_to` is EXCLUSIVE: it is the first day the record is no longer
//     in force (like a hotel checkout date). Documented once, here.
//   * A record with no dates is current law as modeled — undated means
//     "effective now", never "effective never".
//   * `supersedes: [ids]` retires older records: when the superseding record
//     is itself effective at `asOf`, the superseded records are excluded even
//     if their own intervals still cover `asOf`. A supersession asserted by a
//     not-yet-effective (or expired) record does not apply.
//   * Overlapping intervals WITHOUT a supersession edge are both kept; the
//     engine's deterministic first-match ordering decides. Overlap is data to
//     review, not a silent choice.
//   * Inverted intervals (effective_from > effective_to) and supersession
//     cycles fail LOUD at compile time — never silently at runtime.
//
// Enforcement points (both, not one):
//   1. compileKb(nodes, meta, asOf) — jurisdiction-pack compilation filters
//      rules and documents, so a published snapshot only ever contains law in
//      force at its asOf date.
//   2. runRulesEngine(kb, input) — the engine filters kb.rules by
//      input.asOf (default: today UTC), so direct engine calls are also
//      temporally correct.
//
// No real effective dates are invented by this module: the bundled KB carries
// none, so everything stays effective until dated evidence is added. Synthetic
// dated fixtures live only in temporal.test.ts.
// ============================================================================

export interface TemporalRecord {
  id?: string;
  effective_from?: string | null;
  effective_to?: string | null;
  /** Entity ids this record supersedes (retires) once it is itself effective. */
  supersedes?: string[] | null;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Normalize an asOf input to a UTC date-only `YYYY-MM-DD` string.
 *  Default is today (UTC). Throws on anything unparseable — an unknown "when"
 *  must never silently become "now". */
export function normalizeAsOf(input?: string | Date | null): string {
  if (input === undefined || input === null) {
    return new Date().toISOString().slice(0, 10);
  }
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) throw new Error(`TEMPORAL: invalid asOf Date`);
    return input.toISOString().slice(0, 10);
  }
  const s = String(input).trim().slice(0, 10);
  const m = DATE_RE.exec(s);
  if (!m) throw new Error(`TEMPORAL: invalid asOf date "${input}" (expected YYYY-MM-DD)`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new Error(`TEMPORAL: invalid asOf date "${input}" (not a calendar date)`);
  }
  return s;
}

function asDate(value: string | null | undefined, field: string, id: string): string | null {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const s = String(value).trim().slice(0, 10);
  if (!DATE_RE.exec(s)) throw new Error(`TEMPORAL: ${id} has invalid ${field} "${value}" (expected YYYY-MM-DD)`);
  return s;
}

/** True when the record is in force at `asOf` (already normalized). */
export function isEffectiveAt(record: TemporalRecord, asOf: string): boolean {
  const id = record.id ?? "(unknown)";
  const from = asDate(record.effective_from, "effective_from", id);
  const to = asDate(record.effective_to, "effective_to", id);
  if (from && to && from > to) {
    throw new Error(`TEMPORAL: ${id} has inverted interval ${from} > ${to}`);
  }
  if (from && asOf < from) return false;
  if (to && asOf >= to) return false; // effective_to is EXCLUSIVE
  return true;
}

/** Filter records to those in force at `asOf`, then apply supersession.
 *  Records are identified by `id` (fallback: array index). Throws on
 *  inverted intervals and supersession cycles. */
export function filterEffective<T extends TemporalRecord>(records: T[], asOfInput?: string | Date | null): T[] {
  const asOf = normalizeAsOf(asOfInput);
  const idOf = (r: T, i: number) => r.id ?? `#${i}`;
  const byId = new Map<string, T>();
  records.forEach((r, i) => byId.set(idOf(r, i), r));

  // 1. Interval filter (also validates every interval, loud on inversion).
  const effective = records.filter((r) => isEffectiveAt(r, asOf));

  // 2. Supersession: an effective record retires what it supersedes.
  //    Cycle detection over the full supersedes graph first — a cycle is a
  //    data error regardless of which records are effective today.
  const edges = new Map<string, string[]>();
  records.forEach((r, i) => {
    const targets = Array.isArray(r.supersedes) ? r.supersedes.map(String).filter(Boolean) : [];
    edges.set(idOf(r, i), targets);
  });
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`TEMPORAL: supersession cycle detected: ${[...path, id].join(" -> ")}`);
    }
    visiting.add(id);
    for (const t of edges.get(id) ?? []) visit(t, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of edges.keys()) visit(id, []);

  const retired = new Set<string>();
  const indexOf = new Map<T, number>();
  records.forEach((r, i) => indexOf.set(r, i));
  for (const r of effective) {
    for (const t of edges.get(idOf(r, indexOf.get(r)!)) ?? []) {
      if (byId.has(t)) retired.add(t);
    }
  }
  return effective.filter((r) => !retired.has(idOf(r, indexOf.get(r)!)));
}
