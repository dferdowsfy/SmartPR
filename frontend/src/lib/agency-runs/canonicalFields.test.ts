import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_LABELS, normalizeForAgency } from "./canonicalFields";

describe("normalizeForAgency", () => {
  it("ein → digits only", () => {
    assert.equal(normalizeForAgency("66-1234567", "ein"), "661234567");
    assert.equal(normalizeForAgency(" 66 123 4567 ", "ein"), "661234567");
    assert.equal(normalizeForAgency("EIN 66-12-34567", "ein"), "661234567");
  });

  it("phone → digits, preserving a leading +", () => {
    assert.equal(normalizeForAgency("(787) 555-0100", "phone"), "7875550100");
    assert.equal(normalizeForAgency("+1 787-555-0100", "phone"), "+17875550100");
    assert.equal(normalizeForAgency("787.555.0100", "phone"), "7875550100");
  });

  it("date → MM/DD/YYYY from ISO or common inputs", () => {
    assert.equal(normalizeForAgency("2026-09-16", "date"), "09/16/2026");
    assert.equal(normalizeForAgency("2026-9-5", "date"), "09/05/2026");
    assert.equal(normalizeForAgency("09/16/2026", "date"), "09/16/2026");
    assert.equal(normalizeForAgency("9/6/2026", "date"), "09/06/2026");
    assert.equal(normalizeForAgency("2026-09-16T10:00:00Z", "date"), "09/16/2026");
  });

  it("date passes through unparseable input unchanged rather than inventing", () => {
    assert.equal(normalizeForAgency("ayer", "date"), "ayer");
    assert.equal(normalizeForAgency("", "date"), "");
  });

  it("text → trimmed", () => {
    assert.equal(normalizeForAgency("  Café Plaza  ", "text"), "Café Plaza");
  });
});

describe("CANONICAL_LABELS", () => {
  it("maps canonical paths to EN + PR Spanish labels with portal aliases", () => {
    const legal = CANONICAL_LABELS["business.legalName"];
    assert.ok(legal);
    assert.equal(legal.en, "Legal business name");
    assert.equal(legal.es, "Nombre legal del negocio");
    assert.equal(legal.agencyAliases.suri, "Nombre del contribuyente");
    assert.equal(legal.agencyAliases.deptstate, "Nombre de la entidad");
    assert.equal(legal.agencyAliases.ogpe, "Nombre del negocio");
  });

  it("uses boricua Spanish, not neutral/LatAm", () => {
    const muni = CANONICAL_LABELS["addresses.municipality"];
    assert.ok(muni);
    assert.equal(muni.es, "Municipio");
    const email = CANONICAL_LABELS["contact.email"];
    assert.ok(email);
    assert.equal(email.es, "Correo electrónico");
  });

  it("covers the coverage keys used by the filing registry", () => {
    for (const key of [
      "business.legalName",
      "business.tradeName",
      "business.entityType",
      "business.ein",
      "business.registryNumber",
      "contact.fullName",
      "contact.email",
      "contact.phone",
      "addresses.principalPhysical.line1",
      "addresses.municipality",
      "addresses.principalPhysical.postalCode",
      "addresses.state",
    ]) {
      assert.ok(CANONICAL_LABELS[key], `missing label for ${key}`);
    }
  });
});
