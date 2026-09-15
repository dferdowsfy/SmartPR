"use client";

// Floating SmartPR voice orb — capture spoken business facts into the Passport.
// REST STT + confirm-before-apply. CSS/Tailwind only (respects prefers-reduced-motion).
// Intake Start uses a sibling orb (components/voice/IntakeVoiceOrb) that STTs then
// feeds /api/intake/interpret — same glow/MediaRecorder pattern, no businessId.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Mic, Square, Type, X } from "lucide-react";
import {
  canonicalFromBusinessRow,
  passportJsonFromCanonical,
  type BusinessPassportJson,
  type BusinessRowFacts,
} from "../forms/engine/businessPassport";
import type { CanonicalApplicationData, Lang } from "../forms/engine/types";

export type PassportVoiceProposal = {
  fieldId: string;
  canonicalKey: string;
  label: { en: string; es: string };
  value: unknown;
  confidence: number;
  displayValue: string;
};

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

type OrbState = "idle" | "listening" | "processing" | "success" | "error";

export interface PassportVoiceOrbProps {
  businessId: string;
  lang: Lang;
  currentPassport?: BusinessPassportJson | null;
  business?: BusinessRowFacts;
  /** Called after proposals are applied via the existing passport PATCH path. */
  onApplied?: () => void;
  /** Opens the text passport editor (BusinessPassportPanel edit mode). */
  onUseTextInstead?: () => void;
}

function setCanonicalPath(
  root: CanonicalApplicationData,
  path: string,
  value: unknown
): CanonicalApplicationData {
  const parts = path.split(".");
  const clone = structuredClone(root) as unknown as Record<string, unknown>;
  let cursor: Record<string, unknown> = clone;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    } else {
      cursor[key] = { ...(next as Record<string, unknown>) };
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]] = value;
  return clone as unknown as CanonicalApplicationData;
}

