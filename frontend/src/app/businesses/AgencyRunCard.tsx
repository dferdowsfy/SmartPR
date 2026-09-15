"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, ArrowRight, Cloud, Server, FlaskConical } from "lucide-react";
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
    provider === "browser_use_cloud" ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold text-sky-800">
        <Cloud className="h-3 w-3" />
        {L("Runs on Browser Use Cloud", "Corre en Browser Use Cloud", lang)}
      </span>
    ) : provider === "self_hosted" ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-[11px] font-bold text-violet-800">
        <Server className="h-3 w-3" />
        {L("Runs on self-hosted agent (Grok)", "Corre en agente propio (Grok)", lang)}
      </span>
    ) : provider === "mock" ? (
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-bold text-slate-600">
        <FlaskConical className="h-3 w-3" />
        {L("Mock preview — agent not connected", "Vista simulada — agente no conectado", lang)}
      </span>
    ) : null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/[0.02]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand">
            <Bot className="h-4 w-4 text-white" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-bold text-[#161616]">
                {L("File with agency assistant", "Tramitar con asistente de agencia", lang)}
              </h2>
              <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
                {L("Live visual · pilot", "Visual en vivo · piloto", lang)}
              </span>
              {providerBadge}
            </div>
            <p className="mt-0.5 max-w-xl text-sm text-slate-500">
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
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-5 py-2.5 text-sm font-medium text-[#f6f3ea]"
        >
          {L("Open assistant", "Abrir asistente", lang)}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
