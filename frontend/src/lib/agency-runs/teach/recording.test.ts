import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bindRecordedActions, describeAction, normalizeRecorderItems, safeScreenshotRef } from "./recording";
import { sampleRecorderEvents, SAMPLE_PORTAL_URL } from "./sampleRecording";
import { applyTeachEvent, newTeachState, answerQuestion, openQuestions } from "./teachSession";
import { sanitizeTeachEvent } from "./events";

const items = (events: unknown[]) => events.map((event, i) => ({ seq: i + 1, event }));
const u = (p: string) => new URL(p, SAMPLE_PORTAL_URL).toString();

describe("recorder event → step normalization", () => {
  it("turns the raw stream into navigate / click / type / select / upload actions in order", () => {
    const actions = normalizeRecorderItems(items(sampleRecorderEvents()), []);
    assert.deepEqual(
      actions.map((a) => a.kind),
      ["navigate", "click", "navigate", "type", "type", "click", "navigate", "type", "type", "type", "select", "click", "navigate", "upload", "click", "navigate", "click"]
    );
    for (const a of actions) {
      assert.ok(a.label, `every action has a label (${a.kind})`);
      if (a.kind !== "navigate" && a.kind !== "wait") assert.ok(a.selector, `${a.label} keeps its selector`);
    }
  });

  it("marks sign-in, uploads and the final submit; never keeps a value", () => {
    const actions = normalizeRecorderItems(items(sampleRecorderEvents()), []);
    const password = actions.find((a) => a.label === "Contraseña")!;
    assert.equal(password.valueKind, "secret");
    assert.equal(password.pause, "login");
    assert.equal(actions.find((a) => a.kind === "upload")!.pause, "upload");
    const submit = actions.at(-1)!;
    assert.equal(submit.submitLike, true);
    assert.equal(submit.pause, "submit");
    assert.match(describeAction(submit).en, /never replayed/);
    const raw = JSON.stringify(actions);
    assert.ok(!/"value"/.test(raw));
  });

  it("scrubs passport values and drops events with values smuggled in", () => {
    const secret = "Panadería La Esquina LLC";
    const actions = normalizeRecorderItems(
      items([
        { kind: "page", url: u("/a?token=abc"), heading: `Hola ${secret}` },
        { kind: "click", url: u("/a"), role: "button", label: `Enviar a juan@example.com`, selector: "#b", value: "787-555-0142" },
        { kind: "fill", url: u("/a"), role: "textbox", label: "Nombre", selector: "[value='Panaderia']", valueKind: "text", value: secret },
      ]),
      [secret]
    );
    const raw = JSON.stringify(actions);
    assert.ok(!raw.includes(secret));
    assert.ok(!raw.includes("juan@example.com"));
    assert.ok(!raw.includes("token=abc"));
    assert.ok(!raw.includes("787-555-0142"));
    assert.equal(actions[2].selector, null, "selectors quoting a value are dropped");
  });

  it("dedupes SPA re-announcements, double clicks and re-typing the same field", () => {
    const p = { kind: "page", url: u("/f"), title: "T", heading: "Formulario" };
    const c = { kind: "click", url: u("/f"), role: "button", label: "Siguiente", selector: "#n" };
    const f = { kind: "fill", url: u("/f"), role: "textbox", label: "Nombre", selector: "#nombre", valueKind: "text" };
    const actions = normalizeRecorderItems(items([p, p, f, f, c, c]), []);
    assert.deepEqual(actions.map((a) => a.kind), ["navigate", "type", "click"]);
  });

  it("folds a custom dropdown (open + option) into one select, and logs waits", () => {
    const actions = normalizeRecorderItems(
      items([
        { kind: "page", url: u("/f"), heading: "Formulario" },
        { kind: "click", url: u("/f"), role: "combobox", label: "Tipo de entidad", selector: "#tipo" },
        { kind: "click", url: u("/f"), role: "option", label: "Corporación", selector: "#opt-corp", optionText: "Corporación" },
        { kind: "wait", url: u("/f"), ms: 4000 },
        { kind: "wait", url: u("/f"), ms: 3000 },
        { kind: "wait", url: u("/f"), ms: 200 },
      ]),
      []
    );
    assert.deepEqual(actions.map((a) => a.kind), ["navigate", "click", "select", "wait"]);
    assert.equal(actions[2].label, "Tipo de entidad");
    assert.equal(actions[3].waitMs, 7000);
  });

  it("accepts only safe screenshot references", () => {
    assert.equal(safeScreenshotRef("https://worker.example/api/v4/teach/t/shots/3?token=x"), "https://worker.example/api/v4/teach/t/shots/3?token=x");
    assert.equal(safeScreenshotRef("javascript:alert(1)"), null);
    assert.equal(safeScreenshotRef("http://evil.example/x.png"), null);
    assert.ok(safeScreenshotRef("data:image/png;base64,iVBORw0KGgo="));
    const actions = normalizeRecorderItems([{ seq: 1, event: { kind: "page", url: u("/"), heading: "Inicio" }, screenshot: "https://w.example/s/1" }], []);
    assert.equal(actions[0].screenshot, "https://w.example/s/1");
  });

  it("binds typed values to Business Passport fields (or ask each time) from the teacher's answers", () => {
    const events = sampleRecorderEvents();
    let state = newTeachState({ id: "t", ownerUserId: "u", tier: "user", portalName: "P", form: "F", startUrl: SAMPLE_PORTAL_URL });
    for (const e of events) {
      const ev = sanitizeTeachEvent(e);
      if (ev) state = applyTeachEvent(state, ev);
    }
    for (const q of openQuestions(state)) {
      if (q.kind === "mapping") state = answerQuestion(state, q.id, q.label === "Teléfono" ? { kind: "mapping", choice: "ask" } : { kind: "mapping", choice: "confirm" });
      else state = answerQuestion(state, q.id, { kind: "yes_no", value: "yes" });
    }
    const bound = bindRecordedActions(normalizeRecorderItems(items(events), []), state);
    const legal = bound.find((a) => a.label === "Nombre legal del negocio")!;
    assert.deepEqual(legal.binding && legal.binding.kind === "passport" ? legal.binding.path : null, "business.legalName");
    assert.equal(bound.find((a) => a.label === "Teléfono")!.binding?.kind, "ask");
    assert.equal(bound.find((a) => a.label === "Contraseña")!.binding?.kind, "pause");
    assert.equal(bound.find((a) => a.kind === "upload")!.binding?.kind, "pause");
  });
});
