import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { passportScrubValues, sanitizeTeachEvent, type TeachEvent } from "./events";
import { proposeMapping } from "./passportCatalog";
import {
  addSkippedStep,
  answerQuestion,
  applyTeachEvent,
  markStepConditional,
  markStepGate,
  newTeachState,
  openQuestions,
  type TeachState,
} from "./teachSession";
import { buildSkillFromTeach, taughtSkillId } from "./buildSkill";
import { skillCard } from "../skills/skillCard";
import { validateSkill } from "../skills/skillValidate";

const BASE = "https://permisos.ejemplo.pr.gov";
const PASSPORT = {
  business: { legalName: "Panadería La Esquina LLC", entityType: "limited_liability_company" },
  contact: { fullName: "Marisol Rivera", email: "marisol@laesquina.pr", phone: "787-555-0142" },
  addresses: { municipality: "Bayamón", principalPhysical: { line1: "Calle Luna 10", postalCode: "00961" } },
};
const SECRETS = passportScrubValues(PASSPORT);

function ev(raw: Record<string, unknown>): TeachEvent {
  const e = sanitizeTeachEvent(raw, SECRETS);
  assert.ok(e, `event rejected: ${JSON.stringify(raw)}`);
  return e;
}

function start(tier: "admin" | "user" = "user"): TeachState {
  return newTeachState({ id: "t1", ownerUserId: "u1", tier, portalName: "Portal de Permisos", form: "Permiso de Uso", startUrl: `${BASE}/` });
}

/** A 5-screen demonstration: login → datos → dueño → empleados → revisión. */
function demo(): TeachEvent[] {
  return [
    ev({ kind: "page", url: `${BASE}/login`, title: "Portal", heading: "Iniciar sesión", hasPassword: true }),
    ev({ kind: "fill", url: `${BASE}/login`, role: "textbox", label: "Usuario", selector: "#user", inputType: "text", valueKind: "email" }),
    ev({ kind: "fill", url: `${BASE}/login`, role: "textbox", label: "Contraseña", selector: "#pass", inputType: "password", valueKind: "secret" }),
    ev({ kind: "click", url: `${BASE}/login`, role: "button", label: "Entrar", selector: "#go", inputType: "submit" }),
    ev({ kind: "page", url: `${BASE}/app#datos`, title: "Portal", heading: "Datos del negocio" }),
    ev({ kind: "fill", url: `${BASE}/app#datos`, role: "textbox", label: "Nombre legal", selector: "#Input_NombreLegal", inputType: "text", valueKind: "text", required: true }),
    ev({ kind: "fill", url: `${BASE}/app#datos`, role: "textbox", label: "Teléfono", selector: "#tel", inputType: "tel", valueKind: "phone", required: true }),
    ev({ kind: "click", url: `${BASE}/app#datos`, role: "combobox", label: "Municipio", selector: "#muni", inputType: "div" }),
    ev({ kind: "click", url: `${BASE}/app#datos`, role: "option", label: "Bayamón", selector: "#muni-opt-2", inputType: "li", optionText: "Bayamón" }),
    ev({ kind: "fill", url: `${BASE}/app#datos`, role: "textbox", label: "Nombre del proyecto", selector: "#proj", inputType: "text", valueKind: "text" }),
    ev({ kind: "click", url: `${BASE}/app#datos`, role: "button", label: "Continuar", selector: "#next1", inputType: "button" }),
    ev({ kind: "page", url: `${BASE}/app#dueno`, title: "Portal", heading: "¿A nombre de quién sale el permiso?" }),
    ev({ kind: "click", url: `${BASE}/app#dueno`, role: "radio", label: "De una compañía", selector: "#r2", inputType: "radio", optionText: "De una compañía" }),
    ev({ kind: "click", url: `${BASE}/app#dueno`, role: "radio", label: "Usted", selector: "#r1", inputType: "radio", optionText: "Usted" }),
    ev({ kind: "click", url: `${BASE}/app#dueno`, role: "button", label: "Continuar", selector: "#next2", inputType: "button" }),
    ev({ kind: "page", url: `${BASE}/app#empleados`, title: "Portal", heading: "Empleados" }),
    ev({ kind: "fill", url: `${BASE}/app#empleados`, role: "textbox", label: "Cantidad de empleados", selector: "#emp", inputType: "number", valueKind: "number" }),
    ev({ kind: "click", url: `${BASE}/app#empleados`, role: "button", label: "Continuar", selector: "#next3", inputType: "button" }),
    ev({ kind: "page", url: `${BASE}/app#revision`, title: "Portal", heading: "Revisión" }),
    ev({ kind: "click", url: `${BASE}/app#revision`, role: "checkbox", label: "Certifico bajo juramento que la información es correcta", selector: "#cert", inputType: "checkbox" }),
    ev({ kind: "click", url: `${BASE}/app#revision`, role: "button", label: "Radicar", selector: "#radicar", inputType: "button" }),
  ];
}

