"use client";

// Floating SmartPR voice orb for intake Start — STT then existing interpret path.
// No businessId required. CSS/Tailwind only (respects prefers-reduced-motion).
// Visual: deep teal core + cyan/mint glass halo + white sparkles (not mic FAB).

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Square, Type, X } from "lucide-react";
import {
  MIN_AUDIO_BLOB_BYTES,
  appendAudioFormField,
  pickRecorderMime,
  startRecorderWithTimeslice,
  stopRecorderAndCollect,
  sttErrorMessage,
} from "./recordAudioBlob";

type OrbState = "idle" | "listening" | "processing" | "error";
type Lang = "en" | "es";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

/** White multi-sparkle (three 4-point stars) — primary orb icon per mock. */
function SparkleStarsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      {/* Large center sparkle */}
      <path d="M12 2.2l1.15 5.35L18.5 8.7l-5.35 1.15L12 15.2l-1.15-5.35L5.5 8.7l5.35-1.15L12 2.2z" />
      {/* Upper-right small */}
      <path d="M18.2 3.1l0.55 2.15L20.9 5.8l-2.15.55-.55 2.15-.55-2.15-2.15-.55 2.15-.55.55-2.15z" />
      {/* Lower-left small */}
      <path d="M6.3 14.4l0.5 1.95L8.75 16.85l-1.95.5-.5 1.95-.5-1.95-1.95-.5 1.95-.5.5-1.95z" />
    </svg>
  );
}

export interface IntakeVoiceOrbProps {
  lang: Lang;
  /** Called after STT with the transcript — parent runs /api/intake/interpret. */
  onTranscript: (transcript: string) => void | Promise<void>;
  /** Focus the existing NaturalLanguageIntake describe box. */
  onUseTextInstead?: () => void;
  /** Optional: parent is already interpreting (disable re-entry). */
  busy?: boolean;
}

