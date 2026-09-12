"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, BriefcaseBusiness, Building2, FlaskConical, HardHat, Martini,
  MoreVertical, Plus, Search, Store, Utensils,
} from "lucide-react";
import { TopNav } from "../history/ui";
import { useLang } from "../useLang";

interface Business {
  id: string;
  public_id: string | null;
  legal_name: string;
  entity_number: string | null;
  business_structure: string | null;
  business_type: string | null;
  industry: string | null;
  municipality: string | null;
  physical_address: string | null;
  onboarding_mode: "NEW" | "EXISTING";
  readiness_score: number | null;
  active_matters: number;
}

const PAGE_SIZE = 8;

// Contextual icon + soft category color, matched against business_type /
// industry text. Falls back to a neutral generic icon for anything unmapped.
function categoryVisual(business: Business): { Icon: typeof Building2; iconBg: string; iconColor: string } {
  const text = `${business.industry || ""} ${business.business_type || ""}`.toLowerCase();
  if (/lab|pharma|biotech/.test(text)) return { Icon: FlaskConical, iconBg: "bg-emerald-50", iconColor: "text-teal-700" };
  if (/\bbar\b|tavern|pub|nightclub|lounge/.test(text)) return { Icon: Martini, iconBg: "bg-violet-50", iconColor: "text-violet-700" };
  if (/restaurant|caf[eé]|food service|kitchen/.test(text)) return { Icon: Utensils, iconBg: "bg-amber-50", iconColor: "text-amber-700" };
  if (/retail|store|shop/.test(text)) return { Icon: Store, iconBg: "bg-sky-50", iconColor: "text-sky-700" };
  if (/construction|contractor|building/.test(text)) return { Icon: HardHat, iconBg: "bg-orange-50", iconColor: "text-orange-700" };
  if (/professional|consulting|legal|accounting|services/.test(text)) return { Icon: BriefcaseBusiness, iconBg: "bg-blue-50", iconColor: "text-blue-700" };
  return { Icon: Building2, iconBg: "bg-slate-100", iconColor: "text-slate-600" };
}

function filingStatus(business: Business, lang: "en" | "es"): { pillText: string; pillCls: string; primary: string; secondary: string } {
  const es = lang === "es";
  if (business.active_matters > 0) {
    const n = business.active_matters;
    return {
      pillText: es ? "EN PROCESO" : "IN PROGRESS", pillCls: "bg-sky-50 text-sky-700",
      primary: es ? "En progreso" : "In progress",
      secondary: es ? `${n} radicación${n === 1 ? "" : "es"}` : `${n} filing${n === 1 ? "" : "s"}`,
    };
  }
  if (business.readiness_score != null && business.readiness_score >= 90) {
    return { pillText: es ? "LISTO" : "READY", pillCls: "bg-emerald-50 text-emerald-700", primary: es ? "Listo" : "Ready", secondary: es ? "Sin radicación activa" : "No active filing" };
  }
  if (business.readiness_score != null) {
    return { pillText: es ? "EN PROCESO" : "IN PROGRESS", pillCls: "bg-sky-50 text-sky-700", primary: `${business.readiness_score}% ${es ? "listo" : "ready"}`, secondary: es ? "Sin radicación activa" : "No active filing" };
  }
  return { pillText: es ? "NO INICIADO" : "NOT STARTED", pillCls: "bg-slate-100 text-slate-600", primary: es ? "No iniciado" : "Not started", secondary: es ? "Sin radicación activa" : "No active filing" };
}

