"use client";

/**
 * Presentation helpers for the business page's requirement cards: the
 * workflow phase used by the filter tabs, the calm status pill, and the
 * "…" overflow menu that holds lower-priority actions. No requirement,
 * document or status logic lives here — phases are read from the existing
 * obligation status.
 */
import { MoreHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Lang } from "../forms/engine/types";

export type RequirementPhase = "required" | "in_progress" | "completed";

/** Filter-tab bucket for an obligation status. */
export function requirementPhase(status: string): RequirementPhase {
  if (status === "COMPLETED" || status === "CURRENT") return "completed";
  if (status === "IN_PROGRESS" || status === "NEEDS_ATTENTION") return "in_progress";
  return "required";
}

const T = (lang: Lang, en: string, es: string) => (lang === "es" ? es : en);

/**
 * Status pill. Incomplete is normal workflow, so "Required" is calm; red is
 * reserved for real problems (overdue), amber for due soon / needs attention.
 */
export function RequirementStatusPill({ status, lang }: { status: string; lang: Lang }) {
  const [label, cls] =
    status === "OVERDUE" ? [T(lang, "Overdue", "Vencido"), "border-red-200 bg-red-50 text-red-700"]
    : status === "NEEDS_ATTENTION" ? [T(lang, "Needs attention", "Requiere atención"), "border-amber-200 bg-amber-50 text-amber-800"]
    : status === "DUE_SOON" ? [T(lang, "Due soon", "Vence pronto"), "border-amber-200 bg-amber-50 text-amber-800"]
    : status === "COMPLETED" ? [T(lang, "Completed", "Completado"), "border-emerald-200 bg-emerald-50 text-emerald-700"]
    : status === "CURRENT" ? [T(lang, "Current", "Vigente"), "border-emerald-200 bg-emerald-50 text-emerald-700"]
    : status === "IN_PROGRESS" ? [T(lang, "In progress", "En progreso"), "border-teal-200 bg-teal-50 text-teal-800"]
    : [T(lang, "Required", "Requerido"), "border-sky-200 bg-sky-50 text-sky-800"];
  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`} data-testid="requirement-status" data-status={status}>
      {label}
    </span>
  );
}

/** Compact "…" button with a menu of secondary actions. */
export function OverflowMenu({ lang, label, children }: { lang: Lang; label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); ref.current?.querySelector<HTMLButtonElement>("button")?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[role="menu"] button, [role="menu"] a')?.focus());
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`${T(lang, "More actions", "Más acciones")}: ${label}`}
        onClick={() => setOpen((o) => !o)}
        data-testid="requirement-more"
        className="grid h-11 w-11 place-items-center rounded-xl border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          onClick={(e) => { if ((e.target as HTMLElement).closest("[data-menu-close]")) setOpen(false); }}
          className="absolute right-0 z-30 mt-2 flex w-64 flex-col gap-0.5 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
          data-testid="requirement-menu"
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Menu item styling shared by buttons and links in the overflow menu. */
export const menuItemCls = "flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 focus:bg-slate-50 focus:outline-none disabled:opacity-50";
