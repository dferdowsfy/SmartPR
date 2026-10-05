import { readFileSync, existsSync } from "node:fs";
import { SITE_CASES } from "../src/app/locations/siteCases/cases.ts";
import { runCase, checkCase } from "../src/app/locations/siteCases/consistency.ts";
const only = process.argv.slice(2);
for (const c of SITE_CASES) {
  if (only.length && !only.includes(c.id)) continue;
  const p = `src/app/locations/siteCases/fixtures/${c.id}.json`;
  if (!existsSync(p)) { console.log(`${c.id}: no fixture`); continue; }
  const run = await runCase(c, JSON.parse(readFileSync(p, "utf8")));
  const issues = checkCase(run);
  console.log(`\n=== ${c.id}: ${issues.length} issues`);
  for (const i of issues) console.log(`  [${i.output}] ${i.fact}: expected ${i.expected.slice(0,140)} | actual ${i.actual.slice(0,200)}`);
}
