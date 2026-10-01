// Inline row actions: the collapsed row shows the card's own primary action
// (same handler), the rest in an overflow, a check + "View" once done, and
// "Answer" for answer-only rows. Run: npx tsx --test src/app/components/checklist/rowActionModel.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { energyRowActions, isExternalCta, mergeRowActions, requirementRowActions, shortCtaLabel, EMPTY_ROW_ACTIONS } from "./rowActionModel.ts";
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

test("energy row: card actions lead; the official portal is ⋯-only; guided form when nothing is in-platform", () => {
  const onForm = () => "form";
  const onGuided = () => "guided";
  const onTeach = () => "teach";
  const cards = requirementRowActions({
    action: { kind: "form", label: "Complete LUMA form", onClick: onForm },
    filing: { kind: "instructions", label: "View filing instructions", agencySite: { label: "Open agency site", url: "https://lumapr.com/miluma/" } },
  }, "en");
  const m = energyRowActions({ status: "required", cards, portal: PORTAL, onGuidedForm: onGuided, onTeach }, "en");
  assert.equal(m.primary?.onClick, onForm, "same handler as the card");
  assert.deepEqual(m.more.map((c) => c.kind), ["portal", "site", "teach"], "portal + site in ⋯, Teach Clara last");
  const only = energyRowActions({ status: "required", cards: EMPTY_ROW_ACTIONS, portal: PORTAL, onGuidedForm: onGuided, onTeach }, "es");
  assert.equal(only.primary?.kind, "guided", "never 'Open portal' as the primary");
  assert.equal(only.primary?.label, "Completar");
  assert.equal(only.primary?.onClick, onGuided);
  assert.equal(only.more[0].kind, "portal");
  assert.equal(only.more[0].label, "Abrir portal");
  assert.equal(only.more[0].title, "Single Business Portal de OGPe (SBP)");
  assert.equal(only.more.at(-1)?.label, "Enséñale a Clara");
  // A row with only "What you'll need" (was "Start"): the guided form.
  const needsOnly = energyRowActions({ status: "required", cards: EMPTY_ROW_ACTIONS, onGuidedForm: onGuided, onTeach }, "en");
  assert.equal(needsOnly.primary?.kind, "guided");
  assert.equal(needsOnly.primary?.label, "Complete form");
  // No guided handler (legacy caller): the portal still never leads.
  const legacyCaller = energyRowActions({ status: "required", cards: EMPTY_ROW_ACTIONS, portal: PORTAL }, "en");
  assert.equal(legacyCaller.primary, null);
  assert.equal(legacyCaller.more[0].kind, "portal");
});

test("energy row: Answer leads a question row; expert and bare may-apply rows get nothing invented", () => {
  const onGuided = () => {};
  const onTeach = () => {};
  const q = energyRowActions({ status: "question", cards: EMPTY_ROW_ACTIONS, portal: PORTAL, onGuidedForm: onGuided, onTeach, question: { prompt: "Is it a microgrid?" } }, "en");
  assert.equal(q.answer?.prompt, "Is it a microgrid?");
  assert.equal(q.primary, null);
  assert.deepEqual(q.more.map((c) => c.kind), ["portal", "teach"]);
  assert.deepEqual(energyRowActions({ status: "expert", cards: EMPTY_ROW_ACTIONS, portal: PORTAL, onGuidedForm: onGuided, onTeach }, "en"), EMPTY_ROW_ACTIONS);
  assert.equal(energyRowActions({ status: "may_apply", cards: EMPTY_ROW_ACTIONS, onGuidedForm: onGuided, onTeach }, "en").primary, null, "may-apply without a portal: no bare form");
  const mayPortal = energyRowActions({ status: "may_apply", cards: EMPTY_ROW_ACTIONS, portal: PORTAL, onGuidedForm: onGuided, onTeach }, "en");
  assert.equal(mayPortal.primary?.kind, "guided");
  assert.deepEqual(mayPortal.more.map((c) => c.kind), ["portal", "teach"]);
  const onForm = () => "form";
  const expertWithForm = energyRowActions({ status: "expert", cards: requirementRowActions({ action: { kind: "form", label: "Complete application", onClick: onForm } }, "en"), portal: PORTAL, onGuidedForm: onGuided }, "en");
  assert.equal(expertWithForm.primary?.onClick, onForm, "an expert row keeps its card's own form");
  assert.equal(expertWithForm.more.length, 0, "no portal added to an expert row");
});

