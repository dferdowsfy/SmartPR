"use client";

import styles from "./marketing.module.css";
import type { Language } from "./MarketingChrome";
import FilingPathStory from "./FilingPathStory";
import FilingAssistant from "./FilingAssistant";

const VOICE_AGENT_TEL = "tel:+17405636900";

const copy = {
  EN: {
    eyebrow: "See how it works",
    title: "From uncertainty to submission-ready.",
    steps: [
      {
        title: "Describe the business.",
        body: "Tell SmartPR what you want to do, in plain language. Type it, answer a few guided questions — or just call and say it.",
      },
      {
        title: "Identify applicable requirements.",
        body: "SmartPR maps every permit, license, and registration across agencies — only from the facts you confirm. Example: a restaurant in Bayamón.",
      },
      {
        title: "Prepare forms and documents.",
        body: "Official forms filled from your business profile. Supporting documents checked. Whatever's missing gets flagged — before an agency ever sees it.",
      },
      {
        title: "Review and submit.",
        body: "A readiness check, then a complete submission package. Nothing is filed without your review and approval.",
      },
    ],
    callCta: "Call SmartPR",
    callNumber: "+1 (740) 563-6900",
    betaLead: "Assisted live filing — currently in pilot.",
    betaRest:
      "Watch the assistant complete the filing with you on the government website. It pauses for your login, your approval, and your payment — and you click submit yourself.",
  },
  ES: {
    eyebrow: "Vea cómo funciona",
    title: "De la incertidumbre a estar listo para radicar.",
    steps: [
      {
        title: "Describa su negocio.",
        body: "Dígale a SmartPR lo que quiere hacer, en lenguaje sencillo. Escríbalo, conteste unas preguntas guiadas — o llame y dígalo.",
      },
      {
        title: "Identifique los requisitos que aplican.",
        body: "SmartPR mapea cada permiso, licencia y registro en todas las agencias — solo con los datos que usted confirme. Ejemplo: un restaurante en Bayamón.",
      },
      {
        title: "Prepare formularios y documentos.",
        body: "Formularios oficiales llenados desde el perfil de su negocio. Documentos revisados. Lo que falte se señala — antes de que una agencia lo vea.",
      },
      {
        title: "Revise y radique.",
        body: "Una revisión de preparación y un paquete de radicación completo. Nada se radica sin su revisión y aprobación.",
      },
    ],
    callCta: "Llamar a SmartPR",
    callNumber: "+1 (740) 563-6900",
    betaLead: "Trámite asistido en vivo — actualmente en piloto.",
    betaRest:
      "Vea cómo el asistente completa el trámite con usted en la página del gobierno. Se detiene para su inicio de sesión, su aprobación y su pago — y usted le da a enviar.",
  },
} as const;

/** One merged section: the Bayamón restaurant example, the voice channel, and
 * the assisted-filing assistant become proof inside the 4-step flow instead of
 * three standalone sections. Voice is a channel note in Step 1; the filing
 * assistant keeps its Beta badge in Step 3/4. */
export default function HowItWorks({
  language,
  cta,
  onStart,
}: {
  language: Language;
  cta: string;
  onStart: () => void;
}) {
  const c = copy[language];
  return (
    <section id="how-it-works" className={styles.section} aria-label={c.eyebrow}>
      <div className={styles.sectionInner}>
        <p className={styles.eyebrow}>{c.eyebrow}</p>
        <h2>{c.title}</h2>
        <ol className={styles.cards}>
          {c.steps.map((step, i) => (
            <li key={step.title} className={styles.card}>
              <span>{String(i + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
              {i === 0 ? (
                <a className={styles.ghost} href={VOICE_AGENT_TEL}>
                  {c.callCta}: {c.callNumber} <span aria-hidden>→</span>
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      </div>

      <div className={styles.sectionInner}>
        <FilingPathStory language={language} />
      </div>

      <div className={styles.sectionInner}>
        <FilingAssistant language={language} cta={cta} onStart={onStart} />
        <p className={styles.lead}>
          <strong>{c.betaLead}</strong> {c.betaRest}
        </p>
      </div>
    </section>
  );
}
