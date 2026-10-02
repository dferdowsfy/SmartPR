"use client";

/**
 * One business-page section. It renders two things into elements the page
 * owns: its entry in the persistent section menu (navEl) and its full content
 * in the content panel (panelEl). Only the selected section's content is
 * visible; a section's content stays mounted once opened (hidden otherwise)
 * so unsaved form entries survive switching sections.
 */
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type TileTone = "blue" | "green" | "amber" | "rose" | "violet" | "slate";

const ICON: Record<TileTone, string> = {
  blue: "bg-[#D3E3F8] text-[#1F4E8C]",
  green: "bg-[#CFE7D8] text-[#1E6B43]",
  amber: "bg-[#F5E2BB] text-[#8A5A00]",
  rose: "bg-[#F6D5D5] text-[#9F2D2D]",
  violet: "bg-[#E2DAF6] text-[#5B3FA8]",
  slate: "bg-[#E2E5E9] text-[#3D4450]",
};

export function BusinessTile({
  id, tone, icon, title, shortTitle, summary, metric, showSummaryInPanel = true, selected, onSelect, navEl, panelEl, children, testId,
}: {
  id: string;
  tone: TileTone;
  icon: ReactNode;
  title: string;
  /** Label for the compact mobile grid (falls back to title). */
  shortTitle?: string;
  summary: ReactNode;
  /** Count or status shown in the menu. */
  metric?: ReactNode;
  /** Repeat the summary under the panel title (off when the content already shows it). */
  showSummaryInPanel?: boolean;
  selected: boolean;
  onSelect: () => void;
  navEl: HTMLElement | null;
  panelEl: HTMLElement | null;
  children: ReactNode;
  testId?: string;
}) {
  const [mounted, setMounted] = useState(selected);
  if (selected && !mounted) setMounted(true);
  const panelId = `${id}-panel`;
  const navId = `${id}-nav`;

  const navItem = (
    <li className="min-w-0">
      <button
        type="button"
        id={navId}
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        aria-controls={panelId}
        data-testid={testId ? `${testId}-toggle` : undefined}
        data-selected={selected ? "1" : "0"}
        className={`group flex h-full min-h-14 w-full items-center gap-2 rounded-xl border px-2 py-2 text-left transition-colors motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 lg:min-h-12 lg:gap-3 lg:px-3 ${
          selected ? "border-brand/40 bg-[#E6F0EE] text-brand" : "border-transparent hover:bg-[#F4F1EA]"
        } max-lg:flex-col max-lg:items-center max-lg:justify-center max-lg:gap-1 max-lg:text-center`}
      >
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg max-lg:h-7 max-lg:w-7 ${ICON[tone]}`} aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1 max-lg:flex-none">
          <span className={`block text-sm font-semibold leading-tight max-lg:text-[11px] ${selected ? "text-brand" : "text-[#161616]"}`}>
            <span className="max-lg:hidden">{title}</span>
            <span className="lg:hidden">{shortTitle ?? title}</span>
          </span>
          <span className="block truncate text-xs text-[#5a5a5a] max-lg:hidden">{summary}</span>
        </span>
        {metric != null && (
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold max-lg:px-1.5 max-lg:text-[10px] ${selected ? "bg-white text-brand" : "bg-[#F1F2F4] text-[#3D4450]"}`}
            data-testid={testId ? `${testId}-metric` : undefined}
          >
            {metric}
          </span>
        )}
      </button>
    </li>
  );

  return (
    <>
      {navEl && createPortal(navItem, navEl)}
      {mounted && panelEl && createPortal(
        <section id={panelId} aria-labelledby={`${panelId}-title`} hidden={!selected} data-testid={testId ? `${testId}-detail` : undefined}>
          <div className="mb-4 flex items-center gap-3 border-b border-[#ECEAE4] pb-3">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${ICON[tone]}`} aria-hidden="true">{icon}</span>
            <div className="min-w-0 flex-1">
              <h2 id={`${panelId}-title`} className="text-lg font-bold text-[#161616]">{title}</h2>
              {showSummaryInPanel && <p className="text-sm text-[#5a5a5a]">{summary}</p>}
            </div>
          </div>
          <div id={id} className="scroll-mt-40">{children}</div>
        </section>,
        panelEl
      )}
    </>
  );
}
