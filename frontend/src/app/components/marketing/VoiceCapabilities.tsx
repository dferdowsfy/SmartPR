"use client";

import { Check, ClipboardList, Lock, MicOff, MoreHorizontal, Phone } from "lucide-react";
import styles from "./voiceCapabilities.module.css";

type Language = "EN" | "ES";

const VOICE_AGENT_NUMBER = "tel:+17405636900";

const copy = {
  EN: {
    callLabel: "On your time · by phone",
    callTitle: "Call SmartPR.",
    callBody:
      "Call for general guidance, or verify with a PIN to securely access permits, requirements, evidence, and project status by voice.",
    pills: ["General guidance", "PIN verified", "Project status", "Requirements"],
    callCta: "Call SmartPR",
    callAvailability: "Available 24/7 · Spanish and English",
    voiceAssistant: "Voice Assistant",
    listening: "Listening…",
    callHint:
      "“You can say things like ‘check the status of my application’ or ‘what permits do I need?’”",
    mute: "Mute",
    end: "End",
    more: "More",
    callTimer: "00:24",
    phoneAlt: "SmartPR voice assistant on an active phone call",
    speakLabel: "Faster filing · voice powered",
    speakTitle: "Speak instead of type.",
    speakBody: "As you talk, SmartPR maps what you say into the right fields automatically.",
    transcript:
      "“My business is Caribe Industrial Manufacturing LLC. We are already formed in Puerto Rico and have 24 employees.”",
    mappingTitle: "Mapping to your application",
    fields: [
      { label: "Legal entity name", value: "Caribe Industrial Manufacturing LLC" },
      { label: "Formation status", value: "Already formed in Puerto Rico" },
      { label: "Employees", value: "24" },
    ],
    caption: "Real conversations. Real progress.",
  },
  ES: {
    callLabel: "A tu tiempo · por teléfono",
    callTitle: "Llama a SmartPR.",
    callBody:
      "Llama para orientación general, o verifícate con un PIN para acceder por voz y de forma segura a permisos, requisitos, evidencia y el estatus de tu proyecto.",
    pills: ["Orientación general", "PIN verificado", "Estatus del proyecto", "Requisitos"],
    callCta: "Llamar a SmartPR",
    callAvailability: "Disponible 24/7 · Español e inglés",
    voiceAssistant: "Asistente de voz",
    listening: "Escuchando…",
    callHint:
      "“Puedes decir cosas como ‘verifica el estatus de mi solicitud’ o ‘¿qué permisos necesito?’”",
    mute: "Silenciar",
    end: "Colgar",
    more: "Más",
    callTimer: "00:24",
    phoneAlt: "Asistente de voz de SmartPR en una llamada activa",
    speakLabel: "Radicación más rápida · con voz",
    speakTitle: "Habla en vez de escribir.",
    speakBody: "Mientras hablas, SmartPR lleva lo que dices a los campos correctos automáticamente.",
    transcript:
      "“Mi negocio es Caribe Industrial Manufacturing LLC. Ya estamos formados en Puerto Rico y tenemos 24 empleados.”",
    mappingTitle: "Llevando a tu solicitud",
    fields: [
      { label: "Nombre de la entidad legal", value: "Caribe Industrial Manufacturing LLC" },
      { label: "Estatus de formación", value: "Ya formada en Puerto Rico" },
      { label: "Empleados", value: "24" },
    ],
    caption: "Conversaciones reales. Progreso real.",
  },
} as const;

const PILL_ICONS = [Phone, Lock, ClipboardList, Check] as const;

/** White voice-activity bars used inside both orbs. */
function Waveform({ bars, className }: { bars: number[]; className?: string }) {
  return (
    <span className={`${styles.waveform} ${className ?? ""}`} aria-hidden="true">
      {bars.map((h, i) => (
        <span key={i} className={styles.waveBar} style={{ height: `${h}%` }} />
      ))}
    </span>
  );
}

const CALL_WAVE = [38, 55, 72, 48, 88, 64, 95, 58, 78, 42, 68, 90, 52, 74, 46, 62, 84, 50, 70, 40, 58, 76, 48, 36];
const ORB_WAVE = [45, 70, 55, 90, 65, 100, 60, 80, 50];

