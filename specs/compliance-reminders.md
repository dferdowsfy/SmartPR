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

## 10. Monthly digest email — "proactive compliance officer" (revised 2026-09-14)

**Decision 2026-09-14:** the digest is a personalized monthly compliance briefing, not a deadline list. It behaves like a proactive compliance officer for each business.

### Branding
Follow getsmartpr.com: warm paper background `#f4f1ea`, ink `#161616`, brand deep teal `#245c5c`, IBM Plex Sans. Voice: plain, direct, warm — "we make it easy," never bureaucratic. Spanish = boricua Spanish.

### Email structure
Header: **SMARTPR MONTHLY COMPLIANCE DIGEST** — [Business] — [Month Year].

1. **Executive summary** (2–3 sentences, generated from counts): "You have 2 actions requiring attention, 3 requirements approaching within 90 days, and 1 regulatory development that may affect your operation."
2. **ACTION REQUIRED** (only when relevant). Per item: requirement, agency, due date/days remaining, what needs to happen, why it applies, risk of missing it, CTA "Review Requirement."
3. **COMING UP**: group 30/60/90 days; explain what preparation should begin *now*, not just dates.
4. **WHAT CHANGED**: regulatory developments from the pre-email check (§10a) — what changed, effective date, why it affects this business, recommended action, source, confidence. Fallback when none: "No material regulatory changes affecting your SmartPR profile were identified this month."
5. **SMARTPR NEEDS FROM YOU**: missing evidence, unknown expiration dates, info needed to determine applicability. Never invent a date — surface the gap.
6. **COMPLIANCE HEALTH**: e.g. "87% Current — 12 requirements current, 3 upcoming actions, 1 needs verification, 0 critical overdue." CTA "Open Compliance Center."

Health score (explainable): `current / total applicable`, where current = obligation neither overdue, nor due within 30 days, nor missing required evidence, nor flagged needs-verification.

### 10a. Fresh regulatory check (before every digest)
- A monthly regulatory scan runs BEFORE digest generation: reviews authoritative PR sources (OGPe, Hacienda/SURI, Dept of State, DRNA, Bomberos, Salud, DTRH, municipalities, CTPR, relevant leyes/reglamentos) for developments since the previous digest: agency announcements, law/regulation changes, municipal requirements, permit/license changes, forms/fees/procedures, deadlines/renewal rules, enforcement announcements, incentive/program changes.
- Findings stored in `regulatory_developments`: title, summary, source name + URL, published date, effective date, affected requirement codes, applicability notes, confidence (high/medium/low). Primary government sources required; news/media may tip off a development but material findings must be verified against an authoritative source.
- Digest matches developments against the knowledge graph + business profile (business type, activities, municipality, facilities, employees, vehicles). **Only surface a development when SmartPR can explain why it affects or may affect THIS business.** No generic PR news.
- Every WHAT CHANGED item carries: source, date, affected requirement, applicability reasoning, confidence.

### Language
Full user preference: the entire email — explanations, CTAs, everything — renders in the user's selected language (English or Puerto Rican Spanish).

### Applicability labels
Every obligation/finding labeled: **Confirmed** / **Likely — verify** / **Conditional** / Not applicable (never shown). Labels visible in the email where they aid decisions.

### Guardrails
- Never invent deadlines, expiration dates, regulatory changes, or applicability.
- Every finding traces to the knowledge graph and/or a cited authoritative source.
- Do NOT hard-code the OAFA example (or any business) into production logic.
- Prioritize by: deadline proximity, operational/shutdown risk, penalty, preparation lead time, confidence.
- Readable in under 2 minutes. After reading, the user knows: what do I need to do? what is coming? what changed? what is SmartPR missing?

### Gating, schedule, opt-outs
Unchanged from v1: monthly 1st 8:00am ET, paid tiers only (Core = 1 business, Operator = all, Partner = per client), separate digest opt-out + global unsubscribe. Cron endpoints still need host scheduling (daily + monthly).

## 9. Phased rollout (updated)

- **Phase 1:** tables, cron, email templates + opt-out, settings toggles, seed sourced renewal cadences for top ~20 requirements.
- **Phase 2:** intake expiry-date capture, calendar reminder badges.
- **Phase 3:** expiry extraction from uploaded documents (AI-suggested, user-confirmed).
