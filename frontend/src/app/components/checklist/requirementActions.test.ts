// Standard requirement actions: fixed controls; the row's capabilities only
// decide what each one does. Run: npx tsx --test src/app/components/checklist/requirementActions.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { standardRequirementActions } from "./requirementActions.ts";
import type { RowActionsModel, RowCta } from "./rowActionModel.ts";

const noop = () => {};
const cta = (id: string, kind: RowCta["kind"], extra: Partial<RowCta> = {}): RowCta => ({ id, kind, label: kind, title: `${kind} title`, ...extra });
const model = (primary: RowCta | null, more: RowCta[] = [], extra: Partial<RowActionsModel> = {}): RowActionsModel => ({ primary, more, done: null, answer: null, ...extra });
const ctx = { onViewDetails: () => "details", onExplainClara: () => "explain" };

test("SmartPR form leads Complete; Clara filing drives Fill with Clara; rest in ⋯", () => {
  const form = cta("action", "form", { onClick: noop });
  const clara = cta("filing", "assist", { onClick: noop });
  const site = cta("site", "site", { href: "https://x.pr.gov", external: true });
  const teach = cta("teach", "teach", { onClick: noop });
  const a = standardRequirementActions(model(form, [clara, site, teach]), ctx, "en");
  assert.equal(a.complete.route, "smartpr_form");
  assert.equal(a.complete.onClick, form.onClick);
  assert.equal(a.clara.route, "file");
  assert.equal(a.clara.onClick, clara.onClick);
  assert.deepEqual(a.overflow.map((c) => c.kind), ["site", "teach"]);
});

test("no Clara filing: Fill with Clara still shows and explains", () => {
  const a = standardRequirementActions(model(cta("guided", "guided", { onClick: noop })), ctx, "en");
  assert.equal(a.clara.route, "explain");
  assert.equal(a.clara.onClick, ctx.onExplainClara);
});

test("a taught routine wins Fill with Clara", () => {
  const a = standardRequirementActions(model(cta("learned", "assist", { onClick: noop }), [cta("filing", "assist")]), ctx, "en");
  assert.equal(a.clara.route, "learned");
});

test("Complete routes: upload, government, Clara-only, blocked, instructions", () => {
  assert.equal(standardRequirementActions(model(cta("secondary", "confirm")), ctx, "en").complete.route, "upload");
  const gov = standardRequirementActions(model(cta("portal", "portal", { href: "https://p.pr.gov", external: true })), ctx, "en").complete;
  assert.equal(gov.route, "government");
  assert.equal(gov.external, true);
  const only = cta("filing", "assist", { onClick: noop });
  const c = standardRequirementActions(model(only), ctx, "en");
  assert.equal(c.complete.route, "clara");
  assert.equal(c.complete.onClick, only.onClick);
  const onAnswer = () => {};
  const q = standardRequirementActions(model(null, [], { answer: { prompt: "Do you lease?" } }), { ...ctx, onAnswer }, "en").complete;
  assert.equal(q.route, "blocked");
  assert.equal(q.onClick, onAnswer);
  assert.match(q.title, /Do you lease\?/);
  const w = standardRequirementActions(model(null), { ...ctx, blockedReason: "Waiting on the Permiso Único" }, "en").complete;
  assert.equal(w.route, "blocked");
  assert.equal(w.onClick, ctx.onViewDetails);
  const none = standardRequirementActions(model(null), ctx, "en").complete;
  assert.equal(none.route, "instructions");
  assert.equal(none.onClick, ctx.onViewDetails);
});

test("completed rows keep their done state", () => {
  const a = standardRequirementActions(model(null, [], { done: { label: "View" } }), ctx, "en");
  assert.deepEqual(a.done, { label: "View" });
});

test("off-site links never beat SmartPR, Clara or a blocker; instructions open the details panel", () => {
  const pdf = cta("filing", "instructions", { href: "https://agency.pr.gov/guia.pdf", external: true });
  const i = standardRequirementActions(model(pdf), ctx, "en");
  assert.equal(i.complete.route, "instructions");
  assert.equal(i.complete.onClick, ctx.onViewDetails);
  assert.equal(i.complete.href, undefined);
  assert.ok(i.overflow.includes(pdf), "the PDF stays reachable in ⋯");
  const portal = cta("portal", "portal", { href: "https://p.pr.gov", external: true });
  const b = standardRequirementActions(model(portal), { ...ctx, blockedReason: "Needs an expert check" }, "en");
  assert.equal(b.complete.route, "blocked");
  const guided = cta("guided", "guided", { onClick: noop });
  assert.equal(standardRequirementActions(model(portal, [guided]), ctx, "en").complete.route, "smartpr_form");
});
