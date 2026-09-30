// Inline row actions: the collapsed row shows the card's own primary action
// (same handler), the rest in an overflow, a check + "View" once done, and
// "Answer" for answer-only rows. Run: npx tsx --test src/app/components/checklist/rowActions.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { mergeRowActions, requirementRowActions, shortCtaLabel, EMPTY_ROW_ACTIONS } from "./rowActions.ts";
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
  assert.equal(shortCtaLabel("Complete LUMA form", "form", "en"), "Complete LUMA form");
  assert.equal(shortCtaLabel("Continue application", "form", "en"), "Continue application");
  assert.equal(shortCtaLabel("Completar formulario de registro de comerciante", "form", "es"), "Completar formulario");
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
  assert.equal(b.primary?.label, "Continue application");
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
