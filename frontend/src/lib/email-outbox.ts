// SmartPR Supabase email path — app-side enqueue.
//
// Production email delivery no longer happens in the app servers. Instead,
// senders enqueue into the `email_outbox` table and the Supabase
// `email-sender` edge function (driven by pg_cron) delivers through Resend.
//
// This module is the ONLY way app code puts mail into the outbox. Enqueue
// is fire-and-forget: it never throws and never blocks the user flow. A
// failed enqueue is logged loudly — a missing row means the founder hears
// nothing.

import { createClient } from "@supabase/supabase-js";

export type EmailSenderKey = "lead_alert" | "voice_recap" | "compliance_reminder";

export interface EnqueueEmailOptions {
  senderKey: EmailSenderKey;
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Enqueue one email for delivery via the Supabase email path.
 * Returns true when the row was accepted; false when enqueue was
 * impossible (missing config) or the insert failed. Never throws.
 */
export async function enqueueEmail(opts: EnqueueEmailOptions): Promise<boolean> {
  if (!opts.to || !opts.to.includes("@")) return false;
  const client = serviceClient();
  if (!client) {
    console.error("[email-outbox] skipped: Supabase service credentials are not set");
    return false;
  }
  try {
    const { error } = await client.from("email_outbox").insert({
      sender_key: opts.senderKey,
      from_addr: opts.from,
      to_addr: opts.to,
      subject: opts.subject,
      text_body: opts.text,
      html_body: opts.html ?? null,
    });
    if (error) {
      console.error(`[email-outbox] enqueue failed (${opts.senderKey}):`, error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[email-outbox] enqueue failed (${opts.senderKey}):`, (err as Error)?.message || err);
    return false;
  }
}
