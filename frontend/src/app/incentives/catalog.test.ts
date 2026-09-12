import test from "node:test";
import assert from "node:assert/strict";
import { compileIncentiveCatalog, mergeProgramCatalogs, type IncentiveCatalogNode } from "./catalog.ts";
import type { IncentiveProgram } from "./types.ts";

const baseNodes: IncentiveCatalogNode[] = [
  { entityId: "AGY_TEST", nodeType: "agency", data: { id: "AGY_TEST", name: "Test Agency" } },
  { entityId: "FACT_JOBS", nodeType: "project_fact", data: { id: "FACT_JOBS", name: "Planned jobs", fact_key: "planned_job_creation", value_type: "number" } },
  { entityId: "CRIT_JOBS", nodeType: "eligibility_criterion", data: { id: "CRIT_JOBS", name: "Jobs", description: "Plans at least 10 jobs", project_fact_id: "FACT_JOBS", fact_key: "planned_job_creation", operator: "gte", expected_value: 10, required: true, material: true, citation: "Test §2" } },
  { entityId: "BEN_TEST", nodeType: "benefit", data: { id: "BEN_TEST", name: "Benefit", description: "Test benefit", benefit_type: "grant", citation: "Test §1" } },
  { entityId: "SRC_TEST", nodeType: "regulatory_source", data: { id: "SRC_TEST", name: "Official test source", source_type: "guidance", legal_status: "effective", jurisdiction: "Puerto Rico", citation: "Test", url: "https://example.gov/test", last_verified_at: "2026-09-01", source_version: "v1" } },
];

test("catalog compiles a fully linked, source-backed program", () => {
  const nodes: IncentiveCatalogNode[] = [...baseNodes, {
    entityId: "GRANT_TEST",
    nodeType: "grant",
    data: {
      id: "GRANT_TEST",
      name: "Fixture grant",
      description: "Test only",
      administering_agency_id: "AGY_TEST",
      authorized_by_ids: ["SRC_TEST"],
      geography_level: "Puerto Rico",
      criterion_ids: ["CRIT_JOBS"],
      benefit_ids: ["BEN_TEST"],
      program_status: "active",
      last_verified_at: "2026-09-01",
      source_version: "v1",
    },
  }];
  const catalog = compileIncentiveCatalog(nodes);
  assert.equal(catalog.rejected.length, 0);
  assert.equal(catalog.programs.length, 1);
  assert.equal(catalog.programs[0]?.criteria[0]?.factKey, "planned_job_creation");
  assert.equal(catalog.programs[0]?.sources[0]?.url, "https://example.gov/test");
});

test("catalog rejects a program with incomplete provenance instead of partially matching it", () => {
  const nodes: IncentiveCatalogNode[] = [...baseNodes, {
    entityId: "GRANT_UNSAFE",
    nodeType: "grant",
    data: {
      id: "GRANT_UNSAFE",
      name: "Unsafe fixture",
      description: "Missing source links",
      administering_agency_id: "AGY_TEST",
      criterion_ids: ["CRIT_JOBS"],
      benefit_ids: ["BEN_TEST"],
      program_status: "active",
      last_verified_at: "2026-09-01",
      source_version: "v1",
    },
  }];
  const catalog = compileIncentiveCatalog(nodes);
  assert.equal(catalog.programs.length, 0);
  assert.match(catalog.rejected[0]?.reasons.join(" ") ?? "", /authoritative graph source/i);
});

test("F11: a same-ID graph program replaces the static entry", () => {
  const graph = [{ id: "ACT60_EXPORT", name: "Graph-corrected export incentive" } as IncentiveProgram];
  const statik = [
    { id: "ACT60_EXPORT", name: "Stale static export incentive" } as IncentiveProgram,
    { id: "ACT60_TOURISM", name: "Static-only tourism incentive" } as IncentiveProgram,
  ];
  const merged = mergeProgramCatalogs(graph, statik);
  assert.deepEqual(merged.map((p) => p.id), ["ACT60_EXPORT", "ACT60_TOURISM"]);
  assert.equal(merged[0]?.name, "Graph-corrected export incentive");
});

test("F11: graph-only programs are included and static survives without a graph", () => {
  const graph = [{ id: "GRAPH_NEW", name: "Graph-only program" } as IncentiveProgram];
  const statik = [{ id: "ACT60_TOURISM", name: "Static-only" } as IncentiveProgram];
  assert.deepEqual(mergeProgramCatalogs(graph, statik).map((p) => p.id), ["GRAPH_NEW", "ACT60_TOURISM"]);
  assert.deepEqual(mergeProgramCatalogs([], statik).map((p) => p.id), ["ACT60_TOURISM"]);
});
