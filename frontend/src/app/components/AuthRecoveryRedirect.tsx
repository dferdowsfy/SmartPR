"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * If a recovery (or invite) hash lands on any page other than /auth/reset —
 * typically the marketing home Site URL — bounce to the reset page with the
 * hash intact so createBrowserClient can establish the recovery session.
 */
export function AuthRecoveryRedirect() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (pathname === "/auth/reset") return;
    const hash = window.location.hash || "";
    if (!hash) return;
    const isRecovery =
      hash.includes("type=recovery") ||
      (hash.includes("access_token=") && hash.includes("type=recovery"));
    const isInvite = hash.includes("type=invite") || hash.includes("type=magiclink");
    if (!isRecovery && !isInvite) return;
    if (isRecovery) {
      router.replace(`/auth/reset${hash}`);
    }
  }, [pathname, router]);

  return null;
}
