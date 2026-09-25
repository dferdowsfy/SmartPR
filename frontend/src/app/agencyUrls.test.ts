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
    ) as Array<{ document_id: string; agency?: string; agencyUrl?: string | null; agencyNote?: string | null; downloadUrl?: string | null; downloadKind?: string | null; downloadNote?: string | null; source_rule?: string }>;
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
    // REG-PROFESSION-AGENCY-002 (2026-09-24 live audit): the "File online"
    // destination must follow the rule's own authority — the shared
    // document's Didaxis/Juntas portal must NOT be shown for tattoo artists.
    assert.equal(lic.downloadUrl, "https://www.salud.pr.gov/");
    assert.equal(lic.downloadKind, "guidance_page");
    assert.ok(!/didaxis/i.test(String(lic.downloadUrl ?? "")), "no Didaxis portal for a Salud-issued license");
    assert.ok(/318-1999/i.test(String(lic.downloadNote ?? "")));
  });

  it("a genuine Junta-licensed profession keeps the document default", () => {
    const reqs = computeRequirementsFromKB(
      { business_type: "Barbershop", municipality: "Bayamón", industry: "Personal Care", location_type: "Commercial Facility", number_of_employees: 3 } as any,
      { physical_location: true },
      {},
      { projectIntent: "existing_business" as any }
    ) as Array<{ document_id: string; agency?: string; agencyUrl?: string | null; downloadUrl?: string | null; downloadKind?: string | null }>;
    const lic = reqs.find((r) => r.document_id === "DOC_PROFESSIONAL_LICENSE");
    assert.ok(lic, "professional license requirement must exist for an existing barbershop");
    assert.equal(lic.agency, "Department of State Examining Boards");
    assert.equal(lic.agencyUrl, "https://www.didaxispr.com/dept/estado-juntas");
    // No rule-level override here: the "File online" destination stays the
    // shared document default for genuine Junta professions.
    assert.equal(lic.downloadUrl, "https://www.didaxispr.com/dept/estado-juntas");
    assert.equal(lic.downloadKind, "filing_portal");
  });
});

