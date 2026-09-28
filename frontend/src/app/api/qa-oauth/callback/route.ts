/**
 * GET /api/qa-oauth/callback — TEMPORARY QA setup helper.
 *
 * Google retired the copy-paste (OOB) OAuth flow, so the one-time Gmail
 * consent for QA OTP assist redirects here with ?code=. This page just shows
 * the code for copy-paste back into chat; the token exchange happens
 * off-server. DELETE THIS ROUTE once QA_GOOGLE credentials are wired.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const body = error
    ? `<h1>Authorization failed</h1><p>Google returned: <code>${esc(error)}</code>. Go back and try again.</p>`
    : code
      ? `<h1>Copy this code back to chat</h1><p>Paste it to Kavi — it expires in a few minutes.</p><pre style="font-size:22px;padding:16px;background:#f4f4f5;border-radius:8px;user-select:all">${esc(code)}</pre>`
      : `<h1>Nothing to show</h1><p>Open this page via the Google consent link.</p>`;
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>SmartPR QA setup</title></head><body style="font-family:system-ui;max-width:640px;margin:64px auto;padding:0 24px">${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
