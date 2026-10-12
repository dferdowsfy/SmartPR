"use client";

// Instant feedback for actions that take a moment (opening a large form,
// saving before Clara opens): the clicked button shows a spinner right away,
// and the handler runs only after that frame has painted. A handler that
// returns a promise (e.g. save → navigate to Clara) keeps the spinner until
// the page changes, with a safety reset in case it doesn't; a promise that
// resolves to false means "stayed on this page" and clears it at once.

import { useCallback, useEffect, useRef, useState } from "react";

const AFTER_SYNC_MS = 300;
const AFTER_ASYNC_MS = 10000;

export function usePendingAction<K extends string>() {
  const [pending, setPending] = useState<K | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = useCallback((key: K, fn: (() => unknown) | undefined, opts: { deferred?: boolean } = {}) => {
    if (!fn) return;
    setPending(key);
    const clearAfter = (ms: number) => window.setTimeout(() => { if (alive.current) setPending((p) => (p === key ? null : p)); }, ms);
    const exec = () => {
      let result: unknown;
      try {
        result = fn();
      } catch (err) {
        clearAfter(0);
        throw err;
      }
      if (result instanceof Promise) result.then((v) => clearAfter(v === false ? 0 : AFTER_ASYNC_MS), () => clearAfter(0));
      // A sync handler returning true is navigating away (keep the spinner).
      else clearAfter(result === true ? AFTER_ASYNC_MS : AFTER_SYNC_MS);
    };
    // Links navigate on their own: run the handler in the click. Buttons
    // wait one frame so the spinner is on screen before the heavy work.
    if (opts.deferred === false) exec();
    else window.requestAnimationFrame(() => window.setTimeout(exec, 0));
  }, []);
  return { pending, run };
}
