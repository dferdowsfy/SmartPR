import type { ObligationStatus } from "./types";

// Product-level reminder defaults. These control notification timing only;
// regulatory deadlines and renewal cadences still come from structured data.
// Founder decision 2026-09-14: email-only reminders at 60/30/7 days.
export const REMINDER_WINDOWS_DAYS = [60, 30, 7] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function validDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}

export function daysUntil(date: string, now = new Date()): number {
  const target = new Date(`${date}T00:00:00.000Z`).getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.ceil((target - today) / DAY_MS);
}

export function subtractDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Adds a structured renewal cadence while clamping end-of-month dates (for
// example, January 31 + one month becomes February 28/29, never March 2/3).
export function addMonthsClamped(date: string, months: number): string | null {
  const valid = validDateOnly(date);
  if (!valid || !Number.isInteger(months) || months <= 0) return null;
  const [year, month, day] = valid.split("-").map(Number);
  const targetMonth = month - 1 + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, normalizedMonth, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}

export function deriveObligationStatus(input: {
  currentStatus?: string | null;
  dueDate?: string | null;
  evidenceState?: "NONE" | "VERIFIED" | "NEEDS_REVIEW" | "FAILED";
  expectsRenewal?: boolean;
  now?: Date;
}): ObligationStatus {
  if (input.currentStatus === "COMPLETED") return "COMPLETED";
  if (input.evidenceState === "NEEDS_REVIEW") return "NEEDS_ATTENTION";
  if (input.evidenceState === "FAILED") return "MISSING";

  const due = input.dueDate ? validDateOnly(input.dueDate) : null;
  if (input.evidenceState === "NONE" || !input.evidenceState) {
    if (due && daysUntil(due, input.now) <= 0) return "OVERDUE";
    if (input.currentStatus === "UNKNOWN") return "UNKNOWN";
    return input.currentStatus === "IN_PROGRESS" ? "IN_PROGRESS" : "MISSING";
  }

  if (!due) return input.expectsRenewal ? "UNKNOWN" : "CURRENT";
  const remaining = daysUntil(due, input.now);
  if (remaining <= 0) return "OVERDUE";
  if (remaining <= 30) return "DUE_SOON";
  if (remaining <= 90) return "UPCOMING";
  return "CURRENT";
}

export function nextActionForStatus(status: ObligationStatus): string {
  switch (status) {
    case "OVERDUE": return "Start renewal now";
    case "DUE_SOON": return "Prepare renewal filing";
    case "UPCOMING": return "Review renewal requirements";
    case "NEEDS_ATTENTION": return "Review extracted information";
    case "MISSING": return "Upload current evidence";
    case "UNKNOWN": return "Enter date or upload evidence";
    case "IN_PROGRESS": return "Continue filing";
    case "COMPLETED": return "View filing record";
    default: return "No action required";
  }
}