function MoreMenu({ business, lang, onRenamed, onArchived }: { business: Business; lang: "en" | "es"; onRenamed: () => void; onArchived: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const es = lang === "es";
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const rename = async () => {
    setOpen(false);
    const next = window.prompt(es ? "Renombrar negocio" : "Rename business", business.legal_name);
    if (!next || !next.trim() || next.trim() === business.legal_name) return;
    const response = await fetch(`/api/businesses/${business.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ legal_name: next.trim() }),
    });
    if (response.ok) onRenamed();
  };
  const archive = async () => {
    setOpen(false);
    const msg = es
      ? `¿Archivar ${business.legal_name}? Puedes restaurarlo más tarde con soporte.`
      : `Archive ${business.legal_name}? You can restore it later from support.`;
    if (!window.confirm(msg)) return;
    const response = await fetch(`/api/businesses/${business.id}`, { method: "DELETE" });
    if (response.ok) onArchived();
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} aria-label="More actions"
        className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-[#161616]/15 bg-[#fbf8f2] text-[#5a5a5a] hover:border-[#161616]/30 hover:text-[#161616]"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-10 w-52 overflow-hidden rounded-xl border border-[#161616]/12 bg-white py-1.5 shadow-lg shadow-slate-950/[0.06]">
          <Link role="menuitem" href={`/businesses/${business.public_id || business.id}`} className="block px-4 py-2 text-sm text-[#161616] hover:bg-[#f4f1ea]">{es ? "Ver perfil del negocio" : "View business profile"}</Link>
          <Link role="menuitem" href={`/businesses/${business.public_id || business.id}/matters/new`} className="block px-4 py-2 text-sm text-[#161616] hover:bg-[#f4f1ea]">{es ? "Comenzar nueva radicación" : "Start new filing"}</Link>
          <button role="menuitem" type="button" onClick={() => void rename()} className="block w-full px-4 py-2 text-left text-sm text-[#161616] hover:bg-[#f4f1ea]">{es ? "Renombrar negocio" : "Rename business"}</button>
          <button role="menuitem" type="button" onClick={() => void archive()} className="block w-full px-4 py-2 text-left text-sm text-rose-700 hover:bg-rose-50">{es ? "Archivar negocio" : "Archive business"}</button>
        </div>
      )}
    </div>
  );
}

function BusinessCard({ business, lang, onChanged }: { business: Business; lang: "en" | "es"; onChanged: () => void }) {
  const { Icon, iconBg, iconColor } = categoryVisual(business);
  const status = filingStatus(business, lang);
  const locationType = [business.municipality, business.business_type].filter(Boolean).join(" · ") || "Puerto Rico";

  return (
    <div className="group relative rounded-[14px] border border-[#161616]/12 bg-[#fefdfb] p-4 transition-colors hover:border-[#161616]/25 hover:bg-white sm:p-5">
      {/* Mobile: overflow control pinned to the card's upper-right corner. */}
      <div className="absolute right-4 top-4 sm:hidden">
        <MoreMenu business={business} lang={lang} onRenamed={onChanged} onArchived={onChanged} />
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Identity */}
        <div className="flex min-w-0 flex-1 items-center gap-4 pr-10 sm:pr-0">
          <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] ${iconBg}`}>
            <Icon className={`h-6 w-6 ${iconColor}`} strokeWidth={1.75} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-base font-bold text-[#161616]">{business.legal_name}</div>
            <div className="mt-0.5 truncate text-sm text-[#5a5a5a]">{locationType}</div>
            <span className={`mt-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${status.pillCls}`}>{status.pillText}</span>
          </div>
        </div>

        {/* Filing info */}
        <div className="flex items-center gap-4 sm:border-l sm:border-[#161616]/10 sm:pl-6">
          <div className="min-w-[110px]">
            <div className="text-sm font-semibold text-[#161616]">{status.primary}</div>
            <div className="text-xs text-[#5a5a5a]">{status.secondary}</div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 sm:border-l sm:border-[#161616]/10 sm:pl-6">
          <Link
            href={`/businesses/${business.public_id || business.id}`}
            className="inline-flex h-12 w-full items-center justify-center gap-1.5 rounded-[10px] bg-brand px-5 text-sm font-semibold text-[#f6f3ea] transition-colors hover:bg-[#1c4949] sm:w-[150px]"
          >
            {lang === "es" ? "Continuar" : "Continue"} <ArrowRight className="h-4 w-4" />
          </Link>
          <div className="hidden sm:block">
            <MoreMenu business={business} lang={lang} onRenamed={onChanged} onArchived={onChanged} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BusinessesPage() {
  const lang = useLang();
  const es = lang === "es";
  const [businesses, setBusinesses] = useState<Business[] | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState(false);

  const load = () => {
    fetch("/api/portfolio").then((response) => response.json())
      .then((result) => { setBusinesses(result.businesses ?? []); setLoadError(false); })
      .catch(() => setLoadError(true));
  };
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => (businesses ?? []).filter((business) =>
    !search.trim() || business.legal_name.toLowerCase().includes(search.trim().toLowerCase())
  ), [businesses, search]);

  const updateSearch = (value: string) => { setSearch(value); setPage(1); };

  const totalPages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const paged = shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#161616]">
      <TopNav active="businesses" />
      <main className="mx-auto max-w-[1140px] px-5 py-10 sm:px-6">
        <h1 className="text-[36px] font-bold tracking-tight sm:text-[42px]">{es ? "Mis negocios" : "My businesses"}</h1>
        <p className="mt-2 max-w-xl text-[#5a5a5a]">{es ? "Perfiles permanentes para los negocios y clientes para los que radicas en Puerto Rico." : "Permanent profiles for the businesses and clients you file for in Puerto Rico."}</p>

        <Link
          href="/?entry=new-business"
          className="mt-6 inline-flex h-12 w-[210px] items-center justify-center gap-2 rounded-[10px] bg-brand text-sm font-semibold text-[#f6f3ea] transition-colors hover:bg-[#1c4949]"
        >
          <Plus className="h-4 w-4" /> {es ? "Comenzar una radicación" : "Start a new filing"}
        </Link>

        <div className="relative mt-6">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a8a8a]" />
          <input
            value={search}
            onChange={(event) => updateSearch(event.target.value)}
            placeholder={es ? "Buscar por nombre de negocio" : "Search by business name"}
            className="h-[54px] w-full rounded-[12px] border border-[#161616]/15 bg-white pl-11 pr-4 text-sm text-[#161616] placeholder:text-[#8a8a8a] focus:border-brand focus:outline-none"
          />
        </div>
        <div className="mt-6 border-b border-[#161616]/10" />

        <div className="mt-6">
          {loadError ? (
            <p className="mt-6 text-sm text-rose-700">
              {es ? "No se pudieron cargar tus negocios en este momento." : "Couldn't load your businesses right now."}{" "}
              <button type="button" onClick={load} className="font-semibold underline">{es ? "Intentar de nuevo" : "Try again"}</button>
            </p>
          ) : businesses === null ? (
            <div className="mt-6 space-y-3">
              {[0, 1, 2].map((index) => <div key={index} className="h-[112px] animate-pulse rounded-[14px] border border-[#161616]/10 bg-white/60" />)}
            </div>
          ) : shown.length === 0 ? (
            <p className="mt-6 text-sm text-[#5a5a5a]">{businesses.length
              ? (es ? "Ningún negocio coincide con esa búsqueda." : "No businesses match that search.")
              : (es ? "Aún no hay negocios. Comienza una radicación para crear el primer perfil." : "No businesses yet. Start a filing to create the first profile.")}</p>
          ) : (
            <>
              <div className="space-y-3">
                {paged.map((business) => <BusinessCard key={business.id} business={business} lang={lang} onChanged={load} />)}
              </div>

              {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-2">
                  <button
                    type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#161616]/15 bg-white text-sm text-[#161616] disabled:opacity-40"
                  >‹</button>
                  {Array.from({ length: totalPages }, (_, index) => index + 1).map((number) => (
                    <button
                      key={number} type="button" onClick={() => setPage(number)}
                      className={`flex h-9 w-9 items-center justify-center rounded-[8px] border text-sm ${number === page ? "border-brand bg-brand text-white" : "border-[#161616]/15 bg-white text-[#161616]"}`}
                    >{number}</button>
                  ))}
                  <button
                    type="button" disabled={page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                    className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#161616]/15 bg-white text-sm text-[#161616] disabled:opacity-40"
                  >›</button>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
