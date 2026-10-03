// ============================================================================
// Reasoning Paths admin API.
// GET  /api/admin/reasoning-paths/run -> { scenarios, conditions, variants } summaries
// POST /api/admin/reasoning-paths/run { facts }          -> { result }
// POST /api/admin/reasoning-paths/run { facts?, suite }  -> { result?, validation, suite }
// POST /api/admin/reasoning-paths/run { suite }          -> { validation, suite }
//
// The suite runs validateReasoningGraph() plus every golden fixture in
// tests/reasoning-paths/golden/*.json (fixtures are owned separately), comparing
// expected vs actual as sets — exactly like the CLI runner in
// tests/reasoning-paths/run.mts. Super-admin gated like all admin routes.
// ============================================================================

import { promises as fs } from "fs";
import path from "path";
import { requireSuperAdmin } from "../../_util";
import {
  evaluateReasoningPaths,
  loadReasoningGraph,
  validateReasoningGraph,
} from "../../../../../lib/reasoning-paths";
import type {
  FactBag,
  ReasoningPathResult,
  ValidationFinding,
} from "../../../../../lib/reasoning-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET: graph summaries for the admin scenario browser.
// ---------------------------------------------------------------------------

export async function GET() {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;

  try {
    const graph = loadReasoningGraph();
    return Response.json({
      scenarios: graph.scenarios.map((s) => ({
        id: s.id,
        label: s.label,
        description: s.description,
        requiredConditions: s.requiredConditions,
        excludedConditions: s.excludedConditions,
      })),
      conditions: graph.conditions.map((c) => ({
        id: c.id,
        label: c.label,
        triggerSummary: c.triggerSummary,
        sourceId: c.sourceId,
        locator: c.locator,
        confidence: c.confidence ?? null,
      })),
      variants: graph.variants.map((v) => ({
        id: v.id,
        label: v.label,
        processId: v.processId,
        selectorConditions: v.selectorConditions,
        ruleIds: v.ruleIds,
        active: v.active,
        supersededBy: v.supersededBy ?? null,
        note: v.note ?? null,
      })),
    });
  } catch (err) {
    return Response.json(
      { error: "graph_unavailable", message: (err as Error).message },
      { status: 503 }
    );
  }
}

// ---------------------------------------------------------------------------
// Golden fixtures.
// ---------------------------------------------------------------------------

interface GoldenFixture {
  id?: string;
  name?: string;
  inputFacts?: FactBag;
  expectedScenarios?: string[];
  expectedVariants?: string[];
  expectedPermits?: string[];
  expectedNonApplicable?: string[];
}

export interface SuiteEntry {
  id: string;
  name: string;
  pass: boolean;
  diffs: string[];
}

/** Order-insensitive set comparison, returning human-readable diffs. */
function setDiff(label: string, expected: string[], actual: string[]): string[] {
  const exp = new Set(expected);
  const act = new Set(actual);
  const diffs: string[] = [];
  for (const x of [...exp].sort()) {
    if (!act.has(x)) diffs.push(`${label} missing: ${x}`);
  }
  for (const x of [...act].sort()) {
    if (!exp.has(x)) diffs.push(`${label} unexpected: ${x}`);
  }
  return diffs;
}

async function runGoldenSuite(): Promise<{ entries: SuiteEntry[]; note?: string }> {
  const dir = path.join(process.cwd(), "tests", "reasoning-paths", "golden");
  let files: string[];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  } catch {
    // Fixtures are owned separately and may not exist yet — not an error.
    return {
      entries: [],
      note: "golden fixtures not present yet (tests/reasoning-paths/golden/*.json)",
    };
  }

  const entries: SuiteEntry[] = [];
  for (const file of files) {
    let fixture: GoldenFixture;
    try {
      fixture = JSON.parse(await fs.readFile(path.join(dir, file), "utf8")) as GoldenFixture;
    } catch (err) {
      entries.push({
        id: file,
        name: file,
        pass: false,
        diffs: [`fixture unreadable: ${(err as Error).message}`],
      });
      continue;
    }

    const result: ReasoningPathResult = evaluateReasoningPaths(fixture.inputFacts ?? {});
    const actualScenarios = result.scenarios.map((s) => s.id);
    const actualVariants = [...new Set(result.paths.map((p) => p.variantId))];
    const actualPermits = result.permits.map((p) => p.ruleId);

    const diffs = [
      ...setDiff("scenario", fixture.expectedScenarios ?? [], actualScenarios),
      ...setDiff("variant", fixture.expectedVariants ?? [], actualVariants),
      ...setDiff("permit", fixture.expectedPermits ?? [], actualPermits),
    ];
    // Negative testing: expected non-applicables must be ABSENT from permits.
    for (const ruleId of fixture.expectedNonApplicable ?? []) {
      if (actualPermits.includes(ruleId)) {
        diffs.push(`non-applicable permit present: ${ruleId}`);
      }
    }

    entries.push({
      id: fixture.id ?? file,
      name: fixture.name ?? file,
      pass: diffs.length === 0,
      diffs,
    });
  }
  return { entries };
}

// ---------------------------------------------------------------------------
// POST: ad-hoc evaluation and/or full suite.
// ---------------------------------------------------------------------------

interface RunResponse {
  result?: ReasoningPathResult;
  validation?: ValidationFinding[];
  suite?: SuiteEntry[];
  suiteNote?: string;
}

export async function POST(request: Request) {
  const gate = await requireSuperAdmin();
  if ("response" in gate) return gate.response;

  let body: { facts?: FactBag; suite?: boolean };
  try {
    body = (await request.json()) as { facts?: FactBag; suite?: boolean };
  } catch {
    return Response.json({ error: "bad_request", message: "invalid JSON body" }, { status: 400 });
  }

  if (!body.facts && !body.suite) {
    return Response.json(
      { error: "bad_request", message: "provide facts and/or suite:true" },
      { status: 400 }
    );
  }

  try {
    const out: RunResponse = {};
    if (body.facts) {
      out.result = evaluateReasoningPaths(body.facts);
    }
    if (body.suite) {
      // Validation runs first (design §8); findings are surfaced alongside the
      // suite instead of aborting it, so the admin sees everything at once.
      out.validation = validateReasoningGraph();
      const { entries, note } = await runGoldenSuite();
      out.suite = entries;
      if (note) out.suiteNote = note;
    }
    return Response.json(out);
  } catch (err) {
    return Response.json(
      { error: "evaluation_failed", message: (err as Error).message },
      { status: 500 }
    );
  }
}
