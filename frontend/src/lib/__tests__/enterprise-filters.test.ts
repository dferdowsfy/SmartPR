// Unit tests for the enterprise portfolio filter contract (Phase 3).
// The SAME filters drive the portfolio dashboard, the work queue, and all
// executive reports, so parsing mistakes here leak everywhere.
// Run with:
//   npx tsx --test src/lib/__tests__/enterprise-filters.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePortfolioFilters,
  describeFilters,
  hasActiveFilters,
  filtersToSearchParams,
  obligationFilterClause,
  businessFilterClause,
  facilityFilterClause,
  regulatoryImpactFilterClause,
} from "../enterprise-filters";

const B1 = "11111111-1111-1111-1111-111111111111";
const B2 = "22222222-2222-2222-2222-222222222222";
const F1 = "33333333-3333-3333-3333-333333333333";

function sp(qs: string): URLSearchParams {
  return new URLSearchParams(qs);
}

// ---------------------------------------------------------------------------
// Parsing & validation
// ---------------------------------------------------------------------------

test("empty params parse to empty filters with no errors", () => {
  const { filters, errors } = parsePortfolioFilters(sp(""));
  assert.deepEqual(errors, []);
  assert.deepEqual(filters.businessIds, []);
  assert.equal(filters.dueFrom, null);
  assert.ok(!hasActiveFilters(filters));
});

test("full valid filter set parses cleanly", () => {
  const { filters, errors } = parsePortfolioFilters(
    sp(
      `business=${B1}&business=${B2}&facility=${F1}&municipality=San%20Juan` +
        `&municipality=Ponce&project=${B1}&status=IN_PROGRESS&agency=OGPe` +
        `&owner=${B1}&department=Compliance&priority=critical&priority=HIGH` +
        `&due_from=2026-01-01&due_to=2026-12-31&domain=permits`
    )
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(filters.businessIds, [B1, B2]);
  assert.deepEqual(filters.facilityIds, [F1]);
  assert.deepEqual(filters.municipalities, ["San Juan", "Ponce"]);
  assert.deepEqual(filters.projectIds, [B1]);
  assert.deepEqual(filters.statuses, ["IN_PROGRESS"]);
  assert.deepEqual(filters.agencies, ["OGPe"]);
  assert.deepEqual(filters.ownerIds, [B1]);
  assert.deepEqual(filters.departments, ["Compliance"]);
  assert.deepEqual(filters.priorities, ["critical", "high"]);
  assert.equal(filters.dueFrom, "2026-01-01");
  assert.equal(filters.dueTo, "2026-12-31");
  assert.deepEqual(filters.domains, ["permits"]);
  assert.ok(hasActiveFilters(filters));
});

test("comma-separated values split; duplicates removed", () => {
  const { filters, errors } = parsePortfolioFilters(
    sp(`municipality=San%20Juan,San%20Juan,Ponce&priority=critical,critical`)
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(filters.municipalities, ["San Juan", "Ponce"]);
  assert.deepEqual(filters.priorities, ["critical"]);
});

test("invalid UUIDs are rejected, valid ones are kept", () => {
  const { filters, errors } = parsePortfolioFilters(sp(`business=${B1}&business=not-a-uuid&facility=zzz`));
  assert.ok(errors.length > 0);
  assert.ok(errors.some((e) => e.includes("business")));
  assert.deepEqual(filters.businessIds, [B1]);
  assert.deepEqual(filters.facilityIds, []);
});

test("invalid priority values are rejected, valid ones kept", () => {
  const { filters, errors } = parsePortfolioFilters(sp("priority=critical&priority=urgent"));
  assert.ok(errors.some((e) => e.includes("urgent")));
  assert.deepEqual(filters.priorities, ["critical"]);
});

test("malformed dates are rejected; reversed ranges are rejected", () => {
  const bad = parsePortfolioFilters(sp("due_from=01/02/2026"));
  assert.ok(bad.errors.some((e) => e.includes("due_from")));
  assert.equal(bad.filters.dueFrom, null);

  const reversed = parsePortfolioFilters(sp("due_from=2026-12-31&due_to=2026-01-01"));
  assert.ok(reversed.errors.some((e) => e.includes("due_from is after due_to")));
});

// ---------------------------------------------------------------------------
// Round-trip + description
// ---------------------------------------------------------------------------

test("filtersToSearchParams round-trips through parsePortfolioFilters", () => {
  const { filters } = parsePortfolioFilters(
    sp(`business=${B1}&municipality=San%20Juan&priority=high&due_from=2026-03-01&domain=licenses`)
  );
  const rt = parsePortfolioFilters(filtersToSearchParams(filters));
  assert.deepEqual(rt.errors, []);
  assert.deepEqual(rt.filters, filters);
});

test("describeFilters summarizes every active dimension", () => {
  const { filters } = parsePortfolioFilters(
    sp(`business=${B1}&facility=${F1}&municipality=San%20Juan&project=${B2}` +
      `&status=OPEN&agency=OGPe&owner=${B1}&department=Legal&priority=critical` +
      `&due_from=2026-01-01&due_to=2026-06-30&domain=permits`)
  );
  const lines = describeFilters(filters);
  assert.equal(lines.length, 11); // all 11 filter dimensions present
});

// ---------------------------------------------------------------------------
// SQL clause builders
// ---------------------------------------------------------------------------

test("obligationFilterClause: placeholders start at $2 ($1 is workspace_id)", () => {
  const { filters } = parsePortfolioFilters(
    sp(`business=${B1}&priority=critical&due_from=2026-01-01`)
  );
  const { sql, params } = obligationFilterClause(filters);
  assert.ok(sql.includes("o.business_id = ANY($2::uuid[])"));
  assert.ok(!sql.includes("$1"), "must not reuse the workspace_id placeholder");
  assert.deepEqual(params[0], [B1]);
  // placeholders are sequential
  const phs = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])).sort((a, b) => a - b);
  assert.deepEqual(phs, [2, 3, 4]);
  assert.equal(params.length, 3);
});

