/**
 * Server-only Stripe client. Do not import from Client Components.
 */

import Stripe from "stripe";

let stripeSingleton: Stripe | null = null;

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "STRIPE_SECRET_KEY is not set. Add it to your environment (see ENV.stripe.md)."
    );
  }
  if (!stripeSingleton) {
    // apiVersion omitted so the installed `stripe` package default applies.
    stripeSingleton = new Stripe(key, {
      typescript: true,
    });
  }
  return stripeSingleton;
}

export function appUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "https://www.getsmartpr.com";
  return raw;
}
