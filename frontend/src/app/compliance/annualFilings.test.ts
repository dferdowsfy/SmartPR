import assert from "node:assert/strict";
import test from "node:test";
import {
  countFilings,
  filingYear,
  groupAnnualFilings,
  isAnnualFiling,
  sortFilings,
  type FilingLike,
} from "./annualFilings";

const annual = (overrides: Partial<FilingLike> = {}): FilingLike => ({
  id: "o1",
  business_id: "b1",
  business_name: "Café Luna",
  name: "Informe Anual",
  agency: "Departamento de Estado",
  due_date: "2027-04-15",
  status: "UPCOMING",
  renewal_frequency_months: 12,
  ...overrides,
});

test("only 12-month obligations count as annual filings", () => {
  assert.equal(isAnnualFiling(annual()), true);
  assert.equal(isAnnualFiling(annual({ renewal_frequency_months: 6 })), false);
  assert.equal(isAnnualFiling(annual({ renewal_frequency_months: null })), false);
  assert.equal(isAnnualFiling(annual({ item_type: "MATTER", renewal_frequency_months: 12 })), false);
});

test("filing year comes from the due date, never invented", () => {
  assert.equal(filingYear("2027-04-15"), "2027");
  assert.equal(filingYear(null), null);
  assert.equal(filingYear("not-a-date"), null);
});

test("filings sort by due date with unknown dates last", () => {
  const sorted = sortFilings([
    annual({ id: "c", due_date: null, name: "Zeta" }),
    annual({ id: "a", due_date: "2027-06-01" }),
    annual({ id: "b", due_date: "2027-01-15" }),
  ]);
  assert.deepEqual(sorted.map((f) => f.id), ["b", "a", "c"]);
});

test("annual filings group by business, sorted by business name", () => {
  const groups = groupAnnualFilings([
    annual({ business_id: "b2", business_name: "Taller Sol", id: "x" }),
    annual({ business_id: "b1", business_name: "Café Luna", id: "y" }),
    annual({ business_id: "b1", business_name: "Café Luna", id: "z", renewal_frequency_months: 3 }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].business_name, "Café Luna");
  assert.equal(groups[0].filings.length, 1);
  assert.equal(groups[1].business_name, "Taller Sol");
});

test("counts separate filed, overdue, due-soon and upcoming", () => {
  const counts = countFilings([
    annual({ status: "COMPLETED" }),
    annual({ status: "OVERDUE" }),
    annual({ status: "DUE_SOON" }),
    annual({ status: "UPCOMING" }),
    annual({ status: "CURRENT" }),
    annual({ status: "OVERDUE", renewal_frequency_months: 1 }),
  ]);
  assert.deepEqual(counts, { total: 5, overdue: 1, dueSoon: 1, filed: 1, upcoming: 2 });
});
