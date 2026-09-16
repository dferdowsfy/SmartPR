"use client";

/**
 * AgencyBrowser — the SECONDARY live-browser panel.
 *
 * The iframe stays mounted for the whole run (view switches only hide it with
 * CSS, never unmount it) so the session survives toggling. Desktop: right-side
 * collapsible panel. Mobile: full-screen sheet with a persistent back button.
 */
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, CreditCard, FileUp, KeyRound,
  Loader2, Maximize2, Minimize2, PauseCircle, Play, RefreshCw, Square, Upload,
} from "lucide-react";
import type { Lang } from "../../../forms/engine/types";
import type {
  AgencyPauseReason,
  AgencyRunPublic,
} from "../../../../lib/agency-runs/types";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

export interface AgencyBrowserProps {
  lang: Lang;
  run: AgencyRunPublic;
  open: boolean;
  onClose: () => void;
  portalName: string;
  uploadsText: string;
  domainsLabel: string;
  isMock: boolean;
  takeover: boolean;
  busy: boolean;
  previewKey: number;
  previewLoaded: boolean;
  onPreviewLoaded: () => void;
  reconnectBusy: boolean;
  onReconnect: () => void;
  onTakeover: () => void;
  onHandBack: () => void;
  onResume: () => void;
  onStop: () => void;
  fieldsPause: boolean;
  uploadBusy: boolean;
  uploadMsg: string | null;
  onUpload: (file: File) => void;
}

