// Writes, for every representative case: the PDF, Copy summary, Copy full report
// and the document JSON, then runs the Python layout/text checker on each PDF.
//   npx tsx tests/report-outputs.mts <outDir>
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { jsPDF } from "jspdf";
import { reportCases } from "../src/app/locations/reportCases.ts";
import { reportDocument, reportDocumentText } from "../src/app/locations/reportDocument.ts";
import { renderReportPdf, pdfSafe } from "../src/app/locations/propertyReportPdf.ts";
import { reportSummaryText } from "../src/app/locations/propertyReport.ts";

const OUT = path.resolve(process.argv[2] ?? "report-outputs");
mkdirSync(OUT, { recursive: true });
let failed = 0;
for (const c of reportCases()) {
  const d = reportDocument(c.report, c.lang, null);
  const pdf = renderReportPdf(d, new jsPDF({ unit: "mm", format: "letter" }));
  const base = path.join(OUT, c.id);
  writeFileSync(`${base}.pdf`, Buffer.from(pdf.output("arraybuffer")));
  writeFileSync(`${base}.full.txt`, reportDocumentText(d));
  writeFileSync(`${base}.summary.txt`, reportSummaryText(c.report, c.lang));
  // What the PDF must contain: every item and paragraph of the shared document (WinAnsi-safe form).
  const expect = [d.title, d.conclusion, d.snapshot, ...d.facts.flatMap(([k, v]) => [v]), ...d.sections.flatMap((s) => [s.title, ...s.paragraphs, ...s.groups.flatMap((g) => [g.label ?? "", ...g.items.flatMap((i) => [i.title, i.value, i.meta ?? "", ...(i.detail ?? []), i.source?.text ?? "", i.source?.url ?? ""])])])].filter(Boolean).map(pdfSafe);
  writeFileSync(`${base}.expect.json`, JSON.stringify({ expect, urls: d.sections.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.source?.url).filter(Boolean))) }));
  try {
    const r = execFileSync("python3", [path.join(import.meta.dirname, "pdf_layout_check.py"), `${base}.pdf`, `${base}.expect.json`], { encoding: "utf8" });
    console.log(`PASS  ${c.id} (${c.note}) — ${r.trim()}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${c.id} (${c.note})\n${(e as { stdout?: string }).stdout ?? e}`);
  }
}
console.log(failed ? `\n${failed} FAILED — outputs in ${OUT}` : `\nALL PASSED — outputs in ${OUT}`);
process.exit(failed ? 1 : 0);
