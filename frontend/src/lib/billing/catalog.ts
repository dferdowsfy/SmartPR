/**
 * SmartPR billing catalog — plans, entitlements, Stripe price IDs.
 * Price IDs fall back to Stripe test-mode defaults when env is unset.
 */

export type PlanId =
  | "free"
  | "core"
  | "operator"
  | "partner"
  | "pilot"
  | "enterprise";

export type BillingPeriod = "monthly" | "yearly" | "one_time";

export type WorkspaceKind = "INDIVIDUAL" | "PROFESSIONAL";

export type PlanEntitlements = {
  maxBusinesses: number | "unlimited";
  maxSeats: number | "unlimited";
  deliverables: boolean;
  radar: boolean;
  whiteLabel: boolean;
  workspaceKind: WorkspaceKind;
  /** Present on one-time SKUs such as pilot. */
  skuType?: "one_time";
};

export type PlanAmounts = {
  monthly: number | null;
  yearly: number | null;
  one_time: number | null;
};

export type PlanLookupKeys = {
  monthly?: string;
  yearly?: string;
  one_time?: string;
};

export type PlanDefinition = {
  id: PlanId;
  name: string;
  tagline: string;
  amountUsd: PlanAmounts;
  features: string[];
  entitlements: PlanEntitlements;
  lookupKeys: PlanLookupKeys;
  /** Stripe product metadata `plan` key. */
  productMetadataPlan: string;
  /** Stripe product ID (test default). */
  productId: string;
  /** Whether this plan appears as a self-serve pricing card. */
  selfServe: boolean;
  /** Highlight as popular on pricing page. */
  popular?: boolean;
  /** Contact sales instead of Checkout. */
  contactOnly?: boolean;
};

/** Test-mode Stripe defaults — overridden by STRIPE_PRICE_* env vars. */
const TEST_PRICES = {
  free: {
    monthly: "price_1UD5AgHS9D3i7NQZhu1XOOhl",
    product: "prod_VDWC8bFq8sA8Ox",
  },
  core: {
    monthly: "price_1UD5AlHS9D3i7NQZWOYhVoY2",
    yearly: "price_1UD5AlHS9D3i7NQZNzSyMOmn",
    product: "prod_VDWCVPbVA2u4FC",
  },
  operator: {
    monthly: "price_1UD5AlHS9D3i7NQZiAjF4hvs",
    yearly: "price_1UD5AlHS9D3i7NQZPp2dMG2u",
    product: "prod_VDWCDgMcvMJobv",
  },
  partner: {
    monthly: "price_1UD5AlHS9D3i7NQZwMoJMJtV",
    yearly: "price_1UD5AmHS9D3i7NQZAi0q065Y",
    product: "prod_VDWCzFKJkIpFc0",
  },
  pilot: {
    one_time: "price_1UD5AmHS9D3i7NQZhqshuOXp",
    product: "prod_VDWChPZiQSoPbq",
  },
  enterprise: {
    product: "prod_VDWCBYm1uH2voo",
  },
} as const;

function envPrice(
  key: string,
  fallback: string | undefined
): string | undefined {
  const fromEnv =
    typeof process !== "undefined" ? process.env[key] : undefined;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return fallback;
}

/** Resolved price IDs: env override ?? test default. */
export const PRICE_IDS = {
  free: {
    monthly: envPrice(
      "STRIPE_PRICE_FREE_MONTHLY",
      TEST_PRICES.free.monthly
    )!,
  },
  core: {
    monthly: envPrice(
      "STRIPE_PRICE_CORE_MONTHLY",
      TEST_PRICES.core.monthly
    )!,
    yearly: envPrice(
      "STRIPE_PRICE_CORE_YEARLY",
      TEST_PRICES.core.yearly
    )!,
  },
  operator: {
    monthly: envPrice(
      "STRIPE_PRICE_OPERATOR_MONTHLY",
      TEST_PRICES.operator.monthly
    )!,
    yearly: envPrice(
      "STRIPE_PRICE_OPERATOR_YEARLY",
      TEST_PRICES.operator.yearly
    )!,
  },
  partner: {
    monthly: envPrice(
      "STRIPE_PRICE_PARTNER_MONTHLY",
      TEST_PRICES.partner.monthly
    )!,
    yearly: envPrice(
      "STRIPE_PRICE_PARTNER_YEARLY",
      TEST_PRICES.partner.yearly
    )!,
  },
  pilot: {
    one_time: envPrice(
      "STRIPE_PRICE_PILOT_ONE_TIME",
      TEST_PRICES.pilot.one_time
    )!,
  },
} as const;

