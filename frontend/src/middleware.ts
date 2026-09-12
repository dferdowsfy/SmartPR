// Refreshes the Supabase auth session on every request and gates the
// authenticated areas of the app. Anonymous use of `/` continues to work.

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

const PROTECTED_PREFIXES = ["/dashboard", "/businesses", "/calendar", "/history", "/settings"];

export async function middleware(req: NextRequest) {
  // This exact public route contains only bundled fictional data. It neither
  // consumes nor refreshes customer sessions; all protected routes keep the
  // normal authentication path below. Never broaden this to an API prefix.
  if (req.nextUrl.pathname === "/demo/enterprise") return NextResponse.next();
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
  // Skip static assets + Next internals.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico)$).*)"],
};
