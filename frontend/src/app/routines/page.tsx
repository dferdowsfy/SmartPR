"use client";

/**
 * My routines — the filings Clara learned from your walkthroughs (Teach
 * Clara). Each routine stores the steps and which Business Passport detail
 * goes where — never the values you typed. Rename or remove your own;
 * routines from the SmartPR team or partners are listed read-only.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckCircle2, GraduationCap, Loader2, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { useLang } from "../useLang";
import type { LearnedRoutineSummary } from "../../lib/agency-runs/teach/learnedRoutineMatch";
import { claraWorkspaceHref } from "../components/clara/claraWorkspaceLink";

const ATTR = {
  you: { en: "Taught by you", es: "Enseñada por ti" },
  smartpr: { en: "SmartPR team", es: "Equipo de SmartPR" },
  partner: { en: "SmartPR partner", es: "Profesional de SmartPR" },
};

export default function RoutinesPage() {
  const lang = useLang();
  const T = (en: string, es: string) => (lang === "es" ? es : en);
  const [routines, setRoutines] = useState<LearnedRoutineSummary[] | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clara-routines", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setSignedIn(Boolean(j.signed_in));
        setRoutines(Array.isArray(j.routines) ? j.routines : []);
      })
      .catch(() => setRoutines([]));
  }, []);

  const rename = async (ref: string) => {
    setError(null);
    const res = await fetch(`/api/clara-routines/${encodeURIComponent(ref)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: draft }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.routine) return setError(T("Couldn't rename it.", "No se pudo cambiar el nombre."));
    setRoutines((all) => (all ?? []).map((r) => (r.ref === ref ? j.routine : r)));
    setEditing(null);
  };

  const remove = async (r: LearnedRoutineSummary) => {
    if (!window.confirm(T(`Remove “${r.name}”? Fill with Clara will stop using it. You can teach it again anytime.`, `¿Quitar “${r.name}”? Llenar con Clara dejará de usarla. Puedes enseñarla otra vez cuando quieras.`))) return;
    setError(null);
    const res = await fetch(`/api/clara-routines/${encodeURIComponent(r.ref)}`, { method: "DELETE" });
    if (!res.ok) return setError(T("Couldn't remove it.", "No se pudo quitar."));
    setRoutines((all) => (all ?? []).filter((x) => x.ref !== r.ref));
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-8" data-testid="routines-page">
      <h1 className="font-[family-name:var(--font-display)] text-[30px] text-slate-900">{T("Clara's routines", "Rutinas de Clara")}</h1>
      <p className="mt-1 text-[15px] text-slate-600">
        {T(
          "Filings Clara learned from a walkthrough. Each one stores the steps and which Business Passport detail goes where — never what you typed. “Fill with Clara” uses them on any business.",
          "Trámites que Clara aprendió de un recorrido. Cada uno guarda los pasos y qué dato del Pasaporte va dónde — nunca lo que escribiste. “Llenar con Clara” los usa con cualquier negocio."
        )}
      </p>
      {error && <p className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-[14px] text-rose-700" role="alert">{error}</p>}
      {!signedIn && <p className="mt-6 text-[15px]">{T("Sign in to see your routines.", "Entra a tu cuenta para ver tus rutinas.")} <a className="underline" href="/auth/login?next=/routines">{T("Sign in", "Entrar")}</a></p>}
      {routines === null ? (
        <p className="mt-6 text-slate-500"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />{T("Loading…", "Cargando…")}</p>
      ) : signedIn && routines.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6 text-center" data-testid="routines-empty">
          <GraduationCap className="mx-auto h-7 w-7 text-emerald-700" />
          <p className="mt-2 text-[15px] text-slate-700">{T("No routines yet. On a requirement, choose “Teach Clara” and walk the portal once.", "Todavía no hay rutinas. En un requisito, escoge “Enséñale a Clara” y recorre el portal una vez.")}</p>
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {routines.map((r) => {
            const mine = r.attribution === "you";
            return (
              <li key={r.ref} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="routine-row">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    {editing === r.ref ? (
                      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void rename(r.ref); }}>
                        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={120} className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1 text-[15px]" data-testid="routine-name-input" />
                        <button type="submit" className="rounded-full bg-emerald-800 px-3 py-1 text-[13px] font-semibold text-white">{T("Save", "Guardar")}</button>
                        <button type="button" className="text-[13px] text-slate-500" onClick={() => setEditing(null)}>{T("Cancel", "Cancelar")}</button>
                      </form>
                    ) : (
                      <p className="text-[16px] font-semibold text-slate-900">{r.name}</p>
                    )}
                    <p className="mt-0.5 text-[13px] text-slate-500">
                      {[r.agency, r.portal_host, `v${r.version}`, `${r.steps} ${T("steps", "pasos")} · ${r.pauses} ${T("for you", "para ti")}`, new Date(r.learned_at).toLocaleDateString(lang === "es" ? "es-PR" : "en-US"), T(ATTR[r.attribution].en, ATTR[r.attribution].es)].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {r.status === "learned" ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-semibold text-emerald-800"><CheckCircle2 className="h-3.5 w-3.5" />{T("Learned", "Aprendida")}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[12px] font-semibold text-amber-800"><TriangleAlert className="h-3.5 w-3.5" />{T("Portal changed — re-teach", "El portal cambió — enséñala otra vez")}</span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-[13px] font-semibold">
                  <Link className="text-emerald-800 hover:underline" href={claraWorkspaceHref("teach", null, { key: r.requirement_key ?? r.form, name: r.form, agency: r.agency, portalUrl: r.start_url })}>
                    {T("Re-teach", "Enseñar otra vez")}
                  </Link>
                  {mine && editing !== r.ref && (
                    <button type="button" className="inline-flex items-center gap-1 text-slate-600 hover:underline" onClick={() => { setEditing(r.ref); setDraft(r.name); }} data-testid="routine-rename"><Pencil className="h-3.5 w-3.5" />{T("Rename", "Cambiar nombre")}</button>
                  )}
                  {mine && (
                    <button type="button" className="inline-flex items-center gap-1 text-rose-700 hover:underline" onClick={() => void remove(r)} data-testid="routine-remove"><Trash2 className="h-3.5 w-3.5" />{T("Remove", "Quitar")}</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
