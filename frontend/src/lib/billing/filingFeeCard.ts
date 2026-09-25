/**
 * Filing-fee card reminder — the Business Passport's payment settings.
 *
 * When the owner opts in at SmartPR checkout, the card they paid with is
 * remembered as a REFERENCE: the Stripe payment-method id plus display-only
 * details (brand, last 4, expiry). At an agency's payment step Mita shows it
 * ("Use your Visa •••• 4242") so the owner knows which card to enter.
 *
 * What this is not:
 * - Not a way to pay the agency. Stripe never returns a raw card number and
 *   agency portals only accept card entry in their own checkout, so the owner
 *   still types the card there. SmartPR never charges this card for
 *   government fees and Mita never enters it.
 * - Not storage for card numbers, CVV, or portal credentials. The record is
 *   built from a whitelist; anything else Stripe returns is dropped.
 */

/** Bump when the consent wording shown at checkout changes. */
export const FILING_FEE_CARD_CONSENT_VERSION = "2026-09-reminder-only-v1";

export const FILING_FEE_CARD_CONSENT_EN =
  "Also show this card as a reminder when Mita reaches a government filing fee. You still enter the card in the agency's portal — SmartPR never charges it for government fees and keeps only the card brand and last 4 digits.";
export const FILING_FEE_CARD_CONSENT_ES =
  "Mostrar también esta tarjeta como recordatorio cuando Mita llegue a un cargo de radicación del gobierno. Tú sigues escribiendo la tarjeta en el portal de la agencia — SmartPR nunca la cobra por cargos del gobierno y solo guarda la marca y los últimos 4 dígitos.";

export interface FilingFeeCard {
  /** Stripe PaymentMethod id (pm_…) — a reference, not a card number. */
  stripePaymentMethodId: string;
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  /** How SmartPR may use it: display only, never charged for agency fees. */
  use: "reminder_only";
  consent: {
    version: string;
    consentedAt: string;
    consentedByUserId: string;
    source: "stripe_checkout";
    checkoutSessionId: string | null;
  };
  savedAt: string;
}

/** What the browser gets: no Stripe ids, no user ids. */
export interface FilingFeeCardPublic {
  brand: string;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  consentedAt: string;
  expired: boolean;
}

/** Minimal shape of a Stripe PaymentMethod we read (keeps this module Stripe-free). */
export interface StripeCardPaymentMethodLike {
  id: string;
  type: string;
  card?: {
    brand?: string | null;
    last4?: string | null;
    exp_month?: number | null;
    exp_year?: number | null;
    display_brand?: string | null;
  } | null;
}

const PM_ID_RE = /^pm_[A-Za-z0-9]{6,}$/;
const LAST4_RE = /^\d{4}$/;
const BRAND_RE = /^[a-z_]{2,24}$/;

function cleanBrand(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const b = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return BRAND_RE.test(b) ? b : null;
}

function cleanMonth(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 12 ? raw : null;
}

function cleanYear(raw: unknown): number | null {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 2000 && raw <= 2100 ? raw : null;
}

/**
 * Build the stored record from a Stripe PaymentMethod. Returns null unless it
 * is a card with a well-formed id and last 4 — never copies other fields.
 */
export function filingFeeCardFromPaymentMethod(
  pm: StripeCardPaymentMethodLike | null | undefined,
  consent: { userId: string; consentedAt: string; version: string; checkoutSessionId?: string | null },
  now: Date = new Date()
): FilingFeeCard | null {
  if (!pm || pm.type !== "card" || !pm.card) return null;
  if (!PM_ID_RE.test(pm.id)) return null;
  const last4 = typeof pm.card.last4 === "string" && LAST4_RE.test(pm.card.last4) ? pm.card.last4 : null;
  const brand = cleanBrand(pm.card.display_brand) ?? cleanBrand(pm.card.brand) ?? "card";
  if (!last4 || !consent.userId || consent.version !== FILING_FEE_CARD_CONSENT_VERSION) return null;
  return {
    stripePaymentMethodId: pm.id,
    brand,
    last4,
    expMonth: cleanMonth(pm.card.exp_month),
    expYear: cleanYear(pm.card.exp_year),
    use: "reminder_only",
    consent: {
      version: consent.version,
      consentedAt: consent.consentedAt,
      consentedByUserId: consent.userId,
      source: "stripe_checkout",
      checkoutSessionId: consent.checkoutSessionId ?? null,
    },
    savedAt: now.toISOString(),
  };
}

/** Read the record back from `payment_settings`, rejecting anything malformed. */
export function readFilingFeeCard(settings: unknown): FilingFeeCard | null {
  if (!settings || typeof settings !== "object") return null;
  const raw = (settings as Record<string, unknown>).filingFeeCard;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const consent = r.consent as Record<string, unknown> | undefined;
  if (typeof r.stripePaymentMethodId !== "string" || !PM_ID_RE.test(r.stripePaymentMethodId)) return null;
  if (typeof r.last4 !== "string" || !LAST4_RE.test(r.last4)) return null;
  if (r.use !== "reminder_only" || !consent || typeof consent.consentedAt !== "string") return null;
  if (typeof consent.consentedByUserId !== "string" || !consent.consentedByUserId) return null;
  return {
    stripePaymentMethodId: r.stripePaymentMethodId,
    brand: cleanBrand(r.brand) ?? "card",
    last4: r.last4,
    expMonth: cleanMonth(r.expMonth),
    expYear: cleanYear(r.expYear),
    use: "reminder_only",
    consent: {
      version: typeof consent.version === "string" ? consent.version : "",
      consentedAt: consent.consentedAt,
      consentedByUserId: consent.consentedByUserId,
      source: "stripe_checkout",
      checkoutSessionId: typeof consent.checkoutSessionId === "string" ? consent.checkoutSessionId : null,
    },
    savedAt: typeof r.savedAt === "string" ? r.savedAt : consent.consentedAt,
  };
}

export function isCardExpired(card: Pick<FilingFeeCard, "expMonth" | "expYear">, now: Date = new Date()): boolean {
  if (!card.expMonth || !card.expYear) return false;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return card.expYear < y || (card.expYear === y && card.expMonth < m);
}

export function toPublicFilingFeeCard(card: FilingFeeCard | null, now: Date = new Date()): FilingFeeCardPublic | null {
  if (!card) return null;
  return {
    brand: card.brand,
    last4: card.last4,
    expMonth: card.expMonth,
    expYear: card.expYear,
    consentedAt: card.consent.consentedAt,
    expired: isCardExpired(card, now),
  };
}

const BRAND_LABELS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  american_express: "American Express",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
  cartes_bancaires: "Cartes Bancaires",
};

export function cardBrandLabel(brand: string): string {
  return BRAND_LABELS[brand] ?? (brand === "card" ? "Card" : brand.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
}

/** "Visa •••• 4242" */
export function cardDisplayName(card: Pick<FilingFeeCardPublic, "brand" | "last4">): string {
  return `${cardBrandLabel(card.brand)} •••• ${card.last4}`;
}

export function cardExpiryLabel(card: Pick<FilingFeeCardPublic, "expMonth" | "expYear">): string | null {
  if (!card.expMonth || !card.expYear) return null;
  return `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`;
}
