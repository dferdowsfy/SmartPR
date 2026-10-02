"use client";

import { useEffect, useState } from "react";
import { FlaskConical } from "lucide-react";
import type { Lang } from "../forms/engine/types";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

type ProviderKind = "browser_use_cloud" | "self_hosted" | "mock";

/**
 * Clara's pilot context — what used to sit in the business page's "File with
 * Clara" banner, now shown on Clara's own launch screen: the pilot badge, how
 * Clara behaves (pauses for uploads/sign-in, stops at review, never
 * final-submits, allowlisted portals) and the dev-only mock-provider notice.
 */
export function ClaraPilotNote({ lang }: { lang: Lang }) {
  const [provider, setProvider] = useState<ProviderKind | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/agency-runs/provider", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.provider) setProvider(j.provider as ProviderKind);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto mt-3 flex max-w-2xl flex-wrap items-center justify-center gap-2 text-center text-[14px] text-[#64748B]" data-testid="clara-pilot-note">
      <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[12px] font-bold text-amber-800">
        {L("Live visual · pilot", "Visual en vivo · piloto", lang)}
      </span>
      {provider === "mock" && (
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2.5 py-0.5 text-[12px] font-bold text-slate-600">
          <FlaskConical className="h-3 w-3" aria-hidden="true" />
          {L("Mock preview — agent not connected", "Vista simulada — agente no conectado", lang)}
        </span>
      )}
      <span>
        {L(
          "Clara pauses for uploads and sign-in and stops at review — she never final-submits. Runs on allowlisted government portals.",
          "Clara pausa para adjuntos e inicio de sesión y se detiene en la revisión — nunca envía. Corre en portales de gobierno permitidos.",
          lang
        )}
      </span>
    </div>
  );
}
