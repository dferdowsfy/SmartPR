// Server-side Supabase client for Route Handlers + Server Components.
// Reads the user's session from request cookies; falls back to null when the
// env vars aren't configured so anonymous use keeps working.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function supabasePublicKey(): string | undefined {
  return process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function isAuthConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && supabasePublicKey());
}

export async function createSupabaseServer() {
  const key = supabasePublicKey();
  if (!isAuthConfigured() || !key) return null;

  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet) {
          try {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Setting cookies from a Server Component is a no-op; proxy refreshes.
          }
        },
      },
    }
  );
}

// Convenience: return the current authenticated user (or null).
export async function getCurrentUser() {
  const sb = await createSupabaseServer();
  if (!sb) return null;
  const { data, error } = await sb.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}