function answerAll(state: TeachState): TeachState {
  let s = state;
  for (const q of openQuestions(s)) {
    if (q.kind === "gate") s = answerQuestion(s, q.id, { kind: "yes_no", value: "yes" });
    else if (q.kind === "always_choose") s = answerQuestion(s, q.id, { kind: "yes_no", value: "yes" });
    else if (q.kind === "branch") s = answerQuestion(s, q.id, { kind: "branch", path: "operations.employeeCount" });
    else if (q.label === "Nombre del proyecto") s = answerQuestion(s, q.id, { kind: "mapping", choice: "ask" });
    else s = answerQuestion(s, q.id, { kind: "mapping", choice: "confirm" });
  }
  return s;
}

function taught(tier: "admin" | "user" = "user") {
  let s = start(tier);
  for (const e of demo()) s = applyTeachEvent(s, e);
  s = markStepConditional(s, s.steps.find((x) => x.heading === "Empleados")!.id);
  return answerAll(s);
}

describe("event sanitization", () => {
  it("drops query strings, unknown keys and values", () => {
    const e = sanitizeTeachEvent(
      { kind: "fill", url: `${BASE}/app?email=marisol@laesquina.pr#datos?x=1`, role: "textbox", label: "Nombre", selector: "#n", inputType: "text", valueKind: "text", value: "Panadería La Esquina LLC" },
      SECRETS
    )!;
    assert.equal(e.url, `${BASE}/app#datos`);
    assert.ok(!("value" in e));
  });

  it("scrubs passport values, emails and digit runs from labels", () => {
    const e = sanitizeTeachEvent(
      { kind: "page", url: `${BASE}/x`, title: "Bienvenida, Marisol Rivera", heading: "Cuenta 7875550142 de marisol@laesquina.pr — PANADERÍA LA ESQUINA LLC" },
      SECRETS
    ) as Extract<TeachEvent, { kind: "page" }>;
    assert.doesNotMatch(`${e.title} ${e.heading}`, /Marisol|7875550142|laesquina|ESQUINA/i);
  });

  it("drops a selector that carries a passport value", () => {
    const e = sanitizeTeachEvent({ kind: "click", url: `${BASE}/x`, role: "option", label: "Bayamón", selector: "li[data-name='Bayamón']", optionText: "Bayamón" }, SECRETS);
    assert.ok(e && e.kind === "click");
    assert.equal(e.selector, null);
    assert.doesNotMatch(e.optionText, /Bayam/);
  });

  it("forces password inputs to kind secret", () => {
    const e = sanitizeTeachEvent({ kind: "fill", url: `${BASE}/x`, role: "textbox", label: "Clave", inputType: "password", valueKind: "text" }, SECRETS);
    assert.equal(e && e.kind === "fill" && e.valueKind, "secret");
  });

  it("rejects non-http URLs and unknown kinds", () => {
    assert.equal(sanitizeTeachEvent({ kind: "page", url: "javascript:alert(1)" }), null);
    assert.equal(sanitizeTeachEvent({ kind: "keystroke", url: `${BASE}/` }), null);
  });
});