describe("REG-PROFESSION-AGENCY-001 (sweep): every professional-license rule whose citation names a non-Junta authority carries the override", () => {
  // 2026-09-23 12:00 QA cycle (S161, San Juan): the 2f74e7f override
  // mechanism was only populated on RULE_0696 — six other
  // DOC_PROFESSIONAL_LICENSE rules cited a specific non-Junta authority
  // but still rendered the "Department of State Examining Boards" pill.
  // The mechanism generalizes; the data population did not. These tests
  // pin the sweep (insurance, law, notary, sworn translator, staffing,
  // credit services, mortgage broker).
  function profLicenseFor(bt: string, extraAnswers: Record<string, unknown> = {}) {
    const reqs = computeRequirementsFromKB(
      { business_type: bt, municipality: "San Juan", location_type: "Commercial Facility", number_of_employees: 3 } as any,
      { physical_location: true, ...extraAnswers } as any,
      {},
      { projectIntent: "existing_business" as any }
    ) as Array<{ document_id: string; agency?: string; agencyUrl?: string | null; agencyNote?: string | null; source_rule?: string }>;
    return reqs.find((r) => r.document_id === "DOC_PROFESSIONAL_LICENSE");
  }

  const cases: Array<[string, string, string, string, string]> = [
    ["Insurance Agency", "RULE_0224", "Oficina del Comisionado de Seguros (OCS)", "https://www.ocs.pr.gov/", "77-1957"],
    ["Law Firm", "RULE_0114", "Tribunal Supremo de Puerto Rico", "https://www.poderjudicial.pr/", "abogacía"],
    ["Notary Services", "RULE_0120", "Tribunal Supremo de Puerto Rico", "https://www.poderjudicial.pr/", "notaría"],
    ["Translation Services", "RULE_0121", "Tribunal Supremo de Puerto Rico", "https://www.poderjudicial.pr/", "traductor-intérprete jurado"],
    ["Staffing Agency", "RULE_0122", "Departamento del Trabajo y Recursos Humanos (DTRH)", "https://www.trabajo.pr.gov/", "417-1947"],
    ["Credit Services Company", "RULE_0229", "Departamento de Asuntos del Consumidor (DACO)", "https://www.daco.pr.gov/", "64A"],
    ["Mortgage Broker", "RULE_0225", "Oficina del Comisionado de Instituciones Financieras (OCIF)", "https://www.ocif.pr.gov/", "24-2010"],
    // REG-PROFESSION-AGENCY-003 (2026-09-25 QA, S196 Ponce vet clinic):
    // RULE_0103's own citation places the Junta Examinadora de Médicos
    // Veterinarios under ORCPS / Departamento de Salud (Ley 194-1979),
    // but the card rendered the Department of State Examining Boards pill
    // until the rule carried the agency override. Live-confirmed.
    ["Veterinary Clinic", "RULE_0103", "Departamento de Salud", "https://www.salud.pr.gov/CMS/133", "194-1979"],
  ];

  for (const [bt, rule, agency, url, noteFragment] of cases) {
    it(`${bt} professional license carries the ${agency} authority`, () => {
      const lic = profLicenseFor(bt);
      assert.ok(lic, `professional license requirement must exist for ${bt}`);
      assert.equal(lic.source_rule, rule);
      assert.equal(lic.agency, agency);
      assert.equal(lic.agencyUrl, url);
      assert.ok(String(lic.agencyNote ?? "").includes(noteFragment), `agency note must reference ${noteFragment}`);
      assert.ok(!/Junta|Examining Boards/i.test(String(lic.agency ?? "")), "the agency pill itself must not name the Juntas");
    });
  }

  it("a generic fallback firing alongside the specific rule cannot steal the agency pill", () => {
    // 2026-09-23 12:00 (S161): an insurance agency answering
    // Q_PROFESSIONAL_LICENSES=yes fired both RULE_0029 (generic, matched
    // first) and RULE_0224 — the classifier picked RULE_0224 as the winning
    // basis for reason/source_rule but the pill kept the first-matched
    // row's default agency. The pill must follow the winning basis.
    const lic = profLicenseFor("Insurance Agency", { Q_PROFESSIONAL_LICENSES: true });
    assert.ok(lic, "professional license requirement must exist for an insurance agency");
    assert.equal(lic.source_rule, "RULE_0224");
    assert.equal(lic.agency, "Oficina del Comisionado de Seguros (OCS)");
    assert.equal(lic.agencyUrl, "https://www.ocs.pr.gov/");
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

  it("a rule-level download override wins over the shared document default (REG-PROFESSION-AGENCY-002)", async () => {
    // 2026-09-24 live retest: the e7e7b64 engine fix was deployed and the
    // intake card showed the Salud destination, but the business page's
    // "File online" button still linked the Didaxis portal — the business
    // page resolves downloads via getDocumentDownload(documentId) only,
    // ignoring the obligation's source rule. The helper now accepts the
    // source rule id; the rule's own destination wins.
    const { getDocumentDownload } = await import("./kb");
    const tattoo = getDocumentDownload("DOC_PROFESSIONAL_LICENSE", "RULE_0696");
    assert.ok(tattoo, "tattoo-artist license must resolve a download destination");
    assert.equal(tattoo.url, "https://www.salud.pr.gov/");
    assert.equal(tattoo.kind, "guidance_page");
    // Controls: no rule, unknown rule, or a rule without an override keep
    // the document default (Didaxis/Juntas portal for genuine professions).
    const def = getDocumentDownload("DOC_PROFESSIONAL_LICENSE");
    assert.ok(def);
    assert.equal(def.url, "https://www.didaxispr.com/dept/estado-juntas");
    assert.equal(def.kind, "filing_portal");
    const unknown = getDocumentDownload("DOC_PROFESSIONAL_LICENSE", "RULE_DOES_NOT_EXIST");
    assert.deepEqual(unknown, def);
  });
});

describe("REG-DOMICILIARY-CITATION-001: domiciliary-use permit cites a real OGPe regulation", () => {
  // 2026-09-23 18:00 QA cycle (S163, Guaynabo home bakery): the
  // DOC_DOMICILIARY_USE_PERMIT citation was a model-written generic sentence
  // ("Home-based activity needs the applicable domiciliary-use permitting
  // path") at page confidence. §14.7 fix — the OGPe regulation MO-OGPe-001
  // (Regla 2.4.A.3, docs.pr.gov) explicitly names "Permisos Únicos ...
  // incluyendo los domiciliarios ... según lo establecido en el Reglamento
  // Conjunto". Pin the sourced citation so it never regresses to filler.
  it("cites the OGPe regulation naming domiciliary Permiso Único permits", () => {
    const docs = KB.documents as Array<{
      id: string; citation?: string; citation_url?: string | null;
      citation_confidence?: string;
    }>;
    const d = docs.find((x) => x.id === "DOC_DOMICILIARY_USE_PERMIT");
    assert.ok(d, "DOC_DOMICILIARY_USE_PERMIT must exist in the KB");
    assert.match(d.citation ?? "", /MO-OGPe-001/);
    assert.match(d.citation ?? "", /domiciliarios/i);
    assert.equal(d.citation_url, "https://docs.pr.gov/files/DDEC/Aviso%20Pu%CC%81blico/Revisi%C3%B3n-III%20FOMB-(9.4.2025)Reglamento%20Regulaci%C3%B3n%20Profesional-FINAL%20aceptado%20OGPe.pdf");
    assert.equal(d.citation_confidence, "official");
  });

  it("still carries the not-an-independent-permit note (per §29.3)", () => {
    const docs = KB.documents as Array<{ id: string; citation_note?: string }>;
    const d = docs.find((x) => x.id === "DOC_DOMICILIARY_USE_PERMIT");
    assert.ok(d);
    assert.match(d.citation_note ?? "", /not an independent permit/i);
  });
});
