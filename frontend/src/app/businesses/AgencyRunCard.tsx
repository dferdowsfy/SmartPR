"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, ArrowRight, FlaskConical } from "lucide-react";
import type { Lang } from "../forms/engine/types";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

type ProviderKind = "browser_use_cloud" | "self_hosted" | "mock";

/**
 * Entry card on the business profile — opens the agency assistant run panel.
 * Shows exactly which agent backend is active so there is never confusion
 * between Browser Use Cloud, the self-hosted worker, and the mock timeline.
 */
export function AgencyRunCard({
  businessId,
  lang,
}: {
  businessId: string;
  lang: Lang;
}) {
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

  const providerBadge =
    // No third-party provider branding — the agent is part of SmartPR.
    // Only the dev-facing mock notice remains.
    provider === "mock" ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[11px] font-bold text-slate-300">
        <FlaskConical className="h-3 w-3" />
        {L("Mock preview — agent not connected", "Vista simulada — agente no conectado", lang)}
      </span>
    ) : null;

  // Dark card in the Clara workspace's own palette (#161616) so the entry
  // point reads as the same unique feature as the workspace it opens.
  return (
    <section className="rounded-2xl border border-white/10 bg-[#161616] p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#245c5c]">
            <Bot className="h-4 w-4 text-white" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-bold text-[#f6f3ea]">
                {L("File with Clara", "Radicar con Clara", lang)}
              </h2>
              <span className="inline-flex items-center rounded-full border border-amber-200/30 bg-amber-300/10 px-2.5 py-0.5 text-[11px] font-bold text-amber-200">
                {L("Live visual · pilot", "Visual en vivo · piloto", lang)}
              </span>
              {providerBadge}
            </div>
            <p className="mt-0.5 max-w-xl text-sm text-[#b9b0a0]">
              {L(
                "Prefill from Business Passport, pause for uploads and login, stop at review — never final-submit. Runs on allowlisted government portals.",
                "Relleno desde el Pasaporte de Negocio, pausa para adjuntos e inicio de sesión, detener en revisión — nunca envía. Corre en portales de gobierno permitidos.",
                lang
              )}
            </p>
          </div>
        </div>
        <Link
          href={`/businesses/${businessId}/agency-run`}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#f6f3ea] px-5 py-2.5 text-sm font-semibold text-[#161616] transition hover:bg-white"
        >
          {L("Open Clara", "Abrir Clara", lang)}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
