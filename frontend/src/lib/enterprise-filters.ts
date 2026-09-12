// ============================================================================
// Enterprise portfolio filter contract — Phase 3.
//
// The SAME filter contract drives the portfolio dashboard, the work queue
// (/enterprise/work, Phase 2) and all executive reports. Query params:
//   business=<uuid> facility=<uuid> municipality=<name> project=<uuid>
//   status=<status> agency=<name> owner=<uuid> department=<name>
//   priority=<low|medium|high|critical> due_from=<YYYY-MM-DD>
//   due_to=<YYYY-MM-DD> domain=<requirement_category>
// All list params accept comma-separated or repeated values.
//
// Server-side only (SQL builders). parsePortfolioFilters() is pure and safe
// to unit test.
// ============================================================================

export interface PortfolioFilters {
  businessIds: string[];
  facilityIds: string[];
  municipalities: string[];
  projectIds: string[];
  statuses: string[];
  agencies: string[];
  ownerIds: string[];
  departments: string[];
  priorities: string[];
  dueFrom: string | null;
  dueTo: string | null;
  domains: string[];
}

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function splitList(values: (string | null)[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    for (const part of v.split(",")) {
      const t = part.trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

/**
 * Parse + validate portfolio filters from query params.
 * Returns the filters and a list of validation errors (empty when valid).
 */
export function parsePortfolioFilters(sp: URLSearchParams): {
  filters: PortfolioFilters;
  errors: string[];
} {
  const errors: string[] = [];

  const uuidList = (key: string): string[] => {
    const raw = splitList(sp.getAll(key));
    const bad = raw.filter((v) => !UUID_RE.test(v));
    if (bad.length > 0) {
      errors.push(
        `Invalid ${key} id(s): ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? "…" : ""}`
      );
    }
    return raw.filter((v) => UUID_RE.test(v));
  };

  const textList = (key: string): string[] => splitList(sp.getAll(key));

  const dateParam = (key: string): string | null => {
    const raw = (sp.get(key) || "").trim();
    if (!raw) return null;
    if (!DATE_RE.test(raw)) {
      errors.push(`Invalid ${key}: expected YYYY-MM-DD, got "${raw.slice(0, 20)}"`);
      return null;
    }
    return raw;
  };

  const priorities = textList("priority").map((p) => p.toLowerCase());
  const badPriorities = priorities.filter(
    (p) => !["low", "medium", "high", "critical"].includes(p)
  );
  if (badPriorities.length > 0) {
    errors.push(
      `Invalid priority value(s): ${[...new Set(badPriorities)].join(", ")} (expected low|medium|high|critical)`
    );
  }

  const dueFrom = dateParam("due_from");
  const dueTo = dateParam("due_to");
  if (dueFrom && dueTo && dueFrom > dueTo) {
    errors.push("Invalid deadline range: due_from is after due_to");
  }

  return {
    filters: {
      businessIds: uuidList("business"),
      facilityIds: uuidList("facility"),
      municipalities: textList("municipality"),
      projectIds: uuidList("project"),
      statuses: textList("status"),
      agencies: textList("agency"),
      ownerIds: uuidList("owner"),
      departments: textList("department"),
      priorities: priorities.filter((p) =>
        ["low", "medium", "high", "critical"].includes(p)
      ),
      dueFrom,
      dueTo,
      domains: textList("domain"),
    },
    errors,
  };
}

/** Human-readable summary of the applied filters (PDFs, methodology notes). */
export function describeFilters(f: PortfolioFilters): string[] {
  const out: string[] = [];
  const join = (xs: string[]) => xs.slice(0, 5).join(", ") + (xs.length > 5 ? ` (+${xs.length - 5} more)` : "");
  if (f.businessIds.length) out.push(`Businesses: ${f.businessIds.length} selected`);
  if (f.facilityIds.length) out.push(`Facilities: ${f.facilityIds.length} selected`);
  if (f.municipalities.length) out.push(`Municipalities: ${join(f.municipalities)}`);
  if (f.projectIds.length) out.push(`Projects: ${f.projectIds.length} selected`);
  if (f.statuses.length) out.push(`Statuses: ${join(f.statuses)}`);
  if (f.agencies.length) out.push(`Agencies: ${join(f.agencies)}`);
  if (f.ownerIds.length) out.push(`Owners: ${f.ownerIds.length} selected`);
  if (f.departments.length) out.push(`Departments: ${join(f.departments)}`);
  if (f.priorities.length) out.push(`Priorities: ${join(f.priorities)}`);
  if (f.dueFrom || f.dueTo) out.push(`Deadline range: ${f.dueFrom ?? "…"} → ${f.dueTo ?? "…"}`);
  if (f.domains.length) out.push(`Requirement domains: ${join(f.domains)}`);
  return out;
}

/** True when at least one filter is active. */
export function hasActiveFilters(f: PortfolioFilters): boolean {
  return describeFilters(f).length > 0;
}

/** Serialize filters back to query params (drill-down links, export URLs). */
export function filtersToSearchParams(f: PortfolioFilters): URLSearchParams {
  const p = new URLSearchParams();
  for (const v of f.businessIds) p.append("business", v);
  for (const v of f.facilityIds) p.append("facility", v);
  for (const v of f.municipalities) p.append("municipality", v);
  for (const v of f.projectIds) p.append("project", v);
  for (const v of f.statuses) p.append("status", v);
  for (const v of f.agencies) p.append("agency", v);
  for (const v of f.ownerIds) p.append("owner", v);
  for (const v of f.departments) p.append("department", v);
  for (const v of f.priorities) p.append("priority", v);
  if (f.dueFrom) p.set("due_from", f.dueFrom);
  if (f.dueTo) p.set("due_to", f.dueTo);
  for (const v of f.domains) p.append("domain", v);
  return p;
}

// ---------------------------------------------------------------------------
// SQL clause builders.
// All builders assume $1 is the workspace_id. Returned params are appended
// after it, so clause placeholders start at $2.
// Fixed table aliases: o=obligations, b=businesses, ow=obligation_work,
// m=matters, e=evidence.
// ---------------------------------------------------------------------------

interface ClauseAcc {
  sql: string[];
  params: unknown[];
  /** next placeholder index ($1 is reserved for workspace_id) */
  next(): string;
}

function acc(): ClauseAcc {
  const params: unknown[] = [];
  return {
    sql: [],
    params,
    next() {
      return `$${params.length + 2}`;
    },
  };
}

function facilityBusinessSubquery(a: ClauseAcc, facilityIds: string[]): string {
  const p = a.next();
  a.params.push(facilityIds);
  // Facilities may exist without a business link; those cannot match
  // obligations directly (documented in methodology notes).
  return `(SELECT f.business_id FROM facilities f WHERE f.id = ANY(${p}::uuid[]) AND f.business_id IS NOT NULL)`;
}

/**
 * WHERE fragment for obligation-scoped queries. Requires FROM to include:
 *   obligations o JOIN businesses b ON b.id = o.business_id
 *   LEFT JOIN obligation_work ow ON ow.obligation_id = o.id
 *   LEFT JOIN matters m ON m.id = o.matter_id
 * and b.workspace_id = $1 AND b.archived = false in the caller.
 */
export function obligationFilterClause(f: PortfolioFilters): {
  sql: string;
  params: unknown[];
} {
  const a = acc();
  if (f.businessIds.length) {
    const p = a.next();
    a.params.push(f.businessIds);
    a.sql.push(`o.business_id = ANY(${p}::uuid[])`);
  }
  if (f.facilityIds.length) {
    a.sql.push(`o.business_id IN ${facilityBusinessSubquery(a, f.facilityIds)}`);
  }
  if (f.municipalities.length) {
    const p = a.next();
    a.params.push(f.municipalities);
    a.sql.push(`b.municipality = ANY(${p})`);
  }
  if (f.projectIds.length) {
    const p = a.next();
    a.params.push(f.projectIds);
    a.sql.push(`o.matter_id = ANY(${p}::uuid[])`);
  }
  if (f.statuses.length) {
    const p = a.next();
    a.params.push(f.statuses);
    a.sql.push(`o.status = ANY(${p})`);
  }
  if (f.agencies.length) {
    const p = a.next();
    a.params.push(f.agencies);
    a.sql.push(`o.agency = ANY(${p})`);
  }
  if (f.ownerIds.length) {
    const p = a.next();
    a.params.push(f.ownerIds);
    a.sql.push(`ow.owner_user_id = ANY(${p}::uuid[])`);
  }
  if (f.departments.length) {
    const p = a.next();
    a.params.push(f.departments);
    a.sql.push(`ow.department = ANY(${p})`);
  }
  if (f.priorities.length) {
    const p = a.next();
    a.params.push(f.priorities);
    a.sql.push(`COALESCE(ow.priority, 'medium') = ANY(${p})`);
  }
  if (f.dueFrom) {
    const p = a.next();
    a.params.push(f.dueFrom);
    a.sql.push(`COALESCE(ow.internal_due_date, o.due_date) >= ${p}::date`);
  }
  if (f.dueTo) {
    const p = a.next();
    a.params.push(f.dueTo);
    a.sql.push(`COALESCE(ow.internal_due_date, o.due_date) <= ${p}::date`);
  }
  if (f.domains.length) {
    const p = a.next();
    a.params.push(f.domains);
    // obligations.requirement_id is text; the KG key is uuid — cast for the
    // lookup. Non-matching ids simply yield no rows (defensive).
    a.sql.push(
      `EXISTS (SELECT 1 FROM requirement_rules rr WHERE rr.id::text = o.requirement_id AND rr.requirement_category = ANY(${p}))`
    );
  }
  return { sql: a.sql.length ? " AND " + a.sql.join(" AND ") : "", params: a.params };
}

/**
 * WHERE fragment for matter-scoped queries. Requires:
 *   matters m JOIN businesses b ON b.id = m.business_id
 * and m.workspace_id = $1 in the caller.
 */
export function matterFilterClause(f: PortfolioFilters): {
  sql: string;
  params: unknown[];
} {
  const a = acc();
  if (f.businessIds.length) {
    const p = a.next();
    a.params.push(f.businessIds);
    a.sql.push(`m.business_id = ANY(${p}::uuid[])`);
  }
  if (f.facilityIds.length) {
    a.sql.push(`m.business_id IN ${facilityBusinessSubquery(a, f.facilityIds)}`);
  }
  if (f.municipalities.length) {
    const p = a.next();
    a.params.push(f.municipalities);
    a.sql.push(`b.municipality = ANY(${p})`);
  }
  if (f.projectIds.length) {
    const p = a.next();
    a.params.push(f.projectIds);
    a.sql.push(`m.id = ANY(${p}::uuid[])`);
  }
  return { sql: a.sql.length ? " AND " + a.sql.join(" AND ") : "", params: a.params };
}

/**
 * WHERE fragment for business-scoped queries. Requires businesses b
 * with b.workspace_id = $1 AND b.archived = false in the caller.
 */
export function businessFilterClause(f: PortfolioFilters): {
  sql: string;
  params: unknown[];
} {
  const a = acc();
  if (f.businessIds.length) {
    const p = a.next();
    a.params.push(f.businessIds);
    a.sql.push(`b.id = ANY(${p}::uuid[])`);
  }
  if (f.facilityIds.length) {
    const p = a.next();
    a.params.push(f.facilityIds);
    a.sql.push(
      `b.id IN (SELECT f.business_id FROM facilities f WHERE f.id = ANY(${p}::uuid[]) AND f.business_id IS NOT NULL)`
    );
  }
  if (f.municipalities.length) {
    const p = a.next();
    a.params.push(f.municipalities);
    a.sql.push(`b.municipality = ANY(${p})`);
  }
  return { sql: a.sql.length ? " AND " + a.sql.join(" AND ") : "", params: a.params };
}

/**
 * WHERE fragment for facility-scoped queries. Requires:
 *   facilities f LEFT JOIN businesses b ON b.id = f.business_id
 * and f.workspace_id = $1 in the caller.
 */
export function facilityFilterClause(f: PortfolioFilters): {
  sql: string;
  params: unknown[];
} {
  const a = acc();
  if (f.facilityIds.length) {
    const p = a.next();
    a.params.push(f.facilityIds);
    a.sql.push(`f.id = ANY(${p}::uuid[])`);
  }
  if (f.businessIds.length) {
    const p = a.next();
    a.params.push(f.businessIds);
    a.sql.push(`f.business_id = ANY(${p}::uuid[])`);
  }
  if (f.municipalities.length) {
    const p = a.next();
    a.params.push(f.municipalities);
    a.sql.push(`COALESCE(f.municipality, b.municipality) = ANY(${p})`);
  }
  return { sql: a.sql.length ? " AND " + a.sql.join(" AND ") : "", params: a.params };
}

/**
 * WHERE fragment for the regulatory-impact report (grain: event × impacted
 * entity). Requires:
 *   regulatory_events re
 *   LEFT JOIN regulatory_impacts ri ON ri.event_id = re.id AND ri.workspace_id = $1
 *   LEFT JOIN facilities f ON f.id = ri.facility_id
 *   LEFT JOIN businesses b ON b.id = ri.business_id
 *   LEFT JOIN obligations o ON o.id = ri.obligation_id
 *
 * Only entity-scoping filters apply here: workflow filters (status, priority,
 * owner, department, due dates, project, domain) describe obligation_work rows,
 * not impact mappings, and are documented as not-applicable in the report
 * methodology.
 */
export function regulatoryImpactFilterClause(f: PortfolioFilters): {
  sql: string;
  params: unknown[];
} {
  const a = acc();
  if (f.businessIds.length) {
    const p = a.next();
    a.params.push(f.businessIds);
    a.sql.push(
      `(ri.business_id = ANY(${p}::uuid[]) OR o.business_id = ANY(${p}::uuid[]) OR f.business_id = ANY(${p}::uuid[]))`
    );
  }
  if (f.facilityIds.length) {
    const p = a.next();
    a.params.push(f.facilityIds);
    a.sql.push(`ri.facility_id = ANY(${p}::uuid[])`);
  }
  if (f.municipalities.length) {
    const p = a.next();
    a.params.push(f.municipalities);
    a.sql.push(`(f.municipality = ANY(${p}) OR b.municipality = ANY(${p}))`);
  }
  if (f.agencies.length) {
    const p = a.next();
    a.params.push(f.agencies);
    a.sql.push(`o.agency = ANY(${p})`);
  }
  return { sql: a.sql.length ? " AND " + a.sql.join(" AND ") : "", params: a.params };
}

/**
 * WHERE fragment for evidence-scoped queries. Requires:
 *   evidence e JOIN businesses b ON b.id = e.business_id
 * and b.workspace_id = $1 in the caller.
 */
export function evidenceFilterClause(f: PortfolioFilters): {
  sql: string;
  params: unknown[];
} {
  const a = acc();
  if (f.businessIds.length) {
    const p = a.next();
    a.params.push(f.businessIds);
    a.sql.push(`e.business_id = ANY(${p}::uuid[])`);
  }
  if (f.facilityIds.length) {
    const p = a.next();
    a.params.push(f.facilityIds);
    a.sql.push(
      `e.business_id IN (SELECT f.business_id FROM facilities f WHERE f.id = ANY(${p}::uuid[]) AND f.business_id IS NOT NULL)`
    );
  }
  if (f.municipalities.length) {
    const p = a.next();
    a.params.push(f.municipalities);
    a.sql.push(`b.municipality = ANY(${p})`);
  }
  if (f.projectIds.length) {
    const p = a.next();
    a.params.push(f.projectIds);
    a.sql.push(`e.matter_id = ANY(${p}::uuid[])`);
  }
  return { sql: a.sql.length ? " AND " + a.sql.join(" AND ") : "", params: a.params };
}