test("requirement rows: an off-site action never leads — guided form instead; Clara reads 'Fill with Clara'", () => {
  const onGuided = () => "guided";
  const onTeach = () => "teach";
  const instr = requirementRowActions({ action: { kind: "none", label: "" }, filing: { kind: "instructions", label: "View filing instructions", href: "https://www.irs.gov/pub/irs-pdf/fss4.pdf", agencySite: { label: "Open agency site", url: "https://www.irs.gov" } }, onGuidedForm: onGuided, onTeach }, "en");
  assert.equal(instr.primary?.kind, "guided");
  assert.equal(instr.primary?.onClick, onGuided);
  assert.deepEqual(instr.more.map((c) => c.kind), ["instructions", "site", "teach"]);
  const dl = requirementRowActions({ action: { kind: "none", label: "" }, download: { label: "Download form", url: "https://example.pr.gov/form.pdf", downloaded: false, downloadedHint: "", onDownload: noop }, onGuidedForm: onGuided }, "es");
  assert.equal(dl.primary?.kind, "guided");
  assert.equal(dl.more[0].kind, "download");
  const clara = requirementRowActions({ action: { kind: "none", label: "" }, filing: { kind: "file", label: "File with Clara", onClick: noop }, onGuidedForm: onGuided, onTeach }, "en");
  assert.equal(clara.primary?.kind, "assist");
  assert.equal(clara.primary?.label, "Fill with Clara");
  assert.equal(requirementRowActions({ action: { kind: "none", label: "" }, filing: { kind: "prepare", label: "Preparar con Clara", onClick: noop } }, "es").primary?.label, "Llenar con Clara");
  // Sign-in for Clara stays in SmartPR (relative link).
  const signIn = requirementRowActions({ action: { kind: "none", label: "" }, filing: { kind: "prepare", label: "Prepare with Clara", href: "/auth/login?next=%2F" } }, "en");
  assert.equal(signIn.primary?.kind, "assist");
  assert.equal(isExternalCta(signIn.primary), false);
  assert.equal(isExternalCta({ id: "x", kind: "site", label: "", title: "", href: "https://suri.hacienda.pr.gov" }), true);
  assert.equal(isExternalCta({ id: "x", kind: "site", label: "", title: "", href: "//evil.example" }), true);
  // Done rows: no Teach / guided noise.
  assert.equal(requirementRowActions({ action: { kind: "completed", label: "Completed" }, onGuidedForm: onGuided, onTeach }, "en").more.length, 0);
});

