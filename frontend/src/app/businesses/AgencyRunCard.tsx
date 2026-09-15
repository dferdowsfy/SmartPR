"use client";

import Link from "next/link";
import { Bot, ArrowRight } from "lucide-react";
import type { Lang } from "../forms/engine/types";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

/**
 * Entry card on the business profile — opens the agency assistant run panel.
 * Browser Use Cloud when BROWSER_USE_API_KEY is set; mock timeline otherwise.
 */
export function AgencyRunCard({
  businessId,
  lang,
}: {
  businessId: string;
  lang: Lang;
}) {
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
