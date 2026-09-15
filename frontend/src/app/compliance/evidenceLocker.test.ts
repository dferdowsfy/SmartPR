// Evidence locker — tag → requirement satisfaction / package inclusion.
// Run: node --experimental-strip-types --test src/app/compliance/evidenceLocker.test.ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  evidenceForObligation,
  evidenceSatisfiesObligation,
  mergeRequirementTags,
  normalizeRequirementTag,
  normalizeRequirementTags,
  packageEvidenceManifest,
  selectPackageEvidence,
  type LockerEvidence,
  type ObligationRef,
} from "./evidenceLocker.ts";

test("normalizeRequirementTag uppercases DOC_ codes and rejects junk", () => {
  assert.equal(normalizeRequirementTag("doc_contractor_license"), "DOC_CONTRACTOR_LICENSE");
  assert.equal(normalizeRequirementTag("  DOC_BOND  "), "DOC_BOND");
  assert.equal(normalizeRequirementTag(""), null);
  assert.equal(normalizeRequirementTag("../etc/passwd"), null);
  assert.equal(normalizeRequirementTag(null), null);
});

test("normalizeRequirementTags dedupes and drops invalids", () => {
  assert.deepEqual(
    normalizeRequirementTags(["DOC_BOND", "doc_bond", "nope!", "DOC_INSURANCE"]),
    ["DOC_BOND", "DOC_INSURANCE"]
  );
});

test("mergeRequirementTags unions lists", () => {
  assert.deepEqual(
    mergeRequirementTags(["DOC_BOND"], ["DOC_ID", "DOC_BOND"], "DOC_INSURANCE"),
    ["DOC_BOND", "DOC_ID", "DOC_INSURANCE"]
  );
});

const locker: LockerEvidence[] = [
  {
    id: "e-license",
    original_filename: "contractor-license.pdf",
    obligation_id: null,
    requirement_tags: ["DOC_CONTRACTOR_LICENSE", "DOC_BOND"],
    storage_path: "u/locker/license.pdf",
    mime_type: "application/pdf",
    size_bytes: 1200,
  },
  {
    id: "e-id",
    original_filename: "owner-id.pdf",
    obligation_id: "obl-id",
    requirement_tags: ["DOC_ID"],
    storage_path: "u/locker/id.pdf",
    mime_type: "application/pdf",
    size_bytes: 800,
  },
  {
    id: "e-orphan",
    original_filename: "notes.txt",
    obligation_id: null,
    requirement_tags: [],
    storage_path: "u/locker/notes.txt",
  },
];

const obligations: ObligationRef[] = [
  { id: "obl-bond", requirement_id: "DOC_BOND", name: "Surety bond" },
  { id: "obl-id", requirement_id: "DOC_ID", name: "Owner ID" },
  { id: "obl-ins", requirement_id: "DOC_INSURANCE", name: "Liability insurance" },
];

test("evidenceSatisfiesObligation via requirement tag (reuse across asks)", () => {
  assert.equal(
    evidenceSatisfiesObligation(locker[0], { id: "obl-bond", requirement_id: "DOC_BOND" }),
    true
  );
  assert.equal(
    evidenceSatisfiesObligation(locker[0], { id: "obl-license", requirement_id: "DOC_CONTRACTOR_LICENSE" }),
    true
  );
  assert.equal(
    evidenceSatisfiesObligation(locker[0], { id: "obl-ins", requirement_id: "DOC_INSURANCE" }),
    false
  );
});

test("evidenceSatisfiesObligation via direct obligation_id link", () => {
  assert.equal(evidenceSatisfiesObligation(locker[1], { id: "obl-id", requirement_id: "DOC_ID" }), true);
  assert.equal(
    evidenceSatisfiesObligation(locker[1], { id: "other", requirement_id: "DOC_SOMETHING" }),
    false
  );
});

test("evidenceForObligation returns tagged + linked rows", () => {
  const forBond = evidenceForObligation(locker, obligations[0]);
  assert.deepEqual(forBond.map((e) => e.id), ["e-license"]);
  const forId = evidenceForObligation(locker, obligations[1]);
  assert.deepEqual(forId.map((e) => e.id), ["e-id"]);
  assert.deepEqual(evidenceForObligation(locker, obligations[2]).map((e) => e.id), []);
});

test("selectPackageEvidence includes tagged locker files once for multiple requirements", () => {
  const entries = selectPackageEvidence(locker, obligations);
  assert.equal(entries.length, 2);
  const license = entries.find((e) => e.evidenceId === "e-license");
  assert.ok(license);
  assert.equal(license!.zipPath, "evidence/contractor-license.pdf");
  assert.ok(license!.requirementCodes.includes("DOC_BOND"));
  assert.ok(license!.requirementCodes.includes("DOC_CONTRACTOR_LICENSE"));
  assert.equal(license!.inclusionReason, "requirement_tag");
  assert.ok(!entries.some((e) => e.evidenceId === "e-orphan"));
});

test("selectPackageEvidence marks both when link and tag apply", () => {
  const entries = selectPackageEvidence(locker, obligations);
  const id = entries.find((e) => e.evidenceId === "e-id");
  assert.ok(id);
  assert.equal(id!.inclusionReason, "both");
  assert.deepEqual(id!.obligationIds, ["obl-id"]);
});

test("packageEvidenceManifest exposes count and codes for ZIP consumers", () => {
  const manifest = packageEvidenceManifest(selectPackageEvidence(locker, obligations));
  assert.equal(manifest.count, 2);
  assert.ok(manifest.files.every((f) => f.zipPath.startsWith("evidence/")));
  const codes = new Set(manifest.files.flatMap((f) => f.requirementCodes));
  assert.ok(codes.has("DOC_BOND"));
  assert.ok(codes.has("DOC_ID"));
});

test("one contractor license file can satisfy bond + license asks without re-upload", () => {
  const file: LockerEvidence = {
    id: "e1",
    original_filename: "license.pdf",
    requirement_tags: ["DOC_CONTRACTOR_LICENSE", "DOC_BOND", "DOC_INSURANCE"],
  };
  const asks: ObligationRef[] = [
    { id: "a", requirement_id: "DOC_CONTRACTOR_LICENSE" },
    { id: "b", requirement_id: "DOC_BOND" },
    { id: "c", requirement_id: "DOC_INSURANCE" },
  ];
  for (const ask of asks) {
    assert.equal(evidenceSatisfiesObligation(file, ask), true);
  }
  const pkg = selectPackageEvidence([file], asks);
  assert.equal(pkg.length, 1);
  assert.equal(pkg[0].obligationIds.length, 3);
});
