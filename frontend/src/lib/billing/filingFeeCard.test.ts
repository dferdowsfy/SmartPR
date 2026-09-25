import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FILING_FEE_CARD_CONSENT_VERSION as V,
  cardDisplayName,
  cardExpiryLabel,
  filingFeeCardFromPaymentMethod,
  isCardExpired,
  readFilingFeeCard,
  toPublicFilingFeeCard,
} from "./filingFeeCard";
import { saveFilingFeeCardFromCheckout, type FilingFeeCardDeps } from "./filingFeeCardWebhook";
import { stripSensitivePassport } from "../agency-runs/goalBrief";

const NOW = new Date("2026-09-25T12:00:00Z");
const consent = { userId: "user-1", consentedAt: "2026-09-25T11:59:00Z", version: V, checkoutSessionId: "cs_test_1" };
const pmVisa = {
  id: "pm_1AbCdEfGhIjK",
  type: "card",
  card: {
    brand: "visa",
    last4: "4242",
    exp_month: 12,
    exp_year: 2031,
    // Fields Stripe returns that must never be copied.
    fingerprint: "Xt5EWLLDS7FJjR1c",
    funding: "credit",
    country: "US",
    checks: { cvc_check: "pass" },
  },
  billing_details: { name: "Ana Rivera", email: "ana@example.com", address: { line1: "123 Calle" } },
};

describe("filing-fee card — stored record", () => {
  it("keeps only the reference and display details", () => {
    const card = filingFeeCardFromPaymentMethod(pmVisa, consent, NOW)!;
    assert.deepEqual(Object.keys(card).sort(), ["brand", "consent", "expMonth", "expYear", "last4", "savedAt", "stripePaymentMethodId", "use"]);
    assert.equal(card.use, "reminder_only");
    assert.equal(card.brand, "visa");
    assert.equal(card.last4, "4242");
    const dumped = JSON.stringify(card);
    for (const leak of ["fingerprint", "Xt5EWLLDS7FJjR1c", "cvc", "Ana Rivera", "ana@example.com", "123 Calle", "funding"]) {
      assert.ok(!dumped.includes(leak), `leaked ${leak}`);
    }
  });

  it("refuses anything that is not a well-formed card or lacks current consent", () => {
    assert.equal(filingFeeCardFromPaymentMethod({ ...pmVisa, type: "us_bank_account" }, consent), null);
    assert.equal(filingFeeCardFromPaymentMethod({ ...pmVisa, id: "4242424242424242" }, consent), null, "a PAN is not a pm id");
    assert.equal(filingFeeCardFromPaymentMethod({ ...pmVisa, card: { ...pmVisa.card, last4: "4242424242424242" } }, consent), null);
    assert.equal(filingFeeCardFromPaymentMethod(pmVisa, { ...consent, version: "old" }), null);
    assert.equal(filingFeeCardFromPaymentMethod(pmVisa, { ...consent, userId: "" }), null);
    assert.equal(filingFeeCardFromPaymentMethod(null, consent), null);
  });

  it("reads back only a valid record and ignores injected fields", () => {
    const card = filingFeeCardFromPaymentMethod(pmVisa, consent, NOW)!;
    assert.deepEqual(readFilingFeeCard({ filingFeeCard: card }), card);
    const tampered = readFilingFeeCard({ filingFeeCard: { ...card, cardNumber: "4242424242424242", cvv: "123" } })!;
    assert.ok(!JSON.stringify(tampered).includes("4242424242424242"));
    assert.ok(!JSON.stringify(tampered).includes("cvv"));
    assert.equal(readFilingFeeCard({ filingFeeCard: { ...card, use: "charge" } }), null);
    assert.equal(readFilingFeeCard({}), null);
    assert.equal(readFilingFeeCard(null), null);
  });

  it("public view drops the Stripe reference and user id", () => {
    const pub = toPublicFilingFeeCard(filingFeeCardFromPaymentMethod(pmVisa, consent, NOW), NOW)!;
    assert.deepEqual(pub, { brand: "visa", last4: "4242", expMonth: 12, expYear: 2031, consentedAt: consent.consentedAt, expired: false });
    assert.ok(!JSON.stringify(pub).includes("pm_"));
    assert.ok(!JSON.stringify(pub).includes("user-1"));
  });

  it("formats the reminder", () => {
    assert.equal(cardDisplayName({ brand: "visa", last4: "4242" }), "Visa •••• 4242");
    assert.equal(cardDisplayName({ brand: "amex", last4: "0005" }), "American Express •••• 0005");
    assert.equal(cardExpiryLabel({ expMonth: 3, expYear: 2031 }), "03/31");
    assert.equal(isCardExpired({ expMonth: 8, expYear: 2026 }, NOW), true);
    assert.equal(isCardExpired({ expMonth: 9, expYear: 2026 }, NOW), false);
  });

  it("the stripper would drop a card number even if one reached the passport", () => {
    assert.deepEqual(stripSensitivePassport({ payment: { card_number: "4242424242424242", cvv: "123", brand: "visa" } }), { payment: { brand: "visa" } });
  });
});