function PhoneMockup({ c }: { c: (typeof copy)[Language] }) {
  return (
    <div className={styles.phoneWrap}>
      <div className={styles.phone} role="img" aria-label={c.phoneAlt}>
        <div className={styles.phoneScreen}>
          <div className={styles.notch} aria-hidden="true" />
          <div className={styles.statusBar} aria-hidden="true">
            <span className={styles.statusTime}>9:41</span>
            <span className={styles.statusIcons}>
              <span className={styles.sigBars}>
                <i style={{ height: "4px" }} />
                <i style={{ height: "6px" }} />
                <i style={{ height: "8px" }} />
                <i style={{ height: "10px" }} />
              </span>
              <span className={styles.wifi} />
              <span className={styles.battery}>
                <i />
              </span>
            </span>
          </div>
          <p className={styles.callName}>SmartPR</p>
          <p className={styles.callSub}>{c.voiceAssistant}</p>
          <div className={styles.callOrb} aria-hidden="true">
            <span className={styles.callOrbHalo} />
            <Waveform bars={CALL_WAVE} className={styles.callWave} />
          </div>
          <p className={styles.listeningPill}>
            <span className={styles.listeningDot} aria-hidden="true" />
            {c.listening}
          </p>
          <p className={styles.callHint}>{c.callHint}</p>
          <div className={styles.callControls} aria-hidden="true">
            <div className={styles.control}>
              <span className={`${styles.controlBtn} ${styles.controlMuted}`}>
                <MicOff size={20} strokeWidth={1.75} />
              </span>
              <span className={styles.controlLabel}>{c.mute}</span>
            </div>
            <div className={styles.control}>
              <span className={`${styles.controlBtn} ${styles.controlEnd}`}>
                <Phone size={22} strokeWidth={1.75} className={styles.endIcon} />
              </span>
              <span className={styles.controlLabel}>{c.end}</span>
            </div>
            <div className={styles.control}>
              <span className={`${styles.controlBtn} ${styles.controlMuted}`}>
                <MoreHorizontal size={20} strokeWidth={1.75} />
              </span>
              <span className={styles.controlLabel}>{c.more}</span>
            </div>
          </div>
          <p className={styles.callTimer}>{c.callTimer}</p>
        </div>
      </div>
    </div>
  );
}

export default function VoiceCapabilities({ language }: { language: Language }) {
  const c = copy[language];
  return (
    <div className={styles.voice}>
      {/* ——— Card 1: Call SmartPR ——— */}
      <article className={styles.card} aria-labelledby="voice-call-title">
        <div className={styles.cardCopy}>
          <p className={styles.eyebrow}>{c.callLabel}</p>
          <h2 id="voice-call-title" className={styles.title}>
            {c.callTitle}
          </h2>
          <p className={styles.lede}>{c.callBody}</p>
          <ul className={styles.pills}>
            {c.pills.map((pill, i) => {
              const Icon = PILL_ICONS[i];
              return (
                <li key={pill} className={styles.pill}>
                  <Icon size={15} strokeWidth={2} aria-hidden="true" />
                  <span>{pill}</span>
                </li>
              );
            })}
          </ul>
          <a className={styles.cta} href={VOICE_AGENT_NUMBER}>
            <Phone size={17} strokeWidth={2} aria-hidden="true" />
            {c.callCta}
          </a>
          <p className={styles.availability}>{c.callAvailability}</p>
        </div>
        <PhoneMockup c={c} />
      </article>

      {/* ——— Card 2: Speak instead of type ——— */}
      <article className={styles.card} aria-labelledby="voice-speak-title">
        <div className={styles.speakHead}>
          <p className={styles.eyebrow}>{c.speakLabel}</p>
          <h2 id="voice-speak-title" className={styles.title}>
            {c.speakTitle}
          </h2>
          <p className={styles.lede}>{c.speakBody}</p>
        </div>
        <div className={styles.speakGrid}>
          <div className={styles.orbZone}>
            <div className={styles.orb} role="img" aria-label={c.listening}>
              <span className={styles.orbHalo} aria-hidden="true" />
              <span className={styles.orbCore} aria-hidden="true" />
              <Waveform bars={ORB_WAVE} className={styles.orbWave} />
            </div>
            <p className={styles.orbListening}>{c.listening}</p>
            <figure className={styles.transcript}>
              <span className={styles.transcriptWave} aria-hidden="true">
                <i style={{ height: "10px" }} />
                <i style={{ height: "16px" }} />
                <i style={{ height: "8px" }} />
                <i style={{ height: "13px" }} />
              </span>
              <blockquote>{c.transcript}</blockquote>
              <span className={styles.transcriptDots} aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </figure>
          </div>
          <div className={styles.mapZone}>
            <div className={styles.mapCard}>
              <p className={styles.mapTitle}>{c.mappingTitle}</p>
              <ul className={styles.mapFields}>
                {c.fields.map((field) => (
                  <li key={field.label} className={styles.mapField}>
                    <div>
                      <p className={styles.mapLabel}>{field.label}</p>
                      <p className={styles.mapValue}>{field.value}</p>
                    </div>
                    <span className={styles.mapCheck} aria-hidden="true">
                      <Check size={15} strokeWidth={2.5} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <p className={styles.caption}>
              <span className={styles.captionRule} aria-hidden="true" />
              {c.caption}
            </p>
          </div>
        </div>
      </article>
    </div>
  );
}
