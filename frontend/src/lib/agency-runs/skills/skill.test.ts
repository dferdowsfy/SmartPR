import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REFUSE_GATES,
  REQUIRED_HUMAN_GATES,
  SKILL_SCHEMA,
  isSubmitAction,
  stepActions,
  validateSkill,
  type Skill,
} from "./skill";
import { validateJsonSchema } from "./jsonSchema";
import { AGENCY_FILING_CONFIGS } from "../filingTypes";
import { CANONICAL_LABELS } from "../canonicalFields";

const SKILLS_DIR = __dirname;

function loadSkillFile(name: string): Skill {
  return JSON.parse(readFileSync(join(SKILLS_DIR, name), "utf8")) as Skill;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const OGPE_FILE = "ogpe.permiso_unico.v1.json";
const ogpe = loadSkillFile(OGPE_FILE);

describe("skill schema validator", () => {
  it("rejects keywords it does not implement instead of ignoring them", () => {
    assert.throws(() => validateJsonSchema({ maxLength: 3 }, "abcd"), /Unsupported/);
  });

  it("rejects a stored value on a fill action (skills hold structure, never data)", () => {
    const bad = clone(ogpe) as unknown as { steps: { actions: Record<string, unknown>[] }[] };
    const step = bad.steps.find((s) => s.actions.some((a) => a.type === "fill"))!;
    step.actions.find((a) => a.type === "fill")!.value = "Panadería La Esquina LLC";
    assert.ok(validateSkill(bad).some((e) => /\/value value not allowed/.test(e.message)));
  });

  it("rejects a fill with no mapping source", () => {
    const bad = clone(ogpe) as unknown as { steps: { actions: Record<string, unknown>[] }[] };
    const step = bad.steps.find((s) => s.actions.some((a) => a.type === "fill"))!;
    delete step.actions.find((a) => a.type === "fill")!.source;
    assert.ok(validateSkill(bad).length > 0);
  });

  it("rejects a step with no fallback", () => {
    const bad = clone(ogpe);
    bad.steps[0].fallbacks = [];
    assert.ok(validateSkill(bad).some((e) => /fallbacks/.test(e.path)));
  });

  it("rejects Clara acting on a human gate step", () => {
    const bad = clone(ogpe);
    const payment = bad.steps.find((s) => s.gate === "payment")!;
    payment.actor = "clara";
    assert.ok(validateSkill(bad).length > 0);
  });

  it("rejects actions on a human step", () => {
    const bad = clone(ogpe);
    const login = bad.steps.find((s) => s.gate === "login")!;
    login.actions = [{ type: "click", target: { label_es: "Entrar" } }];
    assert.ok(validateSkill(bad).length > 0);
  });

  it("rejects a Clara click on Radicar", () => {
    const bad = clone(ogpe);
    const step = bad.steps.find((s) => s.actor === "clara" && s.actions.length > 0)!;
    step.actions.push({ type: "click", target: { label_es: "Radicar", control: "button" } });
    assert.ok(validateSkill(bad).some((e) => /final submit/.test(e.message)));
  });

  it("rejects a missing required gate", () => {
    const bad = clone(ogpe);
    bad.gates = bad.gates.filter((g) => g.kind !== "certification");
    bad.steps = bad.steps.filter((s) => s.gate !== "certification");
    assert.ok(validateSkill(bad).some((e) => /certification/.test(e.message)));
  });

  it("rejects Clara merely pausing (not refusing) at payment", () => {
    const bad = clone(ogpe);
    bad.gates.find((g) => g.kind === "payment")!.clara = "pause_and_handoff";
    assert.ok(validateSkill(bad).some((e) => /refuse_and_handoff/.test(e.message)));
  });
});

describe("every skill file in skills/", () => {
  const files = readdirSync(SKILLS_DIR).filter((f) => /\.v\d+\.json$/.test(f));

  it("finds at least one skill", () => {
    assert.ok(files.length >= 1);
  });

  for (const file of files) {
    it(`${file} validates and its name matches skillId + version`, () => {
      const skill = loadSkillFile(file);
      assert.deepEqual(validateSkill(skill), []);
      assert.equal(file, `${skill.skillId}.v${skill.version}.json`);
    });
  }
});

describe(`skill v0: ${OGPE_FILE}`, () => {
  it("validates against skill.schema.json", () => {
    assert.deepEqual(validateJsonSchema(SKILL_SCHEMA, ogpe), []);
    assert.deepEqual(validateSkill(ogpe), []);
  });

  it("every step has at least one fallback", () => {
    for (const step of ogpe.steps) {
      assert.ok(step.fallbacks.length >= 1, `step ${step.id} has no fallback`);
    }
  });

  it("declares every required human gate, all performed by the human", () => {
    const declared = new Map(ogpe.gates.map((g) => [g.kind, g]));
    for (const kind of REQUIRED_HUMAN_GATES) {
      const gate = declared.get(kind);
      assert.ok(gate, `gate ${kind} not declared`);
      assert.equal(gate.actor, "human");
    }
    for (const kind of REFUSE_GATES) {
      assert.equal(declared.get(kind)!.clara, "refuse_and_handoff", `${kind} must be refused`);
    }
  });

  it("no step automates submit", () => {
    for (const step of ogpe.steps) {
      for (const action of stepActions(step)) {
        assert.ok(!isSubmitAction(action), `step ${step.id} automates submit`);
      }
    }
    const submit = ogpe.steps.filter((s) => s.gate === "final_submit");
    assert.equal(submit.length, 1, "exactly one final-submit step");
    assert.equal(submit[0].actor, "human");
    assert.equal(submit[0].actions.length, 0);
  });

  it("gated login, MFA, certification, payment and submit steps are human, in-browser, action-free", () => {
    for (const kind of ["login", "mfa", "certification", "payment", "final_submit"] as const) {
      const step = ogpe.steps.find((s) => s.gate === kind);
      assert.ok(step, `no step gated ${kind}`);
      assert.equal(step.actor, "human", `${kind} step actor`);
      assert.equal(step.channel, "IN_BROWSER", `${kind} step channel`);
      assert.equal(step.actions.length, 0, `${kind} step has actions`);
    }
  });

  it("final submit comes after certification and every Clara fill", () => {
    const idx = (pred: (s: Skill["steps"][number]) => boolean) => ogpe.steps.findIndex(pred);
    const submitAt = idx((s) => s.gate === "final_submit");
    assert.ok(idx((s) => s.gate === "certification") < submitAt);
    const lastFill = ogpe.steps.map((s, i) => (s.actions.some((a) => a.type === "fill") ? i : -1));
    assert.ok(Math.max(...lastFill) < submitAt);
  });

  it("every fill maps to a canonical passport path or asks the human", () => {
    for (const step of ogpe.steps) {
      for (const action of stepActions(step)) {
        if (action.type !== "fill") continue;
        if (action.source.kind === "passport") {
          assert.ok(
            action.source.path in CANONICAL_LABELS,
            `${step.id}: ${action.source.path} is not a canonical passport path`
          );
        } else {
          assert.ok(action.source.ask.es.trim() && action.source.ask.en.trim());
        }
      }
      for (const branch of step.branches ?? []) {
        assert.ok(branch.when.passportPath in CANONICAL_LABELS, `${step.id}: branch ${branch.id}`);
      }
    }
  });

  it("every Clara step that fills can pause on an unmapped field", () => {
    for (const step of ogpe.steps) {
      if (!step.actions.some((a) => a.type === "fill")) continue;
      assert.ok(
        step.fallbacks.some((f) => f.on === "unmapped_field" && f.do === "pause_and_ask"),
        `${step.id} lacks an unmapped_field pause`
      );
    }
  });

  it("stores no credentials, codes or entered values", () => {
    const text = readFileSync(join(SKILLS_DIR, OGPE_FILE), "utf8");
    assert.doesNotMatch(text, /"(value|password|otp|code|ssn|ein)"\s*:/i);
    assert.doesNotMatch(text, /"control"\s*:\s*"password"/);
  });

  it("encodes the OGPe playbook rules from filingTypes/taskPrompt", () => {
    const rules = new Map(ogpe.rules.map((r) => [r.id, r]));
    for (const id of ["post_login_sweep", "custom_dropdowns", "usted_never_compania"]) {
      assert.ok(rules.has(id), `rule ${id} missing`);
    }
    const owner = ogpe.steps.find((s) => s.id === "dueno_proyecto")!;
    const choices = stepActions(owner).filter((a) => a.type === "choose");
    assert.deepEqual(choices.map((a) => a.type === "choose" && a.option), ["Usted"]);
    for (const step of ogpe.steps) {
      for (const action of stepActions(step)) {
        if (action.type === "choose") assert.notEqual(action.option, "De una compañía");
        if (action.target.control === "custom_dropdown") {
          assert.ok(action.ruleIds?.includes("custom_dropdowns"), `${step.id}: dropdown without quirk rule`);
        }
      }
    }
    const afterLogin = ogpe.steps[ogpe.steps.findIndex((s) => s.gate === "mfa") + 1];
    assert.ok(stepActions(afterLogin).some((a) => a.ruleIds?.includes("post_login_sweep")));
  });

  it("honestly marks uploads, certification, payment and submission as unobserved", () => {
    for (const kind of ["upload", "certification", "payment", "final_submit"] as const) {
      const step = ogpe.steps.find((s) => s.gate === kind)!;
      assert.equal(step.observed, false, `${kind} step must be observed:false`);
    }
    for (const step of ogpe.steps) {
      if (step.observed) assert.match(step.evidence, /^live_/, `${step.id}: observed without live evidence`);
    }
  });

  it("matches the OGPe filing config's portal and form", () => {
    const config = AGENCY_FILING_CONFIGS.find((c) => c.id === ogpe.form.filingTypeId);
    assert.ok(config, `no filing config ${ogpe.form.filingTypeId}`);
    assert.equal(config.agencyId, ogpe.portal.agencyId);
    assert.deepEqual(config.domains, ogpe.portal.domains);
    assert.equal(config.startUrl, ogpe.portal.startUrl);
  });
});
