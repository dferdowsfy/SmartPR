# Compliance Reminders — Build Spec

**Status:** Draft for review · **Date:** 2026-09-14
**Decision:** Email only. Tiered cadence 60 / 30 / 7 days. Covers renewals/refilings AND stalled in-progress filings. Gated to paid tiers.

## 1. Objective

Turn the compliance calendar from a passive view into a retention engine: users get email reminders before renewable deadlines lapse, and nudges when a filing stalls. The checklist brings users in; reminders keep them paying.

## 2. Reminder types & cadence

| Trigger | Tiers | Notes |
|---|---|---|
| Renewable deadline approaching | 60 days, 30 days, 7 days before `deadline_date` | Lead times overridable per requirement (e.g. inspection-heavy renewals get 90 days) |
| Stalled filing | 14 days of no activity on an `in_progress` requirement | Max one nudge per requirement per 14 days |

No SMS/WhatsApp in this phase — email only.

## 3. Data model

### 3a. Graph: renewal cadence (the long pole)

Only ~42 of 3,100+ KB records mention renewal/expiry today. Add to requirement/document records:

- `renewal_cadence`: `annual` | `biennial` | `one_time` | `per_event` | `unknown`
- `reminder_lead_days`: override array, default `[60, 30, 7]`
- `renewal_source`: URL or citation for the cadence claim

**Honesty rule:** never invent a cadence. Every value needs an authoritative source (agency page, reglamento). `unknown` means "emits no reminders." Authoring priority: P0 high-frequency requirements first — Patente Municipal, Bomberos fire cert, CFSE, Permiso Único, Hacienda merchant registration, DTRH employer registration.

### 3b. Per-user deadlines (new Supabase table `compliance_deadlines`)

- `user_id`, `business_id`, `requirement_code` / `document_id`
- `deadline_date` (date), `cadence` (copied from graph at creation)
- `source`: `user_entered` | `graph_default` | `doc_extract`
- `is_estimate` (bool) — provisional dates are labeled as estimates in the email
- `status`: `active` | `completed` | `lapsed`

**Capture points:**
1. Intake — for requirements the graph marks renewable, ask "when does your current X expire?" (date picker, optional, "I don't know" allowed).
2. Settings/compliance page — editable deadline list per business.
3. (Phase 3) Document upload — extract expiry dates from uploaded docs, user confirms.

**"I don't know" policy (confirmed 2026-09-14):** expiry reminders are sent ONLY when the system has a stored expiry date for that requirement. No date = no reminders, no silent estimates. A wrong reminder destroys trust.

### 3c. Sent-reminder log (`reminder_log`)

- `deadline_id`, `tier` (`60`/`30`/`7`/`stalled`), `sent_at`
- Unique constraint on (`deadline_id`, `tier`) → idempotent sends.

## 4. Reminder engine (daily cron)

- Runs daily ~8:00am ET.
- Query: `compliance_deadlines` where `deadline_date - today ∈ {60,30,7}` (per-requirement overrides), `status = active`, no matching `reminder_log` row, user opted in, plan allows.
- Stalled: requirements `in_progress` with `updated_at < now() - 14 days`, no nudge in last 14 days.
- Sends via the email path (§5), writes `reminder_log` rows.
- Honors: per-business email toggle, global unsubscribe.

## 5. Email

- **Transport (now):** existing Google Workspace Gmail SMTP (same path as verification mail). Watch the ~2,000/day Workspace sending limit; plan the move to Resend/SendGrid before scale.
- **Sender:** alerts@getsmartpr.com (confirmed 2026-09-14).
- **Templates (EN + Puerto Rican Spanish):**
  - 60-day: "upcoming" — requirement, agency, deadline date, what to prepare, deep link.
  - 30-day: "due soon" — same + checklist of evidence still missing.
  - 7-day: "urgent" — same + what happens if it lapses (from graph `why_needed`).
  - Stalled: "pick up where you left off" — requirement, last activity, deep link to resume.
- Every email: one clear CTA (deep link into the app), unsubscribe link, "this is an estimate" banner when `is_estimate`.

## 6. Paywall gating

| Plan | Reminders |
|---|---|
| Free | None (calendar is view-only) |
| Core | 1 business, email |
| Operator | All businesses — the deadline radar |
| Partner | Per client workspace |
| Enterprise/Pilot | Custom |

Enforcement: cron query joins `workspace_subscriptions.plan`; free workspaces are skipped.

## 7. UX changes

- Compliance calendar: badges on requirements with active reminders ("reminds in 23 days").
- Settings → Notifications: email on/off globally, per business, per requirement (mute one noisy renewal).
- Intake: expiry-date question appears only for graph-confirmed renewable requirements.

## 8. Open questions for Darius

1. ~~"I don't know my expiry date" — hard skip (default), or provisional estimate from requirement-completion date, clearly labeled?~~ **Decided 2026-09-14: hard skip — reminders only when a stored expiry date exists.**
2. ~~Sender identity: notifications@getsmartpr.com, or his name?~~ **Decided 2026-09-14: alerts@getsmartpr.com.**
3. Stalled-filing nudge: 14 days right, or 7?

## 9. Phased rollout

- **Phase 1:** tables, cron, email templates + opt-out, settings toggles, seed sourced renewal cadences for top ~20 requirements.
- **Phase 2:** intake expiry-date capture, calendar reminder badges.
- **Phase 3:** expiry extraction from uploaded documents (AI-suggested, user-confirmed).