describe("mapping proposals", () => {
  it("proposes from labels, longest phrase first", () => {
    assert.equal(proposeMapping("Nombre legal de la entidad", "text")?.path, "business.legalName");
    assert.equal(proposeMapping("Email del negocio", "email")?.path, "business.email");
    assert.equal(proposeMapping("Correo electrónico", "email")?.path, "contact.email");
    assert.equal(proposeMapping("Código postal", "postal")?.path, "addresses.principalPhysical.postalCode");
    assert.equal(proposeMapping("Municipio", "option")?.path, "addresses.municipality");
  });
  it("falls back to a low-confidence guess from the value kind only", () => {
    const p = proposeMapping("Campo 7", "phone");
    assert.equal(p?.path, "contact.phone");
    assert.equal(p?.confidence, "low");
    assert.equal(proposeMapping("Campo 8", "text"), null);
  });
});

describe("teach session", () => {
  it("records nothing on the login screen and marks it as a human gate", () => {
    let s = start();
    for (const e of demo().slice(0, 4)) s = applyTeachEvent(s, e);
    assert.equal(s.steps.length, 1);
    assert.equal(s.steps[0].gate, "login");
    assert.equal(s.steps[0].fields.length, 0);
    assert.equal(s.steps[0].actions.length, 0);
    assert.deepEqual(openQuestions(s).map((q) => q.kind), ["gate"]);
  });

  it("asks a mapping question per fill with a proposal", () => {
    let s = start();
    for (const e of demo().slice(0, 10)) s = applyTeachEvent(s, e);
    const qs = openQuestions(s).filter((q) => q.kind === "mapping");
    const byLabel = Object.fromEntries(qs.map((q) => [q.label, q.kind === "mapping" ? q.proposal?.path ?? null : null]));
    assert.equal(byLabel["Nombre legal"], "business.legalName");
    assert.equal(byLabel["Teléfono"], "contact.phone");
    assert.equal(byLabel["Municipio"], "addresses.municipality");
    assert.equal(byLabel["Nombre del proyecto"], null);
  });

  it("keeps only the last radio in a group and asks 'always choose this?'", () => {
    let s = start();
    for (const e of demo().slice(0, 15)) s = applyTeachEvent(s, e);
    const choices = openQuestions(s).filter((q) => q.kind === "always_choose");
    assert.deepEqual(choices.map((q) => q.kind === "always_choose" && q.optionText), ["Usted"]);
  });

  it("detects certification and submit on the review screen", () => {
    let s = start();
    for (const e of demo()) s = applyTeachEvent(s, e);
    const review = s.steps.find((x) => x.heading === "Revisión")!;
    assert.equal(review.gate, "submit");
    assert.equal(review.actions.length, 0);
  });

  it("rejects answers that don't fit the question", () => {
    let s = start();
    for (const e of demo().slice(0, 10)) s = applyTeachEvent(s, e);
    const q = openQuestions(s).find((x) => x.kind === "mapping")!;
    assert.throws(() => answerQuestion(s, q.id, { kind: "yes_no", value: "yes" }));
    assert.throws(() => answerQuestion(s, q.id, { kind: "mapping", choice: "correct", path: "business.notAField" }));
    s = answerQuestion(s, q.id, { kind: "mapping", choice: "confirm" });
    assert.throws(() => answerQuestion(s, q.id, { kind: "mapping", choice: "confirm" }), /already/);
  });

  it("'No' on a detected gate removes it; the teacher can mark gates by hand", () => {
    let s = start();
    s = applyTeachEvent(s, ev({ kind: "page", url: `${BASE}/pago-info`, title: "Portal", heading: "Información de pago del arbitrio" }));
    const q = openQuestions(s).find((x) => x.kind === "gate")!;
    s = answerQuestion(s, q.id, { kind: "yes_no", value: "no" });
    assert.equal(s.steps[0].gate, null);
    s = markStepGate(s, s.steps[0].id, "payment");
    assert.equal(s.steps[0].gate, "payment");
  });
});

