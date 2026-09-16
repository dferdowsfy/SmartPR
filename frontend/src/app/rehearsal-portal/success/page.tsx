"use client";

import { useState } from "react";
import Link from "next/link";
import { PageSub, PageTitle, PortalCard, useRehearsal } from "../rehearsal";

/** Fake success — nothing real happened. */
export default function RehearsalSuccessPage() {
  const { t } = useRehearsal();
  const [confirmation] = useState(
    () => `DEMO-2026-${Math.floor(100000 + Math.random() * 900000)}`
  );

  return (
    <PortalCard>
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
        <span aria-hidden className="text-2xl">✓</span>
      </div>
      <div className="mt-4">
        <PageTitle>{t("Filing submitted (rehearsal)", "Radicación enviada (ensayo)")}</PageTitle>
      </div>
      <PageSub>
        {t("Confirmation number:", "Número de confirmación:")}{" "}
        <span className="font-mono font-bold text-slate-900">{confirmation}</span>
      </PageSub>
      <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
        {t(
          "Nothing was submitted to any real agency. This was a rehearsal — the confirmation number is fictional.",
          "No se envió nada a ninguna agencia real. Esto fue un ensayo — el número de confirmación es ficticio."
        )}
      </p>
      <Link
        href="/rehearsal-portal"
        className="mt-6 inline-flex items-center justify-center rounded-xl border border-slate-300 px-6 py-3 text-sm font-bold text-slate-800 hover:bg-slate-50"
      >
        {t("Start over", "Empezar de nuevo")}
      </Link>
    </PortalCard>
  );
}
