/**
 * Pieces of the Stripe Checkout session that are pure logic:
 * - the "Use this card for filing fees" choice shown ON Stripe's checkout page
 *   (a custom-field dropdown — Checkout has no checkbox field type), and
 * - validation that a resolved price really is the plan the user picked.
 */
import {
  FILING_FEE_CARD_CONSENT_EN,
  FILING_FEE_CARD_CONSENT_VERSION,
} from "./filingFeeCard";
import { expectedAmountCents, type BillingPeriod, type PlanId } from "./catalog";

export const FILING_FEE_FIELD_KEY = "filingfeecard";
export const FILING_FEE_NO = "no";
/** Stripe caps: label 50 chars, option label 100, option value alphanumeric ≤100. */
const MAX_BUSINESSES = 10;

export interface BusinessChoice {
  id: string; // business UUID
  name: string;
}

export interface FilingFeeCheckoutParts {
  custom_fields: Array<{
    key: string;
    label: { type: "custom"; custom: string };
    type: "dropdown";
    optional: true;
    dropdown: { options: Array<{ label: string; value: string }> };
  }>;
  custom_text: { submit: { message: string } };
  metadata: Record<string, string>;
}

const optionValue = (i: number) => `b${i}`;

function clip(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/**
 * The opt-in rendered on Stripe's checkout page. No default is set, so the
 * card is only remembered when the payer actively picks a "Yes" option.
 * Option values are opaque (b0, b1…); the business UUIDs they stand for live
 * in session metadata, which only the server and Stripe can read.
 */
export function filingFeeCheckoutParts(
  businesses: BusinessChoice[],
  preferredBusinessId?: string | null
): FilingFeeCheckoutParts | null {
  if (businesses.length === 0) return null;
  // Defensive: one entry per business id even if the caller passes dup rows.
  const seenIds = new Set<string>();
  const deduped = businesses.filter((b) =>
    seenIds.has(b.id) ? false : (seenIds.add(b.id), true)
  );
  if (deduped.length === 0) return null;
  const ordered = [...deduped].sort((a, b) =>
    a.id === preferredBusinessId ? -1 : b.id === preferredBusinessId ? 1 : 0
  ).slice(0, MAX_BUSINESSES);
  const single = ordered.length === 1;
  // Stripe rejects a dropdown whose option labels are not unique. Two
  // businesses can share a display name (e.g. an accidental duplicate), so
  // disambiguate after clipping — the values stay opaque and unique.
  const usedLabels = new Set<string>(["No"]);
  const options = ordered.map((b, i) => {
    const base = clip(
      single
        ? `Yes — remind me at Mita's filing-fee step (${b.name})`
        : `Yes, for ${b.name}`,
      96
    );
    let label = base;
    let n = 1;
    while (usedLabels.has(label)) {
      n += 1;
      label = clip(`${base} (${n})`, 100);
    }
    usedLabels.add(label);
    return { label, value: optionValue(i) };
  });
  options.push({ label: "No", value: FILING_FEE_NO });
  const metadata: Record<string, string> = {
    filing_fee_card: "offered",
    filing_fee_card_consent_version: FILING_FEE_CARD_CONSENT_VERSION,
  };
  ordered.forEach((b, i) => {
    metadata[`filing_fee_card_${optionValue(i)}`] = b.id;
  });
  return {
    custom_fields: [
      {
        key: FILING_FEE_FIELD_KEY,
        label: { type: "custom", custom: "Use this card for filing fees" },
        type: "dropdown",
        optional: true,
        dropdown: { options },
      },
    ],
    custom_text: { submit: { message: FILING_FEE_CARD_CONSENT_EN } },
    metadata,
  };
}

/** Business UUID the payer opted in for, from the completed session. */
export function filingFeeChoiceFromSession(session: {
  metadata?: Record<string, string> | null;
  custom_fields?: Array<{ key: string; dropdown?: { value?: string | null } | null }> | null;
}): string | null {
  const meta = session.metadata ?? {};
  if (meta.filing_fee_card !== "offered") return null;
  const value = session.custom_fields?.find((f) => f.key === FILING_FEE_FIELD_KEY)?.dropdown?.value ?? null;
  if (!value || value === FILING_FEE_NO || !/^b\d{1,2}$/.test(value)) return null;
  return meta[`filing_fee_card_${value}`] || null;
}

/** Minimal Stripe Price shape we check. */
export interface PriceLike {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  type: string;
  recurring?: { interval: string; interval_count?: number } | null;
  product: string | { id: string; active?: boolean } | null;
}

/**
 * Refuse to open Checkout for a price that doesn't match the plan card:
 * wrong amount, interval, currency, or an archived price/product. Returns a
 * reason, or null when the price is safe to charge.
 */
export function priceMismatch(price: PriceLike, plan: PlanId, period: BillingPeriod): string | null {
  if (!price.active) return "price is archived";
  const product = price.product;
  if (product && typeof product === "object" && product.active === false) return "product is archived";
  if (price.currency !== "usd") return `currency is ${price.currency}, expected usd`;
  const expected = expectedAmountCents(plan, period);
  if (expected === null) return "plan has no price for this period";
  if (price.unit_amount !== expected) return `amount is ${price.unit_amount}, expected ${expected}`;
  if (period === "one_time") {
    if (price.type !== "one_time") return "expected a one-time price";
  } else {
    const interval = period === "monthly" ? "month" : "year";
    if (price.type !== "recurring" || price.recurring?.interval !== interval || (price.recurring.interval_count ?? 1) !== 1) {
      return `expected a recurring ${interval}ly price`;
    }
  }
  return null;
}
