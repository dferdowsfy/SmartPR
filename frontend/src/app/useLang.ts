"use client";
// Single source of truth for the app's EN/ES language state.
//
// Every page must use this hook (never a one-time useMemo read of
// localStorage) so that switching language in the TopNav instantly
// re-renders ALL mounted pages, including the business profile,
// obligation rows, and the new-filing form.
//
// The hook syncs from three sources:
//   1. localStorage "smartpr-lang" (persists across reloads/tabs)
//   2. "smartpr-lang-change" CustomEvent (same-tab toggle from TopNav)
//   3. "storage" event (cross-tab toggle)
import { useEffect, useState } from "react";
import type { Lang } from "./i18n";

export function readLang(): Lang {
  try {
    if (typeof window === "undefined") return "en";
    return window.localStorage.getItem("smartpr-lang") === "es" ? "es" : "en";
  } catch {
    return "en";
  }
}

/** Persist + broadcast a language change to every mounted hook. */
export function setLang(l: Lang): void {
  try {
    window.localStorage.setItem("smartpr-lang", l);
  } catch {}
  window.dispatchEvent(new CustomEvent("smartpr-lang-change", { detail: l }));
}

export function useLang(): Lang {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => {
    setLangState(readLang());
    const handler = (e: Event) => {
      const l = (e as CustomEvent<string>).detail;
      if (l === "en" || l === "es") setLangState(l);
    };
    const storageHandler = (e: StorageEvent) => {
      if (e.key === "smartpr-lang") setLangState(readLang());
    };
    window.addEventListener("smartpr-lang-change", handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener("smartpr-lang-change", handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);
  return lang;
}
