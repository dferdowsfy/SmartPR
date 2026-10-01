"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";

type Language = "en" | "es";

/** "Teach Clara" (admins) / "Show Clara" (everyone else) for a row that has an official portal. */
export function TeachClaraRowLink({ businessId, portalUrl, form, portalName, language }: { businessId: string; portalUrl: string; form: string; portalName: string; language: Language }) {
  const [state, setState] = useState<{ isAdmin: boolean } | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetch("/api/me", { cache: "no-store" }).then((r) => r.json());
        if (!me?.user) return;
        const q = new URLSearchParams({ url: portalUrl, form });
        const match = await fetch(`/api/skills/match?${q}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
        if (!cancelled && match?.can_teach) setState({ isAdmin: Boolean(me.user.isAdmin) });
      } catch {
        // Optional chrome — never break the requirements list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [portalUrl, form]);
  if (!state) return null;
  const es = language === "es";
  const q = new URLSearchParams({ url: portalUrl, form, portal: portalName });
  return (
    <Link className="ck-action" data-testid="card-action" data-cta="teach-clara" href={`/businesses/${encodeURIComponent(businessId)}/teach?${q}`}>
      <GraduationCap size={12} aria-hidden="true" />{" "}
      {state.isAdmin ? (es ? "Enséñale a Clara" : "Teach Clara") : es ? "Muéstrale a Clara" : "Show Clara"}
    </Link>
  );
}
