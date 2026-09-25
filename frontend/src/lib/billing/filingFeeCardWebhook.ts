/**
 * Webhook side of the filing-fee card reminder: after a signed
 * checkout.session.completed, remember the card the owner paid with — only
 * when they opted in, only for a business they can still edit, and only as a
 * reference plus brand/last 4. Dependencies are injected so the rules are
 * testable without Stripe or a database.
 */
import {
  FILING_FEE_CARD_CONSENT_VERSION,
  filingFeeCardFromPaymentMethod,
  type FilingFeeCard,
  type StripeCardPaymentMethodLike,
} from "./filingFeeCard";

export interface CheckoutSessionLike {
  id: string;
  mode: string;
  payment_status?: string | null;
  metadata?: Record<string, string> | null;
  subscription?: string | { id: string } | null;
  payment_intent?: string | { id: string } | null;
}

export interface FilingFeeCardDeps {
  /** default_payment_method of a subscription (id or expanded object). */
  subscriptionPaymentMethod(subscriptionId: string): Promise<string | { id: string } | null>;
  paymentIntentPaymentMethod(paymentIntentId: string): Promise<string | { id: string } | null>;
  retrievePaymentMethod(id: string): Promise<StripeCardPaymentMethodLike | null>;
  /** Business UUID if this user can still edit it, else null. */
  accessibleBusiness(businessId: string, userId: string): Promise<string | null>;
  save(businessUuid: string, card: FilingFeeCard): Promise<void>;
}

export type FilingFeeCardOutcome =
  | { saved: true; businessUuid: string }
  | { saved: false; reason: "not_requested" | "unpaid" | "consent_invalid" | "no_access" | "no_payment_method" | "not_a_card" };

const idOf = (ref: string | { id: string } | null | undefined): string | null =>
  !ref ? null : typeof ref === "string" ? ref : ref.id ?? null;

export async function saveFilingFeeCardFromCheckout(
  session: CheckoutSessionLike,
  deps: FilingFeeCardDeps,
  now: Date = new Date()
): Promise<FilingFeeCardOutcome> {
  const meta = session.metadata ?? {};
  if (meta.filing_fee_card !== "reminder_only") return { saved: false, reason: "not_requested" };
  if (session.payment_status && session.payment_status === "unpaid") return { saved: false, reason: "unpaid" };

  const userId = meta.user_id;
  const businessId = meta.filing_fee_card_business_id;
  const consentedAt = meta.filing_fee_card_consented_at;
  if (
    !userId ||
    !businessId ||
    !consentedAt ||
    Number.isNaN(Date.parse(consentedAt)) ||
    meta.filing_fee_card_consent_version !== FILING_FEE_CARD_CONSENT_VERSION
  ) {
    return { saved: false, reason: "consent_invalid" };
  }

  // Re-check access now: membership may have changed since checkout started.
  const businessUuid = await deps.accessibleBusiness(businessId, userId);
  if (!businessUuid) return { saved: false, reason: "no_access" };

  let pmRef: string | { id: string } | null = null;
  const subId = idOf(session.subscription);
  const piId = idOf(session.payment_intent);
  if (session.mode === "subscription" && subId) pmRef = await deps.subscriptionPaymentMethod(subId);
  else if (session.mode === "payment" && piId) pmRef = await deps.paymentIntentPaymentMethod(piId);
  const pmId = idOf(pmRef);
  if (!pmId) return { saved: false, reason: "no_payment_method" };

  const pm = await deps.retrievePaymentMethod(pmId);
  const card = filingFeeCardFromPaymentMethod(
    pm,
    { userId, consentedAt, version: meta.filing_fee_card_consent_version, checkoutSessionId: session.id },
    now
  );
  if (!card) return { saved: false, reason: "not_a_card" };
  await deps.save(businessUuid, card);
  return { saved: true, businessUuid };
}
