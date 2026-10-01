"use client";

// Viewport-fixed modal plumbing shared by the app's dialogs.
//
// Why a portal: `position: fixed` is relative to the viewport ONLY when no
// ancestor creates a containing block for fixed descendants. Any ancestor
// with a `transform`, `filter`, `backdrop-filter`, `perspective`,
// `contain: paint/layout` or `will-change: transform` does — e.g. the
// filing workflow's stage-enter animation (`.spr-stage-enter`). A dialog
// rendered inside such an ancestor is positioned against it instead of the
// screen, so a user scrolled far down sees it open off-screen at the top of
// the page. Portalling to <body> takes the dialog out of every app ancestor,
// so `fixed; inset: 0` always means "the user's current viewport".

import { useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const noopSubscribe = () => () => {};

/** True only in the browser, after hydration (portals need document.body). */
function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/** Render children into document.body (outside any transformed/scrolling ancestor). */
export function ModalPortal({ children }: { children: ReactNode }) {
  const isClient = useIsClient();
  if (!isClient) return null;
  return createPortal(children, document.body);
}

// Reference-counted so nested/stacked dialogs restore the page only when the
// last one closes.
let scrollLocks = 0;
let savedHtmlOverflow = "";
let savedBodyOverflow = "";

function lockScroll() {
  if (scrollLocks++ > 0) return;
  const html = document.documentElement;
  savedHtmlOverflow = html.style.overflow;
  savedBodyOverflow = document.body.style.overflow;
  html.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
}

function unlockScroll() {
  if (scrollLocks === 0 || --scrollLocks > 0) return;
  document.documentElement.style.overflow = savedHtmlOverflow;
  document.body.style.overflow = savedBodyOverflow;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal behaviour for a dialog element while it is mounted: locks page
 * scroll, moves focus into the dialog (the preferred field, else the dialog
 * itself), keeps Tab inside it, closes on Escape, and returns focus to the
 * opener on close. `onEscape` is read through a ref, so changing it never
 * re-runs the effect (which would steal focus mid-edit).
 */
export function useModalBehavior(
  dialogRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>
) {
  const escapeRef = useRef(onEscape);
  useEffect(() => {
    escapeRef.current = onEscape;
  });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    lockScroll();
    const dialog = dialogRef.current;
    const target = initialFocusRef?.current ?? dialog;
    target?.focus({ preventScroll: true });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      unlockScroll();
      previous?.focus?.({ preventScroll: true });
    };
    // Mount only (see doc comment).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
