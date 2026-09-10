import type { ObligationStatus } from "../../compliance/types";

const STYLE: Record<ObligationStatus, string> = {
  CURRENT: "border-emerald-200 bg-emerald-50 text-emerald-700",
  UPCOMING: "border-sky-200 bg-sky-50 text-sky-700",
  DUE_SOON: "border-amber-200 bg-amber-50 text-amber-800",
  IN_PROGRESS: "border-blue-200 bg-blue-50 text-blue-700",
  NEEDS_ATTENTION: "border-amber-200 bg-amber-50 text-amber-800",
  MISSING: "border-rose-200 bg-rose-50 text-rose-700",
  OVERDUE: "border-red-300 bg-red-50 text-red-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  UNKNOWN: "border-slate-200 bg-slate-100 text-slate-600",
};

export function StatusBadge({ status }: { status: ObligationStatus | string }) {
  const known = status in STYLE ? status as ObligationStatus : "UNKNOWN";
  // Never show the internal "UNKNOWN" state name to users.
  const text = known === "UNKNOWN" ? "NEEDS INFO" : known.replaceAll("_", " ");
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-bold tracking-wide ${STYLE[known]}`}>
      {text}
    </span>
  );
}
