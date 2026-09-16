import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  humanizeValidationError,
  interventionHeading,
} from "./validationErrors";

describe("humanizeValidationError", () => {
  it("empty / null / undefined -> generic flagging copy", () => {
    for (const raw of ["", "   ", null, undefined]) {
      assert.equal(
        humanizeValidationError(raw, "en"),
        "The website is flagging a field, but it did not give a specific reason."
      );
      assert.equal(
        humanizeValidationError(raw, "es"),
        "El portal está marcando un campo, pero no dio una razón específica."
      );
    }
  });

  it("SSN + 9 digits -> 9-digit SSN copy", () => {
    const en = humanizeValidationError(
      "Invalid SSN: must contain 9 digits",
      "en"
    );
    assert.equal(
      en,
      "The site rejected that value. The Social Security number must contain exactly 9 digits."
    );
    const es = humanizeValidationError(
      "Invalid SSN: must contain 9 digits",
      "es"
    );
    assert.equal(
      es,
      "El portal rechazó ese valor. El número de Seguro Social debe tener exactamente 9 dígitos."
    );
  });

  it("SSN without digit specifics -> format SSN copy", () => {
    assert.equal(
      humanizeValidationError("Enter a valid SSN", "en"),
      "The site rejected the Social Security number that was entered — it has to match the format the portal expects."
    );
    assert.equal(
      humanizeValidationError("Enter a valid SSN", "es"),
      "El portal rechazó el número de Seguro Social ingresado — tiene que seguir el formato que espera el portal."
    );
  });

  it("purely technical text -> honest fallback, never leaked", () => {
    const raws = [
      "Timeout waiting for selector #ssn-field",
      "Element not found: input[name='ein']",
      "DOM query failed ::before",
    ];
    for (const raw of raws) {
      const en = humanizeValidationError(raw, "en");
      assert.equal(
        en,
        "SmartPR couldn't complete that step on the website, so I stopped before taking another action.",
        raw
      );
      const es = humanizeValidationError(raw, "es");
      assert.equal(
        es,
        "SmartPR no pudo completar ese paso en el portal, así que me detuve antes de hacer otra cosa.",
        raw
      );
      assert.ok(!/selector|timeout|dom/i.test(en), `technical leak: ${en}`);
    }
  });

  it("plain validation text -> quoted verbatim, no invented explanation", () => {
    assert.equal(
      humanizeValidationError("This field is required.", "en"),
      'The site says: "This field is required."'
    );
    assert.equal(
      humanizeValidationError("This field is required.", "es"),
      'El portal indica: "This field is required."'
    );
  });

  it("redacts SSN-shaped values before quoting", () => {
    const out = humanizeValidationError("Invalid value 123-45-6789", "en");
    assert.equal(out, 'The site says: "Invalid value [removed]"');
    assert.ok(!/\d{3}-\d{2}-\d{4}/.test(out));
  });
});

describe("interventionHeading", () => {
  it("USER_LOGIN -> 'One more item needed' / 'Falta un dato'", () => {
    const h = interventionHeading("USER_LOGIN", "en");
    assert.equal(h.title_en, "One more item needed");
    assert.equal(h.title_es, "Falta un dato");
    assert.ok(h.sub_en.length > 0 && h.sub_es.length > 0);
  });

  it("CAPTCHA copy", () => {
    const h = interventionHeading("CAPTCHA", "es");
    assert.equal(h.title_en, "Quick check on the portal");
    assert.equal(h.title_es, "Verificación rápida en el portal");
  });

  it("USER_UPLOAD copy", () => {
    const h = interventionHeading("USER_UPLOAD", "en");
    assert.equal(h.title_en, "Documents needed");
    assert.equal(h.title_es, "Documentos necesarios");
  });

  it("PAYMENT copy states SmartPR never pays without approval", () => {
    const h = interventionHeading("PAYMENT", "en");
    assert.equal(h.title_en, "Payment authorization needed");
    assert.equal(h.title_es, "Se necesita autorización de pago");
    assert.ok(
      /never pay anything without your explicit approval/i.test(h.sub_en),
      h.sub_en
    );
    assert.ok(
      /nunca pagar[áa] nada sin tu aprobaci[óo]n expl[íi]cita/i.test(h.sub_es),
      h.sub_es
    );
  });

  it("null reason -> generic waiting copy", () => {
    const h = interventionHeading(null, "en");
    assert.ok(h.title_en.length > 0 && h.title_es.length > 0);
    assert.ok(h.sub_en.length > 0 && h.sub_es.length > 0);
  });
});
