"use client";

/**
 * A flat, collapsible tile for the business page grid. The header is always
 * visible (title, one-line summary, optional progress) and toggles the body.
 * Flat fills only — no gradients or heavy shadows.
 */
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export type TileTone = "blue" | "green" | "amber" | "rose" | "violet" | "slate";

const TONES: Record<TileTone, { bg: string; border: string; icon: string; bar: string }> = {
  blue: { bg: "bg-[#EAF1FB]", border: "border-[#C9DAF2]", icon: "bg-[#D3E3F8] text-[#1F4E8C]", bar: "bg-[#2F6FC4]" },
  green: { bg: "bg-[#E8F3EC]", border: "border-[#C5E0CF]", icon: "bg-[#CFE7D8] text-[#1E6B43]", bar: "bg-[#2E8B57]" },
  amber: { bg: "bg-[#FBF1DE]", border: "border-[#EED9AE]", icon: "bg-[#F5E2BB] text-[#8A5A00]", bar: "bg-[#C98A12]" },
  rose: { bg: "bg-[#FBEAEA]", border: "border-[#F0C9C9]", icon: "bg-[#F6D5D5] text-[#9F2D2D]", bar: "bg-[#C94040]" },
  violet: { bg: "bg-[#F0ECFA]", border: "border-[#D9D0F2]", icon: "bg-[#E2DAF6] text-[#5B3FA8]", bar: "bg-[#6D4FC4]" },
  slate: { bg: "bg-[#F1F2F4]", border: "border-[#D9DCE1]", icon: "bg-[#E2E5E9] text-[#3D4450]", bar: "bg-[#5B6472]" },
};

export function BusinessTile({
  id, tone, icon, title, summary, metric, progress, open, onToggle, children, testId,
}: {
  id?: string;
  tone: TileTone;
  icon: ReactNode;
  title: string;
  summary: ReactNode;
  /** Big number/label on the right of the header (e.g. "72%"). */
  metric?: ReactNode;
  /** 0–100 progress bar under the header, when meaningful. */
  progress?: number | null;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const t = TONES[tone];
  const bodyId = id ? `${id}-body` : undefined;
  return (
    <section id={id} className={`scroll-mt-20 rounded-2xl border ${t.border} ${t.bg}`} data-testid={testId} data-open={open ? "1" : "0"}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-4 rounded-2xl px-5 py-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${t.icon}`} aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-bold text-[#161616]">{title}</span>
          <span className="block truncate text-sm text-[#4a4a4a]">{summary}</span>
          {progress != null && (
            <span className="mt-2 block h-1.5 w-full overflow-hidden rounded-full bg-white/80" aria-hidden="true">
              <span className={`block h-full rounded-full ${t.bar}`} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
            </span>
          )}
        </span>
        {metric != null && <span className="shrink-0 text-xl font-bold text-[#161616]">{metric}</span>}
        <ChevronDown className={`h-5 w-5 shrink-0 text-[#4a4a4a] transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {open && <div id={bodyId} className="px-3 pb-3 sm:px-4 sm:pb-4">{children}</div>}
    </section>
  );
}
