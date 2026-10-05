import { test } from "node:test";
import assert from "node:assert/strict";
import { floodMapSummary, floodZoneList, layerChips, type SiteLayers } from "./layers.ts";

test("floodZoneList: governing zone first, each other distinct zone once", () => {
  assert.deepEqual(floodZoneList([{ zone: "X" }, { zone: "AE" }, { zone: "X", sub: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" }]), ["AE", "X"]);
  assert.deepEqual(floodZoneList([{ zone: "X" }, { zone: "X" }], "AE"), ["AE", "X"]);
  assert.deepEqual(floodZoneList([{ zone: "AE" }, { zone: "VE" }, { zone: "ae" }]), ["VE", "AE"]);
  assert.deepEqual(floodZoneList([{ zone: "" }, { zone: " x " }]), ["X"]);
  assert.deepEqual(floodZoneList([]), []);
});

// Isla Verde (18.443404,-66.018583): NFHL returns AE plus two X polygons at the pin.
const islaVerde = {
  latitude: 18.443404,
  longitude: -66.018583,
  results: [{
    layer: "flood_zone", status: "resolved", code: "AE", name: "Zone AE", tags: ["SFHA"],
    attributes: { FLD_ZONE: "AE", ZONE_SUBTY: null, SFHA_TF: "T", STATIC_BFE: 4, ZONES_AT_POINT: 3, ZONES_LIST: "AE,X,X" },
    source: { name: "FEMA NFHL", url: "", version: null, dataset_date: null }, retrieved_at: "2026-10-05T00:00:00Z",
  }],
} as unknown as SiteLayers;

test("floodMapSummary: Isla Verde lists AE then X once (not 'AE · X · X')", () => {
  const fm = floodMapSummary(islaVerde);
  assert.equal(fm?.zone, "AE");
  assert.deepEqual(fm?.zones, ["AE", "X"]);
});

test("flood chip shows governing zone then distinct others, EN and ES", () => {
  const chip = layerChips(islaVerde).find((c) => c.layer === "flood_zone");
  assert.ok(chip);
  assert.equal(chip.label.en, "Flood zone AE · X");
  assert.equal(chip.label.es, "Zona inundable AE · X");
});
