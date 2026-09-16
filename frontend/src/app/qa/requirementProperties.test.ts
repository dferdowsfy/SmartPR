// ============================================================================
// Requirement property tests — oracle-free invariants that hold regardless
// of what the "correct" requirement set is. These catch entire BUG CLASSES:
//
//   1. order-independence — reversing rule order must not change the output
//      (the REG-HOME-PHYSICAL-001 class: output depended on evaluation order).
//   2. municipality isolation — a scenario in municipality A must never name
//      municipality B in user-facing text (the REG-KB-PARKING-CITATION-001
//      class: San Juan law cited for every metro municipality).
//   3. no placeholder text — "coming soon" / "TODO" / "lorem" never reaches
//      a requirement card (guide section 14.7 treats placeholders as defects).
//   4. determinism — the same scenario evaluated twice is identical.
// ============================================================================

import test from "node:test";
import assert from "node:assert/strict";
import { computeRequirementsFromKB, computeRequirementsFromSnapshot, KB } from "../kb";
import { loadGoldens } from "./goldenHarness";

const goldens = loadGoldens();

function requirementIds(rows: Array<{ document_id?: string | null }>): string[] {
  const ids = new Set<string>();
  for (const r of rows) if (r.document_id) ids.add(r.document_id);
  return [...ids].sort();
}

function runScenario(golden: (typeof goldens)[number]) {
  return computeRequirementsFromKB(
    golden.profile,
    golden.answers,
    {},
    {
      entityType: golden.options.entityType ?? undefined,
      projectIntent: (golden.options.projectIntent as "new_business" | null) ?? undefined,
    }
  );
}

test("rule order never changes the requirement set", () => {
  const reversed = { ...KB, rules: [...(KB.rules as unknown[])].reverse() };
  for (const golden of goldens) {
    const normal = requirementIds(runScenario(golden));
    const rowsReversed = computeRequirementsFromSnapshot(
      reversed as typeof KB,
      golden.profile,
      golden.answers,
      {},
      {
        entityType: golden.options.entityType ?? undefined,
        projectIntent: (golden.options.projectIntent as "new_business" | null) ?? undefined,
      }
    );
    assert.deepEqual(
      requirementIds(rowsReversed),
      normal,
      `${golden.id}: requirement set changed when rule order was reversed`
    );
  }
});

/**
 * Reviewed legitimate cross-municipality mentions. Each entry was inspected
 * by a human: the text names another municipality only as an illustrative
 * example while directing the user to their OWN municipality. Additions here
 * require the same inspection — never blanket-allow.
 */
const LEGITIMATE_CROSS_REFERENCES: Array<{
  document_id: string;
  field: string;
  municipality: string;
  why: string;
}> = [
  {
    document_id: "DOC_PATENTE_MUNICIPAL",
    field: "downloadNote",
    municipality: "Aguada",
    why: "Illustrative example ('e.g. Aguada, Caguas, Guaynabo publish their own PDFs'); the note directs the user to their own municipality's finance office.",
  },
  {
    document_id: "DOC_PATENTE_MUNICIPAL",
    field: "downloadNote",
    municipality: "Caguas",
    why: "Same illustrative example as above.",
  },
  {
    document_id: "DOC_PATENTE_MUNICIPAL",
    field: "downloadNote",
    municipality: "Guaynabo",
    why: "Same illustrative example as above.",
  },
  {
    document_id: "DOC_PARKING_COMPLIANCE",
    field: "agencyNote",
    municipality: "San Juan",
    why: "Explains the autonomous-municipality concept with San Juan as the example (incl. its real portal URL); does not attribute the requirement to San Juan.",
  },
  {
    document_id: "DOC_LOADING_ZONE_PERMIT",
    field: "agencyNote",
    municipality: "San Juan",
    why: "Same autonomous-municipality explainer as above.",
  },
];

function isLegitimate(documentId: string | null | undefined, field: string, municipality: string): boolean {
  return LEGITIMATE_CROSS_REFERENCES.some(
    (e) =>
      e.document_id === documentId &&
      e.field === field &&
      e.municipality.toLowerCase() === municipality.toLowerCase()
  );
}

test("no cross-municipality leakage in user-facing text", () => {
  const names = (KB.municipalities as Array<{ name: string }>)
    .map((m) => m.name)
    .sort((a, b) => b.length - a.length);
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const golden of goldens) {
    const own = String(golden.profile.municipality ?? "");
    const others = names.filter((n) => n.toLowerCase() !== own.toLowerCase());
    if (others.length === 0) continue;
    const pattern = new RegExp(`\\b(${others.map(escape).join("|")})\\b`, "iu");
    for (const row of runScenario(golden)) {
      const fields: Array<[string, unknown]> = [
        ["name", row.name],
        ["reason", row.reason],
        ["agencyNote", row.agencyNote],
        ["downloadNote", row.downloadNote],
        ["triggerSummary", row.triggerSummary],
      ];
      for (const [field, value] of fields) {
        if (typeof value !== "string") continue;
        const hit = pattern.exec(value);
        if (hit && isLegitimate(row.document_id, field, hit[0])) continue;
        assert.ok(
          !hit,
          `${golden.id} (${own}): ${row.document_id}.${field} names another municipality: "${hit?.[0]}" in ${JSON.stringify(value.slice(0, 160))}`
        );
      }
    }
  }
});

test("no placeholder text in requirement cards", () => {
  const pattern = /coming soon|todo|lorem ipsum|\[placeholder\]/i;
  for (const golden of goldens) {
    for (const row of runScenario(golden)) {
      for (const [field, value] of [
        ["name", row.name],
        ["reason", row.reason],
        ["agencyNote", row.agencyNote],
      ] as Array<[string, unknown]>) {
        if (typeof value !== "string") continue;
        assert.ok(
          !pattern.test(value),
          `${golden.id}: ${row.document_id}.${field} contains placeholder text: ${JSON.stringify(value.slice(0, 120))}`
        );
      }
    }
  }
});

test("scenario evaluation is deterministic", () => {
  for (const golden of goldens) {
    const first = runScenario(golden).map((r) => ({
      id: r.document_id,
      applicability: r.applicability,
      mandatory: r.mandatory,
    }));
    const second = runScenario(golden).map((r) => ({
      id: r.document_id,
      applicability: r.applicability,
      mandatory: r.mandatory,
    }));
    assert.deepEqual(second, first, `${golden.id}: non-deterministic output across runs`);
  }
});