export const PRODUCT_IDS = {
  free: envPrice("STRIPE_PRODUCT_FREE", TEST_PRICES.free.product)!,
  core: envPrice("STRIPE_PRODUCT_CORE", TEST_PRICES.core.product)!,
  operator: envPrice(
    "STRIPE_PRODUCT_OPERATOR",
    TEST_PRICES.operator.product
  )!,
  partner: envPrice(
    "STRIPE_PRODUCT_PARTNER",
    TEST_PRICES.partner.product
  )!,
  pilot: envPrice("STRIPE_PRODUCT_PILOT", TEST_PRICES.pilot.product)!,
  enterprise: envPrice(
    "STRIPE_PRODUCT_ENTERPRISE",
    TEST_PRICES.enterprise.product
  )!,
} as const;

export const PLAN_CATALOG: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "See where you stand before you spend.",
    amountUsd: { monthly: 0, yearly: null, one_time: null },
    features: [
      "1 business workspace",
      "1 seat",
      "Guided readiness checklist",
      "Government stays system of record",
    ],
    entitlements: {
      maxBusinesses: 1,
      maxSeats: 1,
      deliverables: false,
      radar: false,
      whiteLabel: false,
      workspaceKind: "INDIVIDUAL",
    },
    lookupKeys: { monthly: "smartpr_free_monthly" },
    productMetadataPlan: "free",
    productId: PRODUCT_IDS.free,
    selfServe: true,
  },
  core: {
    id: "core",
    name: "Core",
    tagline: "Readiness packages you can take to the counter.",
    amountUsd: { monthly: 99, yearly: 990, one_time: null },
    features: [
      "1 business workspace",
      "1 seat",
      "Exportable deliverables",
      "Filing-ready package prep",
      "Email support",
    ],
    entitlements: {
      maxBusinesses: 1,
      maxSeats: 1,
      deliverables: true,
      radar: false,
      whiteLabel: false,
      workspaceKind: "INDIVIDUAL",
    },
    lookupKeys: {
      monthly: "smartpr_core_monthly",
      yearly: "smartpr_core_yearly",
    },
    productMetadataPlan: "core",
    productId: PRODUCT_IDS.core,
    selfServe: true,
    popular: true,
  },
  operator: {
    id: "operator",
    name: "Operator",
    tagline: "For owners juggling a few entities.",
    amountUsd: { monthly: 249, yearly: 2490, one_time: null },
    features: [
      "Up to 5 businesses",
      "Up to 5 seats",
      "Exportable deliverables",
      "Shared workspace notes",
      "Priority email support",
    ],
    entitlements: {
      maxBusinesses: 5,
      maxSeats: 5,
      deliverables: true,
      radar: false,
      whiteLabel: false,
      workspaceKind: "INDIVIDUAL",
    },
    lookupKeys: {
      monthly: "smartpr_operator_monthly",
      yearly: "smartpr_operator_yearly",
    },
    productMetadataPlan: "operator",
    productId: PRODUCT_IDS.operator,
    selfServe: true,
  },
  partner: {
    id: "partner",
    name: "Partner",
    tagline: "For advisors managing client portfolios.",
    amountUsd: { monthly: 499, yearly: 4990, one_time: null },
    features: [
      "Up to 25 businesses",
      "Up to 10 seats",
      "Exportable deliverables",
      "Radar alerts for deadlines that may apply",
      "Professional workspace",
    ],
    entitlements: {
      maxBusinesses: 25,
      maxSeats: 10,
      deliverables: true,
      radar: true,
      whiteLabel: false,
      workspaceKind: "PROFESSIONAL",
    },
    lookupKeys: {
      monthly: "smartpr_partner_monthly",
      yearly: "smartpr_partner_yearly",
    },
    productMetadataPlan: "partner",
    productId: PRODUCT_IDS.partner,
    selfServe: true,
  },
  pilot: {
    id: "pilot",
    name: "Readiness Pilot",
    tagline: "Fixed-scope kickoff for teams that need a guided start.",
    amountUsd: { monthly: null, yearly: null, one_time: 7500 },
    features: [
      "Scoped readiness engagement",
      "Exportable deliverables",
      "Dedicated onboarding call",
      "Government remains system of record",
    ],
    entitlements: {
      maxBusinesses: 1,
      maxSeats: 5,
      deliverables: true,
      radar: false,
      whiteLabel: false,
      workspaceKind: "INDIVIDUAL",
      skuType: "one_time",
    },
    lookupKeys: { one_time: "smartpr_pilot_onetime" },
    productMetadataPlan: "pilot",
    productId: PRODUCT_IDS.pilot,
    selfServe: false,
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    tagline: "White-label and unlimited portfolios — by contract.",
    amountUsd: { monthly: null, yearly: null, one_time: null },
    features: [
      "Unlimited businesses",
      "Unlimited seats",
      "White-label options",
      "Radar + deliverables",
      "Contract / invoice billing",
    ],
    entitlements: {
      maxBusinesses: "unlimited",
      maxSeats: "unlimited",
      deliverables: true,
      radar: true,
      whiteLabel: true,
      workspaceKind: "PROFESSIONAL",
    },
    lookupKeys: {},
    productMetadataPlan: "enterprise",
    productId: PRODUCT_IDS.enterprise,
    selfServe: true,
    contactOnly: true,
  },
};

