// Inline row actions: the collapsed row shows the card's own primary action
// (same handler), the rest in an overflow, a check + "View" once done, and
// "Answer" for answer-only rows. Run: npx tsx --test src/app/components/checklist/rowActionModel.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { energyRowActions, mergeRowActions, requirementRowActions, shortCtaLabel, EMPTY_ROW_ACTIONS } from "./rowActionModel.ts";
import { developerGroup, isEnergyDeveloperCompany, openStepCount } from "../filing/requirementGroups.ts";
import { RequirementCard } from "../filing/RequirementCard.tsx";

const noop = () => {};

test("primary = the card's form action (same handler); filing, site and upload go to the overflow", () => {
  const onForm = () => "form";
  const onUpload = () => "upload";
  const m = requirementRowActions({
    action: { kind: "form", label: "Complete registration form", onClick: onForm },
    filing: { kind: "prepare", label: "Prepare with Clara", href: "/auth/login?next=%2F", agencySite: { label: "Open agency site", url: "https://suri.hacienda.pr.gov" } },
    secondary: { prompt: "Already have it?", label: "Upload certificate", onClick: onUpload },
  }, "en");
  assert.equal(m.primary?.label, "Complete form");
  assert.equal(m.primary?.title, "Complete registration form");
  assert.equal(m.primary?.onClick, onForm, "exact same handler");
  assert.deepEqual(m.more.map((c) => c.kind), ["assist", "upload", "site"]);
  assert.equal(m.more.find((c) => c.kind === "upload")?.onClick, onUpload);
  assert.equal(m.more.find((c) => c.kind === "assist")?.href, "/auth/login?next=%2F");
});

test("short labels: kept when short, per-kind default otherwise (EN/ES)", () => {
  assert.equal(shortCtaLabel("Complete LUMA form", "form", "en"), "Complete form");
  assert.equal(shortCtaLabel("Continue application", "form", "en"), "Continue");
  assert.equal(shortCtaLabel("Completar formulario de registro de comerciante", "form", "es"), "Completar");
  assert.equal(shortCtaLabel("Upload the issued Patente Municipal", "upload", "es"), "Subir");
});

test("done: a check and View (reopens the prepared form); no handler → Done", () => {
  const view = () => {};
  const m = requirementRowActions({ action: { kind: "completed", label: "Completed", onClick: view } }, "en");
  assert.deepEqual(m.done, { label: "View", onClick: view });
  assert.equal(m.primary, null);
  assert.equal(requirementRowActions({ action: { kind: "completed", label: "Completado" } }, "es").done?.label, "Listo");
});

test("answer-only rows get Answer; rows without any action get nothing", () => {
  const ask = { prompt: "Do you lease your commercial space?", yesLabel: "Yes", noLabel: "No", onYes: noop, onNo: noop };
  assert.deepEqual(requirementRowActions({ action: { kind: "none", label: "" }, answerPrompt: ask }, "en").answer, ask);
  const none = requirementRowActions({ action: { kind: "none", label: "" } }, "en");
  assert.deepEqual(none, EMPTY_ROW_ACTIONS);
  // Instructions without a link only open the card: not a row action.
  const instr = requirementRowActions({ action: { kind: "none", label: "" }, filing: { kind: "instructions", label: "View filing instructions" } }, "en");
  assert.equal(instr.primary, null);
});

test("verify existing: Confirm (the held-document upload) leads; a started application leads instead", () => {
  const onUpload = () => {};
  const onForm = () => {};
  const a = requirementRowActions({ verifyExisting: true, action: { kind: "form", label: "Complete registration form", onClick: onForm }, secondary: { prompt: "", label: "Upload certificate", onClick: onUpload } }, "en");
  assert.equal(a.primary?.label, "Confirm");
  assert.equal(a.primary?.onClick, onUpload);
  assert.equal(a.more[0].onClick, onForm);
  const b = requirementRowActions({ verifyExisting: true, action: { kind: "form", label: "Continue application", onClick: onForm }, secondary: { prompt: "", label: "Upload certificate", onClick: onUpload } }, "es");
  assert.equal(b.primary?.label, "Continuar");
  assert.equal(b.more[0].label, "Confirmar");
});

test("energy rows merge their cards' actions; all done → View", () => {
  const f = () => {};
  const m = mergeRowActions([
    requirementRowActions({ action: { kind: "form", label: "Complete LUMA form", onClick: f } }, "en"),
    requirementRowActions({ action: { kind: "upload", label: "Upload", onClick: noop } }, "en"),
  ]);
  assert.equal(m.primary?.onClick, f);
  assert.equal(m.more.length, 1);
  const done = mergeRowActions([requirementRowActions({ action: { kind: "completed", label: "Completed", onClick: f } }, "en")]);
  assert.equal(done.done?.label, "View");
});

