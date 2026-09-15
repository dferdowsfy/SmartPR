"use client";

// Floating SmartPR voice orb for intake Start — STT then existing interpret path.
// No businessId required. CSS/Tailwind only (respects prefers-reduced-motion).

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Square, Type, X } from "lucide-react";

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
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<OrbState>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

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
        if (state === "listening") mediaRecorderRef.current?.stop();
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
    async (blob: Blob | null) => {
      setState("processing");
      setError(null);

      try {
        if (!blob || blob.size === 0) {
          setState("error");
          setError(L("Nothing to send.", "No hay nada que enviar.", lang));
          return;
        }

        const form = new FormData();
        form.append("language", lang);
        form.append("audio", blob, blob.type.includes("ogg") ? "audio.ogg" : "audio.webm");

        const res = await fetch("/api/intake/voice", { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          transcript?: string;
        };

        if (!res.ok) {
          setState("error");
          setError(data.error || L("Could not process voice.", "No se pudo procesar la voz.", lang));
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
        setOpen(false);
      } catch {
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

      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
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
      setError(L("Microphone permission denied.", "Permiso de micrófono denegado.", lang));
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

  const glowScale = 1 + (reducedMotion ? 0 : level * 0.35);
  const glowOpacity = 0.35 + (reducedMotion ? 0 : level * 0.45);
  const blocked = busy || state === "processing";

  const statusLabel =
    state === "listening"
      ? L("Listening… tap to stop", "Escuchando… toque para detener", lang)
      : state === "processing"
        ? L("Processing…", "Procesando…", lang)
        : state === "error"
          ? L("Something went wrong", "Algo salió mal", lang)
          : L("Tell SmartPR about your business", "Cuéntele a SmartPR sobre su negocio", lang);

  return (
    <div className="pointer-events-none fixed z-40 flex flex-col items-end gap-3 max-md:bottom-[calc(1.25rem+env(safe-area-inset-bottom))] max-md:right-4 md:right-6 md:top-[min(38%,calc(100%-12rem))]">
      {open && (
        <div
          role="dialog"
          aria-label={L("SmartPR voice intake", "Admisión por voz SmartPR", lang)}
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
                  "Speak naturally. We'll capture the details we recognize and add them for your review.",
                  "Hable con naturalidad. Capturaremos los detalles que reconozcamos y los añadiremos para su revisión.",
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

          <div className="space-y-3 px-4 py-3">
            {state === "idle" && (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => void startListening()}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-3 text-sm font-semibold text-[#f6f3ea] disabled:opacity-40"
                >
                  <Mic className="h-4 w-4" />
                  {L("Press to speak", "Mantener / pulsar para hablar", lang)}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onUseTextInstead?.();
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <Type className="h-4 w-4" />
                  {L("Use text instead", "Usar texto en su lugar", lang)}
                </button>
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
                {L("Transcribing…", "Transcribiendo…", lang)}
              </div>
            )}

            {error && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                {error}
              </p>
            )}

            {(state === "error" || (state === "idle" && error)) && (
              <button
                type="button"
                onClick={() => {
                  setState("idle");
                  setError(null);
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
        type="button"
        disabled={blocked && state !== "listening"}
        onClick={() => {
          if (state === "listening") {
            stopListening();
          } else if (!open) {
            setOpen(true);
            setState("idle");
            setError(null);
          } else if (state === "idle") {
            void startListening();
          } else {
            setOpen(false);
          }
        }}
        aria-label={L("SmartPR voice intake", "Admisión por voz SmartPR", lang)}
        aria-expanded={open}
        className="pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-[#245c5c]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
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
  );
}
