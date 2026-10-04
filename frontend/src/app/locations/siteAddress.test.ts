// Run: npx tsx --test src/app/locations/siteAddress.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { siteAddressParts } from "./siteAddress";

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
