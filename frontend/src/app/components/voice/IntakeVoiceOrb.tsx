"use client";

// Floating SmartPR voice orb for intake Start — STT then existing interpret path.
// No businessId required. CSS/Tailwind only (respects prefers-reduced-motion).
// Visual: ChatGPT-like breathing glow (teal #245c5c + mint/cyan halo + sparkles).
// Anchored lower-right (safe-area); hints/pills stack upward above the orb.

import { useCallback, useEffect, useRef, useState } from "react";
import { Type, X } from "lucide-react";
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
          : L("Tell me what you want to do.", "Dime qué quieres hacer.", lang);

  const showHints = state !== "error";

  return (
    <>
      {/* Scoped orb motion — disabled under prefers-reduced-motion via media query */}
      <style>{`
        @keyframes spr-orb-breathe {
          0%, 100% { transform: scale(1); opacity: 0.5; }
          50% { transform: scale(1.14); opacity: 0.9; }
        }
        @keyframes spr-orb-ring {
          0% { transform: scale(0.92); opacity: 0.45; }
          70% { transform: scale(1.45); opacity: 0; }
          100% { transform: scale(1.45); opacity: 0; }
        }
        @keyframes spr-orb-shimmer {
          0%, 100% { opacity: 0.35; }
          50% { opacity: 0.7; }
        }
        @keyframes spr-smoke-swirl {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes spr-smoke-swirl-rev {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        @keyframes spr-listening-dot {
          0%, 100% { transform: scale(1); opacity: 0.65; }
          50% { transform: scale(1.4); opacity: 1; }
        }
        .spr-intake-orb-breathe {
          animation: spr-orb-breathe 3.2s ease-in-out infinite;
        }
        .spr-intake-orb-ring {
          animation: spr-orb-ring 3.6s ease-out infinite;
        }
        .spr-intake-orb-ring-delay {
          animation: spr-orb-ring 3.6s ease-out infinite 1.2s;
        }
        .spr-intake-orb-shimmer {
          animation: spr-orb-shimmer 2.8s ease-in-out infinite;
        }
        .spr-smoke-swirl {
          animation: spr-smoke-swirl 16s linear infinite;
        }
        .spr-smoke-swirl-rev {
          animation: spr-smoke-swirl-rev 26s linear infinite;
        }
        .spr-listening-dot {
          animation: spr-listening-dot 1.8s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .spr-intake-orb-breathe,
          .spr-intake-orb-ring,
          .spr-intake-orb-ring-delay,
          .spr-intake-orb-shimmer,
          .spr-smoke-swirl,
          .spr-smoke-swirl-rev,
          .spr-listening-dot {
            animation: none !important;
          }
        }
      `}</style>

      <div
        className="pointer-events-none fixed z-40 flex flex-col items-end gap-2.5 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] right-[max(0.75rem,env(safe-area-inset-right,0px))] md:bottom-[calc(1.35rem+env(safe-area-inset-bottom,0px))] md:right-[max(1.25rem,env(safe-area-inset-right,0px))]"
      >
        {/* Compact status / error panel — opens upward above hints */}
        {(showPanel || error) && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto order-1 w-[min(100vw-2rem,16.5rem)] overflow-hidden rounded-2xl border border-teal-100/80 bg-white/95 shadow-lg shadow-teal-950/10 backdrop-blur"
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

        {/* Hints stack upward above the orb (never over Live sidebar / form) */}
        {showHints && (
          <div className="pointer-events-auto relative order-2 max-w-[14.5rem]">
            <button
              type="button"
              disabled={blocked && state !== "listening"}
              onClick={() => {
                if (state === "listening") void stopListening();
                else if (state === "idle") void startListening();
              }}
              className="flex items-center gap-1.5 rounded-full border border-slate-200/70 bg-white/75 px-3.5 py-1.5 text-left text-[11px] font-medium leading-snug text-slate-500 shadow-[0_4px_14px_rgba(36,92,92,0.07)] backdrop-blur-md"
            >
              <span className="min-w-0 flex-1">{tooltipText}</span>
            </button>
            <span
              aria-hidden
              className="absolute left-1/2 top-full -mt-px h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-slate-200/70 bg-white/75 shadow-[2px_2px_4px_rgba(36,92,92,0.05)]"
            />
          </div>
        )}

        {/* Orb + layered ChatGPT-style glow (SmartPR teal / mint) */}
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
          className="pointer-events-auto group relative order-4 flex h-[3.75rem] w-[3.75rem] items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#245c5c] disabled:opacity-70 md:h-16 md:w-16"
          style={{
            transform:
              state === "listening" && !reducedMotion ? `scale(${glowScale})` : undefined,
            transition: reducedMotion ? undefined : "transform 90ms linear",
          }}
        >
          {/* Soft ambient bloom */}
          <span
            aria-hidden
            className={`absolute inset-[-18px] rounded-full bg-[radial-gradient(circle_at_50%_45%,rgba(94,234,212,0.45)_0%,rgba(167,243,208,0.28)_38%,rgba(36,92,92,0.08)_62%,transparent_75%)] ${
              !reducedMotion ? "spr-intake-orb-breathe" : ""
            }`}
            style={{
              opacity: state === "listening" ? 0.95 + level * 0.2 : 0.85,
              filter: "blur(1px)",
            }}
          />
          {/* Gentle ambient rings */}
          {!reducedMotion && (
            <>
              <span
                aria-hidden
                className="spr-intake-orb-ring absolute inset-[-6px] rounded-full border border-teal-200/50"
              />
              <span
                aria-hidden
                className="spr-intake-orb-ring-delay absolute inset-[-6px] rounded-full border border-cyan-200/40"
              />
            </>
          )}
          {/* Cyan/mint glass halo */}
          <span
            aria-hidden
            className={`absolute inset-[-10px] rounded-full bg-[radial-gradient(circle_at_50%_40%,rgba(204,251,241,0.7)_0%,rgba(103,232,249,0.32)_45%,rgba(36,92,92,0.05)_72%,transparent_80%)] ${
              state === "listening" && !reducedMotion ? "animate-pulse" : !reducedMotion ? "spr-intake-orb-shimmer" : ""
            }`}
            style={{
              filter: "blur(0.5px)",
              opacity: 0.9 + (reducedMotion ? 0 : level * 0.15),
              transform: `scale(${1 + (reducedMotion ? 0 : level * 0.1)})`,
            }}
          />
          {/* Smoky green glass core */}
          <span
            aria-hidden
            className="absolute inset-[5px] overflow-hidden rounded-full bg-[#0b3532]"
            style={{
              boxShadow:
                state === "listening"
                  ? `inset 0 -10px 18px rgba(4,47,46,0.55), inset 0 6px 14px rgba(255,255,255,0.18), 0 0 ${18 + level * 32}px rgba(45,212,191,${0.4 + level * 0.4}), 0 6px 18px rgba(36,92,92,0.42)`
                  : "inset 0 -10px 18px rgba(4,47,46,0.55), inset 0 6px 14px rgba(255,255,255,0.16), 0 4px 16px rgba(36,92,92,0.38)",
            }}
          >
            {/* Smoke layer — slow clockwise swirl */}
            <span
              aria-hidden
              className={`absolute -inset-[30%] ${!reducedMotion ? "spr-smoke-swirl" : ""}`}
              style={{
                backgroundImage: "url(/orb-smoke-green.png)",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
            {/* Smoke layer — counter swirl at different scale for depth */}
            <span
              aria-hidden
              className={`absolute -inset-[30%] ${!reducedMotion ? "spr-smoke-swirl-rev" : ""}`}
              style={{
                backgroundImage: "url(/orb-smoke-green.png)",
                backgroundSize: "160%",
                backgroundPosition: "30% 65%",
                opacity: 0.5,
                mixBlendMode: "screen",
              }}
            />
            {/* Glass depth shading */}
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_50%,transparent_55%,rgba(4,32,30,0.55)_100%)]"
            />
            {/* Glass sheen */}
            <span
              aria-hidden
              className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_26%,rgba(255,255,255,0.5)_0%,rgba(255,255,255,0.08)_30%,transparent_48%)]"
            />
          </span>
          {/* Icon */}
          <span className="relative z-10 text-white">
            {state === "listening" ? (
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-full bg-white/90 shadow-[0_0_10px_rgba(255,255,255,0.9)] ${
                  !reducedMotion ? "spr-listening-dot" : ""
                }`}
              />
            ) : state === "processing" ? (
              <span
                className={`inline-block h-5 w-5 rounded-full border-2 border-white border-t-transparent ${
                  reducedMotion ? "" : "animate-spin"
                }`}
              />
            ) : null}
          </span>
        </button>
      </div>
    </>
  );
}
