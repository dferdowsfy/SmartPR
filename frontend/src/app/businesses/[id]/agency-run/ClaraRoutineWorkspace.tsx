"use client";

/**
 * The Clara workspace in routine mode — "Teach Clara" (record a routine
 * once) or "Fill with Clara" (replay a learned routine for this business).
 * Opened from a requirement with its context in the query (see
 * claraWorkspaceLink.ts). Chat is the primary surface; the live browser and
 * the Business Passport are a secondary panel the person can open, hide or
 * switch between ([View browser] / [Business Passport]).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, IdCard } from "lucide-react";
import type { Lang } from "../../../forms/engine/types";
import { setLang } from "../../../useLang";
import type { LearnedRoutineSummary } from "../../../../lib/agency-runs/teach/learnedRoutineMatch";
import { routineForRow } from "../../../../lib/agency-runs/teach/learnedRoutineMatch";
import { isPersistedBusinessId, type ClaraWorkspaceContext } from "../../../components/clara/claraWorkspaceLink";
import { BrowserPanel, ContextCard, L, PassportPanel, api, type PassportFieldView } from "./workspaceParts";
import { TeachChat, type RecorderStatus } from "./TeachChat";
import { FillChat } from "./FillChat";

type Panel = "browser" | "passport" | null;

export function ClaraRoutineWorkspace({ businessId: rawBusinessId, ctx, lang }: { businessId: string; ctx: ClaraWorkspaceContext; lang: Lang }) {
  const router = useRouter();
  const businessId = isPersistedBusinessId(rawBusinessId) ? rawBusinessId : null;
  const [panel, setPanel] = useState<Panel>(ctx.mode === "teach" ? "browser" : null);
  /** Desktop: the browser takes the whole width (chat one click away). */
  const [browserWide, setBrowserWide] = useState(false);
  const [mobilePane, setMobilePane] = useState<"chat" | "panel">("chat");
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [biz, setBiz] = useState<{ name: string; municipality: string } | null>(null);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [passport, setPassport] = useState<{ loaded: boolean; fields: PassportFieldView[] } | null>(null);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [recorder, setRecorder] = useState<RecorderStatus | null>(null);
  const [routines, setRoutines] = useState<LearnedRoutineSummary[] | null>(null);

  const loadStatus = useCallback(async (fresh: boolean) => {
    const r = await api<{ signed_in?: boolean; recorder?: RecorderStatus; live_recorder?: boolean; routines?: LearnedRoutineSummary[] }>(`/api/clara-routines${fresh ? "?fresh=1" : ""}`).catch(() => null);
    if (!r || !r.ok) {
      setSignedIn(false);
      setRoutines([]);
      setRecorder({ ok: false, reason: "unreachable", busy: false, message: { en: "I couldn't reach SmartPR to check my browser.", es: "No pude comunicarme con SmartPR para revisar mi navegador." }, operator_hint: null });
      return;
    }
    setSignedIn(Boolean(r.data.signed_in));
    setRoutines(Array.isArray(r.data.routines) ? r.data.routines : []);
    setRecorder(r.data.recorder ?? { ok: Boolean(r.data.live_recorder), reason: r.data.live_recorder ? null : "config", busy: false, message: null, operator_hint: null });
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void loadStatus(true), 0);
    return () => window.clearTimeout(t);
  }, [loadStatus]);

  useEffect(() => {
    let cancelled = false;
    api<{ loaded: boolean; fields: PassportFieldView[] }>(`/api/clara-workspace/passport?business_id=${encodeURIComponent(businessId ?? "")}`)
      .then((r) => !cancelled && setPassport(r.ok ? { loaded: r.data.loaded, fields: r.data.fields } : { loaded: false, fields: [] }))
      .catch(() => !cancelled && setPassport({ loaded: false, fields: [] }));
    if (businessId) {
      fetch(`/api/businesses/${encodeURIComponent(businessId)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (cancelled || !j?.business) return;
          const name = String(j.business.legal_name || j.business.name || "").trim();
          if (name) setBiz({ name, municipality: String(j.business.municipality || "").trim() });
          const ev = Array.isArray(j.evidence) ? (j.evidence as { original_filename?: string; requirement_tags?: string[]; linked_requirement_id?: string }[]) : [];
          setEvidence(ev.filter((e) => e.linked_requirement_id === ctx.requirementKey || (e.requirement_tags ?? []).includes(ctx.requirementKey)).map((e) => String(e.original_filename ?? "")).filter(Boolean));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [businessId, ctx.requirementKey]);

  const recheck = () => {
    setRecorder(null);
    void loadStatus(true);
  };

  const existing = useMemo(
    () => (routines ? routineForRow(routines, { key: ctx.requirementKey, portalUrl: ctx.portalUrl, name: ctx.name }) : null),
    [routines, ctx.requirementKey, ctx.portalUrl, ctx.name]
  );

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(businessId ? `/businesses/${encodeURIComponent(businessId)}` : "/");
  };
  const showBrowser = useCallback(() => {
    setPanel("browser");
  }, []);
  const togglePanel = (p: Exclude<Panel, null>) => {
    setPanel((cur) => (cur === p ? null : p));
    setMobilePane("panel");
  };

  const passportFields = passport?.fields ?? null;
  const contextInfo = {
    requirementName: ctx.name,
    agency: ctx.agency,
    goal: ctx.goal,
    portalUrl: ctx.portalUrl ?? existing?.start_url ?? null,
    businessName: biz?.name ?? null,
    passportOnFile: passport?.loaded ? passport.fields.filter((f) => f.has).length : null,
    passportTotal: passport?.loaded ? passport.fields.length : null,
    evidence,
  };
  const title = ctx.mode === "teach" ? L("Teach Clara", "Enséñale a Clara", lang) : L("Fill with Clara", "Llenar con Clara", lang);
  const panelOpen = panel !== null;

  return (
    <div className="flex h-[calc(100vh-var(--topnav-h,0px))] flex-col overflow-hidden bg-[#161616]" style={{ height: "calc(100dvh - var(--topnav-h, 0px))" }} data-testid="clara-workspace" data-mode={ctx.mode}>
      <main className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-3 pb-3 pt-2.5 sm:px-5">
        <header className="shrink-0 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" onClick={goBack} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1.5 text-[13px] font-semibold text-[#e8e1d0] hover:bg-white/10">
              <ArrowLeft className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{L("Back", "Atrás", lang)}</span>
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-bold uppercase tracking-[0.14em] text-[#9a917f]">
                {title}
                {biz ? ` · ${biz.name}` : ""}
              </p>
              <h1 className="truncate font-[family-name:var(--font-display)] text-[17px] leading-tight text-[#f4efe2]" data-testid="ws-title">
                {ctx.name}
                {ctx.agency ? <span className="text-[#b9b0a0]"> · {ctx.agency}</span> : null}
              </h1>
            </div>
            <div className="hidden shrink-0 items-center gap-0.5 rounded-full border border-white/15 bg-white/5 p-1 sm:inline-flex" role="group" aria-label={L("Language", "Idioma", lang)}>
              {(["en", "es"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={lang === l}
                  onClick={() => setLang(l)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${lang === l ? "bg-[#fbf8f2] text-[#161616]" : "text-[#b9b0a0] hover:text-white"}`}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => togglePanel("passport")} aria-pressed={panel === "passport"} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[13px] font-semibold text-[#e8e1d0] hover:bg-white/10" data-testid="ws-passport-toggle">
              <IdCard className="h-3.5 w-3.5" />
              <span className="hidden md:inline">{L("Business Passport", "Pasaporte del negocio", lang)}</span>
            </button>
            <button type="button" onClick={() => togglePanel("browser")} aria-pressed={panel === "browser"} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[13px] font-semibold text-[#e8e1d0] hover:bg-white/10" data-testid="ws-view-browser">
              {panel === "browser" ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              <span className="hidden md:inline">{panel === "browser" ? L("Hide browser", "Ocultar navegador", lang) : L("View browser", "Ver navegador", lang)}</span>
            </button>
          </div>
          {panelOpen && (
            <div className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-black/30 p-1 lg:hidden" role="tablist">
              {(
                [
                  ["chat", L("Conversation", "Conversación", lang)],
                  ["panel", panel === "passport" ? L("Passport", "Pasaporte", lang) : L("Browser", "Navegador", lang)],
                ] as const
              ).map(([pane, label]) => (
                <button key={pane} type="button" role="tab" aria-selected={mobilePane === pane} onClick={() => setMobilePane(pane)} className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${mobilePane === pane ? "bg-[#fbf8f2] text-[#161616]" : "text-[#cfc6b4]"}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </header>

        <div className="mt-3 flex min-h-0 flex-1 gap-3">
          <section
            className={`min-h-0 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4 ${panelOpen ? "w-full lg:w-[32%] lg:min-w-[340px] lg:shrink-0" : "mx-auto w-full max-w-3xl"} ${panelOpen && mobilePane !== "chat" ? "hidden lg:block" : ""} ${panelOpen && panel === "browser" && browserWide ? "lg:hidden" : ""}`}
            aria-label={L("Conversation with Clara", "Conversación con Clara", lang)}
            data-testid="ws-chat"
          >
            <ContextCard info={contextInfo} lang={lang} />
            <div className="mt-3">
              {ctx.mode === "teach" ? (
                <TeachChat
                  lang={lang}
                  ctx={ctx}
                  businessId={businessId}
                  signedIn={signedIn}
                  recorder={recorder}
                  existing={existing}
                  passport={passportFields}
                  onRecheck={recheck}
                  onLiveUrl={setLiveUrl}
                  onShowBrowser={showBrowser}
                  onSaved={(r) => setRoutines((all) => [r, ...(all ?? []).filter((x) => x.ref !== r.ref)])}
                />
              ) : (
                <FillChat
                  lang={lang}
                  ctx={ctx}
                  businessId={businessId}
                  businessName={biz?.name ?? null}
                  signedIn={signedIn}
                  recorder={recorder}
                  routines={routines}
                  onRecheck={recheck}
                  onLiveUrl={setLiveUrl}
                  onShowBrowser={showBrowser}
                />
              )}
            </div>
          </section>
          {panelOpen && (
            <aside className={`min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/40 ${mobilePane === "panel" ? "flex" : "hidden lg:flex"}`} data-testid="ws-side-panel" data-panel={panel}>
              {panel === "browser" ? (
                <BrowserPanel liveUrl={liveUrl} lang={lang} wide={browserWide} onToggleWide={() => setBrowserWide((w) => !w)} note={L("Click and type here like any browser. Sign-in, codes, CAPTCHA, signature, payment and submit are yours.", "Haz clic y escribe aquí como en cualquier navegador. Entrar, códigos, CAPTCHA, firma, pago y envío son tuyos.", lang)} />
              ) : (
                <PassportPanel fields={passportFields} loaded={Boolean(passport?.loaded)} lang={lang} />
              )}
            </aside>
          )}
        </div>
      </main>
    </div>
  );
}
