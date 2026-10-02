"use client";

/**
 * A compact, flat tile for the business page. Selecting a tile highlights it
 * and shows its content in ONE shared, full-width detail panel below the tile
 * row (the page owns that panel element and passes it in). Only the selected
 * tile's content is visible; content of tiles opened earlier stays mounted
 * (hidden) so unsaved edits survive switching tiles.
 */
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type TileTone = "blue" | "green" | "amber" | "rose" | "violet" | "slate";

const TONES: Record<TileTone, { bg: string; border: string; sel: string; icon: string; bar: string }> = {
  blue: { bg: "bg-[#EAF1FB]", border: "border-[#C9DAF2]", sel: "border-[#2F6FC4] ring-[#2F6FC4]", icon: "bg-[#D3E3F8] text-[#1F4E8C]", bar: "bg-[#2F6FC4]" },
  green: { bg: "bg-[#E8F3EC]", border: "border-[#C5E0CF]", sel: "border-[#2E8B57] ring-[#2E8B57]", icon: "bg-[#CFE7D8] text-[#1E6B43]", bar: "bg-[#2E8B57]" },
  amber: { bg: "bg-[#FBF1DE]", border: "border-[#EED9AE]", sel: "border-[#C98A12] ring-[#C98A12]", icon: "bg-[#F5E2BB] text-[#8A5A00]", bar: "bg-[#C98A12]" },
  rose: { bg: "bg-[#FBEAEA]", border: "border-[#F0C9C9]", sel: "border-[#C94040] ring-[#C94040]", icon: "bg-[#F6D5D5] text-[#9F2D2D]", bar: "bg-[#C94040]" },
  violet: { bg: "bg-[#F0ECFA]", border: "border-[#D9D0F2]", sel: "border-[#6D4FC4] ring-[#6D4FC4]", icon: "bg-[#E2DAF6] text-[#5B3FA8]", bar: "bg-[#6D4FC4]" },
  slate: { bg: "bg-[#F1F2F4]", border: "border-[#D9DCE1]", sel: "border-[#5B6472] ring-[#5B6472]", icon: "bg-[#E2E5E9] text-[#3D4450]", bar: "bg-[#5B6472]" },
};

export function BusinessTile({
  id, tone, icon, title, summary, metric, progress, selected, onSelect, onClose, panelEl, children, testId, closeLabel = "Close",
}: {
  id: string;
  tone: TileTone;
  icon: ReactNode;
  title: string;
  summary: ReactNode;
  metric?: ReactNode;
  progress?: number | null;
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
  /** The page's shared detail panel. */
  panelEl: HTMLElement | null;
  children: ReactNode;
  testId?: string;
  closeLabel?: string;
}) {
  const t = TONES[tone];
  // Mount on first selection, then keep mounted so in-progress edits persist.
  const [mounted, setMounted] = useState(selected);
  if (selected && !mounted) setMounted(true);
  const bodyId = `${id}-detail`;
  return (
    <>
      <button
        type="button"
        id={id}
        onClick={selected ? onClose : onSelect}
        aria-expanded={selected}
        aria-controls={bodyId}
        data-testid={testId}
        data-selected={selected ? "1" : "0"}
        className={`flex w-full scroll-mt-20 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand ${t.bg} ${selected ? `${t.sel} ring-1` : `${t.border} hover:brightness-[0.98]`}`}
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${t.icon}`} aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-[#161616]">{title}</span>
          <span className="block truncate text-xs text-[#4a4a4a]">{summary}</span>
          {progress != null && (
            <span className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-white/80" aria-hidden="true">
              <span className={`block h-full rounded-full ${t.bar}`} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
            </span>
          )}
        </span>
        {metric != null && <span className="shrink-0 text-lg font-bold text-[#161616]">{metric}</span>}
      </button>
      {mounted && panelEl && createPortal(
        <div id={bodyId} hidden={!selected} role="region" aria-labelledby={`${bodyId}-title`} data-testid={testId ? `${testId}-detail` : undefined}>
          <div className="mb-3 flex items-center gap-3">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${t.icon}`} aria-hidden="true">{icon}</span>
            <h2 id={`${bodyId}-title`} className="flex-1 text-base font-bold text-[#161616]">{title}</h2>
            <button type="button" onClick={onClose} className="rounded-full p-1.5 text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand" aria-label={closeLabel}>
              <X className="h-4 w-4" />
            </button>
          </div>
          {children}
        </div>,
        panelEl
      )}
    </>
  );
}