test("collapsed RequirementCard: an instructions-only row shows 'Complete form' (not a link out) and Teach Clara sits in ⋯", () => {
  const html = renderToStaticMarkup(createElement(RequirementCard, {
    index: 1, icon: null, iconTone: "gray", name: "Environmental Compliance Review", agency: "DRNA", description: "d", whyLabel: "Why", why: null,
    action: { kind: "none", label: "" },
    filing: { kind: "instructions", label: "View filing instructions", href: "https://www.drna.pr.gov/guia.pdf", agencySite: { label: "Open agency site", url: "https://www.drna.pr.gov" } },
    language: "en", id: "req-row-DOC_X",
  }));
  assert.match(html, /<button[^>]*data-testid="row-cta"[^>]*data-cta="guided"/);
  assert.ok(!/<a[^>]*data-testid="row-cta"/.test(html), "the inline primary is never an <a> out of SmartPR");
  assert.match(html, /data-testid="row-more"/);
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

// ---------------------------------------------------------------- record-first Teach Clara
test("learned routine: 'Fill with Clara' (strict replay) becomes the primary on any portal; chip + Re-teach in ⋯", () => {
  const onForm = () => "form";
  const onFill = () => "fill";
  const onTeach = () => "teach";
  const m = requirementRowActions({
    action: { kind: "form", label: "Complete registration form", onClick: onForm },
    filing: { kind: "prepare", label: "Prepare with Clara", href: "/x", agencySite: { label: "Open agency site", url: "https://portal.municipio.example.com" } },
    onTeach,
    onGuidedForm: noop,
    onLearnedFill: onFill,
    learnedStatus: "learned",
  }, "en");
  assert.equal(m.primary?.label, "Fill with Clara");
  assert.equal(m.primary?.onClick, onFill);
  assert.equal(m.learned, "learned");
  assert.ok(!m.more.some((c) => c.kind === "assist"), "the built-in Clara action is replaced, not duplicated");
  assert.equal(m.more[0].onClick, onForm, "the row's own form action moves to ⋯");
  assert.equal(m.more.at(-1)?.label, "Re-teach Clara");
  assert.ok(m.more.some((c) => c.kind === "site" && c.external), "agency links stay in ⋯");

  const es = energyRowActions({ status: "required", cards: EMPTY_ROW_ACTIONS, portal: { url: "https://tramites.example.com", label: "Portal" }, onGuidedForm: noop, onTeach, onLearnedFill: onFill, learnedStatus: "learned" }, "es");
  assert.equal(es.primary?.label, "Llenar con Clara");
  assert.equal(es.primary?.onClick, onFill);
  assert.equal(es.more.at(-1)?.label, "Enseñar de nuevo");
  assert.ok(es.more.some((c) => c.kind === "portal"));
  assert.ok(es.more.some((c) => c.kind === "guided"));
});

test("learned routine that needs re-teaching: normal primary, 'Re-teach Clara' in ⋯, warning chip", () => {
  const m = requirementRowActions({ action: { kind: "form", label: "Complete form", onClick: noop }, onTeach: noop, onLearnedFill: null, learnedStatus: "needs_reteach" }, "en");
  assert.equal(m.primary?.label, "Complete form");
  assert.equal(m.learned, "needs_reteach");
  assert.equal(m.more.at(-1)?.label, "Re-teach Clara");
});

test("learned routine on an answer-only row: Answer stays first, Fill with Clara leads the ⋯", () => {
  const onFill = () => "fill";
  const m = requirementRowActions({ action: { kind: "none", label: "" }, answerPrompt: { prompt: "Do you have employees?", yesLabel: "Yes", noLabel: "No", onYes: noop, onNo: noop }, onTeach: noop, onLearnedFill: onFill, learnedStatus: "learned" }, "en");
  assert.equal(m.primary, null);
  assert.ok(m.answer);
  assert.equal(m.more[0].onClick, onFill);
});

test("learned chip renders with the row title (RowName), not in the actions column (EN/ES)", async () => {
  const { RowActions, RowName } = await import("./RowActions.tsx");
  const model = requirementRowActions({ action: { kind: "form", label: "Complete form", onClick: noop }, onTeach: noop, onLearnedFill: noop, learnedStatus: "learned" }, "en");
  const name = renderToStaticMarkup(createElement(RowName, { name: "LUMA interconnection", model, language: "en" }));
  assert.match(name, /class="ck-name-stack"/);
  assert.match(name, /data-testid="row-learned"/);
  assert.match(name, /Clara learned this/);
  const actions = renderToStaticMarkup(createElement(RowActions, { model, language: "en" }));
  assert.doesNotMatch(actions, /row-learned/, "the chip no longer widens the fixed actions column");
  const modelEs = requirementRowActions({ action: { kind: "form", label: "Completar", onClick: noop }, onTeach: noop, onLearnedFill: noop, learnedStatus: "learned" }, "es");
  assert.match(renderToStaticMarkup(createElement(RowName, { name: "Interconexión", model: modelEs, language: "es" })), /Clara lo aprendió/);
  assert.match(renderToStaticMarkup(createElement(RowActions, { model: modelEs, language: "es" })), /Llenar con Clara/);
  // No routine → plain title.
  const plain = renderToStaticMarkup(createElement(RowName, { name: "X", model: requirementRowActions({ action: { kind: "form", label: "Complete form", onClick: noop } }, "en"), language: "en" }));
  assert.equal(plain, '<span class="ck-name" title="X">X</span>');
});