export function AgencyBrowser(props: AgencyBrowserProps) {
  const { lang, run } = props;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void sectionRef.current?.requestFullscreen().catch(() => {});
    }
  };

  const latestShot = run.events.length
    ? run.events[run.events.length - 1]
    : null;
  const filmstrip = run.events.filter((e) => e.screenshot_url).slice(-6);
  const paused = run.status === "paused";
  const inReview = run.status === "review";

  return (
    <section
      ref={sectionRef}
      className={
        props.open
          ? "fixed inset-0 z-50 flex min-h-0 flex-col bg-[#f4f1ea] lg:static lg:z-auto lg:min-h-0"
          : "hidden"
      }
      aria-label={L("Live browser", "Navegador en vivo", lang)}
    >
      {/* Mobile sheet header with persistent back button */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <button
          type="button"
          onClick={props.onClose}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {L("Back to chat", "Volver al chat", lang)}
        </button>
        <span className="ml-auto text-xs font-medium text-slate-400">
          {run.live_url
            ? L("Live session", "Sesión en vivo", lang)
            : L("Screenshots", "Capturas", lang)}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col rounded-none border-0 bg-white lg:rounded-2xl lg:border lg:border-slate-200 lg:shadow-sm lg:shadow-slate-950/[0.02]">
        <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-bold text-[#161616]">
            {run.live_url
              ? L("Assisted browser (live)", "Navegador asistido (en vivo)", lang)
              : props.isMock
                ? L("Assisted browser (mock)", "Navegador asistido (simulado)", lang)
                : L("Assisted browser", "Navegador asistido", lang)}
          </h2>
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] font-medium text-slate-400 xl:inline">
              {run.live_url
                ? L(`Live preview — ${props.domainsLabel}`, `Vista previa en vivo — ${props.domainsLabel}`, lang)
                : L("Screenshots / placeholders", "Capturas / marcadores", lang)}
            </span>
            {/* In fullscreen there is no chat visible — offer an explicit way
                back. Exits fullscreen AND closes the panel into the chat
                split view. */}
            {isFullscreen && (
              <button
                type="button"
                onClick={() => {
                  void document.exitFullscreen().catch(() => {});
                  props.onClose();
                }}
                className="hidden items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 lg:inline-flex"
              >
                <ArrowLeft className="h-3 w-3" />
                {L("Back to chat", "Volver al chat", lang)}
              </button>
            )}
            {run.live_url && (
              <button
                type="button"
                onClick={toggleFullscreen}
                title={
                  isFullscreen
                    ? L("Exit fullscreen", "Salir de pantalla completa", lang)
                    : L("Maximize browser", "Maximizar navegador", lang)
                }
                className="hidden items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 lg:inline-flex"
              >
                {isFullscreen ? (
                  <Minimize2 className="h-3 w-3" />
                ) : (
                  <Maximize2 className="h-3 w-3" />
                )}
                {isFullscreen ? L("Restore", "Restaurar", lang) : L("Maximize", "Maximizar", lang)}
              </button>
            )}
            {props.takeover && run.live_url ? (
              <button
                type="button"
                onClick={props.onHandBack}
                disabled={props.busy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-white shadow-sm hover:brightness-95 disabled:opacity-60"
              >
                {props.busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                {props.busy
                  ? L("Handing back…", "Devolviendo…", lang)
                  : L("I'm done", "Terminé", lang)}
              </button>
            ) : (
              <>
                {run.live_url && (
                  <button
                    type="button"
                    disabled={props.reconnectBusy}
                    onClick={props.onReconnect}
                    title={L("Reload the live preview stream", "Recargar la vista previa en vivo", lang)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                  >
                    <RefreshCw className="h-3 w-3" />
                    {props.reconnectBusy
                      ? L("Reconnecting…", "Reconectando…", lang)
                      : L("Reconnect", "Reconectar", lang)}
                  </button>
                )}
                {run.live_url &&
                  (run.status === "queued" || run.status === "running" || run.status === "paused") && (
                    <button
                      type="button"
                      onClick={props.onTakeover}
                      title={
                        props.fieldsPause
                          ? L(
                              "Need to solve a captcha or weird UI? Take over instead",
                              "¿Necesitas resolver un captcha o una pantalla rara? Toma el control",
                              lang
                            )
                          : L(
                              "Click and type directly inside the live browser below",
                              "Haz clic y escribe directamente dentro del navegador en vivo",
                              lang
                            )
                      }
                      className={
                        props.fieldsPause
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

        <div className="relative flex min-h-0 flex-1 flex-col bg-slate-900/5 p-3">
          {props.takeover && run.live_url && (
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
          {props.fieldsPause && !props.takeover && run.live_url && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-950">
              <KeyRound className="h-3.5 w-3.5 shrink-0 text-sky-700" />
              <span>
                {L(
                  "Fill the fields in the chat — don't type in this browser.",
                  "Completa los campos en el chat — no escribas en este navegador.",
                  lang
                )}
              </span>
            </div>
          )}
          <div
            className={`relative w-full flex-1 overflow-hidden rounded-xl bg-slate-100 shadow-inner ${
              isFullscreen ? "min-h-0" : "min-h-[16rem]"
            } ${props.takeover ? "border-2 border-amber-400" : "border border-slate-200"}`}
          >
            {run.live_url ? (
              <>
                <iframe
                  key={props.previewKey}
                  src={run.live_url}
                  title={L("Live Browser Use session", "Sesión Browser Use en vivo", lang)}
                  className={`h-full w-full border-0 bg-white ${
                    props.fieldsPause && !props.takeover ? "pointer-events-none" : ""
                  }`}
                  allow="clipboard-read; clipboard-write; autoplay"
                  referrerPolicy="no-referrer"
                  onLoad={props.onPreviewLoaded}
                />
                {props.fieldsPause && !props.takeover && (
                  <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-2">
                    <div className="rounded-full border border-sky-200/80 bg-sky-50/95 px-3 py-1 text-[11px] font-semibold text-sky-950 shadow-sm backdrop-blur-sm">
                      {L(
                        "Fill the fields in the chat — don't type in this browser.",
                        "Completa los campos en el chat — no escribas en este navegador.",
                        lang
                      )}
                    </div>
                  </div>
                )}
                {!props.previewLoaded && (
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
              <div className="flex h-full min-h-[16rem] flex-col items-center justify-center gap-3 bg-white">
                <Loader2 className="h-8 w-8 animate-spin text-brand" />
                <div className="text-sm font-semibold text-slate-600">
                  {L("Waiting for first frame…", "Esperando el primer fotograma…", lang)}
                </div>
              </div>
            )}

            {/* Pause overlay — only for uploads / captcha / payment while the
                browser is open. Field/login pauses live in the chat. */}
            {paused && !props.takeover && !props.fieldsPause && (
              <PauseOverlay
                lang={lang}
                reason={run.pause_reason}
                busy={props.busy}
                uploadBusy={props.uploadBusy}
                uploadMsg={props.uploadMsg}
                fileRef={fileRef}
                liveUrl={run.live_url}
                portalName={props.portalName}
                uploadsText={props.uploadsText}
                pauseStreak={run.pause_streak ?? 0}
                onResume={props.onResume}
                onStop={props.onStop}
                onTakeover={props.onTakeover}
                onUpload={props.onUpload}
              />
            )}

            {/* Review overlay — guides the user to submit on the portal. */}
            {inReview && !props.takeover && (
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
                          onClick={props.onTakeover}
                          className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white"
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                          {L("Take over the browser to submit", "Tome el control del navegador para enviar", lang)}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={props.onStop}
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
      </div>
    </section>
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
  // Field/login pauses never reach this overlay (they live in the chat).
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
                  `Still stuck on this step after ${pauseStreak} tries. Prefer Fill & continue from the chat if fields are listed — or Take over only for captcha/odd UI, then press "I'm done".`,
                  `Sigue atascado en este paso después de ${pauseStreak} intentos. Prefiera Llenar y continuar desde el chat si hay campos — o Tome el control solo para captcha/UI rara, luego pulse "Terminé".`,
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
