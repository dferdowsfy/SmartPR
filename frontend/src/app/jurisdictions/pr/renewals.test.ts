import assert from "node:assert/strict";
import test from "node:test";
import { puertoRicoPack } from "./index";
import documentsJson from "../../../kb/documents.json" with { type: "json" };

// Structural guardrails for the renewal-cadence seed data. The no-invention
// rule is enforced by convention (every entry carries an authoritative
// citation); these tests make malformed entries fail loudly instead of
// silently producing wrong reminders.

const renewals = puertoRicoPack.kb.extensions?.renewals ?? [];
const documentIds = new Set(
  (documentsJson as { id: string }[]).map((d) => d.id)
);

test("renewals array is present and every entry links to a real KB document", () => {
  assert.ok(renewals.length > 0, "renewals array must not be empty");
  for (const r of renewals) {
    const documentId = r["document_id"];
    assert.ok(
      typeof documentId === "string" && documentId.length > 0,
      `renewal entry has bad document_id: ${JSON.stringify(r)}`
    );
    assert.ok(
      documentIds.has(documentId),
      `renewal references unknown document: ${documentId}`
    );
  }
});

test("every renewal has a positive integer cadence and a recorded source", () => {
  for (const r of renewals) {
    const documentId = String(r["document_id"]);
    const frequency = r["frequency_months"];
    assert.ok(
      typeof frequency === "number" &&
        Number.isInteger(frequency) &&
        frequency > 0,
      `${documentId}: frequency_months must be a positive integer, got ${JSON.stringify(frequency)}`
    );
    const citation = r["citation"];
    assert.ok(
      typeof citation === "string" && citation.trim().length > 0,
      `${documentId}: citation must be a non-empty authoritative source reference`
    );
  }
});

test("no duplicate renewal entries per document", () => {
  const seen = new Set<string>();
  for (const r of renewals) {
    const documentId = String(r["document_id"]);
    assert.ok(!seen.has(documentId), `duplicate renewal entry: ${documentId}`);
    seen.add(documentId);
  }
});