describe("taught skill", () => {
  it("builds a skill that passes validateSkill", () => {
    const { skill, blockers, errors } = buildSkillFromTeach(taught());
    assert.deepEqual(blockers, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(validateSkill(skill), []);
    assert.equal(skill.skill_id, "permisos_ejemplo_pr_gov.permiso_de_uso");
  });

  it("contains zero entered values", () => {
    const { skill } = buildSkillFromTeach(taught());
    const json = JSON.stringify(skill);
    for (const secret of SECRETS) {
      assert.ok(!json.toLowerCase().includes(secret.toLowerCase()), `skill leaks "${secret}"`);
    }
  });

  it("maps fields, asks for unmapped ones, and keeps 'always choose' as a rule", () => {
    const { skill } = buildSkillFromTeach(taught());
    const datos = skill.steps.find((s) => s.label.es === "Datos del negocio")!;
    const byLabel = Object.fromEntries(datos.fields.map((f) => [f.portal_field.label, f]));
    assert.equal(byLabel["Nombre legal"].passport_path, "business.legalName");
    assert.equal(byLabel["Teléfono"].transform, "strip_formatting");
    assert.equal(byLabel["Municipio"].portal_field.role, "combobox");
    assert.equal(byLabel["Nombre del proyecto"].passport_path, null);
    assert.equal(byLabel["Nombre del proyecto"].fallback, "pause_and_ask");
    const owner = skill.steps.find((s) => s.label.es.startsWith("¿A nombre"))!;
    const usted = owner.actions.find((a) => a.target.label_contains === "Usted")!;
    assert.match(usted.rule ?? "", /Always choose 'Usted'/);
    assert.ok(!owner.actions.some((a) => a.target.label_contains === "De una compañía"));
  });

  it("turns 'only sometimes' into a branch from the previous screen", () => {
    const { skill } = buildSkillFromTeach(taught());
    const owner = skill.steps.find((s) => s.label.es.startsWith("¿A nombre"))!;
    const empleados = skill.steps.find((s) => s.label.es === "Empleados")!;
    assert.deepEqual(owner.branches, [
      { when: { passport_has: "operations.employeeCount" }, goto_step: empleados.id, note: "This screen only shows up for some businesses." },
    ]);
  });

  it("ends in a human submit and never automates it", () => {
    const { skill } = buildSkillFromTeach(taught());
    const last = skill.steps[skill.steps.length - 1];
    assert.equal(last.gate, "submit");
    assert.ok(!JSON.stringify(skill.steps.flatMap((s) => s.actions)).includes("Radicar"));
  });

  it("adds a human submit step when the teacher never reached it", () => {
    let s = start();
    for (const e of demo().slice(0, 11)) s = applyTeachEvent(s, e);
    s = answerAll(s);
    const { skill, errors } = buildSkillFromTeach(s);
    assert.deepEqual(errors, []);
    const last = skill.steps[skill.steps.length - 1];
    assert.equal(last.gate, "submit");
    assert.equal(last.observed, false);
  });

  it("marks screens the teacher added without walking them as not observed", () => {
    let s = taught();
    s = addSkippedStep(s, { title: "Pago", gate: "payment" });
    const { skill, errors } = buildSkillFromTeach(s);
    assert.deepEqual(errors, []);
    assert.equal(skill.steps.find((x) => x.gate === "payment")?.observed, false);
  });

  it("can't be saved with open questions", () => {
    let s = start();
    for (const e of demo()) s = applyTeachEvent(s, e);
    assert.match(buildSkillFromTeach(s).blockers.join(" "), /question/);
  });

  it("applies tier scope: admin → shared, user → private, both draft", () => {
    assert.equal(buildSkillFromTeach(taught("admin")).skill.scope, "shared");
    assert.equal(buildSkillFromTeach(taught("user")).skill.scope, "private");
    assert.equal(buildSkillFromTeach(taught("user")).skill.status, "draft");
  });

  it("renders a human-readable card", () => {
    const card = skillCard(buildSkillFromTeach(taught()).skill);
    assert.equal(card.counts.fromPassport, 4);
    assert.equal(card.counts.askEachTime, 1);
    const datos = card.steps.find((s) => s.title === "Datos del negocio")!;
    assert.deepEqual(datos.fromPassport.find((f) => f.field === "Nombre legal")?.source, { en: "Business legal name", es: "Nombre legal del negocio" });
    assert.ok(card.steps.find((s) => s.title === "Empleados")!.onlyWhen.length === 1);
    assert.ok(card.humanGates.some((g) => g.id === "submit"));
  });

  it("derives skill ids from site + form", () => {
    assert.equal(taughtSkillId("https://www.sbp.pr.gov/x", "Permiso Único"), "sbp_pr_gov.permiso_unico");
  });
});
