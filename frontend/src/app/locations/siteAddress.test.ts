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
  assert.deepEqual(p, { primary: "Palo Seco, Toa Baja", secondary: "Puerto Rico 00962", placeName: "Almacenes AEE / Luma Energy" });
});

test("street address without barrio leads the primary line", () => {
  const p = siteAddressParts({ formatted_address: "Calle José de Diego, Guaynabo, PR 00969", municipality: { name: "Guaynabo" }, barrio: null });
  assert.deepEqual(p, { primary: "Calle José de Diego, Guaynabo", secondary: "Puerto Rico 00969", placeName: null });
});

test("pin without an address", () => {
  const p = siteAddressParts({ formatted_address: null, municipality: { name: "Adjuntas" }, barrio: { name: "Adjuntas" } });
  assert.deepEqual(p, { primary: "Adjuntas", secondary: "Puerto Rico", placeName: null });
});
