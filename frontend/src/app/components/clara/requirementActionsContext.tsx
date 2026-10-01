"use client";

// What the in-platform row actions need from the page: the business (for
// drafts, Teach Clara and Clara runs), the details that prefill SmartPR's
// guided forms, and the person's learned routines (record-first Teach
// Clara) so rows Clara learned lead with "Fill with Clara". Rows outside a
// provider still work (local drafts, empty prefill, no routines).

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Prefill } from "./guidedFormModel";
import type { LearnedRoutineSummary } from "../../../lib/agency-runs/teach/learnedRoutineMatch";

export interface RequirementActionsEnv {
  /** Persisted business id, when there is one (never a local draft id). */
  businessId: string | null;
  prefill: Prefill;
  signedIn: boolean;
}

export interface RequirementActionsState extends RequirementActionsEnv {
  routines: LearnedRoutineSummary[];
  /** The live recorder (self-hosted browser worker) is connected; null = not known yet. */
  liveRecorder: boolean | null;
  addRoutine(r: LearnedRoutineSummary): void;
}

const Ctx = createContext<RequirementActionsState>({ businessId: null, prefill: {}, signedIn: false, routines: [], liveRecorder: null, addRoutine: () => undefined });

export function RequirementActionsProvider({ value, children }: { value: RequirementActionsEnv; children: ReactNode }) {
  const [routines, setRoutines] = useState<LearnedRoutineSummary[]>([]);
  const [liveRecorder, setLiveRecorder] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/clara-routines", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { routines?: LearnedRoutineSummary[]; live_recorder?: boolean } | null) => {
        if (cancelled || !body) return;
        setRoutines(Array.isArray(body.routines) ? body.routines : []);
        setLiveRecorder(Boolean(body.live_recorder));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [value.signedIn]);
  const addRoutine = useCallback((r: LearnedRoutineSummary) => {
    setRoutines((all) => [r, ...all.filter((x) => x.ref !== r.ref && !(r.requirement_key && x.requirement_key === r.requirement_key))]);
  }, []);
  const state = useMemo(() => ({ ...value, routines, liveRecorder, addRoutine }), [value, routines, liveRecorder, addRoutine]);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useRequirementActionsEnv(): RequirementActionsState {
  return useContext(Ctx);
}
