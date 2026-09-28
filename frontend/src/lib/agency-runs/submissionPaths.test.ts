import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveSubmissionPath,
  submissionPathCoverage,
  pathStatusLabelEn,
  pathStatusLabelEs,
  type SubmissionPathStatus,
} from "./submissionPaths";
import { AGENCY_FILING_CONFIGS } from "./filingTypes";

const STATUSES: SubmissionPathStatus[] = [
  "verified",
  "partial",
  "unknown",
  "not-applicable",
];

describe("resolveSubmissionPath", () => {
  it("resolves every KB document to a non-null path (unknown is explicit, never missing)", () => {
    const cov = submissionPathCoverage();
    assert.equal(
      cov.verified + cov.partial + cov.unknown + cov.notApplicable,
      cov.total
    );
    assert.ok(cov.total > 0);
  });

  it("returns null only for requirement IDs outside the KB", () => {
    assert.equal(resolveSubmissionPath("DOC_NOPE_NOT_REAL"), null);
  });

  it("marks playbook-backed filings as verified", () => {
    for (const id of [
      "DOC_SURI_REGISTRATION",
      "DOC_CERT_INCORPORATION",
      "DOC_PERMISO_UNICO",
    ]) {
      const p = resolveSubmissionPath(id);
      assert.ok(p, id);
      assert.equal(p!.status, "verified", id);
      assert.equal(p!.reconNeeded, false, id);
      assert.ok(p!.filingType, id);
      assert.ok(p!.domains.length > 0, id);
      assert.ok(p!.startUrl, id);
    }
  });

  it("marks portal-known filings without a playbook as partial, with portal identity", () => {
    for (const id of [
      "DOC_MERCHANT_REGISTRATION",
      "DOC_CERT_ORGANIZATION",
      "DOC_ARTICLES_ORGANIZATION",
      "DOC_ANNUAL_REPORT",
    ]) {
      const p = resolveSubmissionPath(id);
      assert.ok(p, id);
      assert.equal(p!.status, "partial", id);
      assert.equal(p!.reconNeeded, true, id);
      assert.ok(p!.filingType, id);
      // Partial still carries verified portal identity — that is the point.
      assert.ok(p!.domains.length > 0, `${id} domains`);
      assert.ok(p!.startUrl, `${id} startUrl`);
      assert.ok(p!.reasonEn.length > 0 && p!.reasonEs.length > 0, id);
    }
  });

  it("verified status always agrees with playbook presence in the registry", () => {
    for (const config of AGENCY_FILING_CONFIGS) {
      if (config.id === "DEMO_REHEARSAL_PORTAL") continue;
      const hasPlaybook =
        Array.isArray(config.playbook?.steps) && config.playbook!.steps.length > 0;
      for (const reqId of config.requirementIds ?? []) {
        const p = resolveSubmissionPath(reqId);
        assert.ok(p, reqId);
        assert.equal(
          p!.status,
          hasPlaybook ? "verified" : "partial",
          `${reqId}: status must track playbook presence`
        );
      }
    }
  });

  it("marks portal filings with no walked config as unknown (never improvises)", () => {
    const p = resolveSubmissionPath("DOC_EIN");
    assert.ok(p);
    assert.equal(p!.status, "unknown");
    assert.equal(p!.filingType, null);
    assert.equal(p!.reconNeeded, true);
    // The KB's published entry point is surfaced so Clara can point the user
    // at it — without pretending a walked path exists.
    assert.ok(p!.startUrl?.includes("irs.gov"), p!.startUrl ?? "no url");
  });

  it("marks third-party requirements as not-applicable", () => {
    const p = resolveSubmissionPath("DOC_INSURANCE");
    assert.ok(p);
    assert.equal(p!.status, "not-applicable");
    assert.equal(p!.reconNeeded, false);
    assert.equal(p!.filingType, null);
  });

  it("marks municipal in-person filings as not-applicable", () => {
    const p = resolveSubmissionPath("DOC_PATENTE_MUNICIPAL");
    assert.ok(p);
    assert.equal(p!.status, "not-applicable");
    assert.equal(p!.reconNeeded, false);
  });

  it("every status has EN/ES labels", () => {
    for (const s of STATUSES) {
      assert.ok(pathStatusLabelEn(s).length > 0, s);
      assert.ok(pathStatusLabelEs(s).length > 0, s);
    }
  });

  it("every resolved path carries a derived (non-empty) reason in both languages", () => {
    const cov = submissionPathCoverage();
    assert.ok(cov.reconBacklog.length > 0, "expected some unknown paths");
    for (const id of cov.reconBacklog.slice(0, 10)) {
      const p = resolveSubmissionPath(id)!;
      assert.ok(p.reasonEn.length > 10, id);
      assert.ok(p.reasonEs.length > 10, id);
    }
  });
});
