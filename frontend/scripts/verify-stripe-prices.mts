/**
 * Checks that every pricing-page plan resolves to a real, matching Stripe
 * price for the configured key. Read-only: it retrieves prices, creates nothing.
 *
 *   STRIPE_SECRET_KEY=sk_live_… npm run billing:verify
 */
import Stripe from "stripe";
import { PLANS, resolvePriceId, stripeMode, type BillingPeriod } from "../src/lib/billing/catalog";
import { priceMismatch } from "../src/lib/billing/checkoutOptions";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set.");
  process.exit(2);
}
const stripe = new Stripe(key);
console.log(`Stripe mode: ${stripeMode(key)}`);
let failures = 0;
for (const plan of PLANS) {
  if (plan.contactOnly || plan.id === "free") continue;
  for (const period of ["monthly", "yearly"] as BillingPeriod[]) {
    const priceId = resolvePriceId(plan.id, period);
    if (!priceId) continue;
    try {
      const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
      const product = price.product as Stripe.Product;
      const problem = priceMismatch(
        { ...price, product: { id: product.id, active: product.active } },
        plan.id,
        period
      );
      if (problem) failures++;
      console.log(`${problem ? "FAIL" : "ok  "}  ${plan.id.padEnd(9)} ${period.padEnd(8)} ${priceId}  ${product.name}  ${problem ?? ""}`);
    } catch (err) {
      failures++;
      console.log(`FAIL  ${plan.id.padEnd(9)} ${period.padEnd(8)} ${priceId}  ${(err as Error).message}`);
    }
  }
}
process.exit(failures ? 1 : 0);
