import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PLANS,
  allPriceIdToPlan,
  defaultPriceId,
  expectedAmountCents,
  resolvePriceId,
  stripeMode,
  type BillingPeriod,
} from "./catalog";
import { filingFeeCheckoutParts, filingFeeChoiceFromSession, priceMismatch } from "./checkoutOptions";

describe("plan → Stripe price", () => {
  it("picks live prices for a live key and test prices otherwise", () => {
    assert.equal(stripeMode("sk_live_abc"), "live");
    assert.equal(stripeMode("rk_live_abc"), "live");
    assert.equal(stripeMode("sk_test_abc"), "test");
    assert.equal(stripeMode(undefined), "test");
    const live = resolvePriceId("core", "monthly", { env: { STRIPE_SECRET_KEY: "sk_live_x" } });
    const test = resolvePriceId("core", "monthly", { env: { STRIPE_SECRET_KEY: "sk_test_x" } });
    assert.equal(live, "price_1UD5BWHS9D3i7NQZ1onBY2cM");
    assert.equal(test, "price_1UD5AlHS9D3i7NQZWOYhVoY2");
  });

  it("an explicit STRIPE_PRICE_* override wins", () => {
    assert.equal(
      resolvePriceId("operator", "yearly", { env: { STRIPE_SECRET_KEY: "sk_live_x", STRIPE_PRICE_OPERATOR_YEARLY: "price_override" } }),
      "price_override"
    );
  });

  it("every self-serve paid card has a live and a test price for each period it shows", () => {
    for (const plan of PLANS) {
      if (plan.contactOnly || plan.id === "free") continue;
      for (const period of ["monthly", "yearly"] as BillingPeriod[]) {
        assert.ok(expectedAmountCents(plan.id, period), `${plan.id} ${period} amount`);
        for (const mode of ["live", "test"] as const) {
          assert.match(defaultPriceId(plan.id, period, mode) ?? "", /^price_/, `${plan.id} ${period} ${mode}`);
        }
      }
    }
    assert.equal(resolvePriceId("enterprise", "monthly", { env: {} }), null);
  });

  it("webhooks map live and test prices back to their plan", () => {
    const map = allPriceIdToPlan();
    assert.equal(map["price_1UD5BWHS9D3i7NQZ1onBY2cM"], "core");
    assert.equal(map["price_1UD5BiHS9D3i7NQZ3szQR9j5"], "partner");
    assert.equal(map["price_1UD5AlHS9D3i7NQZWOYhVoY2"], "core");
  });
});

describe("price validation before Checkout", () => {
  const good = { id: "price_x", active: true, currency: "usd", unit_amount: 9900, type: "recurring", recurring: { interval: "month", interval_count: 1 }, product: { id: "prod_x", active: true } };
  it("accepts the plan card's price", () => {
    assert.equal(priceMismatch(good, "core", "monthly"), null);
    assert.equal(priceMismatch({ ...good, unit_amount: 99000, recurring: { interval: "year" } }, "core", "yearly"), null);
  });
  it("rejects wrong amount, interval, currency, archived price or product", () => {
    assert.match(priceMismatch({ ...good, unit_amount: 24900 }, "core", "monthly")!, /amount/);
    assert.match(priceMismatch({ ...good, recurring: { interval: "year" } }, "core", "monthly")!, /monthly/);
    assert.match(priceMismatch({ ...good, currency: "eur" }, "core", "monthly")!, /currency/);
    assert.match(priceMismatch({ ...good, active: false }, "core", "monthly")!, /archived/);
    assert.match(priceMismatch({ ...good, product: { id: "p", active: false } }, "core", "monthly")!, /product/);
    assert.match(priceMismatch({ ...good, type: "one_time", recurring: null }, "core", "monthly")!, /recurring/);
  });
});

describe("filing-fee choice on the Stripe checkout page", () => {
  const biz = [
    { id: "11111111-aaaa", name: "Brisa Tropical Corp." },
    { id: "22222222-bbbb", name: "Café Plaza LLC" },
  ];
  it("offers Yes per business plus No, with no default and opaque values", () => {
    const parts = filingFeeCheckoutParts(biz, "22222222-bbbb")!;
    const field = parts.custom_fields[0];
    assert.equal(field.label.custom, "Use this card for filing fees");
    assert.ok(field.label.custom.length <= 50);
    assert.equal(field.optional, true);
    assert.ok(!("default_value" in field.dropdown));
    assert.deepEqual(field.dropdown.options.map((o) => o.value), ["b0", "b1", "no"]);
    assert.equal(field.dropdown.options[0].label, "Yes, for Café Plaza LLC", "linked business listed first");
    for (const o of field.dropdown.options) {
      assert.match(o.value, /^[a-z0-9]+$/);
      assert.ok(o.label.length <= 100);
    }
    assert.equal(parts.metadata.filing_fee_card_b0, "22222222-bbbb");
    assert.ok(!JSON.stringify(field).includes("22222222"), "UUIDs stay in metadata, not on the page");
    assert.match(parts.custom_text.submit.message, /never charges it for government fees/);
  });
  it("is not offered without a business", () => {
    assert.equal(filingFeeCheckoutParts([]), null);
  });
  it("reads the payer's pick back", () => {
    const { metadata } = filingFeeCheckoutParts(biz)!;
    assert.equal(filingFeeChoiceFromSession({ metadata, custom_fields: [{ key: "filingfeecard", dropdown: { value: "b1" } }] }), "22222222-bbbb");
    assert.equal(filingFeeChoiceFromSession({ metadata, custom_fields: [{ key: "filingfeecard", dropdown: { value: "no" } }] }), null);
    assert.equal(filingFeeChoiceFromSession({ metadata, custom_fields: [] }), null);
  });
});
