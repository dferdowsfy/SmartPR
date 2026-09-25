import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFilingReadiness, filingReadinessKey, prettifyTag } from "./filingReadiness";
import type { FilingGroup, FilingOption } from "./agencyActions";
import { looksLikeSecret } from "../../app/businesses/[id]/agency-run/chatContracts";

const suri = {
  id: "SURI_REGISTER_TAXPAYER",
  obligation_id: "ob-1",
  supported: true,
  filing_status: "ready_to_start",
  action: { filing_type: "SURI_REGISTER_TAXPAYER", missing_items: [] },
} as unknown as FilingOption;
const unsupported = { id: "unsupported:ob-2", obligation_id: "ob-2", supported: false, action: null } as unknown as FilingOption;
const groups = [{ agency_id: "HACIENDA_SURI", filings: [suri, unsupported] }] as unknown as FilingGroup[];

describe("filing readiness", () => {
  it("lists only documents with a record behind them, best status per tag", () => {
    const r = buildFilingReadiness({
      groups,
      evidence: [
        { review_status: "UPLOADED", requirement_tags: ["DOC_EIN"] },
        { review_status: "VERIFIED", requirement_tags: ["DOC_EIN"] },
        { review_status: "REJECTED", requirement_tags: ["DOC_CERT_INCORPORATION"] },
        { review_status: "NEEDS_REVIEW", requirement_tags: ["DOC_PHOTO_ID"] },
      ],
      obligations: [{ requirement_id: "DOC_EIN", name: "EIN Confirmation Letter" }],
      passport: { filled: 10, total: 10 },
    });
    assert.deepEqual(
      r.documents.map((d) => [d.label_en, d.status]),
      [["EIN Confirmation Letter", "verified"], ["Business Passport", "verified"], ["Photo ID", "needs_attention"]]
    );
    assert.ok(!r.documents.some((d) => /Incorporation/.test(d.label_en)), "rejected file is not 'on file'");
  });

  it("counts the passport plus each required evidence tag per filing", () => {
    const r = buildFilingReadiness({
      groups,
      evidence: [{ review_status: "VERIFIED", requirement_tags: ["DOC_PHOTO_ID"] }],
      obligations: [],
      passport: { filled: 3, total: 10 },
    });
    assert.equal(r.filings.length, 1, "unsupported filings get no readiness");
    const f = r.filings[0];
    assert.equal(f.key, filingReadinessKey(suri));
    // SURI taxpayer config requires photo ID, utility bill, SSN card.
    assert.equal(f.total, 4);
    assert.equal(f.ready, 2);
    assert.deepEqual(f.items.filter((i) => !i.ready).map((i) => i.id), ["DOC_UTILITY_BILL", "DOC_SSN_CARD"]);
    assert.match(r.documents.at(-1)!.label_en, /Business Passport \(30%\)/);
  });

  it("prettifies tags without an obligation name", () => {
    assert.equal(prettifyTag("DOC_PHOTO_ID"), "Photo ID");
    assert.equal(prettifyTag("DOC_EIN"), "EIN");
  });
});

describe("chat input never collects secrets", () => {
  it("flags credentials, codes and full ID numbers", () => {
    for (const t of ["my password is hunter2", "contraseña: abc123", "123-45-6789", "the code is 482913", "482913", "4242 4242 4242 4242", "ssn 123456789"]) {
      assert.equal(looksLikeSecret(t), true, t);
    }
  });
  it("lets ordinary questions through", () => {
    for (const t of ["What does OGPe need for a Permiso Único?", "Explain the requirement for SURI", "Is the $150 fee refundable?", "When is Form 480 due in 2026?"]) {
      assert.equal(looksLikeSecret(t), false, t);
    }
  });
});
