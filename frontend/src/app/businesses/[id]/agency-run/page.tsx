"use client";

/**
 * Agency assistant live run panel.
 * Browser Use Cloud when BROWSER_USE_API_KEY is set; mock timeline otherwise.
 */
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, Bot, CheckCircle2, Cloud, CreditCard, FileUp, KeyRound, PauseCircle,
  Play, RefreshCw, Server, Shield, Square, Upload,
} from "lucide-react";
import { TopNav } from "../../../history/ui";
import { useLang } from "../../../useLang";
import type { Lang } from "../../../forms/engine/types";
import type {
  AgencyFilingType,
  AgencyPauseReason,
  AgencyRunPublic,
  AgencyRunStatus,
} from "../../../../lib/agency-runs/types";
import {
  AGENCY_FILING_CONFIGS,
  getFilingConfig,
} from "../../../../lib/agency-runs/filingTypes";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

const STATUS_STYLES: Record<AgencyRunStatus, string> = {
  queued: "border-slate-300 bg-slate-100 text-slate-700",
  running: "border-sky-300 bg-sky-50 text-sky-800",
  paused: "border-amber-300 bg-amber-50 text-amber-900",
  review: "border-emerald-300 bg-emerald-50 text-emerald-800",
  stopped: "border-slate-400 bg-slate-200 text-slate-800",
  failed: "border-rose-300 bg-rose-50 text-rose-800",
};

function statusLabel(status: AgencyRunStatus, lang: Lang): string {
  const map: Record<AgencyRunStatus, [string, string]> = {
    queued: ["Queued", "En cola"],
    running: ["Running", "En curso"],
    paused: ["Paused", "Pausado"],
    review: ["Review", "Revisión"],
    stopped: ["Stopped", "Detenido"],
    failed: ["Failed", "Falló"],
  };
  const [en, es] = map[status];
  return L(en, es, lang);
}

