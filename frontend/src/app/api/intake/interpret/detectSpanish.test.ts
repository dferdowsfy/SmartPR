/**
 * Regression: Spanish input to /api/intake/interpret must be detected
 * server-side (from the user's own words, not the UI language toggle) so the
 * Spanish system prompt is used and fields populate instead of silently
 * returning nothing on a language mismatch.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectSpanish } from "./route.ts";

describe("detectSpanish", () => {
  it("detects plain Spanish descriptions", () => {
    assert.equal(detectSpanish("Quiero abrir un restaurante en San Juan con 10 empleados"), true);
    assert.equal(detectSpanish("Quiero abrir un bar en Bayamón"), true);
    assert.equal(
      detectSpanish("Me llamo José Rivera y quiero abrir una tienda en Ponce"),
      true
    );
  });

  it("detects short Spanish fragments", () => {
    assert.equal(detectSpanish("No voy a vender alcohol."), true);
    assert.equal(detectSpanish("Solo yo."), true);
    assert.equal(detectSpanish("¿Vendo alcohol en la barra?"), true);
  });

  it("detects Spanglish leaning Spanish", () => {
    assert.equal(detectSpanish("I want to abrir un negocio en San Juan"), true);
  });

  it("keeps English on the English path — even with PR municipality names", () => {
    assert.equal(
      detectSpanish("I want to open a restaurant in San Juan with 10 employees"),
      false
    );
    assert.equal(detectSpanish("I want to open a bar in Bayamón"), false);
    assert.equal(
      detectSpanish("My name is Jose Rivera and I want to open a store"),
      false
    );
    assert.equal(detectSpanish("No alcohol, no outdoor seating"), false);
    assert.equal(detectSpanish("Bar in Ponce"), false);
    assert.equal(detectSpanish("10 employees"), false);
  });

  it("handles empty input", () => {
    assert.equal(detectSpanish(""), false);
    assert.equal(detectSpanish("a"), false);
  });
});
