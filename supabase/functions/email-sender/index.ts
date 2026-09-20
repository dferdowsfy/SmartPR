// ============================================================================
// SmartPR — email-sender (Supabase Edge Function)
//
// Drains the `email_outbox` table and delivers each row through the Resend
// API. Driven by pg_cron once a minute:
//
//   app code  ->  INSERT INTO email_outbox  ->  pg_cron  ->  this function
//             ->  Resend API  ->  inbox
//
// This is the ONLY production email delivery path for lead alerts, voice
// call recaps, and compliance reminders. The app servers never touch SMTP
// or provider APIs directly — they only enqueue.
//
// Required secrets (set once via `supabase secrets set`):
//   RESEND_API_KEY      — Resend API key; getsmartpr.com must be a verified
//                         sending domain in Resend for alerts@ / recap@.
//   EMAIL_SENDER_SECRET — shared secret the pg_cron job presents in the
//                         Authorization header. Pick a long random value.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// Safety rules:
// - Rows are claimed with FOR UPDATE SKIP LOCKED (see
//   public.claim_pending_emails), so concurrent invocations never
//   double-send.
// - A row is retried at most 5 times with exponential backoff
//   (2^attempts minutes); afterwards it is marked failed with the last
//   error recorded. Nothing is silently dropped: failures stay visible
//   in email_outbox.
// - Only recipients the product already emails are ever enqueued — this
//   function sends whatever is in the outbox, so enqueue discipline
//   lives in the app code.
// ============================================================================

import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const EMAIL_SENDER_SECRET = Deno.env.get("EMAIL_SENDER_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const MAX_ATTEMPTS = 5;

interface OutboxRow {
  id: string;
  sender_key: string;
  from_addr: string;
  to_addr: string;
  subject: string;
  text_body: string;
  html_body: string | null;
  attempts: number;
}

function backoffMinutes(attempts: number): number {
  // attempts is already incremented by claim_pending_emails, so the first
  // retry waits 2 minutes, then 4, 8, 16…
  return Math.pow(2, Math.min(attempts, 6));
}

async function sendViaResend(row: OutboxRow): Promise<{ ok: boolean; error?: string; resendId?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: row.from_addr,
        to: row.to_addr,
        subject: row.subject,
        text: row.text_body,
        ...(row.html_body ? { html: row.html_body } : {}),
      }),
      signal: controller.signal,
    });
    const body = await res.text().catch(() => "");
    if (!res.ok) {
      return { ok: false, error: `resend ${res.status}: ${body.slice(0, 300)}` };
    }
    let resendId = "";
    try {
      resendId = (JSON.parse(body) as { id?: string }).id ?? "";
    } catch {
      /* non-JSON success body — ignore */
    }
    return { ok: true, resendId };
  } catch (err) {
    return { ok: false, error: `resend request failed: ${(err as Error)?.message || err}` };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const auth = req.headers.get("Authorization") ?? "";
  if (!EMAIL_SENDER_SECRET || auth !== `Bearer ${EMAIL_SENDER_SECRET}`) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "resend_not_configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: claimed, error: claimError } = await supabase.rpc("claim_pending_emails", {
    batch_size: 25,
  });
  if (claimError) {
    console.error("[email-sender] claim failed:", claimError.message);
    return new Response(JSON.stringify({ error: "claim_failed", detail: claimError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rows = (claimed ?? []) as OutboxRow[];
  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const row of rows) {
    const result = await sendViaResend(row);
    if (result.ok) {
      const { error } = await supabase
        .from("email_outbox")
        .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
        .eq("id", row.id);
      if (error) console.error(`[email-sender] mark-sent failed for ${row.id}:`, error.message);
      else sent += 1;
    } else if (row.attempts >= MAX_ATTEMPTS) {
      const { error } = await supabase
        .from("email_outbox")
        .update({ status: "failed", last_error: result.error ?? "unknown error" })
        .eq("id", row.id);
      if (error) console.error(`[email-sender] mark-failed failed for ${row.id}:`, error.message);
      else failed += 1;
      console.error(`[email-sender] ${row.sender_key} to ${row.to_addr} failed permanently:`, result.error);
    } else {
      const nextAttempt = new Date(Date.now() + backoffMinutes(row.attempts) * 60_000).toISOString();
      const { error } = await supabase
        .from("email_outbox")
        .update({ next_attempt_at: nextAttempt, last_error: result.error ?? "unknown error" })
        .eq("id", row.id);
      if (error) console.error(`[email-sender] backoff update failed for ${row.id}:`, error.message);
      else retried += 1;
    }
  }

  return new Response(JSON.stringify({ claimed: rows.length, sent, retried, failed }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
