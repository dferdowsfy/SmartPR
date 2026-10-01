"use client";

// What the in-platform row actions need from the page: the business (for
// drafts, Teach Clara and Clara runs) and the details that prefill SmartPR's
// guided forms. Rows outside a provider still work (local drafts, empty
// prefill).

import { createContext, useContext, type ReactNode } from "react";
import type { Prefill } from "./guidedFormModel";

export interface RequirementActionsEnv {
  /** Persisted business id, when there is one (never a local draft id). */
  businessId: string | null;
  prefill: Prefill;
  signedIn: boolean;
}

const Ctx = createContext<RequirementActionsEnv>({ businessId: null, prefill: {}, signedIn: false });

export function RequirementActionsProvider({ value, children }: { value: RequirementActionsEnv; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRequirementActionsEnv(): RequirementActionsEnv {
  return useContext(Ctx);
}
