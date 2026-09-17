// Diff engine output vs. Darius's validated Ground Truth for all 25 scenarios.
// Usage: npx tsx src/app/qa/gtDiff.ts
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadGoldens, runGolden } from "./goldenHarness";

const QA_DIR = dirname(fileURLToPath(import.meta.url));
const gt = JSON.parse(readFileSync(join(QA_DIR, "workbook", "ground_truth.json"), "utf8")) as Record<
  string,
  Array<{ expectation: string; code: string; status: string }>
>;

let totalMismatch = 0;
for (const golden of loadGoldens()) {
  const rows = gt[golden.id];
  if (!rows) { console.log(golden.id, "NO GROUND TRUTH"); continue; }
  const present = rows.filter((r) => r.expectation === "PRESENT");
  const absent = rows.filter((r) => r.expectation === "ABSENT").map((r) => r.code);
  const result = runGolden(golden);
  const actual = result.actual;

  const missing = present.filter((r) => !actual.has(r.code)).map((r) => r.code);
  const gtCodes = new Set(present.map((r) => r.code));
  const extra = [...actual.keys()].filter((c) => !gtCodes.has(c));
  const statusMismatch = present
    .filter((r) => actual.has(r.code) && actual.get(r.code)!.applicability !== r.status)
    .map((r) => `${r.code}: engine=${actual.get(r.code)!.applicability} gt=${r.status}`);
  const absentViolated = absent.filter((c) => actual.has(c));

  const n = missing.length + extra.length + statusMismatch.length + absentViolated.length;
  totalMismatch += n;
  if (n > 0) {
    console.log(`\n### ${golden.id} (${n} mismatches)`);
    if (missing.length) console.log("  MISSING (gt wants, engine lacks):", missing.join(", "));
    if (extra.length) console.log("  EXTRA (engine has, gt lacks):", extra.join(", "));
    if (statusMismatch.length) console.log("  STATUS:", statusMismatch.join("; "));
    if (absentViolated.length) console.log("  ABSENT-VIOLATED:", absentViolated.join(", "));
  } else {
    console.log(`${golden.id} OK`);
  }
}
console.log(`\nTOTAL MISMATCHES: ${totalMismatch}`);
