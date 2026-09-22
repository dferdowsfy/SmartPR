"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./marketing.module.css";
import { SiteHeader, SiteFooter, useMarketingLanguage, type Language } from "./MarketingChrome";
import LeadModal from "./LeadModal";
import { createSupabaseBrowser } from "../../../lib/supabase/client";

const DEMO_EMAIL = "darius@getsmartpr.com";
const PILOT_SUBJECT = "SmartPR pilot";
const DEMO_SUBJECT = "SmartPR demo request";
const TRUST_URL = "https://trust.getsmartpr.com";

const copy = {
  EN: {
    kicker: "For gestores, CPAs, and permitting firms",
    heroTitle: "Prepare Puerto Rico filings for every client in one place.",
    heroSub:
      "One workspace per client. Requirements mapped to the law, official forms filled from the profile, and renewals tracked before they come due. Fewer incomplete packages. Less chasing.",
    startPilot: "Start a pilot",
    bookDemo: "Book a demo",
    ownerLead: "Opening a business yourself?",
    ownerCta: "See what applies",
    buyKicker: "What you are buying",
    buyTitle: "Three things. Not a pile of features.",
    buyCards: [
      {
        eyebrow: "Requirements",
        title: "Know what applies",
        body: "Tell us the business. We identify every permit, license, and registration across agencies — from the facts you confirm.",
        link: "See the path",
      },
      {
        eyebrow: "Preparation",
        title: "We prepare the package",
        body: "Official forms completed from the business profile. Documents checked. Gaps flagged before an agency sees them.",
        link: "How filing works",
      },
      {
        eyebrow: "Annual filings",
        title: "Stay compliant every year",
        body: "Renewals and recurring filings tracked. Reminders at 60, 30, and 7 days. Next year's cycle queues when this year's is done.",
        link: "After you open",
      },
    ],
    howKicker: "See how it works",
    howTitle: "One example. One process.",
    steps: [
      {
        title: "1. Describe the business",
        body: "A few questions — or say it in plain language. Same facts every time.",
      },
      {
        title: "2. Match it to the rules",
        body: "SmartPR checks the profile against the regulations that actually apply.",
      },
      {
        title: "3. Get a package you can file",
        body: "What applies, filled forms, missing documents, readiness. You review. You submit.",
      },
    ],
    exampleLabel: "Example only · restaurant in Bayamón · 7 agencies · 7 filings",
    exampleQuote: "I want to open a restaurant in Bayamón with 10 employees and outdoor seating.",
    chips: ["Restaurant", "Bayamón", "10 employees", "Outdoor seating"],
    filings: [
      { title: "Entity registration", sub: "Department of State · Corporation or LLC" },
      { title: "Federal tax registration", sub: "IRS · EIN" },
      { title: "Puerto Rico tax registration", sub: "Hacienda · SURI and tax accounts" },
      { title: "Municipal registration", sub: "Municipio de Bayamón · patente" },
      { title: "Permits & use", sub: "OGPe · Permiso Único" },
      { title: "Health & fire", sub: "Department of Health · Fire Bureau" },
      { title: "Review & submit", sub: "Nothing is filed without you" },
    ],
    exampleNote: "This is a sample path, not your result. Incentive eligibility depends on the full profile.",
    pilotLine:
      "Assisted live filing is in pilot for SURI. The assistant opens the government site and fills it with the profile. It stops for your login, payment, and the final click.",
    whyKicker: "Why SmartPR — not a chatbot",
    whyTitle: "Chatbots explain. This is built to file.",
    whyLead:
      "Ask a chatbot what a Permiso Único is. That is useful. Do not ask it to decide what a client owes Hacienda and then put that on a form. SmartPR is the second job.",
    whyLines: [
      {
        lead: "Curated rules, traced to the source.",
        rest: " Requirements link to the statute or official guidance. Rules are reviewed against primary sources before they ship as verified.",
      },
      {
        lead: "Same facts, same checklist. No improvisation.",
        rest: " The same business profile produces the same requirements every time.",
      },
      {
        lead: "Official forms, not a summary.",
        rest: " Agency forms are filled from the profile and bundled into a submission package. Missing documents get flagged first.",
      },
      {
        lead: "Annual filings don't depend on memory.",
        rest: " Recurring obligations stay on one list, with 60 / 30 / 7-day reminders.",
      },
      {
        lead: "Readiness before the agency sees it.",
        rest: " Completeness checks run on the package. Nothing is submitted without your review.",
      },
    ],
    secKicker: "Security",
    secTitle: "Client files stay in the workspace.",
    secCards: [
      {
        title: "Your documents stay yours",
        body: "Profiles, forms, and uploads live in a private workspace. We do not sell customer data.",
      },
      {
        title: "Access is role-based",
        body: "Only people you authorize see a client. Sensitive actions are gated by role.",
      },
      {
        title: "Passwords are not stored in SmartPR",
        body: "Sign-in uses a dedicated auth provider. Government logins used in assisted filing are not kept by us.",
      },
      {
        title: "SOC 2 readiness — not certified",
        body: "Control inventory and evidence work are underway. No Type I or Type II claim.",
        trustLink: "Trust center",
      },
    ],
    closeTitle: "Bring one client. Run the real process.",
    closeSub: "A pilot is the product, not a slide deck.",
    closeProLead: "Gestores, CPAs, and firms:",
    closeProLink: "see the professional workspace",
  },
  ES: {
    kicker: "Para gestores, CPAs y firmas de permisos",
    heroTitle: "Prepare las radicaciones de Puerto Rico de todos sus clientes en un solo lugar.",
    heroSub:
      "Un espacio por cliente. Requisitos mapeados a la ley, formularios oficiales llenados desde el perfil y renovaciones monitoreadas antes de su vencimiento. Menos paquetes incompletos. Menos corre-corre.",
    startPilot: "Comenzar un piloto",
    bookDemo: "Agendar una demo",
    ownerLead: "¿Abriendo un negocio por su cuenta?",
    ownerCta: "Vea lo que aplica",
    buyKicker: "Lo que está comprando",
    buyTitle: "Tres cosas. No una pila de funciones.",
    buyCards: [
      {
        eyebrow: "Requisitos",
        title: "Sepa qué le aplica",
        body: "Cuéntenos del negocio. Identificamos cada permiso, licencia y registro en todas las agencias — desde los datos que usted confirma.",
        link: "Vea la ruta",
      },
      {
        eyebrow: "Preparación",
        title: "Preparamos el paquete",
        body: "Formularios oficiales completados desde el perfil del negocio. Documentos revisados. Brechas señaladas antes de que una agencia las vea.",
        link: "Cómo se radica",
      },
      {
        eyebrow: "Radicaciones anuales",
        title: "Al día todos los años",
        body: "Renovaciones y radicaciones recurrentes monitoreadas. Avisos a los 60, 30 y 7 días. El ciclo del próximo año se monta cuando termina el de este año.",
        link: "Después de abrir",
      },
    ],
    howKicker: "Vea cómo funciona",
    howTitle: "Un ejemplo. Un proceso.",
    steps: [
      {
        title: "1. Describa el negocio",
        body: "Unas preguntas — o dígalo en lenguaje sencillo. Los mismos datos siempre.",
      },
      {
        title: "2. Lo cruzamos con las reglas",
        body: "SmartPR coteja el perfil con las regulaciones que de verdad aplican.",
      },
      {
        title: "3. Reciba un paquete que puede radicar",
        body: "Qué aplica, formularios llenados, documentos que faltan, preparación. Usted revisa. Usted radica.",
      },
    ],
    exampleLabel: "Ejemplo solamente · restaurante en Bayamón · 7 agencias · 7 radicaciones",
    exampleQuote: "Quiero abrir un restaurante en Bayamón con 10 empleados y asientos al aire libre.",
    chips: ["Restaurante", "Bayamón", "10 empleados", "Asientos al aire libre"],
    filings: [
      { title: "Registro de entidad", sub: "Departamento de Estado · Corporación o LLC" },
      { title: "Registro contributivo federal", sub: "IRS · EIN" },
      { title: "Registro contributivo de Puerto Rico", sub: "Hacienda · SURI y cuentas contributivas" },
      { title: "Registro municipal", sub: "Municipio de Bayamón · patente" },
      { title: "Permisos y uso", sub: "OGPe · Permiso Único" },
      { title: "Salud y bomberos", sub: "Departamento de Salud · Bomberos" },
      { title: "Revisión y radicación", sub: "Nada se radica sin usted" },
    ],
    exampleNote: "Esta es una ruta de ejemplo, no su resultado. La elegibilidad de incentivos depende del perfil completo.",
    pilotLine:
      "La radicación asistida en vivo está en piloto para SURI. El asistente abre el sitio del gobierno y lo llena con el perfil. Se detiene para su login, el pago y el clic final.",
    whyKicker: "Por qué SmartPR — no un chatbot",
    whyTitle: "Los chatbots explican. Esto está hecho para radicar.",
    whyLead:
      "Pregúntele a un chatbot qué es un Permiso Único. Eso es útil. No le pida que decida qué un cliente le debe a Hacienda y luego lo ponga en un formulario. SmartPR es ese segundo trabajo.",
    whyLines: [
      {
        lead: "Reglas curadas, con su fuente.",
        rest: " Los requisitos enlazan el estatuto o la guía oficial. Las reglas se revisan contra fuentes primarias antes de salir como verificadas.",
      },
      {
        lead: "Los mismos datos, la misma lista. Sin improvisar.",
        rest: " El mismo perfil de negocio produce los mismos requisitos siempre.",
      },
      {
        lead: "Formularios oficiales, no un resumen.",
        rest: " Los formularios de las agencias se llenan desde el perfil y se agrupan en un paquete de radicación. Los documentos que faltan se señalan primero.",
      },
      {
        lead: "Las radicaciones anuales no dependen de la memoria.",
        rest: " Las obligaciones recurrentes quedan en una sola lista, con avisos a los 60 / 30 / 7 días.",
      },
      {
        lead: "Preparación antes de que la agencia lo vea.",
        rest: " Los chequeos de completitud corren sobre el paquete. Nada se radica sin su revisión.",
      },
    ],
    secKicker: "Seguridad",
    secTitle: "Los archivos del cliente se quedan en el espacio de trabajo.",
    secCards: [
      {
        title: "Sus documentos son suyos",
        body: "Perfiles, formularios y archivos viven en un espacio privado. No vendemos datos de clientes.",
      },
      {
        title: "El acceso es por rol",
        body: "Solo las personas que usted autorice ven un cliente. Las acciones sensibles están limitadas por rol.",
      },
      {
        title: "Las contraseñas no se guardan en SmartPR",
        body: "El inicio de sesión usa un proveedor de autenticación dedicado. Los logins del gobierno usados en la radicación asistida no los guardamos nosotros.",
      },
      {
        title: "Preparación SOC 2 — no certificados",
        body: "El inventario de controles y el trabajo de evidencia están en curso. Sin reclamo Tipo I ni Tipo II.",
        trustLink: "Centro de confianza",
      },
    ],
    closeTitle: "Traiga un cliente. Corra el proceso real.",
    closeSub: "Un piloto es el producto, no una presentación.",
    closeProLead: "Gestores, CPAs y firmas:",
    closeProLink: "vean el espacio profesional",
  },
} as const;

