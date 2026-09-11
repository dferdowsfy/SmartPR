// ============================================================================
// SmartPR — rich "new signup" founder alert (Supabase Edge Function)
//
// Replaces the thin "SmartPR Alerts" notifier. Paste this file into the
// Supabase dashboard: Edge Functions -> signup-alert -> Code, replacing the
// existing code. It is already wired to the Send Email auth hook, so no
// re-wiring is needed.
//
// What it sends (HTML, same design as the app's own alerts):
//   First name / Last name (from auth metadata) / Email / Signed up (ET) /
//   plus the user's latest business if one exists (name, type, industry,
//   municipality, link).
//
// Required secrets (run once):
//   supabase secrets set GMAIL_SMTP_APP_PASSWORD="xxxx xxxx xxxx xxxx"
//   (a Google app password for darius@getsmartpr.com — the same kind of
//   credential the web app uses; never commit it)
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
// ============================================================================

import nodemailer from "npm:nodemailer@6.9.14";
import { createClient } from "jsr:@supabase/supabase-js@2";

const FOUNDER_EMAIL = "dferdows@gmail.com";
const SMTP_USER = "darius@getsmartpr.com";
const MAIL_FROM = "SmartPR <darius@getsmartpr.com>";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}

function splitName(meta: Record<string, unknown>): { first: string; last: string } {
  const first = typeof meta.first_name === "string" ? meta.first_name.trim() : "";
  const last = typeof meta.last_name === "string" ? meta.last_name.trim() : "";
  if (first || last) return { first, last };
  const full =
    (typeof meta.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta.name === "string" && meta.name.trim()) ||
    "";
  if (full) {
    const parts = full.split(/\s+/);
    return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
  }
  return { first: "", last: "" };
}

function easternTime(iso: string): string {
  try {
    return (
      new Date(iso).toLocaleString("en-US", {
        timeZone: "America/New_York",
        dateStyle: "medium",
        timeStyle: "short",
      }) + " ET"
    );
  } catch {
    return iso;
  }
}

function buildAlertHtml(subject: string, fields: Record<string, string>): string {
  const rows = Object.entries(fields)
    .map(
      ([k, v]) =>
        `<tr>` +
        `<td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#5b6b7b;font-size:13px;width:38%;vertical-align:top;">${escapeHtml(k)}</td>` +
        `<td style="padding:10px 12px;border-bottom:1px solid #eef1f4;color:#12212f;font-size:13px;vertical-align:top;">${escapeHtml(v)}</td>` +
        `</tr>`,
    )
    .join("");
  return (
    `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f2f5f7;">` +
    `<div style="max-width:560px;margin:0 auto;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">` +
    `<div style="background:#0f2a43;border-radius:12px 12px 0 0;padding:20px 24px;">` +
    `<div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.2px;">SmartPR</div>` +
    `<div style="color:#9fb4c7;font-size:14px;margin-top:2px;">${escapeHtml(subject)}</div>` +
    `</div>` +
    `<div style="background:#ffffff;border-radius:0 0 12px 12px;padding:8px 12px 16px;">` +
    `<table role="presentation" style="width:100%;border-collapse:collapse;">${rows}</table>` +
    `</div>` +
    `<div style="color:#8a99a8;font-size:12px;text-align:center;margin-top:12px;">Sent automatically by SmartPR founder alerts</div>` +
    `</div></body></html>`
  );
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const user = (payload?.user ?? {}) as {
      id?: string;
      email?: string;
      created_at?: string;
      user_metadata?: Record<string, unknown>;
    };
    const meta = user.user_metadata ?? {};
    const { first, last } = splitName(meta);

    const fields: Record<string, string> = {
      "First name": first || "—",
      "Last name": last || "—",
      Email: (user.email ?? "").trim().toLowerCase(),
      "Signed up": user.created_at ? easternTime(user.created_at) : "—",
    };

    // Best effort: if the user already has a business (hook fired late, or a
    // returning user), include it. At true signup time this is empty.
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      );
      const { data } = await supabase
        .from("businesses")
        .select("name,business_type,industry,municipality,public_id")
        .eq("user_id", user.id ?? "")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) {
        fields["Business name"] = (data.name as string) || "—";
        fields["Business type"] = (data.business_type as string) || "—";
        fields["Industry"] = (data.industry as string) || "—";
        fields["Municipality"] = (data.municipality as string) || "—";
        if (data.public_id) {
          fields["View in SmartPR"] = `https://www.getsmartpr.com/businesses/${data.public_id}`;
        }
      }
    } catch (lookupErr) {
      console.error("[signup-alert] business lookup failed:", lookupErr);
    }

    const subject = "New signup";
    const text = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
    const appPassword = Deno.env.get("GMAIL_SMTP_APP_PASSWORD") ?? "";
    if (!appPassword) {
      console.error("[signup-alert] skipped: GMAIL_SMTP_APP_PASSWORD secret is not set");
      return new Response(JSON.stringify({ ok: false, reason: "no_credential" }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: SMTP_USER, pass: appPassword.replace(/\s+/g, "") },
    });
    await transporter.sendMail({
      from: MAIL_FROM,
      to: FOUNDER_EMAIL,
      subject: `[SmartPR] ${subject}`,
      text: `[SmartPR] ${subject}\n\n${text}`,
      html: buildAlertHtml(subject, fields),
    });
    console.info(`[signup-alert] sent for ${fields["Email"]}`);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[signup-alert] failed:", err);
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
