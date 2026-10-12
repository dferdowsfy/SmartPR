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

test("SmartPR form leads Complete; a Clara filing CTA never surfaces on the row (Clara rule 2026-10-12)", () => {
  const form = cta("action", "form", { onClick: noop });
  const clara = cta("filing", "assist", { onClick: noop });
  const site = cta("site", "site", { href: "https://x.pr.gov", external: true });
  const teach = cta("teach", "teach", { onClick: noop });
  const a = standardRequirementActions(model(form, [clara, site, teach]), ctx, "en");
  assert.equal(a.complete.route, "smartpr_form");
  assert.equal(a.complete.onClick, form.onClick);
  // Clara files from the filing hub: the row's Clara slot stays empty and
  // the filing CTA appears nowhere — not in the slot, not in ⋯.
  assert.equal(a.clara.route, "explain");
  assert.ok(!a.overflow.includes(clara));
  assert.deepEqual(a.overflow.map((c) => c.kind), ["site", "teach", "assist"]);
  assert.equal(a.overflow.at(-1)?.id, "ask");
});

test("no Clara filing: Complete leads to the form; Ask Clara moves to ⋯", () => {
  const a = standardRequirementActions(model(cta("guided", "guided", { onClick: noop })), ctx, "en");
  assert.equal(a.clara.route, "explain");
  assert.equal(a.complete.route, "smartpr_form");
  const ask = a.overflow.find((c) => c.id === "ask");
  assert.equal(ask?.label, "Ask Clara");
  assert.equal(ask?.onClick, ctx.onExplainClara);
});

test("a taught routine no longer puts Clara on the row — the filing hub launches the replay", () => {
  const learned = cta("learned", "assist", { onClick: noop });
  const a = standardRequirementActions(model(learned, [cta("filing", "assist")]), ctx, "en");
  assert.equal(a.clara.route, "explain");
  assert.ok(!a.overflow.includes(learned));
});

test("Complete routes: upload, government, blocked, instructions — never Clara", () => {
  assert.equal(standardRequirementActions(model(cta("secondary", "confirm")), ctx, "en").complete.route, "upload");
  const gov = standardRequirementActions(model(cta("portal", "portal", { href: "https://p.pr.gov", external: true })), ctx, "en").complete;
  assert.equal(gov.route, "government");
  assert.equal(gov.external, true);
  // A row whose only action is a Clara filing: Complete falls back to the
  // details panel — it never routes to Clara (Clara rule 2026-10-12).
  const only = cta("filing", "assist", { onClick: noop });
  const c = standardRequirementActions(model(only), ctx, "en");
  assert.equal(c.complete.route, "instructions");
  assert.equal(c.complete.onClick, ctx.onViewDetails);
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
