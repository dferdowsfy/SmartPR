-- SmartPR Supabase email path (2026-09-20).
--
-- Replaces the unconfigured Railway SMTP / unverified Resend wiring in the
-- app servers with a database-driven outbox:
--
--   app code  ->  INSERT INTO email_outbox  ->  pg_cron (every minute)
--             ->  edge function `email-sender`  ->  Resend API  ->  inbox
--
-- Senders: lead alerts, voice call recaps, compliance reminders.
-- Reminder cadences and expiry-date rules are untouched — only the delivery
-- route changes.
--
-- This migration also carries the voice auto-recap columns
-- (data/voice_auto_recap_schema.sql was never applied): the recap sweep
-- needs them to decide what to enqueue.
--
-- Idempotent: safe to re-run. Production DDL requires Darius's approval
-- (granted 2026-09-20 via the "move email senders to Supabase" go-ahead).

BEGIN;

-- ---------------------------------------------------------------------------
-- Outbox
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_outbox (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_key  TEXT NOT NULL CHECK (sender_key IN ('lead_alert', 'voice_recap', 'compliance_reminder')),
  from_addr   TEXT NOT NULL,
  to_addr     TEXT NOT NULL,
  subject     TEXT NOT NULL,
  text_body   TEXT NOT NULL,
  html_body   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_due
  ON public.email_outbox (status, next_attempt_at)
  WHERE status = 'pending';

-- Service-role only: the app inserts with the service-role key, the edge
-- function drains with the service-role key. No public access.
ALTER TABLE public.email_outbox ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Claim helper: atomically claim due rows so concurrent drains never
-- double-send. Called by the edge function via the service-role key.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_pending_emails(batch_size INTEGER DEFAULT 25)
RETURNS SETOF public.email_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT id
      FROM public.email_outbox
     WHERE status = 'pending'
       AND attempts < 5
       AND next_attempt_at <= now()
     ORDER BY created_at ASC
     LIMIT batch_size
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.email_outbox o
     SET attempts = o.attempts + 1
    FROM claimed c
   WHERE o.id = c.id
  RETURNING o.*;
END;
$$;

-- ---------------------------------------------------------------------------
-- Voice auto-recap columns (from data/voice_auto_recap_schema.sql, never
-- applied until now).
-- ---------------------------------------------------------------------------
ALTER TABLE public.voice_access
  ADD COLUMN IF NOT EXISTS auto_recap_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE public.voice_sessions
  ADD COLUMN IF NOT EXISTS recap_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_voice_sessions_recap_pending
  ON public.voice_sessions (expires_at)
  WHERE recap_sent_at IS NULL;

-- ---------------------------------------------------------------------------
-- New-user signup monitor (owner request 2026-09-20).
--
-- A trigger on public.users enqueues a founder alert into email_outbox for
-- every genuinely new user row. The app-level signup notifies in
-- frontend/src/lib/leads.ts (convertLeadForUser) were retired in favor of
-- this trigger so a signup can never double-notify. Lead-capture events
-- ("New lead started the assessment") stay in app code — no user row
-- exists yet when those fire.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.html_escape(s TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT replace(replace(replace(replace(replace(
    coalesce(s, ''),
    '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;')
$$;

CREATE OR REPLACE FUNCTION public.notify_new_user_signup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject   TEXT;
  v_source    TEXT;
  v_lead      BOOLEAN;
  v_parts     TEXT[];
  v_first     TEXT;
  v_last      TEXT;
  v_email     TEXT;
  v_when      TEXT;
  v_text      TEXT;
  v_html      TEXT;
BEGIN
  -- Was this email previously captured as a landing-page lead?
  SELECT EXISTS (
    SELECT 1 FROM public.leads
     WHERE lower(email) = lower(NEW.email)
       AND notified_at IS NOT NULL
  ) INTO v_lead;

  IF v_lead THEN
    v_subject := 'Lead converted to signup';
    v_source  := 'Started as a landing-page lead, now created an account.';
  ELSE
    v_subject := 'New signup';
    v_source  := 'Signed up directly (no prior lead capture).';
  END IF;

  v_parts := string_to_array(trim(coalesce(NEW.name, '')), ' ');
  v_first := COALESCE(NULLIF(v_parts[1], ''), '—');
  v_last  := CASE
               WHEN array_length(v_parts, 1) > 1
               THEN array_to_string(v_parts[2:array_length(v_parts, 1)], ' ')
               ELSE '—'
             END;
  v_email := COALESCE(NULLIF(trim(coalesce(NEW.email, '')), ''), '—');
  v_when  := to_char(
               COALESCE(NEW.created_at, now()) AT TIME ZONE 'America/New_York',
               'Mon DD, YYYY HH12:MI AM'
             ) || ' ET';

  v_text := '[SmartPR] ' || v_subject || E'\n\n'
         || 'First name: ' || v_first || E'\n'
         || 'Last name: '  || v_last  || E'\n'
         || 'Email: '      || v_email || E'\n'
         || 'Signed up: '  || v_when  || E'\n'
         || 'Source: '     || v_source;

  -- Branded design matching the app's buildAlertHtml.
  v_html := '<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f2f5f7;">'
         || '<div style="max-width:560px;margin:0 auto;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,Helvetica,Arial,sans-serif;">'
         || '<div style="background:#0f2a43;border-radius:12px 12px 0 0;padding:20px 24px;">'
         || '<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.2px;">SmartPR</div>'
         || '<div style="color:#9fb4c7;font-size:14px;margin-top:2px;">' || public.html_escape(v_subject) || '</div>'
         || '</div>'
         || '<div style="background:#ffffff;border-radius:0 0 12px 12px;padding:8px 12px 16px;">'
         || '<table role="presentation" style="width:100%;border-collapse:collapse;">'
         || '<tr><td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#5b6b7b;font-size:13px;width:38%;vertical-align:top;">First name</td>'
         || '<td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#12212f;font-size:13px;vertical-align:top;">' || public.html_escape(v_first) || '</td></tr>'
         || '<tr><td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#5b6b7b;font-size:13px;width:38%;vertical-align:top;">Last name</td>'
         || '<td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#12212f;font-size:13px;vertical-align:top;">' || public.html_escape(v_last) || '</td></tr>'
         || '<tr><td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#5b6b7b;font-size:13px;width:38%;vertical-align:top;">Email</td>'
         || '<td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#12212f;font-size:13px;vertical-align:top;">' || public.html_escape(v_email) || '</td></tr>'
         || '<tr><td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#5b6b7b;font-size:13px;width:38%;vertical-align:top;">Signed up</td>'
         || '<td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#12212f;font-size:13px;vertical-align:top;">' || public.html_escape(v_when) || '</td></tr>'
         || '<tr><td style="padding:10px 12px;color:#5b6b7b;font-size:13px;width:38%;vertical-align:top;">Source</td>'
         || '<td style="padding:10px 12px;color:#12212f;font-size:13px;vertical-align:top;">' || public.html_escape(v_source) || '</td></tr>'
         || '</table></div>'
         || '<div style="color:#8a99a8;font-size:12px;text-align:center;margin-top:12px;">Sent automatically by SmartPR founder alerts</div>'
         || '</div></body></html>';

  INSERT INTO public.email_outbox (sender_key, from_addr, to_addr, subject, text_body, html_body)
  VALUES ('lead_alert',
          'SmartPR <alerts@getsmartpr.com>',
          'dferdows@gmail.com',
          '[SmartPR] ' || v_subject,
          v_text,
          v_html);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_new_signup ON public.users;
CREATE TRIGGER trg_users_new_signup
  AFTER INSERT ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_new_user_signup();

COMMIT;
