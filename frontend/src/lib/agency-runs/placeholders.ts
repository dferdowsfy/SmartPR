/** Solid-color SVG data URLs used as placeholder "browser screenshots". */

function svgDataUrl(bg: string, title: string, subtitle: string): string {
  const t = escapeXml(title);
  const s = escapeXml(subtitle);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <rect width="1280" height="800" fill="${bg}"/>
  <rect x="0" y="0" width="1280" height="48" fill="#1e293b"/>
  <circle cx="28" cy="24" r="7" fill="#f87171"/>
  <circle cx="52" cy="24" r="7" fill="#fbbf24"/>
  <circle cx="76" cy="24" r="7" fill="#4ade80"/>
  <text x="110" y="30" fill="#e2e8f0" font-family="ui-sans-serif,system-ui,sans-serif" font-size="14">suri.hacienda.pr.gov — SmartPR agency assistant (mock)</text>
  <rect x="40" y="80" width="1200" height="680" rx="12" fill="#ffffff" fill-opacity="0.92"/>
  <text x="640" y="360" text-anchor="middle" fill="#0f172a" font-family="ui-sans-serif,system-ui,sans-serif" font-size="36" font-weight="700">${t}</text>
  <text x="640" y="410" text-anchor="middle" fill="#475569" font-family="ui-sans-serif,system-ui,sans-serif" font-size="20">${s}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const PLACEHOLDER_SHOTS = {
  home: svgDataUrl("#0f766e", "SURI home", "Opening portal (allowlisted domain)"),
  register: svgDataUrl("#0e7490", "Create SURI Logon", "Registration path selected"),
  taxpayerId: svgDataUrl("#1d4ed8", "Taxpayer ID", "Sensitive fields — human confirms"),
  info: svgDataUrl("#4338ca", "Taxpayer information", "Prefill from Business Passport"),
  address: svgDataUrl("#6d28d9", "Name & address", "Verify Address required"),
  upload: svgDataUrl("#b45309", "Attachments", "USER_UPLOAD — max 5 MB per file"),
  login: svgDataUrl("#be123c", "SURI login / MFA", "USER_LOGIN — credentials stay with you"),
  captcha: svgDataUrl("#7c2d12", "CAPTCHA", "Human challenge — pause"),
  review: svgDataUrl("#065f46", "Pre-submit review", "Agent never clicks final submit"),
  stopped: svgDataUrl("#334155", "Run stopped", "Assistant halted by user"),
} as const;
