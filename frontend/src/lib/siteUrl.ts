// Single source of truth for the app's absolute URL. Used for any auth flow
// that bakes a redirect into an outbound message (magic-link emails, OAuth
// state). Must NEVER rely on window.location.origin alone because emails are
// generated server-side at Supabase and the deep-linked URL is fixed.
//
// Resolution order:
//   1. NEXT_PUBLIC_SITE_URL (explicit override — set this on Railway for prod)
//   2. Production default: www.getsmartpr.com
//   3. Development default: http://localhost:3000

const PROD_DEFAULT = "https://www.getsmartpr.com";
const DEV_DEFAULT = "http://localhost:3000";

export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  return process.env.NODE_ENV === "production" ? PROD_DEFAULT : DEV_DEFAULT;
}

/** OAuth / magic-link: go through /auth/callback so the server can exchange the code. */
export function authRedirectUrl(nextPath: string): string {
  const safeNext = nextPath && nextPath.startsWith("/") ? nextPath : "/";
  return `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(safeNext)}`;
}

/**
 * Email verification: the confirmation link must land on the LOGIN page, not
 * drop the user straight into the app. Goes through /auth/callback so the
 * server can consume the token; the callback then signs the user out and
 * redirects to /auth/login?verified=1 (preserving the post-login destination).
 */
export function verificationRedirectUrl(nextPath: string, inviteToken?: string): string {
  const safeNext = nextPath && nextPath.startsWith("/") ? nextPath : "/";
  let loginNext = `/auth/login?verified=1&next=${encodeURIComponent(safeNext)}`;
  if (inviteToken) loginNext += `&invite=${encodeURIComponent(inviteToken)}`;
  return `${getSiteUrl()}/auth/callback?next=${encodeURIComponent(loginNext)}`;
}

/**
 * Password recovery must NOT use the server /auth/callback route as redirectTo.
 * Implicit recovery links put tokens in the URL hash; servers never see the hash.
 * Point straight at the client reset page so tokens can be consumed in-browser.
 */
export function passwordResetRedirectUrl(): string {
  return `${getSiteUrl()}/auth/reset`;
}
