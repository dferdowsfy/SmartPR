"use client";

/**
 * One accordion row on the business page. The header (title, one-line
 * summary, count/status) is always visible; the content opens directly under
 * its own header. Content opened once stays mounted (hidden when closed) so
 * unsaved edits survive closing the row or opening another one.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export type TileTone = "blue" | "green" | "amber" | "rose" | "violet" | "slate";

const TONES: Record<TileTone, { icon: string; bar: string }> = {
  blue: { icon: "bg-[#D3E3F8] text-[#1F4E8C]", bar: "bg-[#2F6FC4]" },
  green: { icon: "bg-[#CFE7D8] text-[#1E6B43]", bar: "bg-[#2E8B57]" },
  amber: { icon: "bg-[#F5E2BB] text-[#8A5A00]", bar: "bg-[#C98A12]" },
  rose: { icon: "bg-[#F6D5D5] text-[#9F2D2D]", bar: "bg-[#C94040]" },
  violet: { icon: "bg-[#E2DAF6] text-[#5B3FA8]", bar: "bg-[#6D4FC4]" },
  slate: { icon: "bg-[#E2E5E9] text-[#3D4450]", bar: "bg-[#5B6472]" },
};

export function BusinessTile({
  id, tone, icon, title, summary, metric, progress, selected, onSelect, onClose, children, testId,
}: {
  id: string;
  tone: TileTone;
  icon: ReactNode;
  title: string;
  summary: ReactNode;
  /** Count or status kept visible while collapsed. */
  metric?: ReactNode;
  progress?: number | null;
  selected: boolean;
  onSelect: () => void;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const t = TONES[tone];
  const [mounted, setMounted] = useState(selected);
  if (selected && !mounted) setMounted(true);
  const bodyId = `${id}-detail`;
  const headId = `${id}-header`;
  return (
    <section id={id} className="scroll-mt-20 border-b border-[#E4E1D8] last:border-b-0" data-testid={testId} data-selected={selected ? "1" : "0"}>
      <h2 className="m-0">
        <button
          type="button"
          id={headId}
          onClick={selected ? onClose : onSelect}
          aria-expanded={selected}
          aria-controls={bodyId}
          data-testid={testId ? `${testId}-toggle` : undefined}
          className={`flex w-full items-center gap-3 px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:px-5 ${selected ? "bg-[#F7F5EF]" : "hover:bg-[#FAF8F3]"}`}
        >
          <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${t.icon}`} aria-hidden="true">{icon}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-[#161616]">{title}</span>
            <span className="block truncate text-xs text-[#4a4a4a]">{summary}</span>
            {progress != null && (
              <span className="mt-1.5 block h-1 w-full max-w-xs overflow-hidden rounded-full bg-[#ECEAE4]" aria-hidden="true">
                <span className={`block h-full rounded-full ${t.bar}`} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
              </span>
            )}
          </span>
          {metric != null && <span className="shrink-0 text-base font-bold text-[#161616]" data-testid={testId ? `${testId}-metric` : undefined}>{metric}</span>}
          <ChevronDown className={`h-4 w-4 shrink-0 text-[#4a4a4a] transition-transform duration-150 motion-reduce:transition-none ${selected ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
      </h2>
      {mounted && (
        <div id={bodyId} role="region" aria-labelledby={headId} hidden={!selected} className="px-3 pb-4 pt-1 sm:px-5" data-testid={testId ? `${testId}-detail` : undefined}>
          {children}
        </div>
      )}
    </section>
  );
}
