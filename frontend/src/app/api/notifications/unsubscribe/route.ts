// One-click unsubscribe for compliance-reminder emails.
// GET /api/notifications/unsubscribe?token=<signed>
// The token is HMAC-signed (see src/lib/compliance-reminders.ts), so no
// login is required — this is the link in every reminder email footer.
import { getPool } from "../../../graph/db";
import { verifyUnsubscribeToken } from "../../../../lib/compliance-reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function page(lang: "en" | "es", ok: boolean): Response {
  const title = lang === "es" ? "Recordatorios desactivados" : "Reminders turned off";
  const body = ok
    ? lang === "es"
      ? "Ya no recibirás recordatorios de vencimiento por email. Puedes reactivarlos cuando quieras desde Configuración → Notificaciones."
      : "You won't receive deadline reminder emails anymore. You can turn them back on anytime from Settings → Notifications."
    : lang === "es"
      ? "Este enlace no es válido. Revisa tu configuración de notificaciones dentro de la aplicación."
      : "This link isn't valid. Check your notification settings inside the app.";
  return new Response(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SmartPR</title></head>` +
      `<body style="margin:0;background:#f2f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">` +
      `<div style="max-width:480px;margin:64px auto;padding:32px;background:#fff;border-radius:16px;text-align:center;">` +
      `<div style="font-size:20px;font-weight:800;color:#0f2a43;margin-bottom:12px;">SmartPR</div>` +
      `<div style="font-size:16px;font-weight:700;color:#12212f;margin-bottom:8px;">${title}</div>` +
      `<p style="font-size:14px;color:#5b6b7b;line-height:1.5;">${body}</p></div></body></html>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const lang = url.searchParams.get("lang") === "es" ? "es" : "en";
  const userId = verifyUnsubscribeToken(token);
  if (!userId) return page(lang, false);
  const pool = getPool();
  if (!pool) return page(lang, false);
  await pool.query(
    `INSERT INTO notification_preferences (user_id, scope, channel, muted, updated_at)
     VALUES ($1, 'global', 'EMAIL', true, now())
     ON CONFLICT (user_id, scope, business_id, obligation_id, channel)
     DO UPDATE SET muted = true, updated_at = now()`,
    [userId]
  );
  // Cancel any still-pending email reminders for this user.
  await pool.query(
    `UPDATE notifications SET status = 'CANCELLED'
      WHERE user_id = $1 AND channel = 'EMAIL' AND status = 'PENDING'`,
    [userId]
  );
  return page(lang, true);
}
