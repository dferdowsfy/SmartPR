// Refreshes the Supabase auth session on every request and gates the
// authenticated areas of the app. Anonymous use of `/` continues to work.
// On trust.getsmartpr.com, `/` is rewritten to the public Trust Center.
//
// Next.js 16 uses the proxy.ts convention (middleware.ts is deprecated).

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/businesses",
  "/calendar",
  "/history",
  "/settings",
  "/filings",
  "/enterprise",
  "/admin",
];
const TRUST_HOST = "trust.getsmartpr.com";
const APEX_HOST = "getsmartpr.com";
const WWW_HOST = "www.getsmartpr.com";

function hostOf(req: NextRequest): string {
  return req.headers.get("host")?.split(":")[0]?.toLowerCase() ?? "";
}

function isTrustHost(req: NextRequest): boolean {
  return hostOf(req) === TRUST_HOST;
}

function isApexHost(req: NextRequest): boolean {
  return hostOf(req) === APEX_HOST;
}

function forwardedHeaders(req: NextRequest, pathname?: string): Headers {
  const headers = new Headers(req.headers);
  headers.set("x-pathname", pathname ?? req.nextUrl.pathname);
  headers.set("x-search", req.nextUrl.search);
  return headers;
}

function supabasePublicKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export async function proxy(req: NextRequest) {
  if (isApexHost(req)) {
    const url = req.nextUrl.clone();
    url.host = WWW_HOST;
    url.protocol = "https:";
    url.port = "";
    return NextResponse.redirect(url, 308);
  }

  if (isTrustHost(req)) {
    const path = req.nextUrl.pathname;
    if (path === "/" || path === "") {
      const url = req.nextUrl.clone();
      url.pathname = "/trust";
      return NextResponse.rewrite(url, {
        request: { headers: forwardedHeaders(req, "/trust") },
      });
    }
    return NextResponse.next({ request: { headers: forwardedHeaders(req) } });
  }

  const path = req.nextUrl.pathname;
  const needsAuth = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = supabasePublicKey();

  // Fail closed for protected areas if Auth is misconfigured. Public routes
  // still render so marketing pages and guest intake remain available.
  if (!url || !key) {
    if (needsAuth) {
      const login = new URL("/auth/login", req.url);
      login.searchParams.set("next", path + req.nextUrl.search);
      return NextResponse.redirect(login);
    }
    return NextResponse.next({ request: { headers: forwardedHeaders(req) } });
  }

  let res = NextResponse.next({ request: { headers: forwardedHeaders(req) } });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(toSet, responseHeaders) {
        toSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: { headers: forwardedHeaders(req) } });
        toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
        Object.entries(responseHeaders).forEach(([name, value]) => res.headers.set(name, value));
      },
    },
  });

  // Verify the JWT before trusting identity from request cookies.
  const { data, error } = await supabase.auth.getClaims();
  const authenticated = !error && !!data?.claims?.sub;

  if (needsAuth && !authenticated) {
    const login = new URL("/auth/login", req.url);
    login.searchParams.set("next", path + req.nextUrl.search);
    return NextResponse.redirect(login);
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)"],
};
