// Refreshes the Supabase auth session on every request and gates the
// authenticated areas of the app. Anonymous use of `/` continues to work.
// On trust.getsmartpr.com, `/` is rewritten to the public Trust Center.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED_PREFIXES = ["/dashboard", "/businesses", "/calendar", "/history", "/settings"];
const TRUST_HOST = "trust.getsmartpr.com";

function isTrustHost(req: NextRequest): boolean {
  const host = req.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
  return host === TRUST_HOST;
}

export async function middleware(req: NextRequest) {
  // Public Trust Center subdomain: serve /trust at the apex path.
  // /trust/* (including the security PDF) continues to resolve normally.
  if (isTrustHost(req)) {
    const path = req.nextUrl.pathname;
    if (path === "/" || path === "") {
      const url = req.nextUrl.clone();
      url.pathname = "/trust";
      return NextResponse.rewrite(url);
    }
    // Trust Center host is fully public (page + PDF under /trust/*).
    return NextResponse.next();
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Auth not configured -> all routes are open, no-op middleware.
  if (!url || !key) return NextResponse.next();

  let res = NextResponse.next({ request: req });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(toSet) {
        toSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;
  const needsAuth = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
  if (needsAuth && !data?.user) {
    const login = new URL("/auth/login", req.url);
    login.searchParams.set("next", path + req.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return res;
}

export const config = {
  // Skip static assets + Next internals. Keep .pdf in the matcher so the
  // trust host can still rewrite `/` while public PDFs under /trust/ are
  // served after a no-op next() (they are not under PROTECTED_PREFIXES).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)"],
};
