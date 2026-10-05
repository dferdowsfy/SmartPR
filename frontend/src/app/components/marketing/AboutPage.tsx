"use client";

import { useEffect } from "react";
import styles from "./marketing.module.css";
import { SiteHeader, SiteFooter, useMarketingLanguage, type Language } from "./MarketingChrome";

const CONTACT_EMAIL = "contact@getsmartpr.com";

const copy = {
  EN: {
    title: "About SmartPR",
    purpose:
      "Opening and running a business in Puerto Rico shouldn't require a law degree or a gestor on retainer. SmartPR exists to make every requirement knowable, every form completable, and every deadline unmissable — for owners and the professionals who serve them.",
    whatHeading: "What SmartPR does",
    whatBody:
      "SmartPR turns a plain-language description of a business into a clear action plan: which permits, licenses, registrations, and inspections apply; which official forms and documents are required; when renewals and compliance deadlines fall; and which tax incentives the business may qualify for. Everything is derived from official Puerto Rico government sources — not generic checklists.",
    whoHeading: "Who SmartPR is for",
    whoBody:
      "SmartPR serves business owners opening or operating in Puerto Rico, and the professionals who advise them — CPAs, attorneys, gestores, and consultants — who use it to prepare complete, source-backed client packages.",
    reviewHeading: "How requirements are reviewed",
    reviewBody:
      "Every requirement in SmartPR traces to the legal authority that creates it. Rules are checked against primary sources, run against 25 frozen real-world scenarios whose expectations are never rewritten to make SmartPR pass, and kept under continuous expert review. When the confirmed facts don't support a requirement, SmartPR asks instead of guessing.",
    privacyHeading: "Data and privacy",
    privacyBody:
      "SmartPR only collects the information needed to prepare your requirements: the business details you enter, the documents you upload, and basic account information. We don't sell personal data, and business documents are used only to map form fields and check evidence.",
    privacyLink: "Read the full privacy policy",
    disclaimerHeading: "Not legal advice",
    disclaimerBody:
      "SmartPR provides regulatory information and preparation tools. It is not a law firm and does not provide legal advice. Requirements change over time — always confirm with the issuing agency or a licensed professional before filing.",
    contactHeading: "Support and contact",
    contactBody: "Questions or help with your account? Write to us:",
  },
  ES: {
    title: "Sobre SmartPR",
    purpose:
      "Abrir y correr un negocio en Puerto Rico no debería requerir un título de abogado ni un gestor de planta. SmartPR existe para que cada requisito se pueda conocer, cada formulario se pueda completar y ningún vencimiento se pase — para dueños y los profesionales que los atienden.",
    whatHeading: "Qué hace SmartPR",
    whatBody:
      "SmartPR convierte una descripción sencilla de tu negocio en un plan de acción claro: qué permisos, licencias, registros e inspecciones aplican; qué formularios oficiales y documentos se requieren; cuándo vencen las renovaciones y los cumplimientos; y para qué incentivos contributivos puede cualificar el negocio. Todo se deriva de fuentes oficiales del gobierno de Puerto Rico — no de listados genéricos.",
    whoHeading: "Para quién es SmartPR",
    whoBody:
      "SmartPR sirve a dueños de negocio que abren u operan en Puerto Rico, y a los profesionales que los asesoran — CPA, abogados, gestores y consultores — que lo usan para preparar paquetes completos respaldados por fuentes oficiales.",
    reviewHeading: "Cómo se revisan los requisitos",
    reviewBody:
      "Cada requisito en SmartPR lleva a la autoridad legal que lo crea. Las reglas se verifican contra fuentes primarias, corren contra 25 escenarios reales congelados cuyas expectativas nunca se reescriben para que SmartPR pase, y se mantienen bajo revisión experta continua. Cuando los datos confirmados no sustentan un requisito, SmartPR pregunta en vez de adivinar.",
    privacyHeading: "Datos y privacidad",
    privacyBody:
      "SmartPR solo recoge la información necesaria para preparar tus requisitos: los datos del negocio que entras, los documentos que subes y la información básica de tu cuenta. No vendemos datos personales, y los documentos del negocio solo se usan para mapear campos de formularios y verificar evidencia.",
    privacyLink: "Lee la política de privacidad completa",
    disclaimerHeading: "No es asesoría legal",
    disclaimerBody:
      "SmartPR ofrece información regulatoria y herramientas de preparación. No es un bufete de abogados ni ofrece asesoría legal. Los requisitos cambian con el tiempo — confirma siempre con la agencia emisora o un profesional licenciado antes de radicar.",
    contactHeading: "Soporte y contacto",
    contactBody: "¿Preguntas o ayuda con tu cuenta? Escríbenos:",
  },
} as const;

export default function AboutPage({ initialLanguage = "EN" }: { initialLanguage?: Language }) {
  const { language, handleLanguageChange } = useMarketingLanguage(initialLanguage);
  const c = copy[language];
  const home = language === "ES" ? "/es" : "/";
  const privacyHref = language === "ES" ? "/privacy" : "/privacy";

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className={styles.shell}>
      <SiteHeader language={language} home={home} variant="home" onLanguageChange={handleLanguageChange} />

      <main>
        <div className={styles.showcase}>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <h1>
                <span>{c.title}</span>
              </h1>
              <p className={styles.heroLead}>{c.purpose}</p>
            </div>
          </section>
        </div>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <h2>{c.whatHeading}</h2>
            <p className={styles.lead}>{c.whatBody}</p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <h2>{c.whoHeading}</h2>
            <p className={styles.lead}>{c.whoBody}</p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <h2>{c.reviewHeading}</h2>
            <p className={styles.lead}>{c.reviewBody}</p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <h2>{c.privacyHeading}</h2>
            <p className={styles.lead}>{c.privacyBody}</p>
            <p className={styles.lead}>
              <a className={styles.ghost} href={privacyHref}>
                {c.privacyLink} <span aria-hidden>→</span>
              </a>
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <h2>{c.disclaimerHeading}</h2>
            <p className={styles.lead}>{c.disclaimerBody}</p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <h2>{c.contactHeading}</h2>
            <p className={styles.lead}>
              {c.contactBody}{" "}
              <a className={styles.ghost} href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL} <span aria-hidden>→</span>
              </a>
            </p>
          </div>
        </section>
      </main>

      <SiteFooter language={language} variant="home" />
    </div>
  );
}
