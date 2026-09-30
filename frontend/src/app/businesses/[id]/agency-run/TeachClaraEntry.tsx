"use client";

/**
 * Teach Clara entry points on the filing view (Teach Clara spec §5).
 *
 *  variant="button" — header button: "Teach Clara" for admins (builds the
 *    shared library), "Show Clara" for everyone else (private skill).
 *  variant="offer"  — shown when the current filing's portal + form has no
 *    skill yet: "I haven't done this form before — show me once."
 *
 * Both open /businesses/[id]/teach prefilled with the filing's portal
 * address and form name. Hidden when teaching isn't available here.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GraduationCap } from "lucide-react";
import type { Lang } from "../../../forms/engine/types";
import { getFilingConfig } from "../../../../lib/agency-runs/filingTypes";
import type { AgencyFilingType } from "../../../../lib/agency-runs/types";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

interface MatchState {
  isAdmin: boolean;
  canTeach: boolean;
  hasSkill: boolean | null;
  /** Replayable skill for the current filing, when Clara already knows it. */
  replayRef: string | null;
}

function teachHref(businessId: string, filingType: string | null): string {
  const q = new URLSearchParams();
  const cfg = filingType ? getFilingConfig(filingType as AgencyFilingType) : null;
  if (cfg) {
    q.set("url", cfg.startUrl);
    q.set("form", cfg.labelEs);
    q.set("portal", cfg.portalEs);
  }
  const s = q.toString();
  return `/businesses/${encodeURIComponent(businessId)}/teach${s ? `?${s}` : ""}`;
}

export function TeachClaraEntry(props: {
  businessId: string;
  filingType: string | null;
  lang: Lang;
  variant: "button" | "offer";
}) {
  const { businessId, filingType, lang, variant } = props;
  const router = useRouter();
  const [state, setState] = useState<MatchState | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await fetch("/api/me", { cache: "no-store" }).then((r) => r.json());
        const isAdmin = Boolean(me?.user?.isAdmin);
        if (!me?.user) return;
        const cfg = filingType ? getFilingConfig(filingType as AgencyFilingType) : null;
        const q = new URLSearchParams({ url: cfg?.startUrl ?? "https://example.gov/", form: cfg?.labelEs ?? "-" });
        const res = await fetch(`/api/skills/match?${q}`, { cache: "no-store" });
        const match = res.ok ? await res.json() : null;
        const replay = cfg
          ? await fetch(`/api/replays/match?filing_type=${encodeURIComponent(cfg.id)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
          : null;
        if (!cancelled) {
          setState({
            isAdmin,
            canTeach: Boolean(match?.can_teach),
            hasSkill: cfg ? Boolean(match?.skill || replay?.skill) : null,
            replayRef: replay?.skill && replay?.can_replay ? String(replay.skill.ref) : null,
          });
        }
      } catch {
        // Teach entry is optional chrome — never break the filing view.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filingType]);

  if (!state) return null;
  if (variant === "offer" && state.replayRef) {
    const ref = state.replayRef;
    const plan = async () => {
      setStarting(true);
      try {
        const res = await fetch("/api/replays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skill_ref: ref, business_id: businessId }) });
        const body = await res.json();
        if (res.ok) router.push(`/businesses/${encodeURIComponent(businessId)}/replay/${body.replay.id}`);
      } finally {
        setStarting(false);
      }
    };
    return (
      <div className="mt-2 flex flex-wrap items-center gap-3 rounded-2xl border border-[#2f6b4f] bg-[#1e4d38]/30 px-4 py-3 text-[14px] text-[#e8e1d0]">
        <GraduationCap className="h-4 w-4 shrink-0 text-[#9fd3b4]" />
        <p className="min-w-0 flex-1">
          {L("I already know this form. I can fill it in from your business info and stop wherever you're needed.", "Ya conozco este formulario. Lo puedo llenar con la información de tu negocio y me detengo donde me necesites.", lang)}
        </p>
        <button type="button" disabled={starting} onClick={plan} className="shrink-0 rounded-full bg-[#fbf8f2] px-3 py-1.5 text-[13px] font-bold text-[#161616] hover:bg-white disabled:opacity-50">
          {L("See the plan", "Ver el plan", lang)}
        </button>
      </div>
    );
  }
  if (!state.canTeach) return null;
  const href = teachHref(businessId, filingType);

  if (variant === "button") {
    return (
      <Link
        href={href}
        className="hidden shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[13px] font-semibold text-[#e8e1d0] hover:bg-white/10 lg:inline-flex"
        title={
          state.isAdmin
            ? L("Walk a filing once so Clara can do it for every business.", "Haz un trámite una vez para que Clara lo pueda hacer para cualquier negocio.", lang)
            : L("Show Clara a form once and she'll remember it for you.", "Enséñale un formulario a Clara una vez y ella se lo aprende.", lang)
        }
      >
        <GraduationCap className="h-3.5 w-3.5" />
        {state.isAdmin ? L("Teach Clara", "Enséñale a Clara", lang) : L("Show Clara", "Muéstrale a Clara", lang)}
      </Link>
    );
  }

  if (state.hasSkill !== false) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 rounded-2xl border border-[#2f6b4f] bg-[#1e4d38]/30 px-4 py-3 text-[14px] text-[#e8e1d0]">
      <GraduationCap className="h-4 w-4 shrink-0 text-[#9fd3b4]" />
      <p className="min-w-0 flex-1">
        {L(
          "I haven't done this form before. Show me once and next time I'll fill it in from your business info.",
          "Todavía no he hecho este formulario. Muéstramelo una vez y la próxima vez lo lleno con la información de tu negocio.",
          lang
        )}
      </p>
      <Link href={href} className="shrink-0 rounded-full bg-[#fbf8f2] px-3 py-1.5 text-[13px] font-bold text-[#161616] hover:bg-white">
        {state.isAdmin ? L("Teach Clara", "Enséñale a Clara", lang) : L("Show Clara", "Muéstrale a Clara", lang)}
      </Link>
    </div>
  );
}
