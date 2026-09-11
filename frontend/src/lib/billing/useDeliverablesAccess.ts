"use client";

import { useEffect, useState } from "react";

export type PaywallCode = "auth_required" | "plan_deliverables_locked";

export type DeliverablesAccess = {
  /**
   * Tri-state: true = entitled, false = locked, null = still loading or the
   * check failed. Hosts show no lock while null and let the server-side
   * /populate gate (the source of truth) decide.
   */
  canUseDeliverables: boolean | null;
  /** Which paywall copy the modal should open with when locked. */
  paywallCode: PaywallCode | null;
  /** True when the signed-in user is a platform admin (bypasses the gate). */
  isAdmin: boolean;
};

/**
 * Client-side read of the deliverables entitlement. Used to surface the
 * paywall *before* the user fills out a government form — the server-side
 * /populate gate remains the source of truth and is enforced regardless.
 */
export function useDeliverablesAccess(): DeliverablesAccess {
  const [state, setState] = useState<DeliverablesAccess>({
    canUseDeliverables: null,
    paywallCode: null,
    isAdmin: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/billing/entitlements", { credentials: "same-origin" });
        if (res.status === 401) {
          // Guest: the assessment stays free; completed documents need an account + plan.
          if (!cancelled) setState({ canUseDeliverables: false, paywallCode: "auth_required", isAdmin: false });
          return;
        }
        if (!res.ok) {
          if (!cancelled) setState({ canUseDeliverables: null, paywallCode: null, isAdmin: false });
          return;
        }
        const body = (await res.json()) as {
          entitlements?: { deliverables?: boolean };
          admin?: boolean;
        };
        if (!cancelled) {
          const ok = body.entitlements?.deliverables === true;
          setState({
            canUseDeliverables: ok,
            paywallCode: ok ? null : "plan_deliverables_locked",
            isAdmin: body.admin === true,
          });
        }
      } catch {
        if (!cancelled) setState({ canUseDeliverables: null, paywallCode: null, isAdmin: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
