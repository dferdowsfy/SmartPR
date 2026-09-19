"use client";

// Floating SmartPR voice orb for intake Start — STT then existing interpret path.
// No businessId required. CSS/Tailwind only (respects prefers-reduced-motion).
// Visual: a single globe orb — green cosmos smoke swirls continuously inside
// the globe, white waveform signal bars on top. No border rings or halos.
// Anchored lower-right (safe-area); hints/pills stack upward above the orb.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pause, Square, Type, Volume2, VolumeX, X } from "lucide-react";
import {
  MIN_AUDIO_BLOB_BYTES,
  appendAudioFormField,
  pickRecorderMime,
  startRecorderWithTimeslice,
  stopRecorderAndCollect,
  sttErrorMessage,
} from "./recordAudioBlob";

type OrbState = "idle" | "requesting" | "listening" | "processing" | "error";
type Lang = "en" | "es";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

/** Optional business context so voice answers can be specific. */
export interface VoiceChatContext {
  profile?: {
    name?: string | null;
    business_type?: string | null;
    industry?: string | null;
    municipality?: string | null;
    business_structure?: string | null;
    location_type?: string | null;
  };
  requirements?: Array<{
    code: string;
    name: string;
    status?: string;
    mandatory?: boolean;
    agency?: string;
  }>;
}

export interface IntakeVoiceOrbProps {
  lang: Lang;
  /** Called after STT with the transcript — parent runs /api/intake/interpret. */
  onTranscript: (transcript: string) => void | Promise<void>;
  /** Focus the existing NaturalLanguageIntake describe box. */
  onUseTextInstead?: () => void;
  /** Optional: parent is already interpreting (disable re-entry). */
  busy?: boolean;
  /** Answer spoken questions via /api/chat instead of treating them as intake. Default true. */
  enableVoiceAnswers?: boolean;
  /** Business context for answers (profile/requirements may be empty). */
  chatContext?: VoiceChatContext;
  feedback?: ReactNode;
}

/**
 * White waveform signal bars, like a voice-activity indicator.
 * Idle: gentle pulsing silhouette on the green globe.
 * Listening: bars bounce continuously (staggered, like a voice assistant
 * hearing sound) while their base height follows the live mic level.
 */
function WaveformBars({
  live,
  level,
  reducedMotion,
}: {
  live: boolean;
  level: number;
  reducedMotion: boolean;
}) {
  const idleHeights = [9, 21, 14, 9];
  // Per-bar shape so the waveform reads even when the mic level is steady.
  const liveFactors = [0.6, 1.0, 0.78, 0.52];
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      {idleHeights.map((base, i) => {
        const height = live
          ? Math.round((7 + 19 * Math.min(1, level)) * liveFactors[i])
          : base;
        return (
          <span
            key={i}
            className={`w-[3px] rounded-full bg-white/95 ${
              live
                ? !reducedMotion
                  ? "spr-wave-live"
                  : ""
                : !reducedMotion
                  ? "spr-wave-bar"
                  : ""
            }`}
            style={{
              height: `${height}px`,
              animationDelay: !reducedMotion ? `${i * (live ? 0.14 : 0.28)}s` : undefined,
              boxShadow: "0 0 6px rgba(255,255,255,0.35)",
            }}
          />
        );
      })}
    </span>
  );
}

