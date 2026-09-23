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


describe("REG-PROFESSION-AGENCY-001: rule-level issuing-agency override", () => {
  // 2026-09-23 06:00 QA cycle (S156, Ponce): the tattoo-artist
  // professional-license card pointed at the Juntas Examinadoras although
  // Ley 318-1999 licenses tattoo artists through the Dept. de Salud.
  // RULE_0696 overrides agency/agency_url/agency_note; the full pipeline
  // (engine -> classifier -> kb.ts UIRequirement) must surface the rule's
  // authority on the pill, the filing link, and the "where to get this"
  // note — while a genuine Junta profession keeps the document default.
  function tattooShopReqs() {
    return computeRequirementsFromKB(
      { business_type: "Tattoo Shop", municipality: "Ponce", industry: "Personal Care", location_type: "Commercial Facility", number_of_employees: 2 } as any,
      { physical_location: true },
      {},
      { projectIntent: "existing_business" as any }
    ) as Array<{ document_id: string; agency?: string; agencyUrl?: string | null; agencyNote?: string | null; source_rule?: string }>;
  }

  it("tattoo artist professional license carries the Dept. de Salud authority end to end", () => {
    const lic = tattooShopReqs().find((r) => r.document_id === "DOC_PROFESSIONAL_LICENSE");
    assert.ok(lic, "professional license requirement must exist for an existing tattoo shop");
    assert.equal(lic.source_rule, "RULE_0696");
    assert.equal(lic.agency, "Departamento de Salud");
    assert.equal(lic.agencyUrl, "https://www.salud.pr.gov/");
    assert.ok(/318-1999/.test(String(lic.agencyNote ?? "")));
    assert.ok(!/Junta|Examining Boards/i.test(String(lic.agency ?? "")), "the agency pill itself must not name the Juntas");
    assert.ok(/no las Juntas/i.test(String(lic.agencyNote ?? "")), "the note explicitly disambiguates against the Juntas Examinadoras");
  });

  it("a genuine Junta-licensed profession keeps the document default", () => {
    const reqs = computeRequirementsFromKB(
      { business_type: "Barbershop", municipality: "Bayamón", industry: "Personal Care", location_type: "Commercial Facility", number_of_employees: 3 } as any,
      { physical_location: true },
      {},
      { projectIntent: "existing_business" as any }
    ) as Array<{ document_id: string; agency?: string; agencyUrl?: string | null }>;
    const lic = reqs.find((r) => r.document_id === "DOC_PROFESSIONAL_LICENSE");
    assert.ok(lic, "professional license requirement must exist for an existing barbershop");
    assert.equal(lic.agency, "Department of State Examining Boards");
    assert.equal(lic.agencyUrl, "https://www.didaxispr.com/dept/estado-juntas");
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
