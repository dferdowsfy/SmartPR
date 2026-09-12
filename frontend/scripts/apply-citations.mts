#!/usr/bin/env npx tsx
/**
 * Applies document-level citations (researched by citation agents) to
 * documents.json, then propagates to rules.json for rules that lack a
 * rule-specific citation. Inherited citations are marked honestly:
 *   citation_source: "document"  -> inherited from the required document
 *   citation_source: "rule"       -> rule carries its own specific citation
 *
 * Usage: npx tsx scripts/apply-citations.mts [--apply]
 * Default is dry-run (prints stats only).
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const kbDir = join(root, "src", "kb");
const citDir = join(root, "..", ".citations");
const APPLY = process.argv.includes("--apply");

type Cit = { id: string; citation: string; url: string; confidence: "statute" | "page" | "unverified" };

const citations = new Map<string, Cit>();
for (const f of readdirSync(citDir).filter((f) => f.endsWith(".json"))) {
  const arr = JSON.parse(readFileSync(join(citDir, f), "utf8")) as Cit[];
  for (const c of arr) citations.set(c.id, c);
}

const docsPath = join(kbDir, "documents.json");
const rulesPath = join(kbDir, "rules.json");
const docs = JSON.parse(readFileSync(docsPath, "utf8")) as Record<string, any>[];
const rules = JSON.parse(readFileSync(rulesPath, "utf8")) as Record<string, any>[];

let docsUpdated = 0, docsVerified = 0, docsUnverified = 0, rulesInherited = 0, rulesKept = 0, rulesNoDoc = 0;

for (const d of docs) {
  const c = citations.get(d.id);
  if (!c || c.confidence === "unverified" || !c.citation) { docsUnverified++; continue; }
  d.citation = c.citation;
  d.citation_url = c.url || undefined;
  d.citation_confidence = c.confidence;
  docsUpdated++; docsVerified++;
}

const docById = new Map(docs.map((d) => [d.id, d]));

for (const r of rules) {
  const existing = String(r.citation ?? "");
  if (existing.length > 10) { rulesKept++; r.citation_source = r.citation_source ?? "rule"; continue; }
  const doc = docById.get(r.requires_document_id);
  if (!doc || !doc.citation) { rulesNoDoc++; continue; }
  r.citation = doc.citation;
  r.citation_url = doc.citation_url;
  r.citation_confidence = doc.citation_confidence;
  r.citation_inherited_from = doc.id;
  r.citation_source = "document";
  rulesInherited++;
}

console.log(`citations researched: ${citations.size}`);
console.log(`documents: ${docsUpdated} updated, ${docsUnverified} unverified/blank`);
console.log(`rules: ${rulesInherited} inherited from document, ${rulesKept} kept rule-specific, ${rulesNoDoc} no cited document`);

if (APPLY) {
  writeFileSync(docsPath, JSON.stringify(docs, null, 2) + "\n");
  writeFileSync(rulesPath, JSON.stringify(rules, null, 2) + "\n");
  console.log("APPLIED to documents.json and rules.json");
} else {
  console.log("dry-run only — pass --apply to write");
}