export function IntakeVoiceOrb({
  lang,
  onTranscript,
  onUseTextInstead,
  busy = false,
  enableVoiceAnswers = true,
  chatContext,
  feedback,
}: IntakeVoiceOrbProps) {
  const [state, setState] = useState<OrbState>("idle");
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [answer, setAnswer] = useState<{ question: string; reply: string } | null>(null);
  const [answering, setAnswering] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);

  const historyRef = useRef<Array<{ role: "user" | "assistant"; content: string }>>([]);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);
  const requestingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const stopSpeaking = useCallback(() => {
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    } catch {
      // Speech is best-effort.
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (muted) return;
      try {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
        const synth = window.speechSynthesis;
        synth.cancel();
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = lang === "es" ? "es-PR" : "en-US";
        const voices = synth.getVoices?.() ?? [];
        const match =
          voices.find((v) =>
            v.lang?.toLowerCase().startsWith(lang === "es" ? "es-pr" : "en-us")
          ) || voices.find((v) => v.lang?.toLowerCase().startsWith(lang === "es" ? "es" : "en"));
        if (match) utter.voice = match;
        utter.onend = () => setSpeaking(false);
        utter.onerror = () => setSpeaking(false);
        setSpeaking(true);
        synth.speak(utter);
      } catch {
        setSpeaking(false);
      }
    },
    [lang, muted]
  );

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

  useEffect(
    () => {
      mountedRef.current = true;
      return () => {
        mountedRef.current = false;
        teardownMedia();
        stopSpeaking();
      };
    },
    [teardownMedia, stopSpeaking]
  );

  const stopListeningRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!showPanel && state !== "listening" && state !== "processing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowPanel(false);
        stopSpeaking();
        if (state === "listening") stopListeningRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showPanel, state, stopSpeaking]);

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

  const QUESTION_WH =
    /^(what|when|where|which|who|whom|whose|why|how|qu[eé]|cu[aá]l(es)?|cu[aá]ndo|d[oó]nde|c[oó]mo|por\s*qu[eé]|qui[eé]n(es)?|cu[aá]nto)/i;
  const QUESTION_IMPERATIVE = /^(tell me|explain|describe|dime|expl[ií]came?)/i;
  // Auxiliary-led questions need a subject right after the auxiliary:
  // "Do I need…?" is a question, "Do catering" is a field-filling statement.
  const QUESTION_AUX_SUBJECT =
    /^(can|could|should|would|do|does|did|is|are|was|were|will|have|has)\s+(you|i|we|they|he|she|it|this|that|there|my|your|our|their|the|a|an|smartpr)\b/i;

  function looksLikeQuestion(t: string): boolean {
    const s = t.trim();
    if (!s) return false;
    if (/[?¿]/.test(s)) return true;
    if (QUESTION_WH.test(s)) return true;
    if (QUESTION_IMPERATIVE.test(s)) return true;
    if (/^necesito saber/i.test(s)) return true;
    if (QUESTION_AUX_SUBJECT.test(s)) return true;
    return false;
  }

  const answerQuestion = useCallback(
    async (question: string) => {
      setAnswering(true);
      try {
        const history = [...historyRef.current].slice(-8);
        const messages: Array<{ role: "user" | "assistant"; content: string }> = [
          ...history,
          { role: "user", content: question },
        ];
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages,
            context: {
              profile: chatContext?.profile ?? {},
              requirements: chatContext?.requirements ?? [],
              language: lang,
            },
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          reply?: string;
          error?: string;
        };
        const reply = (data.reply || "").trim();
        if (!res.ok || !reply) throw new Error(data.error || `chat ${res.status}`);
        historyRef.current = (
          [
            ...historyRef.current,
            { role: "user", content: question },
            { role: "assistant", content: reply },
          ] as Array<{ role: "user" | "assistant"; content: string }>
        ).slice(-12);
        setAnswer({ question, reply });
        setShowPanel(true);
        setState("idle");
        speak(reply);
      } catch (err) {
        console.error("[IntakeVoiceOrb] chat answer failed", err);
        setState("error");
        setError(
          L(
            "Couldn't answer that right now. Try again.",
            "No pude responder ahora. Inténtelo de nuevo.",
            lang
          )
        );
      } finally {
        setAnswering(false);
      }
    },
    [chatContext, lang, speak]
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

        // Spoken question → answer it (voice mode). Otherwise → intake flow.
        if (enableVoiceAnswers && looksLikeQuestion(transcript)) {
          await answerQuestion(transcript);
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
    [lang, onTranscript, enableVoiceAnswers, answerQuestion]
  );

  const startListening = useCallback(async () => {
    if (requestingRef.current || mediaRecorderRef.current) return;
    setError(null);
    stopSpeaking();
    setAnswer(null);
    setAnswering(false);

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
      requestingRef.current = true;
      setState("requesting");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      if (!mountedRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
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
    } finally { requestingRef.current = false; }
  }, [lang, startMeter, stopSpeaking, teardownMedia]);

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

  const blocked = busy || state === "processing" || state === "requesting";

  const tooltipText =
    state === "requesting" ? L("Mic off · Allow microphone access…", "Micrófono apagado · Permita el acceso…", lang) : state === "listening"
      ? L("Mic on · Listening — tap to finish", "Micrófono activo · Escuchando — toque para terminar", lang)
      : state === "processing"
        ? answering
          ? L("Answering…", "Respondiendo…", lang)
          : L("Mic off · Processing…", "Micrófono apagado · Procesando…", lang)
        : state === "error"
          ? L("Something went wrong", "Algo salió mal", lang)
          : L("Mic off · Tap to speak", "Micrófono apagado · Toque para hablar", lang);

  const showHints = state !== "error";

  return (
    <>
      {/* Scoped orb motion — disabled under prefers-reduced-motion via media query */}
      <style>{`
        @keyframes spr-orb-ring {
          0% { transform: scale(0.92); opacity: 0.45; }
          70% { transform: scale(1.45); opacity: 0; }
          100% { transform: scale(1.45); opacity: 0; }
        }
        @keyframes spr-smoke-swirl {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes spr-smoke-swirl-rev {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        @keyframes spr-orb-alive {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.07); }
        }
        @keyframes spr-wave-bar {
          0%, 100% { transform: scaleY(0.75); }
          50% { transform: scaleY(1.15); }
        }
        /* Active-listening waveform: continuous staggered bounce that mimics
           understanding sound, even when the mic level holds steady. */
        @keyframes spr-wave-live {
          0%, 100% { transform: scaleY(0.45); }
          50% { transform: scaleY(1.35); }
        }
        /* Soft breathing pulse on the dark signal disc while listening. */
        @keyframes spr-disc-pulse {
          0%, 100% { transform: scale(1); filter: brightness(1); }
          50% { transform: scale(1.045); filter: brightness(1.18); }
        }
        .spr-intake-orb-ring {
          animation: spr-orb-ring 3.6s ease-out infinite;
        }
        .spr-intake-orb-ring-delay {
          animation: spr-orb-ring 3.6s ease-out infinite 1.2s;
        }
        .spr-smoke-swirl {
          animation: spr-smoke-swirl 9s linear infinite;
        }
        .spr-smoke-swirl-rev {
          animation: spr-smoke-swirl-rev 15s linear infinite;
        }
        .spr-orb-alive {
          animation: spr-orb-alive 4.5s ease-in-out infinite;
        }
        .spr-wave-bar {
          animation: spr-wave-bar 2.2s ease-in-out infinite;
          transform-origin: center;
        }
        .spr-wave-live {
          animation: spr-wave-live 0.9s ease-in-out infinite;
          transform-origin: center;
        }
        .spr-disc-pulse {
          animation: spr-disc-pulse 2.4s ease-in-out infinite;
        }
        /* Safari (esp. mobile) does not reliably clip GPU-composited,
           transform-animated descendants with border-radius + overflow
           alone — the rotating smoke layers paint square corners and the
           orb intermittently renders as a square. A circular mask is
           applied at compositing time, so it enforces the clip no matter
           how the children are composited. 98% -> 100% feather keeps the
           edge crisp against the border-radius circle. */
        .spr-orb-clip {
          -webkit-mask-image: -webkit-radial-gradient(center, circle closest-side, rgba(0,0,0,1) 98%, rgba(0,0,0,0) 100%);
          mask-image: radial-gradient(circle closest-side, rgba(0,0,0,1) 98%, rgba(0,0,0,0) 100%);
        }
        @media (prefers-reduced-motion: reduce) {
          .spr-intake-orb-ring,
          .spr-intake-orb-ring-delay,
          .spr-smoke-swirl,
          .spr-smoke-swirl-rev,
          .spr-orb-alive,
          .spr-wave-bar,
          .spr-wave-live,
          .spr-disc-pulse {
            animation: none !important;
          }
        }
      `}</style>

      <div
        className="pointer-events-none fixed z-40 flex flex-col items-end gap-2.5 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] right-[max(0.75rem,env(safe-area-inset-right,0px))] md:bottom-[calc(1.35rem+env(safe-area-inset-bottom,0px))] md:right-[max(1.25rem,env(safe-area-inset-right,0px))]"
      >
        {feedback && <div className="pointer-events-auto order-1 max-h-[45vh] w-[min(100vw-2rem,22rem)] overflow-y-auto">{feedback}</div>}
        {/* Compact status / error panel — opens upward above hints */}
        {(showPanel || error) && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-auto order-1 w-[min(100vw-2rem,16.5rem)] overflow-hidden rounded-2xl border border-teal-100/80 bg-white/95 shadow-lg shadow-teal-950/10 backdrop-blur"
          >
            <div className="flex items-start gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1 space-y-2">
                {answer && !error && state === "idle" && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold leading-snug text-slate-500">
                      &ldquo;{answer.question}&rdquo;
                    </p>
                    <p className="max-h-44 overflow-y-auto text-[12.5px] leading-snug text-[#1a2e2e]">
                      {answer.reply}
                    </p>
                    <div className="flex gap-1.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => (speaking ? stopSpeaking() : speak(answer.reply))}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#245c5c] px-3 py-1.5 text-[11px] font-semibold text-[#f6f3ea]"
                      >
                        {speaking ? (
                          <Pause className="h-3.5 w-3.5" />
                        ) : (
                          <Volume2 className="h-3.5 w-3.5" />
                        )}
                        {speaking
                          ? L("Stop", "Detener", lang)
                          : L("Hear it", "Escúchalo", lang)}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !muted;
                          setMuted(next);
                          if (next) stopSpeaking();
                        }}
                        aria-pressed={muted}
                        aria-label={L(
                          "Mute voice answers",
                          "Silenciar respuestas de voz",
                          lang
                        )}
                        title={L("Mute voice answers", "Silenciar respuestas de voz", lang)}
                        className={`rounded-xl border px-2.5 ${
                          muted
                            ? "border-[#245c5c] bg-[#245c5c]/10 text-[#245c5c]"
                            : "border-slate-200 text-slate-500 hover:bg-slate-50"
                        }`}
                      >
                        {muted ? (
                          <VolumeX className="h-3.5 w-3.5" />
                        ) : (
                          <Volume2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
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
                    {answering
                      ? L("Answering…", "Respondiendo…", lang)
                      : L("Transcribing…", "Transcribiendo…", lang)}
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
                  stopSpeaking();
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
              <span role="status" aria-live="polite" className="min-w-0 flex-1">{tooltipText}</span>
            </button>
            <span
              aria-hidden
              className="absolute left-1/2 top-full -mt-px h-2.5 w-2.5 -translate-x-1/2 rotate-45 border-b border-r border-slate-200/70 bg-white/75 shadow-[2px_2px_4px_rgba(36,92,92,0.05)]"
            />
          </div>
        )}

        {/* Single globe orb — cosmos smoke swirls continuously inside */}
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
          aria-label={state === "listening" ? L("Stop recording and use speech", "Terminar grabación y usar voz", lang) : L("Start voice input — microphone off", "Activar voz — micrófono apagado", lang)}
          aria-pressed={state === "listening"}
          aria-busy={state === "processing"}
          className={`pointer-events-auto group relative order-4 flex items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#245c5c] disabled:opacity-70 ${state === "listening" ? "h-24 w-24 ring-4 ring-teal-600 ring-offset-4 md:h-28 md:w-28" : "h-[5.5rem] w-[5.5rem] md:h-24 md:w-24"}`}
        >
          {/* Gentle ambient rings — listening indicator only */}
          {state === "listening" && !reducedMotion && (
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
          {state === "listening" || state === "processing" ? (
            /* Mic ON: dark signal disc with a pulsating white waveform —
               no globe in the active state. */
            <span
              aria-hidden
              className={`absolute inset-[5px] overflow-hidden rounded-full bg-[#303036] ${
                state === "listening" && !reducedMotion ? "spr-disc-pulse" : ""
              }`}
              style={{
                boxShadow:
                  "inset 0 -8px 16px rgba(0,0,0,0.5), inset 0 4px 10px rgba(255,255,255,0.08), 0 4px 16px rgba(0,0,0,0.35)",
              }}
            />
          ) : (
            /* Motion globe — green smoke, kept visibly alive. The globe fills
               the button edge-to-edge: no border gap, no halo rings. */
            <span
              aria-hidden
              className={`absolute inset-0 overflow-hidden rounded-full bg-[#0b3532] ${
                !reducedMotion ? "spr-orb-alive" : ""
              }`}
              style={{
                boxShadow:
                  "inset 0 -10px 18px rgba(4,47,46,0.55), inset 0 6px 14px rgba(255,255,255,0.16), 0 4px 16px rgba(36,92,92,0.38)",
              }}
            >
            {/* Smoke layers sit inside a masked circular clipper: without the
                mask, Safari intermittently renders the orb as a square
                because the rotating (GPU-composited) smoke squares escape
                the border-radius + overflow clip. */}
            <span aria-hidden className="spr-orb-clip absolute inset-0 overflow-hidden rounded-full bg-[#0b3532]">
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
            </span>
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
          )}
          {/* Icon: white waveform signal — pulsating while listening, calm on the globe */}
          <span className="relative z-10">
            {state === "listening" ? (
              <span className="flex flex-col items-center gap-1"><WaveformBars live level={level} reducedMotion={reducedMotion} /><Square className="h-3 w-3 fill-white text-white" /></span>
            ) : state === "processing" ? (
              <span
                className={`inline-block h-5 w-5 rounded-full border-2 border-white border-t-transparent ${
                  reducedMotion ? "" : "animate-spin"
                }`}
              />
            ) : (
              <WaveformBars live={false} level={0} reducedMotion={reducedMotion} />
            )}
          </span>
        </button>
      </div>
    </>
  );
}