export function IntakeVoiceOrb({
  lang,
  onTranscript,
  onUseTextInstead,
  busy = false,
}: IntakeVoiceOrbProps) {
  const [state, setState] = useState<OrbState>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);

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
    chunksRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    analyserRef.current = null;
    stoppingRef.current = false;
  }, [stopMeter]);

  useEffect(() => () => teardownMedia(), [teardownMedia]);

  const stopListeningRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!showPanel && state !== "listening" && state !== "processing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowPanel(false);
        if (state === "listening") stopListeningRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showPanel, state]);

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
    async (blob: Blob | null) => {
      setState("processing");
      setError(null);
      setShowPanel(true);

      try {
        if (!blob || blob.size < MIN_AUDIO_BLOB_BYTES) {
          console.warn("[IntakeVoiceOrb] audio blob too small", blob?.size ?? 0);
          setState("error");
          setError(
            L(
              "Recording too short or empty. Hold the orb and speak for a moment, then stop.",
              "Grabación demasiado corta o vacía. Mantenga el orbe y hable un momento, luego detenga.",
              lang
            )
          );
          return;
        }

        const form = new FormData();
        form.append("language", lang);
        appendAudioFormField(form, blob);

        const res = await fetch("/api/intake/voice", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          detail?: unknown;
          transcript?: string;
        };

        if (!res.ok) {
          console.error("[IntakeVoiceOrb] STT failed", res.status, data);
          setState("error");
          setError(
            sttErrorMessage(
              data,
              L("Could not process voice.", "No se pudo procesar la voz.", lang)
            )
          );
          return;
        }

        const transcript = (data.transcript || "").trim();
        if (!transcript) {
          setState("error");
          setError(L("No speech detected.", "No se detectó habla.", lang));
          return;
        }

        await onTranscript(transcript);
        setState("idle");
        setShowPanel(false);
          } catch (err) {
        console.error("[IntakeVoiceOrb] network/STT error", err);
        setState("error");
        setError(L("Network error. Try again.", "Error de red. Inténtelo de nuevo.", lang));
      }
    },
    [lang, onTranscript]
  );

  const startListening = useCallback(async () => {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setShowPanel(true);
      setError(
        L(
          "Microphone not supported in this browser.",
          "Este navegador no admite el micrófono.",
          lang
        )
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      const { mimeType } = pickRecorderMime();
      const { recorder, chunks } = startRecorderWithTimeslice(stream, mimeType);
      mediaRecorderRef.current = recorder;
      chunksRef.current = chunks;

      startMeter(stream);
      setState("listening");
      setShowPanel(false);
    } catch {
      teardownMedia();
      setState("error");
      setShowPanel(true);
      setError(L("Microphone permission denied.", "Permiso de micrófono denegado.", lang));
    }
  }, [lang, startMeter, teardownMedia]);

  const stopListening = useCallback(async () => {
    const rec = mediaRecorderRef.current;
    if (!rec || stoppingRef.current) return;
    if (rec.state === "inactive") {
      teardownMedia();
      setState("idle");
      return;
    }
    stoppingRef.current = true;
    setState("processing");
    try {
      const blob = await stopRecorderAndCollect(rec, chunksRef.current);
      teardownMedia();
      await processBlob(blob);
    } catch (err) {
      console.error("[IntakeVoiceOrb] stop/collect failed", err);
      teardownMedia();
      setState("error");
      setShowPanel(true);
      setError(L("Could not finish recording.", "No se pudo terminar la grabación.", lang));
    }
  }, [lang, processBlob, teardownMedia]);

  stopListeningRef.current = () => {
    void stopListening();
  };

  const blocked = busy || state === "processing";
  const glowScale = 1 + (reducedMotion ? 0 : level * 0.28);

  const tooltipText =
    state === "listening"
      ? L("Listening… tap orb to stop", "Escuchando… toque el orbe para detener", lang)
      : state === "processing"
        ? L("Transcribing…", "Transcribiendo…", lang)
        : state === "error"
          ? L("Something went wrong", "Algo salió mal", lang)
          : L("Tell SmartPR about your business", "Cuéntele a SmartPR sobre su negocio", lang);

  const pillText =
    state === "listening"
      ? L("Speak now — I'll capture what I can.", "Hable ahora — capturaré lo que pueda.", lang)
      : state === "processing"
        ? L("Almost there…", "Ya casi…", lang)
        : L("Speak naturally. I'll fill in what I can.", "Hable con naturalidad. Completaré lo que pueda.", lang);

  const showHints = state !== "error";

  return (
    <div className="pointer-events-none fixed z-40 flex flex-col items-center gap-2.5 max-md:bottom-[calc(1.25rem+env(safe-area-inset-bottom))] max-md:right-3 md:right-5 md:top-[min(36%,calc(100%-14rem))]">
      {/* Upper white tooltip */}
      {showHints && (
        <div className="pointer-events-auto relative max-w-[14.5rem]">
          <button
            type="button"
            disabled={blocked && state !== "listening"}
            onClick={() => {
              if (state === "listening") void stopListening();
              else if (state === "idle") void startListening();
            }}
            className="flex items-center gap-1.5 rounded-2xl border border-white/80 bg-white px-3.5 py-2 text-left text-[12px] font-semibold leading-snug text-[#1a2e2e] shadow-[0_8px_24px_rgba(36,92,92,0.12)]"
          >
            <span className="min-w-0 flex-1">{tooltipText}</span>
            {state === "idle" && (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
            )}
          </button>
          {/* Arrow / chevron pointing down at orb */}
          <span
            aria-hidden
            className="absolute left-1/2 top-full -mt-px h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-white/80 bg-white shadow-[2px_2px_4px_rgba(36,92,92,0.06)]"
          />
        </div>
      )}

      {/* Orb + glass halo */}
      <button
        type="button"
        disabled={blocked && state !== "listening"}
        onClick={() => {
          if (state === "listening") {
            void stopListening();
          } else if (state === "processing") {
            return;
          } else if (state === "error") {
            setState("idle");
            setError(null);
            setShowPanel(true);
          } else {
            void startListening();
          }
        }}
        aria-label={L("SmartPR voice intake", "Admisión por voz SmartPR", lang)}
        aria-busy={state === "processing" || state === "listening"}
        className="pointer-events-auto group relative flex h-[4.25rem] w-[4.25rem] items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#245c5c] disabled:opacity-70"
        style={{
          transform:
            state === "listening" && !reducedMotion ? `scale(${glowScale})` : undefined,
          transition: reducedMotion ? undefined : "transform 90ms linear",
        }}
      >
        {/* Soft cyan/mint glass halo */}
        <span
          aria-hidden
          className={`absolute inset-[-10px] rounded-full bg-[radial-gradient(circle_at_50%_45%,rgba(167,243,208,0.55)_0%,rgba(103,232,249,0.28)_42%,rgba(36,92,92,0.06)_70%,transparent_78%)] ${
            state === "listening" && !reducedMotion ? "animate-pulse" : ""
          }`}
          style={{
            filter: "blur(0.5px)",
            opacity: 0.95 + (reducedMotion ? 0 : level * 0.15),
            transform: `scale(${1 + (reducedMotion ? 0 : level * 0.12)})`,
          }}
        />
        {/* Outer frosted ring */}
        <span
          aria-hidden
          className="absolute inset-[-4px] rounded-full border border-cyan-100/70 bg-gradient-to-br from-white/50 via-teal-100/25 to-cyan-200/30 shadow-[0_10px_28px_rgba(36,92,92,0.18),inset_0_1px_0_rgba(255,255,255,0.65)] backdrop-blur-[2px]"
        />
        {/* Deep teal core */}
        <span
          aria-hidden
          className="absolute inset-[6px] rounded-full bg-[#245c5c] shadow-[inset_0_2px_6px_rgba(255,255,255,0.18),0_4px_14px_rgba(36,92,92,0.35)]"
          style={{
            boxShadow:
              state === "listening"
                ? `inset 0 2px 6px rgba(255,255,255,0.2), 0 0 ${16 + level * 28}px rgba(45,212,191,${0.35 + level * 0.35}), 0 6px 18px rgba(36,92,92,0.4)`
                : undefined,
          }}
        />
        {/* Icon */}
        <span className="relative z-10 text-white">
          {state === "listening" ? (
            <Square className="h-5 w-5 fill-current" />
          ) : state === "processing" ? (
            <span
              className={`inline-block h-5 w-5 rounded-full border-2 border-white border-t-transparent ${
                reducedMotion ? "" : "animate-spin"
              }`}
            />
          ) : (
            <SparkleStarsIcon className="h-6 w-6 drop-shadow-sm" />
          )}
        </span>
      </button>

      {/* Lower translucent mint pill */}
      {showHints && (
        <div className="pointer-events-none relative z-10 -mt-0.5 max-w-[13.5rem] rounded-full border border-emerald-100/80 bg-[rgba(209,250,229,0.72)] px-3.5 py-1.5 text-center text-[10.5px] font-medium leading-snug text-[#1f3d3d] shadow-[0_4px_14px_rgba(36,92,92,0.08)] backdrop-blur-md">
          {pillText}
        </div>
      )}

      {/* Compact status / error / text fallback panel — not a chatbot FAB card */}
      {(showPanel || error) && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-auto mt-1 w-[min(100vw-2rem,16.5rem)] overflow-hidden rounded-2xl border border-teal-100/80 bg-white/95 shadow-lg shadow-teal-950/10 backdrop-blur"
        >
          <div className="flex items-start gap-2 px-3 py-2.5">
            <div className="min-w-0 flex-1 space-y-2">
              {error && (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-medium leading-snug text-amber-950">
                  {error}
                </p>
              )}
              {state === "processing" && !error && (
                <p className="flex items-center gap-2 text-[11px] font-medium text-slate-600">
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full border-2 border-[#245c5c] border-t-transparent ${
                      reducedMotion ? "" : "animate-spin"
                    }`}
                    aria-hidden
                  />
                  {L("Transcribing…", "Transcribiendo…", lang)}
                </p>
              )}
              {(state === "error" || state === "idle") && (
                <div className="flex flex-col gap-1.5">
                  {state === "error" && (
                    <button
                      type="button"
                      onClick={() => {
                        setState("idle");
                        setError(null);
                        void startListening();
                      }}
                      className="w-full rounded-xl bg-[#245c5c] px-3 py-2 text-[12px] font-semibold text-[#f6f3ea]"
                    >
                      {L("Try again", "Intentar de nuevo", lang)}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setShowPanel(false);
                                        setError(null);
                      setState("idle");
                      onUseTextInstead?.();
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    <Type className="h-3.5 w-3.5" />
                    {L("Use text instead", "Usar texto en su lugar", lang)}
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setShowPanel(false);
                if (state === "error") {
                  setError(null);
                  setState("idle");
                }
              }}
              className="rounded-lg p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              aria-label={L("Dismiss", "Cerrar", lang)}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
