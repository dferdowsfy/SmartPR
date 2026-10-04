// Geo-layer health check (scheduled in CI: template frontend/scripts/ci/geo-health.workflow.yml → .github/workflows/geo-health.yml).
// Hits every map provider (primary + fallbacks) and checks the answers at
// known Puerto Rico points. Exit 1 when a required check fails.
//   npm run geo:health            human-readable
//   npm run geo:health -- --json  machine-readable
import { runGeoHealth } from "../src/app/locations/geoHealth.ts";

const report = await runGeoHealth();
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const c of report.checks) {
    const mark = c.ok ? "ok  " : c.required ? "FAIL" : "warn";
    console.log(`${mark} [${c.kind}] ${c.id} — ${c.detail}${c.latency_ms != null ? ` (${c.latency_ms} ms)` : ""}`);
  }
  console.log(`\n${report.ok ? "HEALTHY" : "UNHEALTHY"}: ${report.required_failures} required failure(s), ${report.optional_failures} optional failure(s) — ${report.checked_at}`);
}
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import("node:fs");
  const rows = report.checks.map((c) => `| ${c.ok ? "✅" : c.required ? "❌" : "⚠️"} | ${c.kind} | ${c.id.replace(/\|/g, "\\|")} | ${c.detail.replace(/\|/g, "\\|")} | ${c.latency_ms ?? ""} |`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Geo-layer health\n\n**${report.ok ? "Healthy" : "Unhealthy"}** — ${report.required_failures} required / ${report.optional_failures} optional failures\n\n| | Kind | Check | Detail | ms |\n|---|---|---|---|---|\n${rows.join("\n")}\n`);
}
process.exit(report.ok ? 0 : 1);