function StatusPill({ status, lang }: { status: AgencyRunStatus; lang: Lang }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold tracking-wide ${STATUS_STYLES[status]}`}>
      {statusLabel(status, lang)}
    </span>
  );
}

export default function AgencyRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: businessId } = use(params);
  const lang = useLang();
  const [filingType, setFilingType] = useState<AgencyFilingType>("SURI_REGISTER_TAXPAYER");
  const [run, setRun] = useState<AgencyRunPublic | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [reconnectBusy, setReconnectBusy] = useState(false);
  /** Inline takeover: the user drives the embedded live browser directly.
   * No new window — the iframe stays interactive and an "I'm done" button
   * hands control back to the assistant. */
  const [takeover, setTakeover] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const poll = useCallback(async (runId: string) => {
    const response = await fetch(`/api/agency-runs/${runId}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error || L("Could not load run.", "No se pudo cargar la ejecución.", lang));
      return;
    }
    setRun(result.run as AgencyRunPublic);
  }, [lang]);

  useEffect(() => {
    if (!run?.id) return;
    if (run.status === "stopped" || run.status === "failed" || run.status === "review") return;
    // Keep polling while queued/running/paused so mock advances / Browser Use syncs.
    const handle = window.setInterval(() => {
      void poll(run.id);
    }, 900);
    return () => window.clearInterval(handle);
  }, [run?.id, run?.status, poll]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [run?.events.length]);

  // Leaving takeover mode whenever a different run loads.
  useEffect(() => {
    setTakeover(false);
  }, [run?.id]);

  const start = async () => {
    setBusy(true);
    setError(null);
    setUploadMsg(null);
    try {
      const response = await fetch("/api/agency-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ business_id: businessId, filing_type: filingType }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || L("Could not start run.", "No se pudo iniciar la ejecución.", lang));
        return;
      }
      setRun(result.run as AgencyRunPublic);
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/agency-runs/${run.id}/resume`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || L("Could not resume.", "No se pudo reanudar.", lang));
        return;
      }
      setRun(result.run as AgencyRunPublic);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/agency-runs/${run.id}/stop`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || L("Could not stop.", "No se pudo detener.", lang));
        return;
      }
      setRun(result.run as AgencyRunPublic);
    } finally {
      setBusy(false);
    }
  };

  const reconnectPreview = async () => {
    if (!run?.live_url) return;
    setReconnectBusy(true);
    try {
      await poll(run.id);
    } finally {
      // Remount the iframe so the Browser Use viewer re-establishes its
      // stream, even when live_url itself did not change.
      setPreviewKey((k) => k + 1);
      setReconnectBusy(false);
    }
  };

  const enterTakeover = () => setTakeover(true);
  const exitTakeover = () => setTakeover(false);

  const uploadToLocker = async (file: File) => {
    setUploadBusy(true);
    setUploadMsg(null);
    try {
      if (file.size > 5 * 1024 * 1024) {
        setUploadMsg(
          L(
            "Portal attachments max 5 MB — compress or crop before upload.",
            "Adjuntos del portal máx. 5 MB — comprima o recorte antes de subir.",
            lang
          )
        );
        return;
      }
      const form = new FormData();
      form.append("file", file);
      form.append("business_id", businessId);
      form.append("requirement_tags", activeConfig.evidenceTags.join(","));
      const response = await fetch("/api/evidence", { method: "POST", body: form });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setUploadMsg(result.error || L("Upload failed.", "La subida falló.", lang));
        return;
      }
      setUploadMsg(
        L(
          "Saved to Evidence Locker. Resume when all required docs are ready.",
          "Guardado en el Casillero de evidencia. Reanude cuando tenga todos los documentos.",
          lang
        )
      );
    } catch {
      setUploadMsg(L("Upload failed.", "La subida falló.", lang));
    } finally {
      setUploadBusy(false);
    }
  };

  const latestShot = useMemo(() => {
    if (!run?.events.length) return null;
    return run.events[run.events.length - 1];
  }, [run]);

  const filmstrip = useMemo(() => {
    if (!run) return [];
    return run.events.filter((e) => e.screenshot_url).slice(-6);
  }, [run]);

  const showPreflight = !run;
  const paused = run?.status === "paused";
  const inReview = run?.status === "review";
  // Active filing config: the run's type once started, otherwise the picker's selection.
  const activeConfig = getFilingConfig(run ? run.filing_type : filingType);
  const preflightConfig = getFilingConfig(filingType);

  return (
    <div className="min-h-screen bg-[#f4f1ea]">
      <TopNav active="businesses" />
      <main className="mx-auto max-w-7xl px-5 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/businesses/${businessId}`} className="text-sm font-semibold text-brand">
            ← {L("Business profile", "Perfil del negocio", lang)}
          </Link>
          {run && <StatusPill status={run.status} lang={lang} />}
        </div>

        <header className="mt-3 rounded-2xl border border-[#161616]/15 bg-[#fbf8f2] p-6 text-[#161616]">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand">
              <Bot className="h-5 w-5 text-white" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand">
                {L("Agency assistant", "Asistente de agencia", lang)}
              </p>
              <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-medium tracking-tight md:text-4xl">
                {L("Agency live visual run", "Ejecución visual en vivo de agencia", lang)}
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-[#5a5a5a]">
                {L(
                  "Assisted government filing with live browser preview when the agent provider is configured. Mock timeline runs otherwise.",
                  "Trámite de gobierno asistido con vista previa en vivo cuando el proveedor del agente está configurado. Línea de tiempo simulada en caso contrario.",
                  lang
                )}
              </p>
              {run?.provider && run.provider !== "mock" && (
                <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
                  {run.provider === "browser_use_cloud" ? (
                    <Cloud className="h-3.5 w-3.5 text-sky-600" />
                  ) : (
                    <Server className="h-3.5 w-3.5 text-violet-600" />
                  )}
                  {run.provider === "browser_use_cloud"
                    ? L("Powered by Browser Use Cloud", "Con tecnología de Browser Use Cloud", lang)
                    : L("Powered by self-hosted agent (Grok)", "Con tecnología de agente propio (Grok)", lang)}
                </p>
              )}
            </div>
          </div>
        </header>

        {error && (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        )}

        {showPreflight && (
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-950/[0.02]">
            <h2 className="font-bold text-[#161616]">
              {L("Preflight", "Verificación previa", lang)}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {L(
                "Vault / passport coverage will prefill non-sensitive fields. Sensitive IDs stay with you.",
                "La cobertura del casillero / pasaporte rellenará campos no sensibles. Los ID sensibles quedan con usted.",
                lang
              )}
            </p>

            <label className="mt-5 block">
              <span className="mb-1 block text-xs font-bold text-slate-600">
                {L("Filing type", "Tipo de trámite", lang)}
              </span>
              <select
                value={filingType}
                onChange={(e) => setFilingType(e.target.value as AgencyFilingType)}
                className="w-full max-w-xl rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-[#161616]"
              >
                {AGENCY_FILING_CONFIGS.map((c) => (
                  <option
                    key={c.id}
                    value={c.id}
                    disabled={!c.enabled || c.requiresExistingAccount}
                  >
                    {L(c.labelEn, c.labelEs, lang)}
                    {c.requiresExistingAccount
                      ? L(" — requires an existing portal account", " — requiere una cuenta existente en el portal", lang)
                      : ""}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/80 p-4">
              <div className="flex items-start gap-2">
                <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" />
                <div className="text-sm text-amber-950">
                  <div className="font-bold">{L("Hard rules", "Reglas firmes", lang)}</div>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-amber-900/90">
                    <li>{L("Agent never clicks final submit — you submit on the portal.", "El agente nunca hace clic en enviar — usted envía en el portal.", lang)}</li>
                    <li>{L(`Domain allowlist: ${preflightConfig.domains.join(", ")} only.`, `Dominio permitido: solo ${preflightConfig.domains.join(", ")}.`, lang)}</li>
                    <li>{L("Pauses for uploads, login/MFA, and captcha.", "Pausa para adjuntos, inicio de sesión/MFA y captcha.", lang)}</li>
                    <li>{L("Prefill from Business Passport; sensitive IDs are not stored.", "Relleno desde el Pasaporte de Negocio; los ID sensibles no se almacenan.", lang)}</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-[#f4f1ea] p-4 text-sm text-slate-700">
              <div className="font-bold text-[#161616]">{L("Gotcha hints from recon", "Avisos de reconocimiento", lang)}</div>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                {(lang === "es" ? preflightConfig.hintsEs : preflightConfig.hintsEn).map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={() => void start()}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand px-6 py-3 text-sm font-medium text-[#f6f3ea] disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              {busy
                ? L("Starting…", "Iniciando…", lang)
                : L("Start agency run", "Iniciar ejecución con agencia", lang)}
            </button>
          </section>
        )}

        {run && (
          <div className="relative mt-6 grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            {/* Step log */}
            <aside className="flex max-h-[70vh] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.02]">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-bold text-[#161616]">
                  {L("Step log", "Registro de pasos", lang)}
                </h2>
                <StatusPill status={run.status} lang={lang} />
              </div>
              <ol className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
                {run.events.map((event) => (
                  <li
                    key={event.index}
                    className={`rounded-xl border px-3 py-2 text-xs ${
                      event.kind === "pause"
                        ? "border-amber-200 bg-amber-50 text-amber-950"
                        : event.kind === "review"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-950"
                          : "border-slate-100 bg-slate-50 text-slate-700"
                    }`}
                  >
                    <div className="font-semibold text-[10px] uppercase tracking-wide text-slate-400">
                      #{event.index + 1}
                    </div>
                    <div className="mt-0.5 leading-snug">
                      {lang === "es" ? event.message_es : event.message}
                    </div>
                  </li>
                ))}
                <div ref={logEndRef} />
              </ol>
              <div className="flex gap-2 border-t border-slate-100 p-3">
                {paused && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resume()}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" />
                    {L("Resume", "Reanudar", lang)}
                  </button>
                )}
                {run.status !== "stopped" && run.status !== "review" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void stop()}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    <Square className="h-3.5 w-3.5" />
                    {L("Stop", "Detener", lang)}
                  </button>
                )}
                {(run.status === "stopped" || run.status === "review") && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setRun(null);
                      setError(null);
                      setUploadMsg(null);
                    }}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white"
                  >
                    {L("New run", "Nueva ejecución", lang)}
                  </button>
                )}
              </div>
            </aside>

            {/* Live browser / screenshot panel */}
            <section className="relative flex min-h-[70vh] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.02]">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-bold text-[#161616]">
                  {run.live_url
                    ? L("Assisted browser (live)", "Navegador asistido (en vivo)", lang)
                    : run.worker === "browser_use"
                      ? L("Assisted browser", "Navegador asistido", lang)
                      : L("Assisted browser (mock)", "Navegador asistido (simulado)", lang)}
                </h2>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium text-slate-400">
                    {run.live_url
                      ? L(`Live preview — ${activeConfig.domains[0]}`, `Vista previa en vivo — ${activeConfig.domains[0]}`, lang)
                      : L("Screenshots / placeholders", "Capturas / marcadores", lang)}
                  </span>
                  {takeover && run.live_url ? (
                    <button
                      type="button"
                      onClick={exitTakeover}
                      title={L(
                        "Hand control back to the agency assistant",
                        "Devolver el control al asistente de agencia",
                        lang
                      )}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:brightness-95"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {L("I'm done", "Terminé", lang)}
                    </button>
                  ) : (
                    <>
                      {run.live_url && (
                        <button
                          type="button"
                          disabled={reconnectBusy}
                          onClick={() => void reconnectPreview()}
                          title={L("Reload the live preview stream", "Recargar la vista previa en vivo", lang)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <RefreshCw className="h-3 w-3" />
                          {reconnectBusy
                            ? L("Reconnecting…", "Reconectando…", lang)
                            : L("Reconnect", "Reconectar", lang)}
                        </button>
                      )}
                      {run.live_url &&
                        (run.status === "queued" || run.status === "running" || run.status === "paused") && (
                          <button
                            type="button"
                            onClick={enterTakeover}
                            title={L(
                              "Click and type directly inside the live browser below",
                              "Haz clic y escribe directamente dentro del navegador en vivo",
                              lang
                            )}
                            className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/5 px-2 py-1 text-[11px] font-semibold text-brand hover:bg-brand/10"
                          >
                            <KeyRound className="h-3 w-3" />
                            {L("Take over", "Tomar control", lang)}
                          </button>
                        )}
                    </>
                  )}
                </div>
              </div>

              <div className="relative flex flex-1 flex-col bg-slate-900/5 p-3">
                {takeover && run.live_url && (
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
                    <KeyRound className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                    <span>
                      {L(
                        "You're in control — click and type directly inside the browser below. Press “I'm done” (top right) when finished to hand it back to the assistant.",
                        "Tienes el control — haz clic y escribe directamente dentro del navegador. Pulsa “Terminé” (arriba a la derecha) cuando acabes para devolverlo al asistente.",
                        lang
                      )}
                    </span>
                  </div>
                )}
                <div
                  className={`relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-slate-100 shadow-inner ${
                    takeover ? "border-2 border-amber-400" : "border border-slate-200"
                  }`}
                >
                  {run.live_url ? (
                    <iframe
                      key={previewKey}
                      src={run.live_url}
                      title={L("Live Browser Use session", "Sesión Browser Use en vivo", lang)}
                      className="h-full w-full border-0 bg-white"
                      allow="clipboard-read; clipboard-write; autoplay"
                      referrerPolicy="no-referrer"
                    />
                  ) : latestShot ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={latestShot.screenshot_url}
                      alt={lang === "es" ? latestShot.message_es : latestShot.message}
                      className="h-full w-full object-cover object-top"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-slate-400">
                      {L("Waiting for first frame…", "Esperando el primer fotograma…", lang)}
                    </div>
                  )}

                  {/* Pause overlay — hidden during inline takeover so the user
                      can click inside the live browser. Resume/Stop stay
                      available in the sidebar. */}
                  {paused && !takeover && (
                    <PauseOverlay
                      lang={lang}
                      reason={run.pause_reason}
                      busy={busy}
                      uploadBusy={uploadBusy}
                      uploadMsg={uploadMsg}
                      fileRef={fileRef}
                      liveUrl={run.live_url}
                      portalName={L(activeConfig.portalEn, activeConfig.portalEs, lang)}
                      uploadsText={L(activeConfig.uploadsEn, activeConfig.uploadsEs, lang)}
                      onResume={() => void resume()}
                      onStop={() => void stop()}
                      onTakeover={enterTakeover}
                      onUpload={(file) => void uploadToLocker(file)}
                    />
                  )}

                  {/* Review overlay — hidden during inline takeover. */}
                  {inReview && !takeover && (
                    <div className="absolute inset-0 flex items-end justify-center bg-gradient-to-t from-slate-950/70 via-slate-950/20 to-transparent p-6">
                      <div className="w-full max-w-lg rounded-2xl border border-emerald-200 bg-white p-5 shadow-xl">
                        <div className="flex items-start gap-3">
                          <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-600" />
                          <div>
                            <div className="font-bold text-[#161616]">
                              {L("You submit on the portal", "Usted envía en el portal", lang)}
                            </div>
                            <p className="mt-1 text-sm text-slate-600">
                              {L(
                                "Review the last screenshot. The agency assistant never clicks final submit. When ready, take over the browser below and complete submission yourself directly in the live browser on this page.",
                                "Revise la última captura. El asistente nunca hace clic en enviar. Cuando esté listo, tome el control del navegador abajo y complete el envío usted mismo directamente en el navegador en vivo de esta página.",
                                lang
                              )}
                            </p>
                            {run.live_url && (
                              <button
                                type="button"
                                onClick={enterTakeover}
                                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white"
                              >
                                <KeyRound className="h-3.5 w-3.5" />
                                {L("Take over the browser to submit", "Tome el control del navegador para enviar", lang)}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => void stop()}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
                            >
                              <Square className="h-3.5 w-3.5" />
                              {L("Close run", "Cerrar ejecución", lang)}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Filmstrip — screenshots when not embedding live preview */}
                {!run.live_url && filmstrip.length > 0 && (
                  <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                    {filmstrip.map((frame) => (
                      <div
                        key={frame.index}
                        className="h-16 w-28 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white"
                        title={lang === "es" ? frame.message_es : frame.message}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={frame.screenshot_url} alt="" className="h-full w-full object-cover object-top" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function PauseOverlay({
  lang,
  reason,
  busy,
  uploadBusy,
  uploadMsg,
  fileRef,
  liveUrl,
  portalName,
  uploadsText,
  onResume,
  onStop,
  onTakeover,
  onUpload,
}: {
  lang: Lang;
  reason: AgencyPauseReason;
  busy: boolean;
  uploadBusy: boolean;
  uploadMsg: string | null;
  fileRef: React.RefObject<HTMLInputElement | null>;
  liveUrl: string | null;
  portalName: string;
  uploadsText: string;
  onResume: () => void;
  onStop: () => void;
  onTakeover: () => void;
  onUpload: (file: File) => void;
}) {
  const icon =
    reason === "USER_UPLOAD" ? (
      <FileUp className="h-6 w-6 text-amber-700" />
    ) : reason === "USER_LOGIN" ? (
      <KeyRound className="h-6 w-6 text-amber-700" />
    ) : reason === "PAYMENT" ? (
      <CreditCard className="h-6 w-6 text-amber-700" />
    ) : (
      <PauseCircle className="h-6 w-6 text-amber-700" />
    );

  const title =
    reason === "USER_UPLOAD"
      ? L("Upload required documents", "Suba los documentos requeridos", lang)
      : reason === "USER_LOGIN"
        ? L(`Your turn — log into ${portalName}`, `Te toca a ti — inicia sesión en ${portalName}`, lang)
        : reason === "CAPTCHA"
          ? L("Complete captcha", "Complete el captcha", lang)
          : reason === "PAYMENT"
            ? L("Complete payment", "Complete el pago", lang)
            : L("Paused for your action", "Pausado para su acción", lang);

  const body =
    reason === "USER_UPLOAD"
      ? L(
          `${uploadsText}. Max 5 MB per file. Upload into Evidence Locker, then Resume.`,
          `${uploadsText}. Máx. 5 MB por archivo. Suba al Casillero de evidencia y luego Reanudar.`,
          lang
        )
      : reason === "USER_LOGIN"
        ? L(
            `Press "Take over the browser" below and type your ${portalName} username, password, and MFA code directly in the live browser on this page. What you type is private — nobody at SmartPR, admins included, can see this session. When you're logged in, press "I'm done" (top right), then Resume.`,
            `Pulsa "Tomar el control del navegador" abajo y escribe tu usuario, contraseña y código MFA de ${portalName} directamente en el navegador en vivo de esta página. Lo que escribas es privado — nadie en SmartPR, ni los administradores, puede ver esta sesión. Cuando entres, pulsa "Terminé" (arriba a la derecha) y luego Reanudar.`,
            lang
          )
        : reason === "CAPTCHA"
          ? L(
              'This one needs a human touch. Press "Take over the browser", complete the captcha or challenge directly in the live browser on this page, then press "I\'m done" (top right) and Resume.',
              'Esto necesita toque humano. Pulsa "Tomar el control del navegador", completa el captcha o el desafío directamente en el navegador en vivo de esta página, luego pulsa "Terminé" (arriba a la derecha) y Reanudar.',
              lang
            )
          : reason === "PAYMENT"
            ? L(
                'Payment is always yours to make — the assistant never touches it. Press "Take over the browser" and pay directly in the live browser on this page, then press "I\'m done" (top right) and Resume.',
                'El pago siempre lo haces tú — el asistente nunca lo toca. Pulsa "Tomar el control del navegador" y paga directamente en el navegador en vivo de esta página, luego pulsa "Terminé" (arriba a la derecha) y Reanudar.',
                lang
              )
            : L("Take the required action, then Resume.", "Realice la acción requerida y luego Reanudar.", lang);

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-5 shadow-xl">
        <div className="flex items-start gap-3">
          {icon}
          <div className="min-w-0 flex-1">
            <div className="font-bold text-[#161616]">{title}</div>
            <p className="mt-1 text-sm text-slate-600">{body}</p>

            {reason === "USER_UPLOAD" && (
              <div className="mt-3 space-y-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
                  <AlertTriangle className="mr-1 inline h-3 w-3 text-amber-600" />
                  {L(
                    "Remember Verify Address on the name/address step; attachments cannot be skipped.",
                    "Recuerde Verificar dirección en nombre/dirección; los adjuntos no se pueden omitir.",
                    lang
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,image/*,.doc,.docx"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) onUpload(file);
                  }}
                />
                <button
                  type="button"
                  disabled={uploadBusy}
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-800 disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {uploadBusy
                    ? L("Uploading…", "Subiendo…", lang)
                    : L("Upload to Evidence Locker", "Subir al Casillero de evidencia", lang)}
                </button>
                {uploadMsg && <p className="text-xs text-slate-600">{uploadMsg}</p>}
              </div>
            )}

            {reason === "USER_LOGIN" && liveUrl && (
              <button
                type="button"
                onClick={onTakeover}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2.5 text-xs font-semibold text-white"
              >
                <KeyRound className="h-3.5 w-3.5" />
                {L("Take over the browser", "Tomar el control del navegador", lang)}
              </button>
            )}

            {(reason === "CAPTCHA" || reason === "PAYMENT") && liveUrl && (
              <button
                type="button"
                onClick={onTakeover}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2.5 text-xs font-semibold text-white"
              >
                <KeyRound className="h-3.5 w-3.5" />
                {L("Take over the browser", "Tomar el control del navegador", lang)}
              </button>
            )}

            {reason === "USER_UPLOAD" && liveUrl && (
              <button
                type="button"
                onClick={onTakeover}
                className="mt-2 w-full text-center text-xs font-semibold text-brand underline underline-offset-2"
              >
                {L(
                  "Or take over the browser to attach files directly on the portal",
                  "O toma el control del navegador para adjuntar los archivos directamente en el portal",
                  lang
                )}
              </button>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={onResume}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                <Play className="h-3.5 w-3.5" />
                {L("Resume", "Reanudar", lang)}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onStop}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
              >
                <Square className="h-3.5 w-3.5" />
                {L("Stop", "Detener", lang)}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