export function PassportVoiceOrb({
  businessId,
  lang,
  currentPassport,
  business,
  onApplied,
  onUseTextInstead,
}: PassportVoiceOrbProps) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<OrbState>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [proposals, setProposals] = useState<PassportVoiceProposal[]>([]);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [textDraft, setTextDraft] = useState("");
  const [reducedMotion, setReducedMotion] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const stopMeter = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setLevel(0);
  }, []);

  const teardownMedia = useCallback(() => {
    stopMeter();
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, [stopMeter]);

  useEffect(() => () => teardownMedia(), [teardownMedia]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        if (state === "listening") {
          mediaRecorderRef.current?.stop();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, state]);

  const startMeter = useCallback(
    (stream: MediaStream) => {
      try {
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        const data = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          analyser.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i++) sum += data[i];
          const avg = sum / data.length / 255;
          setLevel(Math.min(1, avg * 2.2));
          rafRef.current = requestAnimationFrame(tick);
        };
        if (!reducedMotion) rafRef.current = requestAnimationFrame(tick);
      } catch {
        // Meter is cosmetic — recording still works.
      }
    },
    [reducedMotion]
  );

  const processBlob = useCallback(
    async (blob: Blob | null, text?: string) => {
      setState("processing");
      setError(null);
      setProposals([]);
      setRejected(new Set());
      setTranscript(null);

      try {
        const form = new FormData();
        form.append("businessId", businessId);
        form.append("language", lang);
        if (currentPassport) {
          form.append("passport", JSON.stringify(currentPassport));
        }
        if (text?.trim()) {
          form.append("text", text.trim());
        } else if (blob && blob.size > 0) {
          form.append("audio", blob, blob.type.includes("ogg") ? "audio.ogg" : "audio.webm");
        } else {
          setState("error");
          setError(L("Nothing to send.", "No hay nada que enviar.", lang));
          return;
        }

        const res = await fetch("/api/passport/voice", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          transcript?: string;
          proposals?: PassportVoiceProposal[];
          count?: number;
        };

        if (!res.ok) {
          setState("error");
          setError(data.error || L("Could not process voice.", "No se pudo procesar la voz.", lang));
          return;
        }

        setTranscript(data.transcript || null);
        const next = Array.isArray(data.proposals) ? data.proposals : [];
        setProposals(next);
        setState(next.length ? "success" : "success");
        if (!next.length) {
          setError(
            L(
              "We didn't recognize passport details yet. Try again or use text.",
              "Aún no reconocimos datos del pasaporte. Inténtelo de nuevo o use texto.",
              lang
            )
          );
        }
      } catch {
        setState("error");
        setError(L("Network error. Try again.", "Error de red. Inténtelo de nuevo.", lang));
      }
    },
    [businessId, lang, currentPassport]
  );

  const startListening = useCallback(async () => {
    setError(null);
    setProposals([]);
    setRejected(new Set());
    setTranscript(null);
    setTextMode(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setError(
        L(
          "Microphone not supported in this browser.",
          "Este navegador no admite el micrófono.",
          lang
        )
      );
      setOpen(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mime =
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : MediaRecorder.isTypeSupported("audio/ogg")
              ? "audio/ogg"
              : "";

      const recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        teardownMedia();
        void processBlob(blob);
      };

      recorder.start();
      startMeter(stream);
      setState("listening");
      setOpen(true);
    } catch {
      teardownMedia();
      setState("error");
      setError(
        L(
          "Microphone permission denied.",
          "Permiso de micrófono denegado.",
          lang
        )
      );
      setOpen(true);
    }
  }, [lang, processBlob, startMeter, teardownMedia]);

  const stopListening = useCallback(() => {
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    } else {
      teardownMedia();
      setState("idle");
    }
  }, [teardownMedia]);

  const toggleOrb = useCallback(() => {
    if (state === "listening") {
      stopListening();
      return;
    }
    if (state === "processing" || applying) return;
    if (!open) {
      setOpen(true);
      setState("idle");
      setError(null);
      return;
    }
    setOpen((prev) => !prev);
  }, [state, applying, open, stopListening]);

  const accepted = proposals.filter((p) => !rejected.has(p.fieldId));

  const applyAccepted = useCallback(async () => {
    if (!accepted.length || applying) return;
    setApplying(true);
    setError(null);
    try {
      const base = business
        ? canonicalFromBusinessRow(business)
        : canonicalFromBusinessRow({ passport_json: currentPassport ?? null });

      let next = base;
      for (const p of accepted) {
        next = setCanonicalPath(next, p.canonicalKey, p.value);
      }

      const passport_json = passportJsonFromCanonical(next);
      const response = await fetch(`/api/businesses/${businessId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passport: passport_json }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(
          (result as { error?: string }).error ||
            L("Could not save passport.", "No se pudo guardar el pasaporte.", lang)
        );
        return;
      }
      setProposals([]);
      setRejected(new Set());
      setTranscript(null);
      setState("idle");
      setOpen(false);
      onApplied?.();
    } finally {
      setApplying(false);
    }
  }, [accepted, applying, business, currentPassport, businessId, lang, onApplied]);

  const rejectOne = (fieldId: string) => {
    setRejected((prev) => new Set(prev).add(fieldId));
  };

  const confirmOne = async (fieldId: string) => {
    const one = proposals.find((p) => p.fieldId === fieldId);
    if (!one) return;
    setRejected((prev) => {
      const next = new Set(prev);
      // temporarily keep others rejected for a single apply? Better apply one via PATCH merge.
      return next;
    });
    // Apply single field immediately
    setApplying(true);
    try {
      const base = business
        ? canonicalFromBusinessRow(business)
        : canonicalFromBusinessRow({ passport_json: currentPassport ?? null });
      const next = setCanonicalPath(base, one.canonicalKey, one.value);
      const passport_json = passportJsonFromCanonical(next);
      const response = await fetch(`/api/businesses/${businessId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passport: passport_json }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        setError(
          (result as { error?: string }).error ||
            L("Could not save passport.", "No se pudo guardar el pasaporte.", lang)
        );
        return;
      }
      setProposals((prev) => prev.filter((p) => p.fieldId !== fieldId));
      onApplied?.();
      if (proposals.length <= 1) {
        setState("idle");
      }
    } finally {
      setApplying(false);
    }
  };

  const glowScale = 1 + (reducedMotion ? 0 : level * 0.35);
  const glowOpacity = 0.35 + (reducedMotion ? 0 : level * 0.45);

  const statusLabel =
    state === "listening"
      ? L("Listening… tap to stop", "Escuchando… toque para detener", lang)
      : state === "processing"
        ? L("Processing…", "Procesando…", lang)
        : state === "error"
          ? L("Something went wrong", "Algo salió mal", lang)
          : proposals.length
            ? L(
                `SmartPR captured ${accepted.length} detail${accepted.length === 1 ? "" : "s"}`,
                `SmartPR capturó ${accepted.length} detalle${accepted.length === 1 ? "" : "s"}`,
                lang
              )
            : L("Tell SmartPR about your business", "Cuéntele a SmartPR sobre su negocio", lang);

  return (
    <>
      {/* Desktop: fixed right near passport; mobile: bottom-safe */}
      <div className="pointer-events-none fixed z-40 flex flex-col items-end gap-3 max-md:bottom-[calc(1.25rem+env(safe-area-inset-bottom))] max-md:right-4 md:right-6 md:top-[min(42%,calc(100%-12rem))]">
        {open && (
          <div
            ref={panelRef}
            role="dialog"
            aria-label={L("SmartPR voice passport", "Pasaporte por voz SmartPR", lang)}
            className="pointer-events-auto w-[min(100vw-2rem,22rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-950/10"
          >
            <header className="flex items-start gap-3 border-b border-slate-100 bg-gradient-to-br from-[#245c5c]/[0.08] to-transparent px-4 py-3">
              <span
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-white"
                aria-hidden
              >
                <Mic className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-[#161616]">{statusLabel}</div>
                <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
                  {L(
                    "Speak naturally. We'll capture the details we recognize and add them to your Business Passport for review.",
                    "Hable con naturalidad. Capturaremos los detalles que reconozcamos y los añadiremos a su Pasaporte comercial para revisión.",
                    lang
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (state === "listening") stopListening();
                  setOpen(false);
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label={L("Close", "Cerrar", lang)}
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="max-h-[min(60vh,28rem)] space-y-3 overflow-y-auto px-4 py-3">
              {state === "idle" && !proposals.length && !textMode && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => void startListening()}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-[#f6f3ea]"
                  >
                    <Mic className="h-4 w-4" />
                    {L("Press to speak", "Mantener / pulsar para hablar", lang)}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTextMode(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Type className="h-4 w-4" />
                    {L("Use text instead", "Usar texto en su lugar", lang)}
                  </button>
                  {onUseTextInstead && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpen(false);
                        onUseTextInstead();
                      }}
                      className="w-full text-center text-xs font-semibold text-brand hover:underline"
                    >
                      {L("Or edit passport fields", "O editar campos del pasaporte", lang)}
                    </button>
                  )}
                </div>
              )}

              {textMode && (
                <div className="space-y-2">
                  <textarea
                    value={textDraft}
                    onChange={(e) => setTextDraft(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder={L(
                      "Describe your business in a few sentences…",
                      "Describa su negocio en unas pocas oraciones…",
                      lang
                    )}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-[#161616] outline-none focus:border-brand focus:ring-1 focus:ring-brand/30"
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={!textDraft.trim() || state === "processing"}
                      onClick={() => void processBlob(null, textDraft)}
                      className="flex-1 rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-[#f6f3ea] disabled:opacity-40"
                    >
                      {L("Extract details", "Extraer detalles", lang)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTextMode(false)}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"
                    >
                      {L("Back", "Volver", lang)}
                    </button>
                  </div>
                </div>
              )}

              {state === "listening" && (
                <div className="flex flex-col items-center gap-3 py-2">
                  <div
                    className="relative flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white"
                    style={{
                      boxShadow: `0 0 ${18 + level * 28}px rgba(36,92,92,${glowOpacity})`,
                      transform: reducedMotion ? undefined : `scale(${glowScale})`,
                      transition: reducedMotion ? undefined : "transform 80ms linear",
                    }}
                  >
                    <Mic className="h-6 w-6" />
                  </div>
                  <button
                    type="button"
                    onClick={stopListening}
                    className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-800"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                    {L("Stop", "Detener", lang)}
                  </button>
                </div>
              )}

              {state === "processing" && (
                <div className="flex items-center gap-3 py-4 text-sm text-slate-600">
                  <span
                    className={`inline-block h-4 w-4 rounded-full border-2 border-brand border-t-transparent ${
                      reducedMotion ? "" : "animate-spin"
                    }`}
                    aria-hidden
                  />
                  {L("Transcribing and extracting…", "Transcribiendo y extrayendo…", lang)}
                </div>
              )}

              {error && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                  {error}
                </p>
              )}

              {transcript && (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] italic text-slate-500">
                  “{transcript}”
                </p>
              )}

              {proposals.length > 0 && (
                <ul className="space-y-2">
                  {proposals.map((p) => {
                    const isRejected = rejected.has(p.fieldId);
                    return (
                      <li
                        key={p.fieldId}
                        className={`rounded-xl border px-3 py-2.5 ${
                          isRejected
                            ? "border-slate-100 bg-slate-50 opacity-50"
                            : "border-slate-200 bg-white"
                        }`}
                      >
                        <div className="text-[11px] font-medium text-slate-500">
                          {lang === "es" ? p.label.es : p.label.en}
                        </div>
                        <div className="mt-0.5 break-words text-sm font-semibold text-[#161616]">
                          {p.displayValue}
                        </div>
                        {!isRejected && (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              disabled={applying}
                              onClick={() => void confirmOne(p.fieldId)}
                              className="inline-flex items-center gap-1 rounded-lg bg-brand/10 px-2.5 py-1 text-[11px] font-bold text-brand"
                            >
                              <Check className="h-3 w-3" />
                              {L("Confirm", "Confirmar", lang)}
                            </button>
                            <button
                              type="button"
                              disabled={applying}
                              onClick={() => rejectOne(p.fieldId)}
                              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:bg-slate-100"
                            >
                              <X className="h-3 w-3" />
                              {L("Reject", "Rechazar", lang)}
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              {proposals.length > 0 && accepted.length > 0 && (
                <button
                  type="button"
                  disabled={applying}
                  onClick={() => void applyAccepted()}
                  className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-[#f6f3ea] disabled:opacity-40"
                >
                  {applying
                    ? L("Saving…", "Guardando…", lang)
                    : L(
                        `Confirm all (${accepted.length})`,
                        `Confirmar todos (${accepted.length})`,
                        lang
                      )}
                </button>
              )}

              {(state === "success" || state === "error") && !textMode && (
                <button
                  type="button"
                  onClick={() => {
                    setState("idle");
                    setError(null);
                    setProposals([]);
                    setTranscript(null);
                  }}
                  className="w-full text-center text-xs font-semibold text-brand hover:underline"
                >
                  {L("Try again", "Intentar de nuevo", lang)}
                </button>
              )}
            </div>
          </div>
        )}

        <button
          ref={orbRef}
          type="button"
          onClick={() => {
            if (state === "listening") {
              stopListening();
            } else if (!open) {
              setOpen(true);
              setState("idle");
            } else if (state === "idle" && !proposals.length) {
              void startListening();
            } else {
              toggleOrb();
            }
          }}
          aria-label={L("SmartPR voice passport", "Pasaporte por voz SmartPR", lang)}
          aria-expanded={open}
          className="pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-[#245c5c]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          style={{
            boxShadow:
              state === "listening"
                ? `0 0 ${20 + level * 36}px rgba(36,92,92,${0.45 + level * 0.4}), 0 10px 24px rgba(36,92,92,0.35)`
                : undefined,
            transform:
              state === "listening" && !reducedMotion ? `scale(${glowScale})` : undefined,
            transition: reducedMotion ? undefined : "transform 80ms linear, box-shadow 80ms linear",
          }}
        >
          {/* Soft outer glow ring */}
          <span
            aria-hidden
            className={`absolute inset-0 rounded-full bg-brand/30 ${
              state === "listening" && !reducedMotion ? "animate-pulse" : ""
            }`}
            style={{ transform: `scale(${1.15 + (reducedMotion ? 0 : level * 0.25)})` }}
          />
          {state === "listening" ? (
            <Square className="relative h-5 w-5 fill-current" />
          ) : state === "processing" ? (
            <span
              className={`relative inline-block h-5 w-5 rounded-full border-2 border-white border-t-transparent ${
                reducedMotion ? "" : "animate-spin"
              }`}
            />
          ) : (
            <Mic className="relative h-5 w-5" />
          )}
        </button>
      </div>
    </>
  );
}
