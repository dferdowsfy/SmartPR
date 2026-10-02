import assert from "node:assert/strict";
import test from "node:test";
import { addMonthsClamped, deriveObligationStatus, subtractDays, validDateOnly } from "./dates";

const NOW = new Date("2026-08-17T12:00:00.000Z");

test("due-date status windows are application defaults, not invented deadlines", () => {
  assert.equal(deriveObligationStatus({ dueDate: "2026-11-15", evidenceState: "VERIFIED", expectsRenewal: true, now: NOW }), "UPCOMING");
  assert.equal(deriveObligationStatus({ dueDate: "2026-09-14", evidenceState: "VERIFIED", expectsRenewal: true, now: NOW }), "DUE_SOON");
  assert.equal(deriveObligationStatus({ dueDate: "2026-08-15", evidenceState: "VERIFIED", expectsRenewal: true, now: NOW }), "OVERDUE");
  assert.equal(deriveObligationStatus({ dueDate: "2026-08-17", evidenceState: "VERIFIED", expectsRenewal: true, now: NOW }), "OVERDUE");
});

test("unknown renewal dates remain unknown", () => {
  assert.equal(deriveObligationStatus({ evidenceState: "VERIFIED", expectsRenewal: true, now: NOW }), "UNKNOWN");
  assert.equal(deriveObligationStatus({ evidenceState: "VERIFIED", expectsRenewal: false, now: NOW }), "CURRENT");
  assert.equal(deriveObligationStatus({ evidenceState: "NONE", now: NOW }), "MISSING");
  assert.equal(deriveObligationStatus({ currentStatus: "UNKNOWN", evidenceState: "NONE", now: NOW }), "UNKNOWN");
});

test("recurrence uses an explicit cadence and clamps month ends", () => {
  assert.equal(addMonthsClamped("2024-01-31", 1), "2024-02-29");
  assert.equal(addMonthsClamped("2025-01-31", 1), "2025-02-28");
  assert.equal(addMonthsClamped("2026-11-15", 12), "2027-11-15");
  assert.equal(addMonthsClamped("2026-11-15", 0), null);
});

test("date-only validation and reminder subtraction are deterministic", () => {
  assert.equal(validDateOnly("2026-02-29"), null);
  assert.equal(validDateOnly("2028-02-29"), "2028-02-29");
  assert.equal(subtractDays("2026-11-15", 90), "2026-08-17");
});

test("normalizeReminderDays: defaults, filtering, order, empty", async () => {
  const { normalizeReminderDays } = await import("./dates");
  assert.deepEqual(normalizeReminderDays(null), [60, 30, 7]);
  assert.deepEqual(normalizeReminderDays([7, 90, 7, 0, 5, "30"]), [90, 7, 0]);
  assert.deepEqual(normalizeReminderDays([]), []);
});