export default function MarketingLanding({ initialLanguage = "EN" }: { initialLanguage?: Language }) {
  const router = useRouter();
  const { language, handleLanguageChange } = useMarketingLanguage(initialLanguage);
  const [leadOpen, setLeadOpen] = useState(false);
  const c = copy[language];
  const home = language === "ES" ? "/es" : "/";
  const professionalsHref = language === "ES" ? "/es/profesionales" : "/professionals";
  const pilotHref = `mailto:${DEMO_EMAIL}?subject=${encodeURIComponent(PILOT_SUBJECT)}`;
  const demoHref = `mailto:${DEMO_EMAIL}?subject=${encodeURIComponent(DEMO_SUBJECT)}`;

  // The landing page always opens at the very top: the browser must not
  // restore a previous scroll position (or a stale anchor jump) that would
  // cut off the hero headline above the viewport.
  useEffect(() => {
    try {
      if ("scrollRestoration" in window.history) {
        window.history.scrollRestoration = "manual";
      }
    } catch {
      // Older browsers: fall through to the explicit scroll below.
    }
    window.scrollTo(0, 0);
  }, []);

  function goToAssessment() {
    router.push("/?entry=new-business");
  }

  // The owner escape hatch funnels through here. Signed-in visitors are
  // tracked silently against their account; signed-out visitors give the
  // minimum (name + email) before the assessment begins. Tracking never
  // blocks the assessment itself.
  async function start() {
    try {
      const supabase = createSupabaseBrowser();
      const { data } = await supabase.auth.getSession();
      if (data?.session) {
        try {
          await fetch("/api/leads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: "landing_start_assessment", language: language.toLowerCase() }),
          });
        } catch {
          // Tracking is best-effort; the assessment matters more.
        }
        goToAssessment();
        return;
      }
    } catch {
      // If the session check itself fails, don't strand the visitor.
      goToAssessment();
      return;
    }
    setLeadOpen(true);
  }

  return (
    <div className={styles.shell}>
      <SiteHeader language={language} home={home} variant="home" onLanguageChange={handleLanguageChange} />

      <main>
        <section className={styles.heroPlain}>
          <p className={styles.eyebrow}>{c.kicker}</p>
          <h1>{c.heroTitle}</h1>
          <p className={styles.heroSub}>{c.heroSub}</p>
          <div className={styles.ctaRow}>
            <a className={styles.primary} href={pilotHref}>
              {c.startPilot}
            </a>
            <a className={styles.secondary} href={demoHref}>
              {c.bookDemo}
            </a>
          </div>
          <p className={styles.escapeHatch}>
            {c.ownerLead}{" "}
            <button type="button" className={styles.textLink} onClick={() => void start()}>
              {c.ownerCta}
            </button>
          </p>
        </section>

        <section id="what-you-get" className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.buyKicker}</p>
            <h2>{c.buyTitle}</h2>
            <ol className={`${styles.cards} ${styles.cardsThree}`}>
              {c.buyCards.map((card) => (
                <li key={card.title} className={styles.card}>
                  <span>{card.eyebrow}</span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                  <a className={styles.cardLink} href="#how-it-works">
                    {card.link}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="how-it-works" className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.howKicker}</p>
            <h2>{c.howTitle}</h2>
            <div className={styles.stepsWrap}>
              <ol className={styles.stepList}>
                {c.steps.map((step) => (
                  <li key={step.title} className={styles.card}>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </li>
                ))}
              </ol>
              <div className={styles.exampleCard}>
                <p className={styles.exampleLabel}>{c.exampleLabel}</p>
                <p className={styles.exampleQuote}>{c.exampleQuote}</p>
                <ul className={styles.chips}>
                  {c.chips.map((chip) => (
                    <li key={chip} className={styles.chip}>
                      {chip}
                    </li>
                  ))}
                </ul>
                <ol className={styles.filingRows}>
                  {c.filings.map((filing, i) => (
                    <li key={filing.title}>
                      <span className={styles.filingNum}>{i + 1}</span>
                      <div>
                        <h4>{filing.title}</h4>
                        <p>{filing.sub}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className={styles.exampleNote}>{c.exampleNote}</p>
              </div>
            </div>
            <p className={styles.pilotLine}>{c.pilotLine}</p>
          </div>
        </section>

        <section id="why-smartpr" className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.whyKicker}</p>
            <h2>{c.whyTitle}</h2>
            <p className={styles.lead}>{c.whyLead}</p>
            <ul className={styles.whyList}>
              {c.whyLines.map((line) => (
                <li key={line.lead}>
                  <p>
                    <strong>{line.lead}</strong>
                    {line.rest}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="security" className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.secKicker}</p>
            <h2>{c.secTitle}</h2>
            <ol className={styles.cards}>
              {c.secCards.map((card) => (
                <li key={card.title} className={styles.card}>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                  {"trustLink" in card ? (
                    <a className={styles.trustLink} href={TRUST_URL} target="_blank" rel="noreferrer">
                      {card.trustLink}
                    </a>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.close}>
            <h2>{c.closeTitle}</h2>
            <p className={styles.lead}>{c.closeSub}</p>
            <div className={styles.ctaRow}>
              <a className={styles.primary} href={pilotHref}>
                {c.startPilot}
              </a>
              <a className={styles.secondary} href={demoHref}>
                {c.bookDemo}
              </a>
            </div>
            <p className={styles.closeNote}>
              {c.closeProLead}{" "}
              <Link href={professionalsHref}>{c.closeProLink}</Link>
            </p>
          </div>
        </section>
      </main>

      <LeadModal
        language={language}
        open={leadOpen}
        source="landing_start_assessment"
        successMode="close"
        onClose={() => setLeadOpen(false)}
        onDone={goToAssessment}
      />

      <SiteFooter language={language} variant="home" />
    </div>
  );
}
