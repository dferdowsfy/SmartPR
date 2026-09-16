// ============================================================================
// Snapshot script: (re)generates JSON goldens from the scenario catalog.
//
//   npx tsx src/app/qa/snapshotGoldens.ts            # snapshot all drafts
//   npx tsx src/app/qa/snapshotGoldens.ts G01 G02     # snapshot specific ids
//
// Only goldens with status "draft" are re-snapshotted. Validated goldens are
// NEVER overwritten by this script — their expected sets are Darius-reviewed
// ground truth, and changing them requires his explicit correction.
// ============================================================================

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { computeRequirementsFromKB } from "../kb";
import { GOLDEN_SCENARIO_DEFS } from "./scenarioDefs";
import type { Golden } from "./goldenHarness";

const QA_DIR = join(dirname(fileURLToPath(import.meta.url)));
const GOLDENS_DIR = join(QA_DIR, "goldens");
mkdirSync(GOLDENS_DIR, { recursive: true });

const onlyIds = new Set(process.argv.slice(2));

for (const def of GOLDEN_SCENARIO_DEFS) {
  if (onlyIds.size > 0 && !onlyIds.has(def.id)) continue;
  const file = join(GOLDENS_DIR, `${def.id}.json`);
  if (existsSync(file)) {
    const existing = JSON.parse(readFileSync(file, "utf8")) as Golden;
    if (existing.status === "validated") {
      console.log(`${def.id}: validated — skipped (never auto-overwritten)`);
      continue;
    }
  }
  const rows = computeRequirementsFromKB(
    def.profile,
    def.answers,
    {},
    {
      entityType: def.options.entityType ?? undefined,
      projectIntent: (def.options.projectIntent as "new_business" | null) ?? undefined,
    }
  );
  const seen = new Set<string>();
  const expected = rows
    .filter((r) => {
      if (seen.has(r.document_id!)) return false;
      seen.add(r.document_id!);
      return true;
    })
    .map((r) => ({
      document_id: r.document_id!,
      name: r.name ?? r.document_id!,
      applicability: r.applicability ?? "unknown",
      mandatory: !!r.mandatory,
      source_rule: (r as { source_rule?: string }).source_rule ?? "",
    }));
  const golden: Golden = {
    id: def.id,
    title: def.title,
    status: "draft",
    profile: def.profile,
    answers: def.answers,
    options: def.options,
    expected,
    expectedAbsent: existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as Golden).expectedAbsent ?? []
      : [],
  };
  writeFileSync(file, JSON.stringify(golden, null, 2) + "\n");
  console.log(`${def.id}: snapshotted ${expected.length} requirements -> ${file}`);
}
console.log("done.");
