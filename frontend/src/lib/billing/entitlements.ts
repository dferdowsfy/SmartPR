/**
 * Workspace entitlement helpers derived from the billing catalog.
 */

import {
  PLAN_CATALOG,
  allPriceIdToPlan,
  isPlanId,
  type PlanEntitlements,
  type PlanId,
} from "./catalog";

export type WorkspacePlanState = {
  planId: PlanId;
  status: string;
};

export function entitlementsFor(planId: PlanId): PlanEntitlements {
  return PLAN_CATALOG[planId].entitlements;
}

function isActiveStatus(status: string): boolean {
  const s = status.toLowerCase();
  return s === "active" || s === "trialing" || s === "free";
}

function withinLimit(
  limit: number | "unlimited",
  current: number
): boolean {
  if (limit === "unlimited") return true;
  return current < limit;
}

export function canAddBusiness(
  state: WorkspacePlanState,
  currentCount: number
): boolean {
  if (!isActiveStatus(state.status) && state.planId !== "free") {
    return false;
  }
  const { maxBusinesses } = entitlementsFor(state.planId);
  return withinLimit(maxBusinesses, currentCount);
}

export function canInviteSeat(
  state: WorkspacePlanState,
  currentSeats: number
): boolean {
  if (!isActiveStatus(state.status) && state.planId !== "free") {
    return false;
  }
  const { maxSeats } = entitlementsFor(state.planId);
  return withinLimit(maxSeats, currentSeats);
}

export function canExportDeliverables(state: WorkspacePlanState): boolean {
  if (!isActiveStatus(state.status) && state.planId !== "free") {
    return false;
  }
  return entitlementsFor(state.planId).deliverables;
}

export function canUseRadar(state: WorkspacePlanState): boolean {
  if (!isActiveStatus(state.status) && state.planId !== "free") {
    return false;
  }
  return entitlementsFor(state.planId).radar;
}

/**
 * Map a Stripe Price ID (env-resolved or test default) back to a PlanId.
 */
export function planFromStripePriceId(priceId: string): PlanId | null {
  if (!priceId) return null;
  const map = allPriceIdToPlan();
  return map[priceId] ?? null;
}

/**
 * Resolve plan from Checkout/session metadata `planId` or a price ID.
 */
export function resolvePlanId(input: {
  planId?: string | null;
  priceId?: string | null;
}): PlanId | null {
  if (input.planId && isPlanId(input.planId)) return input.planId;
  if (input.priceId) return planFromStripePriceId(input.priceId);
  return null;
}
