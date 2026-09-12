import nodemailer from "nodemailer";
import { randomBytes } from "crypto";
import { getSiteUrl } from "./siteUrl";

const SMTP_USER = process.env.GMAIL_SMTP_USER || "darius@getsmartpr.com";
const MAIL_FROM = process.env.GMAIL_FROM || "SmartPR <darius@getsmartpr.com>";

export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function buildInviteEmailHtml(opts: {
  workspaceName: string;
  role: string;
  inviteUrl: string;
  inviterEmail: string;
}): string {
  const { workspaceName, role, inviteUrl, inviterEmail } = opts;
  return (
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head>` +
    `<body style="margin:0;padding:0;background-color:#f4f1ea;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f1ea;padding:32px 16px;">` +
    `<tr><td align="center">` +
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border:1px solid #e5e0d3;border-radius:12px;overflow:hidden;">` +
    `<tr><td style="height:4px;background-color:#245c5c;font-size:0;line-height:0;">&nbsp;</td></tr>` +
    `<tr><td style="padding:32px 40px 8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">` +
    `<div style="font-size:26px;font-weight:800;color:#245c5c;letter-spacing:-0.5px;">SmartPR</div>` +
    `<div style="font-size:13px;color:#6b6963;margin-top:2px;">Open and run your business in Puerto Rico</div>` +
    `</td></tr>` +
    `<tr><td style="padding:16px 40px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">` +
    `<h1 style="margin:0 0 12px;font-size:24px;line-height:1.3;color:#161616;font-weight:700;">You've been invited</h1>` +
    `<div style="font-size:16px;line-height:1.65;color:#3d3d3d;">` +
    `<p style="margin:0 0 12px;">${escapeHtml(inviterEmail)} invited you to join <strong>${escapeHtml(workspaceName)}</strong> on SmartPR as <strong>${escapeHtml(role)}</strong>.</p>` +
    `<p style="margin:0;">Click below to create your account (or sign in) and join the workspace. This invitation expires in 7 days.</p>` +
    `</div></td></tr>` +
    `<tr><td align="center" style="padding:24px 40px 4px;">` +
    `<a href="${inviteUrl}" style="display:inline-block;background-color:#245c5c;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;text-decoration:none;padding:14px 32px;border-radius:8px;">Accept invitation</a>` +
    `</td></tr>` +
    `<tr><td style="padding:20px 40px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#6b6963;">` +
    `Button not working? Paste this link into your browser:<br>` +
    `<a href="${inviteUrl}" style="color:#245c5c;word-break:break-all;">${inviteUrl}</a>` +
    `</td></tr>` +
    `<tr><td style="padding:28px 40px 32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-size:13px;line-height:1.6;color:#6b6963;border-top:1px solid #e5e0d3;margin-top:24px;">` +
    `<div style="margin-top:4px;">&copy; 2026 SmartPR &middot; <a href="https://www.getsmartpr.com" style="color:#245c5c;text-decoration:none;">getsmartpr.com</a></div>` +
    `</td></tr>` +
    `</table></td></tr></table></body></html>`
  );
}

export function inviteUrlForToken(token: string): string {
  return `${getSiteUrl()}/signup?invite=${encodeURIComponent(token)}`;
}

/** Best-effort: returns false when SMTP is not configured; never throws. */
export async function sendInviteEmail(to: string, html: string): Promise<boolean> {
  if (!process.env.GMAIL_SMTP_APP_PASSWORD) {
    console.error("[invite-email] skipped: GMAIL_SMTP_APP_PASSWORD is not set");
    return false;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: SMTP_USER, pass: process.env.GMAIL_SMTP_APP_PASSWORD },
    });
    await transporter.sendMail({
      from: MAIL_FROM,
      to,
      subject: "You've been invited to join a SmartPR workspace",
      html,
    });
    return true;
  } catch (e) {
    console.error("[invite-email] failed:", (e as Error).message);
    return false;
  }
}
