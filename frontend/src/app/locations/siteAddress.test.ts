// Run: npx tsx --test src/app/locations/siteAddress.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { addressWithOfficialBarrio, contradictsOfficialBarrio, siteAddressParts } from "./siteAddress";

test("geocoder string → clean hierarchy, no United States", () => {
  const p = siteAddressParts({
    formatted_address: "Almacenes AEE / Luma Energy, Palo Seco, Toa Baja, Puerto Rico, 00962, United States",
    municipality: { name: "Toa Baja" },
    barrio: { name: "Palo Seco" },
  });
  assert.deepEqual(p, { primary: "Palo Seco, Toa Baja", secondary: "Puerto Rico 00962", placeName: "Almacenes AEE / Luma Energy", street: null });
});

test("street address without barrio leads the primary line", () => {
  const p = siteAddressParts({ formatted_address: "Calle José de Diego, Guaynabo, PR 00969", municipality: { name: "Guaynabo" }, barrio: null });
  assert.deepEqual(p, { primary: "Calle José de Diego, Guaynabo", secondary: "Puerto Rico 00969", placeName: null, street: null });
});

test("pin without an address", () => {
  const p = siteAddressParts({ formatted_address: null, municipality: { name: "Adjuntas" }, barrio: { name: "Adjuntas" } });
  assert.deepEqual(p, { primary: "Adjuntas", secondary: "Puerto Rico", placeName: null, street: null });
});

test("a bare house number is never shown as a place name", () => {
  const p = siteAddressParts({ formatted_address: "60, Calle Los Ramos, Quebrada Infierno, Gurabo, Puerto Rico, 00778, United States", municipality: { name: "Gurabo" }, barrio: { name: "Quebrada Infierno" } });
  assert.equal(p.placeName, null);
  assert.equal(p.street, "Calle Los Ramos 60");
  assert.equal(p.primary, "Quebrada Infierno, Gurabo");
  const q = siteAddressParts({ formatted_address: "60, Gurabo, PR", municipality: { name: "Gurabo" }, barrio: { name: "Quebrada Infierno" } });
  assert.equal(q.placeName, null);
});

// E6 (live 2026-10-14): the geocoder said "Maleza Alta, Aguadilla" while the
// official barrio layer placed the airport-area pin in Maleza Baja.
test("a sibling barrio from the geocoder never contradicts the official barrio", () => {
  assert.equal(contradictsOfficialBarrio("Maleza Alta", "Maleza Baja"), true);
  assert.equal(contradictsOfficialBarrio("Sabana Abajo", "Sabana Arriba"), true);
  assert.equal(contradictsOfficialBarrio("Maleza Baja", "Maleza Baja"), false);
  assert.equal(contradictsOfficialBarrio("Calle Luna 5", "Maleza Baja"), false);
  assert.equal(contradictsOfficialBarrio("Maleza Alta", null), false);
  const p = siteAddressParts({ formatted_address: "Maleza Alta, Aguadilla, Puerto Rico, 00603, United States", municipality: { name: "Aguadilla" }, barrio: { name: "Maleza Baja" } });
  assert.equal(p.primary, "Maleza Baja, Aguadilla");
  assert.equal(p.placeName, null);
  assert.equal(addressWithOfficialBarrio("Carr. 110, Maleza Alta, Aguadilla", "Maleza Baja"), "Carr. 110, Maleza Baja, Aguadilla");
});
