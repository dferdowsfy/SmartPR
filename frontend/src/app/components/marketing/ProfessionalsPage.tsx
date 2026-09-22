"use client";

import { useEffect, useState } from "react";
import styles from "./marketing.module.css";
import { SiteHeader, SiteFooter, useMarketingLanguage, type Language } from "./MarketingChrome";
import LeadModal from "./LeadModal";

const DEMO_EMAIL = "darius@getsmartpr.com";

const copy = {
  EN: {
    heroHeadline: "Prepare permits and filings for every client in one place.",
    heroSub:
      "SmartPR gives your firm one platform for every client's Puerto Rico filings — from requirements to readiness to submission. Less chasing, fewer rejections, work your team can actually see.",
    startPilot: "Start a pilot",
    bookDemo: "Book a demo",
    demoSubject: "SmartPR demo request",
    whoFor: "Gestores · CPAs · Permitting firms · Law firms · Consultants · Multi-entity operators",
    features: [
      {
        title: "One dashboard for every client.",
        body: "Each client gets a workspace with its businesses, filings, documents, and deadlines — all visible from your firm's dashboard. No more digging through email threads to answer '¿cómo va lo mío?'",
      },
      {
        title: "Reusable business profiles.",
        body: "Enter a client's facts once. Every form, checklist, and filing reuses the same profile — no retyping the same data across agencies.",
      },
      {
        title: "Client filing status and readiness.",
        body: "See at a glance which filings are ready, which are waiting on documents, and what's due next — for one client or fifty.",
      },
      {
        title: "Fewer incomplete or rejected filings.",
        body: "Structured requirements and completeness checks catch missing facts and documents before anything reaches the agency — fewer rejections, less rework.",
      },
    ],
    pilotTitle: "How a pilot works",
    pilotSteps: [
      "Bring one client — or five.",
      "We set up your firm workspace together.",
      "Run real filings. Measure what changes.",
    ],
    closeTitle: "Start a pilot",
  },
  ES: {
    heroHeadline: "Prepare permisos y trámites para todos sus clientes en un solo lugar.",
    heroSub:
      "SmartPR le da a su firma una sola plataforma para los trámites de cada cliente en Puerto Rico — de los requisitos a la preparación a la radicación. Menos corre-corre, menos rechazos, trabajo que su equipo sí puede ver.",
    startPilot: "Comenzar un piloto",
    bookDemo: "Agendar una demo",
    demoSubject: "Solicitud de demo de SmartPR",
    whoFor: "Gestores · CPAs · Firmas de permisos · Bufetes · Consultores · Operadores con varias entidades",
    features: [
      {
        title: "Un panel para cada cliente.",
        body: "Cada cliente tiene su espacio con sus negocios, trámites, documentos y vencimientos — todo visible desde el panel de su firma. Adiós a buscar en emails para contestar '¿cómo va lo mío?'",
      },
      {
        title: "Perfiles de negocio reutilizables.",
        body: "Registre los datos de un cliente una vez. Cada formulario, lista y trámite reusa el mismo perfil — sin volver a escribir lo mismo en cada agencia.",
      },
      {
        title: "Estatus y preparación por cliente.",
        body: "Vea de un vistazo qué trámites están listos, cuáles esperan documentos y qué vence próximo — para un cliente o cincuenta.",
      },
      {
        title: "Menos radicaciones incompletas o rechazadas.",
        body: "Requisitos estructurados y chequeos de completitud detectan datos y documentos que faltan antes de que algo llegue a la agencia — menos rechazos, menos retrabajo.",
      },
    ],
    pilotTitle: "Cómo funciona un piloto",
    pilotSteps: [
      "Traiga un cliente — o cinco.",
      "Montamos juntos el espacio de su firma.",
      "Corra trámites reales. Mida qué cambia.",
    ],
    closeTitle: "Comenzar un piloto",
  },
} as const;

export default function ProfessionalsPage({ initialLanguage = "EN" }: { initialLanguage?: Language }) {
  const { language, handleLanguageChange } = useMarketingLanguage(initialLanguage);
  const [leadOpen, setLeadOpen] = useState(false);
  const c = copy[language];
  const home = language === "ES" ? "/es" : "/";

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className={styles.shell}>
      <SiteHeader language={language} home={home} onLanguageChange={handleLanguageChange} />

      <main>
        <div className={styles.showcase}>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <h1>
                <span>{c.heroHeadline}</span>
              </h1>
              <p className={styles.heroLead}>{c.heroSub}</p>
              <div className={styles.heroActions}>
                <button type="button" className={styles.primary} onClick={() => setLeadOpen(true)}>
                  {c.startPilot}
                </button>
                <a
                  className={styles.ghost}
                  href={`mailto:${DEMO_EMAIL}?subject=${encodeURIComponent(c.demoSubject)}`}
                >
                  {c.bookDemo} <span aria-hidden>→</span>
                </a>
              </div>
              <p className={styles.lead}>{c.whoFor}</p>
            </div>
          </section>
        </div>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <ol className={styles.cards}>
              {c.features.map((feature, i) => (
                <li key={feature.title} className={styles.card}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <h2>{c.pilotTitle}</h2>
            <ol className={styles.cards}>
              {c.pilotSteps.map((step, i) => (
                <li key={step} className={styles.card}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.close}>
            <h2>{c.closeTitle}</h2>
            <div className={styles.heroActions}>
              <button type="button" className={styles.primary} onClick={() => setLeadOpen(true)}>
                {c.startPilot}
              </button>
              <a
                className={styles.ghost}
                href={`mailto:${DEMO_EMAIL}?subject=${encodeURIComponent(c.demoSubject)}`}
              >
                {c.bookDemo} <span aria-hidden>→</span>
              </a>
            </div>
          </div>
        </section>
      </main>

      <LeadModal
        language={language}
        open={leadOpen}
        source="professionals_start_pilot"
        successMode="confirm"
        onClose={() => setLeadOpen(false)}
        onDone={() => setLeadOpen(false)}
      />

      <SiteFooter language={language} home={home} onLanguageChange={handleLanguageChange} />
    </div>
  );
}