/** Pricing-page cards: Free, Core, Operator, Partner, Enterprise (Contact). */
export const PLANS: PlanDefinition[] = [
  PLAN_CATALOG.free,
  PLAN_CATALOG.core,
  PLAN_CATALOG.operator,
  PLAN_CATALOG.partner,
  PLAN_CATALOG.enterprise,
];

/**
 * Resolve a Stripe Price ID for a plan + billing period.
 * Returns null when the plan/period has no Checkout price (e.g. enterprise).
 */
export function getPriceId(
  plan: PlanId,
  period: BillingPeriod
): string | null {
  switch (plan) {
    case "free":
      return period === "monthly" ? PRICE_IDS.free.monthly : null;
    case "core":
      if (period === "monthly") return PRICE_IDS.core.monthly;
      if (period === "yearly") return PRICE_IDS.core.yearly;
      return null;
    case "operator":
      if (period === "monthly") return PRICE_IDS.operator.monthly;
      if (period === "yearly") return PRICE_IDS.operator.yearly;
      return null;
    case "partner":
      if (period === "monthly") return PRICE_IDS.partner.monthly;
      if (period === "yearly") return PRICE_IDS.partner.yearly;
      return null;
    case "pilot":
      return period === "one_time" ? PRICE_IDS.pilot.one_time : null;
    case "enterprise":
      return null;
    default: {
      const _exhaustive: never = plan;
      return _exhaustive;
    }
  }
}

/** Flat map of every known price ID → planId (for webhook / entitlements). */
export function allPriceIdToPlan(): Record<string, PlanId> {
  const map: Record<string, PlanId> = {};
  const add = (id: string | undefined, plan: PlanId) => {
    if (id) map[id] = plan;
  };
  add(PRICE_IDS.free.monthly, "free");
  add(PRICE_IDS.core.monthly, "core");
  add(PRICE_IDS.core.yearly, "core");
  add(PRICE_IDS.operator.monthly, "operator");
  add(PRICE_IDS.operator.yearly, "operator");
  add(PRICE_IDS.partner.monthly, "partner");
  add(PRICE_IDS.partner.yearly, "partner");
  add(PRICE_IDS.pilot.one_time, "pilot");
  return map;
}

export function isPlanId(value: string): value is PlanId {
  return value in PLAN_CATALOG;
}
