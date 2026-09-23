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
    reviewHeading: "How requirements are reviewed",
    reviewBody:
      "Every requirement in SmartPR traces to the legal authority that creates it. Rules are checked against primary sources, run against 25 frozen real-world scenarios whose expectations are never rewritten to make SmartPR pass, and kept under continuous expert review. When the confirmed facts don't support a requirement, SmartPR asks instead of guessing.",
    foundersHeading: "Founders",
    foundersTodo: "Founder bios coming soon.",
    contactHeading: "Contact",
  },
  ES: {
    title: "Sobre SmartPR",
    purpose:
      "Abrir y correr un negocio en Puerto Rico no debería requerir un título de abogado ni un gestor de planta. SmartPR existe para que cada requisito se pueda conocer, cada formulario se pueda completar y ningún vencimiento se pase — para dueños y los profesionales que los atienden.",
    reviewHeading: "Cómo se revisan los requisitos",
    reviewBody:
      "Cada requisito en SmartPR lleva a la autoridad legal que lo crea. Las reglas se verifican contra fuentes primarias, corren contra 25 escenarios reales congelados cuyas expectativas nunca se reescriben para que SmartPR pase, y se mantienen bajo revisión experta continua. Cuando los datos confirmados no sustentan un requisito, SmartPR pregunta en vez de adivinar.",
    foundersHeading: "Fundadores",
    foundersTodo: "Biografías de los fundadores próximamente.",
    contactHeading: "Contacto",
  },
} as const;

export default function AboutPage({ initialLanguage = "EN" }: { initialLanguage?: Language }) {
  const { language, handleLanguageChange } = useMarketingLanguage(initialLanguage);
  const c = copy[language];
  const home = language === "ES" ? "/es" : "/";

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
            <h2>{c.reviewHeading}</h2>
            <p className={styles.lead}>{c.reviewBody}</p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <h2>{c.foundersHeading}</h2>
            {/* TODO: founder names, roles, and one-line bios to be supplied — do not invent. */}
            <p className={styles.lead}>{c.foundersTodo}</p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <h2>{c.contactHeading}</h2>
            <p className={styles.lead}>
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
