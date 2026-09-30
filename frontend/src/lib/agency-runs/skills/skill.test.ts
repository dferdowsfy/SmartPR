import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REQUIRED_HUMAN_GATES, applyTransform, type Skill } from "./skill";
import { SKILL_SCHEMA, isSubmitTarget, validateSkill } from "./skillValidate";
import { validateJsonSchema } from "./jsonSchema";
import { AGENCY_FILING_CONFIGS } from "../filingTypes";
import { CANONICAL_LABELS } from "../canonicalFields";

const SKILLS_DIR = __dirname;
const OGPE_FILE = "ogpe.permiso_unico.v1.json";

function loadSkillFile(name: string): Skill {
  return JSON.parse(readFileSync(join(SKILLS_DIR, name), "utf8")) as Skill;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const ogpe = loadSkillFile(OGPE_FILE);
const stepWithFields = (s: Skill) => s.steps.find((st) => st.fields.length > 0)!;
const stepWithActions = (s: Skill) => s.steps.find((st) => st.actions.length > 0)!;

describe("skill schema validator", () => {
  it("rejects keywords it does not implement instead of ignoring them", () => {
    assert.throws(() => validateJsonSchema({ maxLength: 3 }, "abcd"), /Unsupported/);
  });

  it("rejects a stored value on a field (skills hold structure, never data)", () => {
    const bad = clone(ogpe);
    (stepWithFields(bad).fields[0] as unknown as Record<string, unknown>).value = "Panadería La Esquina LLC";
    assert.ok(validateSkill(bad).some((e) => /\/value$/.test(e.path)));
  });

  it("rejects an action without a fallback", () => {
    const bad = clone(ogpe);
    delete (stepWithActions(bad).actions[0] as Partial<Skill["steps"][0]["actions"][0]>).fallback;
    assert.ok(validateSkill(bad).some((e) => /fallback/.test(e.message)));
  });

  it("rejects an unmapped field that does not pause and ask", () => {
    const bad = clone(ogpe);
    const field = stepWithFields(bad).fields.find((f) => f.passport_path !== null)!;
    field.passport_path = null;
    assert.ok(validateSkill(bad).some((e) => /unmapped field/.test(e.message)));
  });

  it("rejects a Clara click on Radicar", () => {
    const bad = clone(ogpe);
    stepWithActions(bad).actions.push({
      type: "click",
      target: { role: "button", label_contains: "Radicar" },
      fallback: "pause_and_ask",
    });
    assert.ok(validateSkill(bad).some((e) => /final submit/.test(e.message)));
  });

  it("rejects a Clara click on a certification checkbox", () => {
    const bad = clone(ogpe);
    stepWithActions(bad).actions.push({
      type: "click",
      target: { role: "checkbox", label_contains: "Certifico bajo juramento" },
      fallback: "pause_and_ask",
    });
    assert.ok(validateSkill(bad).some((e) => /certification control/.test(e.message)));
  });

  it("rejects a password or payment field in a skill", () => {
    for (const label of ["Contraseña", "Número de tarjeta", "Código de verificación"]) {
      const bad = clone(ogpe);
      stepWithFields(bad).fields[0].portal_field.label = label;
      assert.ok(validateSkill(bad).some((e) => /human-only/.test(e.message)), label);
    }
  });

  it("rejects actions or fields on a gate screen", () => {
    const bad = clone(ogpe);
    const payment = bad.steps.find((s) => s.gate === "payment")!;
    payment.actions = [{ type: "click", target: { role: "button", label_contains: "Pagar" }, fallback: "pause_and_ask" }];
    assert.ok(validateSkill(bad).length > 0);
  });

  it("rejects a missing required gate, or one downgraded to pause", () => {
    const missing = clone(ogpe);
    missing.gates = missing.gates.filter((g) => g.id !== "signature");
    assert.ok(validateSkill(missing).some((e) => /signature/.test(e.message)));

    const downgraded = clone(ogpe);
    downgraded.gates.find((g) => g.id === "certification")!.type = "pause";
    assert.ok(validateSkill(downgraded).some((e) => /must be type human/.test(e.message)));
  });

  it("rejects a branch to an unknown step", () => {
    const bad = clone(ogpe);
    stepWithFields(bad).branches = [
      { when: { passport_has: "business.tradeName" }, goto_step: "no-such-step" },
    ];
    assert.ok(validateSkill(bad).some((e) => /unknown step/.test(e.message)));
  });

  it("rejects Clara filling after the submit gate", () => {
    const bad = clone(ogpe);
    const [work] = bad.steps.splice(bad.steps.indexOf(stepWithFields(bad)), 1);
    bad.steps.push(work);
    assert.ok(validateSkill(bad).some((e) => /after the submit gate/.test(e.message)));
  });
});

describe("skills are not tied to known portals", () => {
  it("a skill for any government site validates without a filing config", () => {
    const other: Skill = {
      skill_id: "municipio_ejemplo.patente_municipal",
      version: 1,
      portal: { name: "Municipio de Ejemplo — Portal de Patentes", base_url: "https://patentes.ejemplo.invalid/" },
      form: "Patente Municipal",
      taught_by: "user",
      scope: "private",
      status: "draft",
      steps: [
        {
          id: "datos-negocio",
          label: { en: "Business details", es: "Datos del negocio" },
          page_match: { title_contains: "Datos del negocio" },
          observed: true,
          fallback: "pause_and_ask",
          actions: [],
          fields: [
            {
              portal_field: { label: "Nombre del negocio", selector: "#nombre", role: "textbox" },
              passport_path: "business.legalName",
              transform: "trim",
              required: true,
              fallback: "pause_and_ask",
            },
          ],
        },
        {
          id: "enviar",
          label: { en: "Submit", es: "Enviar" },
          page_match: { title_contains: "Revisión" },
          gate: "submit",
          observed: true,
          fallback: "pause_and_ask",
          actions: [],
          fields: [],
        },
      ],
      gates: REQUIRED_HUMAN_GATES.map((id) => ({ id, type: "human" as const })),
    };
    assert.deepEqual(validateSkill(other), []);
  });
});

describe("field transforms", () => {
  it("strip_formatting drops phone punctuation and spaces", () => {
    assert.equal(applyTransform("(787) 555-1234", "strip_formatting"), "7875551234");
    assert.equal(applyTransform("+1 787.555.1234", "strip_formatting"), "17875551234");
  });
  it("digits_only, trim, uppercase, null", () => {
    assert.equal(applyTransform("00918-1234", "digits_only"), "009181234");
    assert.equal(applyTransform("  Hato Rey ", "trim"), "Hato Rey");
    assert.equal(applyTransform("pr", "uppercase"), "PR");
    assert.equal(applyTransform(" as is ", null), " as is ");
  });
});

describe("every skill file in skills/", () => {
  const files = readdirSync(SKILLS_DIR).filter((f) => /\.v\d+\.json$/.test(f));

  it("finds at least one skill", () => {
    assert.ok(files.length >= 1);
  });

  for (const file of files) {
    it(`${file} validates and its name matches skill_id + version`, () => {
      const skill = loadSkillFile(file);
      assert.deepEqual(validateSkill(skill), []);
      assert.equal(file, `${skill.skill_id}.v${skill.version}.json`);
    });
  }
});

describe(`skill v0: ${OGPE_FILE}`, () => {
  it("validates against skill.schema.json", () => {
    assert.deepEqual(validateJsonSchema(SKILL_SCHEMA, ogpe), []);
    assert.deepEqual(validateSkill(ogpe), []);
  });

  it("every step, action and field declares a fallback", () => {
    for (const step of ogpe.steps) {
      assert.ok(step.fallback, `step ${step.id}`);
      for (const a of step.actions) assert.ok(a.fallback, `${step.id}: ${a.target.label_contains}`);
      for (const f of step.fields) assert.ok(f.fallback, `${step.id}: ${f.portal_field.label}`);
    }
  });

  it("declares every §3 human gate, plus the spec's parcel pause", () => {
    const gates = new Map(ogpe.gates.map((g) => [g.id, g]));
    for (const id of REQUIRED_HUMAN_GATES) {
      assert.equal(gates.get(id)?.type, "human", `gate ${id}`);
    }
    assert.equal(gates.get("parcel")?.type, "pause");
    for (const gate of ogpe.gates) {
      assert.ok(gate.handoff?.en && gate.handoff.es, `gate ${gate.id} needs bilingual handoff copy`);
    }
  });

  it("no step automates submit", () => {
    for (const step of ogpe.steps) {
      for (const action of step.actions) {
        assert.ok(!isSubmitTarget(action.target), `step ${step.id} automates submit`);
      }
    }
    const submit = ogpe.steps.filter((s) => s.gate === "submit");
    assert.equal(submit.length, 1, "exactly one submit screen");
    assert.equal(submit[0].actions.length + submit[0].fields.length, 0);
  });

  it("login, MFA, certification, payment and submit are gate screens Clara doesn't touch", () => {
    for (const gate of ["login", "mfa", "certification", "payment", "submit"]) {
      const step = ogpe.steps.find((s) => s.gate === gate);
      assert.ok(step, `no step for gate ${gate}`);
      assert.equal(step.actions.length + step.fields.length, 0, gate);
    }
  });

  it("every mapped field uses a canonical passport path; unmapped fields ask", () => {
    for (const step of ogpe.steps) {
      for (const field of step.fields) {
        if (field.passport_path === null) {
          assert.equal(field.fallback, "pause_and_ask");
          assert.ok(field.ask?.en && field.ask.es, field.portal_field.label);
        } else {
          assert.ok(
            field.passport_path in CANONICAL_LABELS,
            `${step.id}: ${field.passport_path} is not a canonical passport path`
          );
        }
      }
    }
  });

  it("encodes the OGPe playbook rules", () => {
    const text = JSON.stringify(ogpe);
    assert.match(text, /POST-LOGIN SWEEP/);
    assert.match(text, /CUSTOM DROPDOWNS/);

    const owner = ogpe.steps.find((s) => s.id === "proyecto-dueno")!;
    assert.deepEqual(owner.actions.map((a) => a.target.label_contains), ["Usted"]);
    assert.match(owner.actions[0].rule ?? "", /never 'De una compañía'/);
    for (const step of ogpe.steps) {
      for (const action of step.actions) assert.doesNotMatch(action.target.label_contains, /compañía/i);
      for (const field of step.fields) {
        if (field.portal_field.role === "combobox") {
          assert.match(field.rule ?? "", /CUSTOM DROPDOWNS/, `${step.id}: ${field.portal_field.label}`);
        }
      }
    }
    // The sweep rule sits on the first screen after MFA.
    const afterMfa = ogpe.steps[ogpe.steps.findIndex((s) => s.gate === "mfa") + 1];
    assert.ok(afterMfa.rules?.some((r) => r.startsWith("POST-LOGIN SWEEP")));
  });

  it("honestly marks uploads, certification, payment and submission as unobserved", () => {
    for (const gate of ["upload", "certification", "payment", "submit"]) {
      assert.equal(ogpe.steps.find((s) => s.gate === gate)!.observed, false, gate);
    }
  });

  it("stores no credentials, codes, values or recorded selectors it doesn't have", () => {
    const text = readFileSync(join(SKILLS_DIR, OGPE_FILE), "utf8");
    assert.doesNotMatch(text, /"(value|password|otp|ssn)"\s*:/i);
    for (const step of ogpe.steps) {
      for (const a of step.actions) assert.equal(a.target.selector, null);
      for (const f of step.fields) assert.equal(f.portal_field.selector, null);
    }
  });

  it("matches the OGPe filing config", () => {
    const config = AGENCY_FILING_CONFIGS.find((c) => c.id === ogpe.filing_type_id);
    assert.ok(config, `no filing config ${ogpe.filing_type_id}`);
    assert.ok(config.domains.includes(new URL(ogpe.portal.base_url).hostname));
  });
});
