import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  IRREVERSIBLE_GATES,
  gateCopy,
  isIrreversibleGate,
} from "./irreversibleGates";

describe("irreversibleGates", () => {
  it("registry contains the five expected gates", () => {
    assert.deepEqual([...IRREVERSIBLE_GATES], [
      "attestation",
      "certification",
      "signature",
      "payment",
      "final_submission",
    ]);
  });

  it("payment gate copy states no charge without explicit approval", () => {
    const c = gateCopy("payment", "en");
    assert.equal(c.title_en, "Payment authorization needed");
    assert.equal(c.title_es, "Se necesita autorización de pago");
    assert.ok(
      /never charge anything without your explicit approval/i.test(c.body_en),
      c.body_en
    );
    assert.ok(
      /nunca har[áa] un cargo sin tu aprobaci[óo]n expl[íi]cita/i.test(c.body_es),
      c.body_es
    );
  });

  it("final_submission gate copy says the user decides", () => {
    const c = gateCopy("final_submission", "es");
    assert.equal(c.title_en, "Ready to submit — your call");
    assert.equal(c.title_es, "Lista para enviar — tú decides");
    assert.ok(/until you authorize it/i.test(c.body_en), c.body_en);
    assert.ok(/hasta que tú lo autorices/i.test(c.body_es), c.body_es);
  });

  it("every gate returns complete bilingual copy", () => {
    for (const gate of IRREVERSIBLE_GATES) {
      const c = gateCopy(gate, "en");
      for (const [k, v] of Object.entries(c)) {
        assert.ok(v.length > 0, `${gate}.${k} is empty`);
      }
    }
  });

  it("isIrreversibleGate discriminates", () => {
    assert.equal(isIrreversibleGate("payment"), true);
    assert.equal(isIrreversibleGate("final_submission"), true);
    assert.equal(isIrreversibleGate("navigation"), false);
    assert.equal(isIrreversibleGate(""), false);
  });
});
