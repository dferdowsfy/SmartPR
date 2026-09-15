import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isPrefillBlocked,
  mergeFieldsWithPassportPrefill,
  prefillFromPassport,
} from "./prefillFromPassport";
import type { AgencyPendingField } from "./types";

const passport = {
  business: {
    legalName: "Café Plaza LLC",
    tradeName: "Café Plaza",
    email: "hola@cafeplaza.pr",
    phone: "787-555-0100",
    ein: "66-1234567",
    registryNumber: "12345",
    entityType: "limited_liability_company",
  },
  contact: {
    fullName: "Ana Rivera",
    email: "ana@cafeplaza.pr",
    phone: "787-555-0199",
  },
  addresses: {
    principalPhysical: {
      line1: "123 Calle Principal",
      line2: "Ste 2",
      cityOrMunicipality: "San Juan",
      state: "PR",
      postalCode: "00901",
    },
  },
  _denormalized: {
    legal_name: "Café Plaza LLC",
    name: "Café Plaza",
    entity_number: "12345",
    business_structure: "llc",
    municipality: "San Juan",
    physical_address: "123 Calle Principal, San Juan, PR 00901",
  },
};

describe("prefillFromPassport", () => {
  it("prefills email aliases from business.email and never touches password/mfa", () => {
    const fields: AgencyPendingField[] = [
      { id: "email", label: "Email", type: "email", sensitive: false },
      { id: "password", label: "Password", type: "password", sensitive: true },
      { id: "mfa", label: "MFA code", type: "text", sensitive: true, optional: true },
    ];
    const out = prefillFromPassport(fields, passport);
    assert.equal(out.email, "hola@cafeplaza.pr");
    assert.equal(out.password, undefined);
    assert.equal(out.mfa, undefined);
  });

  it("maps contact_email / business_email / login_email aggressively", () => {
    const fields: AgencyPendingField[] = [
      { id: "contact_email", label: "Contact email", type: "email", sensitive: false },
      { id: "business_email", label: "Business email", type: "email", sensitive: false },
      { id: "login_email", label: "Login", type: "email", sensitive: false },
    ];
    const out = prefillFromPassport(fields, passport);
    assert.ok(out.contact_email);
    assert.ok(out.business_email);
    assert.ok(out.login_email);
  });

  it("prefills phone, names, address, municipality, ein, entity_number", () => {
    const fields: AgencyPendingField[] = [
      { id: "phone", label: "Phone", type: "tel", sensitive: false },
      { id: "legal_name", label: "Legal name", type: "text", sensitive: false },
      { id: "first_name", label: "First name", type: "text", sensitive: false },
      { id: "last_name", label: "Last name", type: "text", sensitive: false },
      { id: "address", label: "Street", type: "text", sensitive: false },
      { id: "municipality", label: "Municipality", type: "text", sensitive: false },
      { id: "ein", label: "EIN", type: "text", sensitive: false },
      { id: "entity_number", label: "Registry", type: "text", sensitive: false },
    ];
    const out = prefillFromPassport(fields, passport);
    assert.equal(out.phone, "787-555-0100");
    assert.equal(out.legal_name, "Café Plaza LLC");
    assert.equal(out.first_name, "Ana");
    assert.equal(out.last_name, "Rivera");
    assert.equal(out.address, "123 Calle Principal");
    assert.equal(out.municipality, "San Juan");
    assert.equal(out.ein, "66-1234567");
    assert.equal(out.entity_number, "12345");
  });

  it("blocks sensitive=true even for email-shaped ids", () => {
    const fields: AgencyPendingField[] = [
      { id: "ssn", label: "SSN", type: "password", sensitive: true },
      { id: "email", label: "Email", type: "email", sensitive: true },
    ];
    assert.equal(isPrefillBlocked(fields[0]!), true);
    const out = prefillFromPassport(fields, passport);
    assert.deepEqual(out, {});
  });

  it("mergeFieldsWithPassportPrefill lets submitted win and fills empties", () => {
    const fields: AgencyPendingField[] = [
      { id: "email", label: "Email", type: "email", sensitive: false },
      { id: "phone", label: "Phone", type: "tel", sensitive: false },
      { id: "password", label: "Password", type: "password", sensitive: true },
    ];
    const merged = mergeFieldsWithPassportPrefill(
      fields,
      { email: "user-typed@example.com", password: "secret" },
      passport
    );
    assert.equal(merged.email, "user-typed@example.com");
    assert.equal(merged.phone, "787-555-0100");
    assert.equal(merged.password, "secret");
  });

  it("returns empty when passport missing", () => {
    const fields: AgencyPendingField[] = [
      { id: "email", label: "Email", type: "email", sensitive: false },
    ];
    assert.deepEqual(prefillFromPassport(fields, null), {});
  });
});