test("obligationFilterClause: facility filter resolves through facilities", () => {
  const { filters } = parsePortfolioFilters(sp(`facility=${F1}`));
  const { sql, params } = obligationFilterClause(filters);
  assert.ok(sql.includes("facilities f"));
  assert.ok(sql.includes("f.business_id IS NOT NULL"));
  assert.deepEqual(params, [[F1]]);
});

test("obligationFilterClause: empty filters produce no clause", () => {
  const { filters } = parsePortfolioFilters(sp(""));
  const { sql, params } = obligationFilterClause(filters);
  assert.equal(sql, "");
  assert.deepEqual(params, []);
});

test("businessFilterClause scopes businesses and rejects cross-tenant leakage", () => {
  const { filters } = parsePortfolioFilters(sp(`business=${B1}&municipality=Ponce`));
  const { sql } = businessFilterClause(filters);
  // The caller adds b.workspace_id = $1; the clause itself must not widen scope.
  assert.ok(!sql.includes("workspace_id"));
  assert.ok(sql.includes("b.id = ANY($2::uuid[])"));
  assert.ok(sql.includes("b.municipality = ANY($3)"));
});

test("facilityFilterClause honors facility, business, and municipality", () => {
  const { filters } = parsePortfolioFilters(
    sp(`facility=${F1}&business=${B1}&municipality=San%20Juan`)
  );
  const { sql, params } = facilityFilterClause(filters);
  assert.ok(sql.includes("f.id = ANY($2::uuid[])"));
  assert.ok(sql.includes("f.business_id = ANY($3::uuid[])"));
  assert.ok(sql.includes("COALESCE(f.municipality, b.municipality) = ANY($4)"));
  assert.deepEqual(params, [[F1], [B1], ["San Juan"]]);
});

test("regulatoryImpactFilterClause scopes impacts to entity filters only", () => {
  const { filters } = parsePortfolioFilters(
    sp(`business=${B1}&facility=${F1}&municipality=Ponce&agency=OGPe&priority=critical&status=OPEN`)
  );
  const { sql, params } = regulatoryImpactFilterClause(filters);
  // Entity filters apply…
  assert.ok(sql.includes("ri.business_id = ANY($2::uuid[])"));
  assert.ok(sql.includes("ri.facility_id = ANY($3::uuid[])"));
  assert.ok(sql.includes("f.municipality = ANY($4)"));
  assert.ok(sql.includes("o.agency = ANY($5)"));
  assert.deepEqual(params, [[B1], [F1], ["Ponce"], ["OGPe"]]);
  // …workflow filters never leak into the impact grain.
  assert.ok(!sql.includes("priority"));
  assert.ok(!sql.includes("status"));
});
