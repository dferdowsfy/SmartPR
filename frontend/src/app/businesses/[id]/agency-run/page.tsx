"use client";

/**
 * Agency assistant live run panel.
 * Browser Use Cloud when BROWSER_USE_API_KEY is set; mock timeline otherwise.
 */
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, Bot, CheckCircle2, Cloud, CreditCard, Eye, EyeOff, FileUp, KeyRound, Loader2, Maximize2,
  Minimize2, PauseCircle, Play, RefreshCw, Server, Shield, Square, Upload,
} from "lucide-react";
import { TopNav } from "../../../history/ui";
import { useLang } from "../../../useLang";
import type { Lang } from "../../../forms/engine/types";
import type {
  AgencyFilingType,
  AgencyPauseReason,
  AgencyPendingField,
  AgencyRunPublic,
  AgencyRunStatus,
} from "../../../../lib/agency-runs/types";
import {
  AGENCY_FILING_CONFIGS,
  getFilingConfig,
} from "../../../../lib/agency-runs/filingTypes";
import {
  collectPortalValidationMessages,
  DEFAULT_LOGIN_PENDING_FIELDS,
  fieldHasValidationIssue,
  VALIDATION_HINT_RE,
} from "../../../../lib/agency-runs/pendingFields";
import {
  mergeFieldsWithPassportPrefill,
  prefillFromPassport,
} from "../../../../lib/agency-runs/prefillFromPassport";

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
  /** Pending-field values typed in the Assistant panel (single input surface).
   * Never mirrored into event messages — only POSTed to resume as `{ fields }`. */
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  /** Client-only show/hide for sensitive Assistant inputs — never persisted. */
  const [revealedFields, setRevealedFields] = useState<Record<string, boolean>>({});
  const firstEmptyFieldRef = useRef<HTMLInputElement | null>(null);
  const prefillSeedKeyRef = useRef<string>("");
  /** Tracks whether the live preview iframe has rendered its first frame —
   * drives the loading animation while the Cloud session spins up. */
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Fullscreen (maximized) live browser panel. */
  const previewSectionRef = useRef<HTMLElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
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
    setFieldValues({});
    setRevealedFields({});
    prefillSeedKeyRef.current = "";
  }, [run?.id]);

  // Reset the preview loading animation whenever the stream is (re)created.
  useEffect(() => {
    setPreviewLoaded(false);
  }, [previewKey, run?.id, run?.live_url]);

  // Track browser fullscreen state for the maximize/restore button.
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void previewSectionRef.current?.requestFullscreen().catch(() => {});
    }
  };

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

  const resume = async (fields?: Record<string, string>) => {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const cleaned: Record<string, string> = {};
      if (fields) {
        for (const [id, value] of Object.entries(fields)) {
          const v = typeof value === "string" ? value.trim() : "";
          if (id && v) cleaned[id] = v;
        }
      }
      const hasFields = Object.keys(cleaned).length > 0;
      const response = await fetch(`/api/agency-runs/${run.id}/resume`, {
        method: "POST",
        headers: hasFields ? { "Content-Type": "application/json" } : undefined,
        body: hasFields ? JSON.stringify({ fields: cleaned }) : undefined,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || L("Could not resume.", "No se pudo reanudar.", lang));
        return;
      }
      setRun(result.run as AgencyRunPublic);
      // Keep fieldValues in React state so a re-pause with the same ids can
      // edit in place (portal validation errors). Cleared only on new run id.
      setTakeover(false);
    } finally {
      setBusy(false);
    }
  };

  const setFieldValue = (id: string, value: string) => {
    setFieldValues((prev) => ({ ...prev, [id]: value }));
  };

  const toggleRevealField = (id: string) => {
    setRevealedFields((prev) => ({ ...prev, [id]: !prev[id] }));
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

  /** Enter inline takeover — also logs the handoff to the Assistant panel so the
   * on-screen notifications reflect that the user is in control. */
  const enterTakeover = async () => {
    setTakeover(true);
    if (!run) return;
    try {
      const response = await fetch(`/api/agency-runs/${run.id}/takeover`, { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.run) setRun(result.run as AgencyRunPublic);
    } catch {
      // Best-effort logging only — takeover itself never depends on it.
    }
  };
  /** "I'm done" — exit takeover mode AND hand control back to the agent in one tap. */
  const handBackToAgent = async () => {
    setTakeover(false);
    await resume();
  };

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

  /** Fields to render in the Assistant panel while paused. */
  const pendingFields: AgencyPendingField[] = useMemo(() => {
    if (!run || run.status !== "paused") return [];
    if (run.pending_fields?.length) return run.pending_fields;
    // Client-side fallback if API omitted pending_fields on USER_LOGIN (preserve #88 UX).
    if (run.pause_reason === "USER_LOGIN") return DEFAULT_LOGIN_PENDING_FIELDS;
    return [];
  }, [run]);

  /** Text-field pause: Assistant is the only place to type; live browser is view-only. */
  const fieldsPause =
    Boolean(run && run.status === "paused") &&
    (pendingFields.length > 0 || run?.pause_reason === "USER_LOGIN");

  // Seed non-sensitive values from passport whenever a new fields pause appears.
  useEffect(() => {
    if (!run || run.status !== "paused" || pendingFields.length === 0) return;
    const seedKey = `${run.id}:${run.pause_reason || ""}:${pendingFields.map((f) => f.id).join(",")}`;
    if (prefillSeedKeyRef.current === seedKey) return;
    prefillSeedKeyRef.current = seedKey;
    const seeded = prefillFromPassport(pendingFields, run.passport_snapshot);
    setFieldValues((prev) => {
      const next = { ...prev };
      for (const [id, value] of Object.entries(seeded)) {
        if (!(next[id] || "").trim()) next[id] = value;
      }
      return next;
    });
    // Sensitive non-password fields (SSN/ITIN) default to shown so format is
    // easy to verify; actual passwords stay masked until the user toggles.
    const defaults: Record<string, boolean> = {};
    for (const f of pendingFields) {
      if ((f.sensitive || f.type === "password") && f.type !== "password") {
        defaults[f.id] = true;
      }
    }
    setRevealedFields(defaults);
  }, [run, pendingFields]);

  // Auto-focus the first empty required field when a fields pause appears.
  useEffect(() => {
    if (!fieldsPause || takeover) return;
    const handle = window.setTimeout(() => {
      firstEmptyFieldRef.current?.focus();
    }, 50);
    return () => window.clearTimeout(handle);
  }, [fieldsPause, takeover, pendingFields, run?.id]);

  const fillAndContinue = async () => {
    if (!run) return;
    const merged = mergeFieldsWithPassportPrefill(
      pendingFields,
      fieldValues,
      run.passport_snapshot
    );
    await resume(merged);
  };

  const canFillFields = pendingFields.some((f) => {
    if (f.optional) return false;
    return Boolean((fieldValues[f.id] || "").trim());
  }) || pendingFields.some((f) => Boolean((fieldValues[f.id] || "").trim()));

  const portalValidationMessages = useMemo(
    () => collectPortalValidationMessages(pendingFields),
    [pendingFields]
  );
  const showValidationBanner =
    portalValidationMessages.length > 0 ||
    pendingFields.some((f) => fieldHasValidationIssue(f));

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
            {/* Assistant panel (chat-like required-field inputs + event feed) */}
            <aside className="flex max-h-[70vh] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.02]">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <h2 className="text-sm font-bold text-[#161616]">
                  {L("Assistant", "Asistente", lang)}
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
              {paused && pendingFields.length > 0 && (
                <div className="space-y-2 border-t border-amber-100 bg-amber-50/60 px-3 py-3">
                  {showValidationBanner && (
                    <div
                      role="alert"
                      className="flex gap-2 rounded-lg border border-rose-300 bg-rose-50 px-2.5 py-2 text-[11px] leading-snug text-rose-950"
                    >
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                      <div>
                        <div className="font-bold text-rose-900">
                          {L(
                            "Portal rejected a value — fix below",
                            "El portal rechazó un valor — corríjalo abajo",
                            lang
                          )}
                        </div>
                        {portalValidationMessages.length > 0 ? (
                          <p className="mt-1 text-rose-900/90">
                            {portalValidationMessages.join(" · ")}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-900">
                    <KeyRound className="h-3.5 w-3.5" />
                    {L("Required fields", "Campos requeridos", lang)}
                  </div>
                  <p className="text-[11px] leading-snug text-amber-900/80">
                    {L(
                      "Type only here in Assistant — the live browser is view-only. Non-sensitive values are prefilled from your passport when possible. Values are never stored.",
                      "Escriba solo aquí en Asistente — el navegador en vivo es solo lectura. Los valores no sensibles se rellenan desde su pasaporte cuando es posible. Los valores nunca se almacenan.",
                      lang
                    )}
                  </p>
                  {pendingFields.map((field, index) => {
                    const isSensitive = field.sensitive || field.type === "password";
                    const revealed = Boolean(revealedFields[field.id]);
                    const emptyRequired =
                      !field.optional && !(fieldValues[field.id] || "").trim();
                    const isFirstEmpty =
                      emptyRequired &&
                      pendingFields.findIndex(
                        (f) => !f.optional && !(fieldValues[f.id] || "").trim()
                      ) === index;
                    const inputType = isSensitive
                      ? revealed
                        ? "text"
                        : "password"
                      : field.type === "email"
                        ? "email"
                        : field.type === "tel"
                          ? "tel"
                          : field.type === "number"
                            ? "number"
                            : "text";
                    return (
                      <label key={field.id} className="block">
                        <span className="sr-only">
                          {field.label}
                          {field.optional ? L(" (optional)", " (opcional)", lang) : ""}
                        </span>
                        <div className="relative">
                          <input
                            ref={isFirstEmpty ? firstEmptyFieldRef : undefined}
                            type={inputType}
                            autoComplete={
                              field.id === "email" || field.id.endsWith("_email")
                                ? "username"
                                : field.id === "password"
                                  ? "current-password"
                                  : field.id === "mfa"
                                    ? "one-time-code"
                                    : "off"
                            }
                            inputMode={
                              field.id === "mfa" ||
                              field.type === "tel" ||
                              /ssn|itin|tax_id/i.test(field.id)
                                ? "numeric"
                                : undefined
                            }
                            value={fieldValues[field.id] || ""}
                            onChange={(e) => setFieldValue(field.id, e.target.value)}
                            placeholder={
                              field.optional
                                ? `${field.label}${L(" (optional)", " (opcional)", lang)}`
                                : field.label
                            }
                            className={`w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand ${
                              isSensitive ? "pr-9" : ""
                            }`}
                          />
                          {isSensitive && (
                            <button
                              type="button"
                              onClick={() => toggleRevealField(field.id)}
                              className="absolute inset-y-0 right-0 flex items-center px-2 text-slate-500 hover:text-slate-800"
                              aria-label={
                                revealed
                                  ? L("Hide value", "Ocultar valor", lang)
                                  : L("Show value", "Mostrar valor", lang)
                              }
                              title={
                                revealed
                                  ? L("Hide", "Ocultar", lang)
                                  : L("Show", "Mostrar", lang)
                              }
                            >
                              {revealed ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                        {field.error ? (
                          <p className="mt-1 text-[10px] font-medium leading-snug text-rose-700">
                            {field.error}
                          </p>
                        ) : null}
                        {field.hint ? (
                          <p
                            className={`mt-1 text-[10px] leading-snug ${
                              !field.error && VALIDATION_HINT_RE.test(field.hint)
                                ? "font-medium text-rose-700"
                                : "text-slate-500"
                            }`}
                          >
                            {field.hint}
                          </p>
                        ) : null}
                      </label>
                    );
                  })}
                  <button
                    type="button"
                    disabled={busy || !canFillFields}
                    onClick={() => void fillAndContinue()}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" />
                    {L("Fill & continue", "Llenar y continuar", lang)}
                  </button>
                  {run.live_url && (
                    <button
                      type="button"
                      onClick={() => void enterTakeover()}
                      className="w-full text-center text-[11px] font-medium text-slate-500 underline-offset-2 hover:text-brand hover:underline"
                    >
                      {L(
                        "Need to solve a captcha or weird UI? Take over instead",
                        "¿Necesita resolver un captcha o una UI rara? Tome el control en su lugar",
                        lang
                      )}
                    </button>
                  )}
                </div>
              )}
              <div className="flex gap-2 border-t border-slate-100 p-3">
                {paused && pendingFields.length === 0 && (
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
                {(run.status === "stopped" || run.status === "review" || run.status === "failed") && (
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
                    {run.status === "failed"
                      ? L("Try again", "Intentar de nuevo", lang)
                      : L("New run", "Nueva ejecución", lang)}
                  </button>
                )}
              </div>
            </aside>

            {/* Live browser / screenshot panel */}
            <section
              ref={previewSectionRef}
              className="relative flex min-h-[70vh] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-950/[0.02]"
            >
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
                  {run.live_url && (
                    <button
                      type="button"
                      onClick={toggleFullscreen}
                      title={
                        isFullscreen
                          ? L("Exit fullscreen", "Salir de pantalla completa", lang)
                          : L("Maximize browser", "Maximizar navegador", lang)
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      {isFullscreen ? (
                        <Minimize2 className="h-3 w-3" />
                      ) : (
                        <Maximize2 className="h-3 w-3" />
                      )}
                      {isFullscreen
                        ? L("Restore", "Restaurar", lang)
                        : L("Maximize", "Maximizar", lang)}
                    </button>
                  )}
                  {takeover && run.live_url ? (
                    <button
                      type="button"
                      onClick={() => void handBackToAgent()}
                      disabled={busy}
                      title={L(
                        "Hand control back to the agency assistant",
                        "Devolver el control al asistente de agencia",
                        lang
                      )}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:brightness-95 disabled:opacity-60"
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      )}
                      {busy
                        ? L("Handing back…", "Devolviendo…", lang)
                        : L("I'm done", "Terminé", lang)}
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
                            onClick={() => void enterTakeover()}
                            title={
                              fieldsPause
                                ? L(
                                    "Need to solve a captcha or weird UI? Take over instead",
                                    "¿Necesita resolver un captcha o una UI rara? Tome el control en su lugar",
                                    lang
                                  )
                                : L(
                                    "Click and type directly inside the live browser below",
                                    "Haz clic y escribe directamente dentro del navegador en vivo",
                                    lang
                                  )
                            }
                            className={
                              fieldsPause
                                ? "inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
                                : "inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/5 px-2 py-1 text-[11px] font-semibold text-brand hover:bg-brand/10"
                            }
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
                {fieldsPause && !takeover && run.live_url && (
                  <div className="mb-2 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-950">
                    <KeyRound className="h-3.5 w-3.5 shrink-0 text-sky-700" />
                    <span>
                      {L(
                        "Fill the fields in Assistant on the left — don't type in this browser.",
                        "Complete los campos en Asistente a la izquierda — no escriba en este navegador.",
                        lang
                      )}
                    </span>
                  </div>
                )}
                <div
                  className={`relative w-full overflow-hidden rounded-xl bg-slate-100 shadow-inner ${
                    isFullscreen ? "min-h-0 flex-1" : "aspect-[16/10]"
                  } ${takeover ? "border-2 border-amber-400" : "border border-slate-200"}`}
                >
                  {run.live_url ? (
                    <>
                      <iframe
                        key={previewKey}
                        src={run.live_url}
                        title={L("Live Browser Use session", "Sesión Browser Use en vivo", lang)}
                        className={`h-full w-full border-0 bg-white ${
                          fieldsPause && !takeover ? "pointer-events-none" : ""
                        }`}
                        allow="clipboard-read; clipboard-write; autoplay"
                        referrerPolicy="no-referrer"
                        onLoad={() => setPreviewLoaded(true)}
                      />
                      {fieldsPause && !takeover && (
                        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-2">
                          <div className="rounded-full border border-sky-200/80 bg-sky-50/95 px-3 py-1 text-[11px] font-semibold text-sky-950 shadow-sm backdrop-blur-sm">
                            {L(
                              "Fill the fields in Assistant on the left — don't type in this browser.",
                              "Complete los campos en Asistente a la izquierda — no escriba en este navegador.",
                              lang
                            )}
                          </div>
                        </div>
                      )}
                      {!previewLoaded && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white">
                          <Loader2 className="h-8 w-8 animate-spin text-brand" />
                          <p className="text-sm font-semibold text-slate-600">
                            {L(
                              "Starting secure browser session…",
                              "Iniciando sesión segura del navegador…",
                              lang
                            )}
                          </p>
                          <p className="max-w-xs text-center text-xs text-slate-400">
                            {L(
                              "This can take up to a minute the first time while the cloud browser spins up.",
                              "Puede tardar hasta un minuto la primera vez mientras se inicia el navegador en la nube.",
                              lang
                            )}
                          </p>
                        </div>
                      )}
                    </>
                  ) : latestShot ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={latestShot.screenshot_url}
                      alt={lang === "es" ? latestShot.message_es : latestShot.message}
                      className="h-full w-full object-cover object-top"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 bg-white">
                      <Loader2 className="h-8 w-8 animate-spin text-brand" />
                      <div className="text-sm font-semibold text-slate-600">
                        {L("Waiting for first frame…", "Esperando el primer fotograma…", lang)}
                      </div>
                    </div>
                  )}

                  {/* Pause overlay — only for uploads / captcha / payment.
                      Field/login pauses use Assistant + the slim view-only
                      banner so the live portal (and its validation errors)
                      stay readable — no duplicate SSN form over the iframe. */}
                  {paused && !takeover && !fieldsPause && (
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
                      pauseStreak={run.pause_streak ?? 0}
                      onResume={() => void resume()}
                      onStop={() => void stop()}
                      onTakeover={() => void enterTakeover()}
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
  pauseStreak,
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
  pauseStreak: number;
  onResume: () => void;
  onStop: () => void;
  onTakeover: () => void;
  onUpload: (file: File) => void;
}) {
  // Field/login pauses never reach this overlay (gated by !fieldsPause above).
  // Keep a light, non-blurring chrome so captcha/payment still leave the live
  // page readable; uploads keep a centered card for the file UI.
  const isUpload = reason === "USER_UPLOAD";
  const isGate = reason === "CAPTCHA" || reason === "PAYMENT";

  const icon = isUpload ? (
    <FileUp className="h-6 w-6 text-amber-700" />
  ) : reason === "PAYMENT" ? (
    <CreditCard className="h-6 w-6 text-amber-700" />
  ) : (
    <PauseCircle className="h-6 w-6 text-amber-700" />
  );

  const title = isUpload
    ? L("Upload required documents", "Suba los documentos requeridos", lang)
    : reason === "CAPTCHA"
      ? L("Complete captcha", "Complete el captcha", lang)
      : reason === "PAYMENT"
        ? L("Complete payment", "Complete el pago", lang)
        : L("Paused for your action", "Pausado para su acción", lang);

  const body = isUpload
    ? L(
        `${uploadsText}. Max 5 MB per file. Upload into Evidence Locker, then Resume.`,
        `${uploadsText}. Máx. 5 MB por archivo. Suba al Casillero de evidencia y luego Reanudar.`,
        lang
      )
    : reason === "CAPTCHA"
      ? L(
          'This one needs a human touch. Press "Take over the browser", complete the captcha or challenge directly in the live browser on this page, then press "I\'m done" (top right) to hand it back to the assistant.',
          'Esto necesita toque humano. Pulsa "Tomar el control del navegador", completa el captcha o el desafío directamente en el navegador en vivo de esta página, luego pulsa "Terminé" (arriba a la derecha) para devolverle el control al asistente.',
          lang
        )
      : reason === "PAYMENT"
        ? L(
            'Payment is always yours to make — the assistant never touches it. Press "Take over the browser" and pay directly in the live browser on this page, then press "I\'m done" (top right) to hand it back to the assistant.',
            'El pago siempre lo haces tú — el asistente nunca lo toca. Pulsa "Tomar el control del navegador" y paga directamente en el navegador en vivo de esta página, luego pulsa "Terminé" (arriba a la derecha) para devolverle el control al asistente.',
            lang
          )
        : L("Take the required action, then Resume.", "Realice la acción requerida y luego Reanudar.", lang);

  const shellClass = isGate
    ? "absolute inset-0 flex items-end justify-center bg-gradient-to-t from-slate-950/55 via-slate-950/10 to-transparent p-4 pointer-events-none"
    : "absolute inset-0 flex items-center justify-center bg-slate-950/40 p-4";

  return (
    <div className={shellClass}>
      <div
        className={`w-full max-w-md rounded-2xl border border-amber-200 bg-white/95 p-5 shadow-xl ${
          isGate ? "pointer-events-auto mb-2" : ""
        }`}
      >
        <div className="flex items-start gap-3">
          {icon}
          <div className="min-w-0 flex-1">
            <div className="font-bold text-[#161616]">{title}</div>
            <p className="mt-1 text-sm text-slate-600">{body}</p>
            {portalName ? (
              <p className="mt-1 text-[11px] font-medium text-slate-400">{portalName}</p>
            ) : null}

            {isUpload && (
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

            {isGate && liveUrl && (
              <button
                type="button"
                onClick={onTakeover}
                className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2.5 text-xs font-semibold text-white"
              >
                <KeyRound className="h-3.5 w-3.5" />
                {L("Take over the browser", "Tomar el control del navegador", lang)}
              </button>
            )}

            {isUpload && liveUrl && (
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

            {pauseStreak >= 3 && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">
                {L(
                  `Still stuck on this step after ${pauseStreak} tries. Prefer Fill & continue from Assistant if fields are listed — or Take over only for captcha/odd UI, then press "I'm done".`,
                  `Sigue atascado en este paso después de ${pauseStreak} intentos. Prefiera Llenar y continuar desde Asistente si hay campos — o Tome el control solo para captcha/UI rara, luego pulse "Terminé".`,
                  lang
                )}
              </div>
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