describe("filing-fee card — webhook save", () => {
  const session = {
    id: "cs_test_1",
    mode: "subscription",
    payment_status: "paid",
    subscription: "sub_1",
    metadata: {
      user_id: "user-1",
      filing_fee_card: "reminder_only",
      filing_fee_card_business_id: "biz-uuid",
      filing_fee_card_consent_version: V,
      filing_fee_card_consented_at: "2026-09-25T11:59:00Z",
    },
  };
  function deps(over: Partial<FilingFeeCardDeps> = {}) {
    const saved: unknown[] = [];
    const d: FilingFeeCardDeps = {
      subscriptionPaymentMethod: async () => "pm_1AbCdEfGhIjK",
      paymentIntentPaymentMethod: async () => ({ id: "pm_1AbCdEfGhIjK" }),
      retrievePaymentMethod: async () => pmVisa,
      accessibleBusiness: async (b, u) => (b === "biz-uuid" && u === "user-1" ? "biz-uuid" : null),
      save: async (b, c) => void saved.push([b, c]),
      ...over,
    };
    return { d, saved };
  }

  it("saves on opt-in for a business the user can edit", async () => {
    const { d, saved } = deps();
    assert.deepEqual(await saveFilingFeeCardFromCheckout(session, d, NOW), { saved: true, businessUuid: "biz-uuid" });
    assert.equal(saved.length, 1);
  });

  it("does nothing without opt-in", async () => {
    const { d, saved } = deps();
    const r = await saveFilingFeeCardFromCheckout({ ...session, metadata: { user_id: "user-1" } }, d, NOW);
    assert.deepEqual(r, { saved: false, reason: "not_requested" });
    assert.equal(saved.length, 0);
  });

  it("re-checks access at webhook time", async () => {
    const { d, saved } = deps({ accessibleBusiness: async () => null });
    assert.deepEqual(await saveFilingFeeCardFromCheckout(session, d, NOW), { saved: false, reason: "no_access" });
    assert.equal(saved.length, 0);
  });

  it("rejects stale or missing consent", async () => {
    const { d } = deps();
    const stale = { ...session, metadata: { ...session.metadata, filing_fee_card_consent_version: "old" } };
    assert.equal((await saveFilingFeeCardFromCheckout(stale, d, NOW)).saved, false);
    const noTime = { ...session, metadata: { ...session.metadata, filing_fee_card_consented_at: "yesterday-ish" } };
    assert.equal((await saveFilingFeeCardFromCheckout(noTime, d, NOW)).saved, false);
  });

  it("skips unpaid sessions and non-card methods", async () => {
    const { d } = deps();
    assert.deepEqual(await saveFilingFeeCardFromCheckout({ ...session, payment_status: "unpaid" }, d, NOW), { saved: false, reason: "unpaid" });
    const { d: d2 } = deps({ retrievePaymentMethod: async () => ({ id: "pm_1AbCdEfGhIjK", type: "link", card: null }) });
    assert.deepEqual(await saveFilingFeeCardFromCheckout(session, d2, NOW), { saved: false, reason: "not_a_card" });
    const { d: d3 } = deps({ subscriptionPaymentMethod: async () => null });
    assert.deepEqual(await saveFilingFeeCardFromCheckout(session, d3, NOW), { saved: false, reason: "no_payment_method" });
  });

  it("one-time (pilot) checkout reads the payment intent's method", async () => {
    const { d, saved } = deps();
    const r = await saveFilingFeeCardFromCheckout({ ...session, mode: "payment", subscription: null, payment_intent: "pi_1" }, d, NOW);
    assert.equal(r.saved, true);
    assert.equal(saved.length, 1);
  });
});
