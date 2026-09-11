import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeRequirementsFromKB, KB } from "./kb";

// Every KB document must either carry a verified official agency_url or an
// explicit agency_note (non-governmental issuers) — so the intake can always
// show "Where to get this" on a requirement row.
describe("agency URL coverage", () => {
  it("every document has agency_url or agency_note", () => {
    const docs = KB.documents as Array<{ id: string; agency_url?: string | null; agency_note?: string }>;
    const bad = docs.filter((d) => !d.agency_url && !d.agency_note);
    assert.deepEqual(bad.map((d) => d.id), [], `${bad.length} docs lack both agency_url and agency_note`);
  });

  it("agency_url values are http(s) URLs", () => {
    const docs = KB.documents as Array<{ id: string; agency_url?: string | null }>;
    // ridpr.pr.gov is http-only (verified via browser); everything else https.
    const bad = docs.filter((d) => d.agency_url && !/^https?:\/\//.test(d.agency_url));
    assert.deepEqual(bad.map((d) => d.id), []);
  });

  it("computed requirements carry agencyUrl or agencyNote", () => {
    const reqs = computeRequirementsFromKB(
      { business_type: "Restaurant", municipality: "San Juan", industry: "Food & Beverage", location_type: "Commercial Facility", number_of_employees: 8 } as any,
      { alcohol_sold: true },
      {}
    ) as Array<{ document_id: string; agencyUrl?: string | null; agencyNote?: string | null }>;
    assert.ok(reqs.length > 0);
    const bad = reqs.filter((r) => !r.agencyUrl && !r.agencyNote);
    assert.deepEqual(bad.map((r) => r.document_id), []);
  });

  it("every document has a download_url or a download_note (how to obtain)", () => {
    const docs = KB.documents as Array<{ id: string; download_url?: string | null; download_note?: string }>;
    const bad = docs.filter((d) => !d.download_url && !d.download_note);
    assert.deepEqual(bad.map((d) => d.id), [], `${bad.length} docs lack both download_url and download_note`);
  });

  it("download_url values are well-formed https links with a known kind", () => {
    const docs = KB.documents as Array<{ id: string; download_url?: string | null; download_kind?: string }>;
    const kinds = new Set(["form_pdf", "filing_portal", "form_page", "guidance_page", "none"]);
    const bad = docs.filter((d) => (d.download_url && !/^https:\/\//.test(d.download_url)) || !kinds.has(d.download_kind ?? ""));
    assert.deepEqual(bad.map((d) => d.id), []);
  });

  it("computed requirements carry downloadUrl/downloadKind or a note", () => {
    const reqs = computeRequirementsFromKB(
      { business_type: "Restaurant", municipality: "San Juan", industry: "Food & Beverage", location_type: "Commercial Facility", number_of_employees: 8 } as any,
      { alcohol_sold: true },
      {}
    ) as Array<{ document_id: string; downloadUrl?: string | null; downloadKind?: string | null; downloadNote?: string | null; agencyUrl?: string | null; agencyNote?: string | null }>;
    assert.ok(reqs.length > 0);
    const bad = reqs.filter((r) => !r.downloadUrl && !r.downloadNote && !r.agencyUrl && !r.agencyNote);
    assert.deepEqual(bad.map((r) => r.document_id), []);
  });
});

describe("getDocumentDownload", () => {
  it("resolves a document id to its direct official destination", async () => {
    const { getDocumentDownload, downloadKindLabel } = await import("./kb");
    const dl = getDocumentDownload("DOC_EIN");
    assert.ok(dl);
    assert.equal(dl.kind, "filing_portal");
    assert.ok(/^https:\/\//.test(dl.url));
    assert.equal(downloadKindLabel(dl.kind), "File online");
    assert.equal(downloadKindLabel("form_pdf"), "Download form");
    assert.equal(downloadKindLabel("form_page"), "Get the form");
    assert.equal(downloadKindLabel("guidance_page"), "How to file");
  });

  it("returns null for documents with no central download and for unknown ids", async () => {
    const { getDocumentDownload } = await import("./kb");
    const docs = KB.documents as Array<{ id: string; download_url?: string | null }>;
    const noUrl = docs.find((d) => !d.download_url);
    assert.ok(noUrl, "expected at least one document without a download_url");
    assert.equal(getDocumentDownload(noUrl.id), null);
    assert.equal(getDocumentDownload("DOC_DOES_NOT_EXIST"), null);
    assert.equal(getDocumentDownload(null), null);
  });
});