test("collapsed RequirementCard renders the CTA on its line (outside the toggle), details stay closed", () => {
  const html = renderToStaticMarkup(createElement(RequirementCard, {
    index: 1, icon: null, iconTone: "gray", name: "Merchant Registration Certificate", agency: "Hacienda", description: "d",
    badge: { label: "Required", tone: "amber" }, whyLabel: "Why", why: null,
    action: { kind: "form", label: "Complete registration form", onClick: noop },
    secondary: { prompt: "", label: "Upload certificate", onClick: noop },
    language: "en",
  }));
  const line = html.slice(html.indexOf("ck-card-line"), html.indexOf("ck-card-line") + html.slice(html.indexOf("ck-card-line")).indexOf("</div></div>"));
  assert.match(line, /data-testid="row-cta"[^>]*data-cta="form"/);
  assert.match(line, />Complete form</);
  assert.match(line, /data-testid="row-more"/);
  assert.ok(!/ck-row-body/.test(html), "details not rendered while collapsed");
  // The CTA is not inside the toggle button.
  const toggle = html.slice(html.indexOf('class="ck-row-head"'), html.indexOf("</button>", html.indexOf('class="ck-row-head"')));
  assert.ok(!/row-cta/.test(toggle));
  const done = renderToStaticMarkup(createElement(RequirementCard, {
    index: 2, icon: null, iconTone: "gray", name: "EIN", description: "d", whyLabel: "Why", why: null,
    action: { kind: "completed", label: "Completed", onClick: noop }, language: "es",
  }));
  assert.match(done, /data-cta="view"[^>]*>.*Ver</);
});

const PORTAL = { url: "https://www.sbp.pr.gov/", label: "OGPe Single Business Portal (SBP)", label_es: "Single Business Portal de OGPe (SBP)" };

test("energy row: card actions lead, the official portal ranks above 'agency site', Start only as the fallback", () => {
  const onForm = () => "form";
  const cards = requirementRowActions({
    action: { kind: "form", label: "Complete LUMA form", onClick: onForm },
    filing: { kind: "instructions", label: "View filing instructions", agencySite: { label: "Open agency site", url: "https://lumapr.com/miluma/" } },
  }, "en");
  const m = energyRowActions({ status: "required", cards, portal: PORTAL, onStart: noop }, "en");
  assert.equal(m.primary?.onClick, onForm, "same handler as the card");
  assert.deepEqual(m.more.map((c) => c.kind), ["portal", "site"], "no Start when there is a real action");
  const only = energyRowActions({ status: "required", cards: EMPTY_ROW_ACTIONS, portal: PORTAL, onStart: noop }, "es");
  assert.equal(only.primary?.kind, "portal");
  assert.equal(only.primary?.label, "Abrir portal");
  assert.equal(only.primary?.title, "Single Business Portal de OGPe (SBP)");
  assert.equal(only.primary?.href, PORTAL.url);
  const onStart = () => "start";
  const start = energyRowActions({ status: "required", cards: EMPTY_ROW_ACTIONS, onStart }, "en");
  assert.equal(start.primary?.kind, "start");
  assert.equal(start.primary?.label, "Start");
  assert.equal(start.primary?.onClick, onStart);
});

test("energy row: Answer leads a question row; expert and bare may-apply rows get nothing invented", () => {
  const q = energyRowActions({ status: "question", cards: EMPTY_ROW_ACTIONS, portal: PORTAL, onStart: noop, question: { prompt: "Is it a microgrid?" } }, "en");
  assert.equal(q.answer?.prompt, "Is it a microgrid?");
  assert.equal(q.primary, null);
  assert.deepEqual(q.more.map((c) => c.kind), ["portal"]);
  assert.deepEqual(energyRowActions({ status: "expert", cards: EMPTY_ROW_ACTIONS, portal: PORTAL, onStart: noop }, "en"), EMPTY_ROW_ACTIONS);
  assert.equal(energyRowActions({ status: "may_apply", cards: EMPTY_ROW_ACTIONS, onStart: noop }, "en").primary, null);
  assert.equal(energyRowActions({ status: "may_apply", cards: EMPTY_ROW_ACTIONS, portal: PORTAL }, "en").primary?.kind, "portal");
  const onForm = () => "form";
  const expertWithForm = energyRowActions({ status: "expert", cards: requirementRowActions({ action: { kind: "form", label: "Complete application", onClick: onForm } }, "en"), portal: PORTAL }, "en");
  assert.equal(expertWithForm.primary?.onClick, onForm, "an expert row keeps its card's own form");
  assert.equal(expertWithForm.more.length, 0, "no portal added to an expert row");
});

test("energy developer: an existing company — business formation items are secondary, steps count only required items shown open", () => {
  assert.equal(isEnergyDeveloperCompany({ projectIntent: null, energyProposed: true, applicantRole: "developer" }), true, "unset intent: still a company");
  assert.equal(isEnergyDeveloperCompany({ projectIntent: "existing_business", energyProposed: true, applicantRole: "developer" }), true);
  assert.equal(isEnergyDeveloperCompany({ projectIntent: "new_business", energyProposed: true, applicantRole: "developer" }), false, "an explicit new business stays one");
  assert.equal(isEnergyDeveloperCompany({ projectIntent: null, energyProposed: true, applicantRole: "end_use_customer" }), false);
  assert.equal(isEnergyDeveloperCompany({ projectIntent: null, energyProposed: false, applicantRole: "developer" }), false);
  for (const stage of ["tax_registration", "municipal", "entity_formation", "employment"]) {
    assert.equal(developerGroup("required_now", stage, true), "registrations", stage);
    assert.equal(developerGroup("conditional", stage, true), "registrations", stage);
  }
  assert.equal(developerGroup("conditional", "operating_permits", true), "conditional", "a lease question is not business formation");
  assert.equal(developerGroup("required_now", "tax_registration", false), "required_now");
  assert.equal(developerGroup("completed", "tax_registration", true), "completed");
  assert.equal(openStepCount([{ id: "required_now", cards: [1, 2] }, { id: "conditional", cards: [1, 2, 3] }, { id: "prerequisites", cards: [1] }, { id: "supporting", cards: [1] }]), 3);
});
