import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adoptPromptPlace, dismissProposal, extractPromptLocations, initialLocationState, keepSelected, onConfirmedChange,
  reconcilePrompt, isCurrentRevision, type ConfirmedSiteRef,
} from "./locationState.ts";

const NAMES = ["San Juan", "Caguas", "Gurabo", "Ponce", "Bayamón", "Guaynabo", "Juana Díaz", "Loíza", "Carolina", "Toa Baja"];
const site = (municipality: string, extra: Partial<ConfirmedSiteRef> = {}): ConfirmedSiteRef => ({
  municipality, barrio: null, formatted_address: null, latitude: 18.29, longitude: -65.99, origin: "map_pin", ...extra,
});
const s0 = initialLocationState();

test("prompt-first: municipio only → area_only (never a confirmed site)", () => {
  const r = reconcilePrompt(extractPromptLocations("I want to open a bakery in Caguas", NAMES), null, s0);
  assert.equal(r.kind, "area_only");
  assert.equal(r.kind === "area_only" && r.place.municipality, "Caguas");
});

test("prompt-first: street address → propose", () => {
  const r = reconcilePrompt(extractPromptLocations("Opening a café at Calle Luna 12 in San Juan", NAMES), null, s0);
  assert.equal(r.kind, "propose");
  assert.equal(r.kind === "propose" && r.place.precision, "address");
});

test("street named after a municipio is part of the address", () => {
  const p = extractPromptLocations("Restaurant on Calle Loíza 1800, San Juan", NAMES);
  assert.deepEqual(p.project.map((x) => x.municipality), ["San Juan"]);
});

test("pin-first: same municipality description keeps the pin", () => {
  const r = reconcilePrompt(extractPromptLocations("A hardware store in Gurabo", NAMES), site("Gurabo"), s0);
  assert.equal(r.kind, "agrees");
});

test("pin-first: different municipio → conflict naming both", () => {
  const r = reconcilePrompt(extractPromptLocations("We are opening a gym in Ponce", NAMES), site("Gurabo"), s0);
  assert.equal(r.kind, "conflict");
  assert.equal(r.kind === "conflict" && r.current, "Gurabo");
});

test("incidental mentions are not relocations", () => {
  for (const text of [
    "Bakery in Gurabo serving customers from Caguas and San Juan",
    "Bakery in Gurabo. I live in Ponce.",
    "Bakery in Gurabo; mailing address in Carolina",
    "Bakery in Gurabo with clients across Bayamón",
  ]) {
    const r = reconcilePrompt(extractPromptLocations(text, NAMES), site("Gurabo"), s0);
    assert.equal(r.kind, "agrees", text);
  }
});

test("multiple project sites → ambiguous", () => {
  const r = reconcilePrompt(extractPromptLocations("Choosing between a local in Ponce or a local in Caguas", NAMES), null, s0);
  assert.equal(r.kind, "ambiguous");
});

test("Keep selected property makes the pin authoritative; a moved pin asks again", () => {
  const places = extractPromptLocations("We are opening a gym in Ponce", NAMES);
  const cur = site("Gurabo");
  const r = reconcilePrompt(places, cur, s0);
  assert.equal(r.kind, "conflict");
  const kept = keepSelected(s0, r.kind === "conflict" ? r.place : places.project[0]!, cur);
  assert.equal(reconcilePrompt(places, cur, kept).kind, "agrees");
  const moved = site("Gurabo", { latitude: 18.3, longitude: -66.0 });
  assert.equal(reconcilePrompt(places, moved, onConfirmedChange(kept)).kind, "conflict");
});

test("reverse conflict: pin moved away from the description", () => {
  const places = extractPromptLocations("Opening a gym in Gurabo", NAMES);
  assert.equal(reconcilePrompt(places, site("Gurabo"), s0).kind, "agrees");
  assert.equal(reconcilePrompt(places, site("Ponce"), s0).kind, "conflict");
});

test("different street in the same municipio is a conflict; same street agrees", () => {
  const places = extractPromptLocations("Café at Calle Luna 12, San Juan", NAMES);
  assert.equal(reconcilePrompt(places, site("San Juan", { formatted_address: "Calle Luna 12, San Juan, PR 00901" }), s0).kind, "agrees");
  assert.equal(reconcilePrompt(places, site("San Juan", { formatted_address: "Avenida Ashford 1050, San Juan" }), s0).kind, "conflict");
});

test("cancel keeps the confirmed site; dismissed prompt stops proposing", () => {
  const places = extractPromptLocations("Bakery in Caguas", NAMES);
  const r = reconcilePrompt(places, null, s0);
  const st = dismissProposal(adoptPromptPlace(s0, places.project[0]!), places.project[0]!);
  assert.equal(st.adopting, null);
  assert.equal(st.revision, s0.revision);
  assert.equal(r.kind, "area_only");
  assert.equal(reconcilePrompt(places, null, st).kind, "none");
});

test("revisions drop stale async answers", () => {
  const a = onConfirmedChange(s0);
  const b = onConfirmedChange(a);
  assert.ok(isCurrentRevision(b, b.revision));
  assert.ok(!isCurrentRevision(b, a.revision));
});

test("Spanish prompts and accents", () => {
  const r = reconcilePrompt(extractPromptLocations("Quiero abrir una panadería en Juana Diaz, mis clientes son de Ponce", NAMES), site("Juana Díaz"), s0);
  assert.equal(r.kind, "agrees");
  const b = extractPromptLocations("Local en el barrio Quebrada Infierno de Gurabo", NAMES);
  assert.equal(b.project[0]?.precision, "barrio");
  assert.equal(b.project[0]?.barrio, "Quebrada Infierno");
});
