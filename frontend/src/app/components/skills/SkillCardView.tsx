"use client";

/**
 * Human-readable skill card (Teach Clara spec §5 step 6): each screen, what
 * Clara fills from the business's info, what she asks every time, the
 * choices she always makes, screens that only show up sometimes, and the
 * steps only the person does. Used by the teach review and skill review.
 */
import { CheckCircle2, CircleDashed, Hand, HelpCircle, ListChecks, Split } from "lucide-react";
import type { Lang } from "../../forms/engine/types";
import type { SkillCard } from "../../../lib/agency-runs/skills/skillCard";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

export function SkillCardView({ card, lang }: { card: SkillCard; lang: Lang }) {
  const { counts } = card;
  return (
    <section aria-label={L("What Clara learned", "Lo que Clara aprendió", lang)} className="space-y-4">
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#9a917f]">{card.portal}</p>
        <h2 className="font-[family-name:var(--font-display)] text-[20px] leading-tight text-[#f4efe2]">{card.form}</h2>
        <p className="mt-2 text-[14px] text-[#cfc6b4]">
          {L(
            `${counts.screens} screens · ${counts.fromPassport} answers filled from the business's info · ${counts.askEachTime} asked each time · ${counts.humanSteps} steps you do yourself`,
            `${counts.screens} pantallas · ${counts.fromPassport} respuestas salen de la información del negocio · ${counts.askEachTime} se preguntan cada vez · ${counts.humanSteps} pasos que haces tú`,
            lang
          )}
        </p>
      </div>

      <ol className="space-y-3">
        {card.steps.map((step, i) => (
          <li key={step.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1e4d38] text-[12px] font-bold text-white">{i + 1}</span>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-[15px] font-semibold text-[#f4efe2]">{step.title}</h3>
                  {!step.observed && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/40 px-2 py-0.5 text-[11px] font-bold text-amber-200">
                      <CircleDashed className="h-3 w-3" />
                      {L("Not walked through", "No se recorrió", lang)}
                    </span>
                  )}
                </div>
                {step.gateText && (
                  <p className="flex items-center gap-2 text-[14px] text-amber-100">
                    <Hand className="h-4 w-4 shrink-0" />
                    {L(`You do this yourself: ${step.gateText.en}`, `Esto lo haces tú: ${step.gateText.es}`, lang)}
                  </p>
                )}
                {step.onlyWhen.length > 0 && (
                  <p className="flex items-center gap-2 text-[14px] text-[#cfc6b4]">
                    <Split className="h-4 w-4 shrink-0" />
                    {L("Only shows up when ", "Solo aparece cuando ", lang)}
                    {step.onlyWhen.map((c) => L(c.en, c.es, lang)).join(L(" or ", " o ", lang))}
                  </p>
                )}
                {step.fromPassport.length > 0 && (
                  <ul className="space-y-1">
                    {step.fromPassport.map((f) => (
                      <li key={f.field} className="flex items-start gap-2 text-[14px] text-[#e8e1d0]">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[#9fd3b4]" />
                        <span>
                          <span className="font-semibold">{f.field}</span>
                          <span className="text-[#b9b0a0]"> ← {L(f.source.en, f.source.es, lang)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {step.askEachTime.length > 0 && (
                  <ul className="space-y-1">
                    {step.askEachTime.map((label) => (
                      <li key={label} className="flex items-start gap-2 text-[14px] text-[#e8e1d0]">
                        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
                        <span>
                          <span className="font-semibold">{label}</span>
                          <span className="text-[#b9b0a0]"> — {L("Clara asks you each time", "Clara te pregunta cada vez", lang)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {step.alwaysChoose.length > 0 && (
                  <ul className="space-y-1">
                    {step.alwaysChoose.map((label) => (
                      <li key={label} className="flex items-start gap-2 text-[14px] text-[#e8e1d0]">
                        <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-[#9fd3b4]" />
                        {L(`Always picks "${label}"`, `Siempre escoge "${label}"`, lang)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>

      <div className="rounded-2xl border border-amber-300/30 bg-amber-50/[0.04] p-4 text-[14px] text-amber-100">
        <p className="font-semibold">{L("Always yours, every time:", "Siempre te toca a ti, cada vez:", lang)}</p>
        <p className="mt-1 text-[#e8e1d0]">{card.humanGates.map((g) => L(g.text.en, g.text.es, lang)).join(" · ")}</p>
      </div>
    </section>
  );
}
