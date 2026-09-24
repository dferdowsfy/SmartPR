"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./marketing.module.css";
import { SiteHeader, SiteFooter, useMarketingLanguage, type Language } from "./MarketingChrome";
import LeadModal from "./LeadModal";
import { createSupabaseBrowser } from "../../../lib/supabase/client";

const TRUST_URL = "https://trust.getsmartpr.com";

const copy = {
  EN: {
    heroTitle: "Know which Puerto Rico filings apply — and get the package ready.",
    heroSub:
      "SmartPR maps the permits, licenses, and registrations for a business, fills the official forms from the profile, and tracks the ones that come back every year.",
    seeWhatApplies: "See what applies",
    fileForClients: "For professionals",
    talkItThrough: "Talk it through",
    voiceNote: "You can also do this by voice.",
    buyKicker: "What you get",
    buyTitle: "Three things. Not a pile of features.",
    buyCards: [
      {
        eyebrow: "Requirements",
        title: "Know what applies",
        body: "Describe the business. We identify every permit, license, and registration across agencies — from the facts you confirm.",
      },
      {
        eyebrow: "Preparation",
        title: "We prepare the package",
        body: "Official forms completed from the profile. Documents checked. Gaps flagged before an agency sees them.",
      },
      {
        eyebrow: "Annual filings",
        title: "Stay compliant every year",
        body: "Renewals tracked in one list. Reminders at 60, 30, and 7 days. Next year's cycle queues when this year's is done.",
      },
    ],
    howKicker: "See how it works",
    howTitle: "From a few answers to a filing package.",
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
    whyKicker: "Why this isn't a chatbot",
    whyTitle: "Chatbots explain. This is built to file.",
    whyLead:
      "Ask a chatbot what a Permiso Único is. That is useful. Do not ask it to decide what a business owes Hacienda and then put that on a form.",
    whyLines: [
      {
        lead: "Curated rules, traced to the source.",
        rest: " Requirements link to the statute or official guidance.",
      },
      {
        lead: "Same facts, same checklist. No improvisation.",
        rest: "",
      },
      {
        lead: "Official forms, not a summary.",
        rest: " Agency forms filled from the profile and bundled into a package.",
      },
      {
        lead: "Annual filings don't depend on memory.",
        rest: " 60 / 30 / 7-day reminders on one list.",
      },
      {
        lead: "Readiness before the agency sees it.",
        rest: " Nothing is submitted without your review.",
      },
    ],
    secKicker: "Security",
    secTitle: "Your files stay in the workspace.",
    secCards: [
      {
        title: "Documents stay yours",
        body: "Profiles, forms, and uploads live in a private workspace. We do not sell customer data.",
      },
      {
        title: "Access is role-based",
        body: "Only people you authorize see a business. Sensitive actions are gated by role.",
      },
      {
        title: "Passwords are not stored here",
        body: "Sign-in uses a dedicated auth provider. Government logins used in assisted filing are not kept by us.",
      },
      {
        title: "SOC 2 readiness — not certified",
        body: "Control inventory underway. No Type I or Type II claim.",
        trustLink: "Trust center",
      },
    ],
    closeTitle: "Tell SmartPR what you want to build.",
    closeSub: "We'll show you the path and what's missing.",
  },
  ES: {
    heroTitle: "Sepa qué radicaciones de Puerto Rico le aplican — y deje el paquete listo.",
    heroSub:
      "SmartPR mapea los permisos, licencias y registros de un negocio, llena los formularios oficiales desde el perfil y le da seguimiento a los que vencen todos los años.",
    seeWhatApplies: "Vea lo que aplica",
    fileForClients: "Para profesionales",
    talkItThrough: "Háblalo por voz",
    voiceNote: "También puedes hacerlo por voz.",
    buyKicker: "Lo que obtiene",
    buyTitle: "Tres cosas. No una pila de funciones.",
    buyCards: [
      {
        eyebrow: "Requisitos",
        title: "Sepa qué le aplica",
        body: "Describa el negocio. Identificamos cada permiso, licencia y registro en todas las agencias — desde los datos que usted confirma.",
      },
      {
        eyebrow: "Preparación",
        title: "Preparamos el paquete",
        body: "Formularios oficiales completados desde el perfil. Documentos revisados. Brechas señaladas antes de que una agencia las vea.",
      },
      {
        eyebrow: "Radicaciones anuales",
        title: "Al día todos los años",
        body: "Renovaciones monitoreadas en una sola lista. Avisos a los 60, 30 y 7 días. El ciclo del próximo año se monta cuando termina el de este año.",
      },
    ],
    howKicker: "Vea cómo funciona",
    howTitle: "De unas respuestas a un paquete listo para radicar.",
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
    whyKicker: "Por qué esto no es un chatbot",
    whyTitle: "Los chatbots explican. Esto está hecho para radicar.",
    whyLead:
      "Pregúntele a un chatbot qué es un Permiso Único. Eso es útil. No le pida que decida lo que un negocio le debe a Hacienda y luego lo ponga en un formulario.",
    whyLines: [
      {
        lead: "Reglas curadas, con su fuente.",
        rest: " Los requisitos enlazan el estatuto o la guía oficial.",
      },
      {
        lead: "Los mismos datos, la misma lista. Sin improvisar.",
        rest: "",
      },
      {
        lead: "Formularios oficiales, no un resumen.",
        rest: " Los formularios de la agencia se llenan desde el perfil y se agrupan en un paquete.",
      },
      {
        lead: "Las radicaciones anuales no dependen de la memoria.",
        rest: " Avisos a los 60 / 30 / 7 días en una sola lista.",
      },
      {
        lead: "Preparación antes de que la agencia lo vea.",
        rest: " Nada se somete sin su revisión.",
      },
    ],
    secKicker: "Seguridad",
    secTitle: "Sus archivos se quedan en el espacio de trabajo.",
    secCards: [
      {
        title: "Los documentos son suyos",
        body: "Perfiles, formularios y archivos viven en un espacio privado. No vendemos datos de clientes.",
      },
      {
        title: "Acceso por rol",
        body: "Solo las personas que usted autorice ven un negocio. Las acciones sensibles están limitadas por rol.",
      },
      {
        title: "Las contraseñas no se guardan aquí",
        body: "El inicio de sesión usa un proveedor de autenticación dedicado. Los logins del gobierno usados en la radicación asistida no los guardamos nosotros.",
      },
      {
        title: "Preparación SOC 2 — no certificados",
        body: "Inventario de controles en curso. Sin reclamo Tipo I ni Tipo II.",
        trustLink: "Centro de confianza",
      },
    ],
    closeTitle: "Dígale a SmartPR lo que quiere montar.",
    closeSub: "Le mostramos la ruta y lo que falta.",
  },
} as const;

export default function MarketingLanding({ initialLanguage = "EN" }: { initialLanguage?: Language }) {
  const router = useRouter();
  const { language, handleLanguageChange } = useMarketingLanguage(initialLanguage);
  const [leadOpen, setLeadOpen] = useState(false);
  const howRef = useRef<HTMLElement | null>(null);

  // Reveal the how-it-works steps as a staged process when scrolled into view.
  useEffect(() => {
    const el = howRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            el.classList.add(styles.howVisible);
            io.disconnect();
          }
        });
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const c = copy[language];
  const home = language === "ES" ? "/es" : "/";
  const professionalsHref = language === "ES" ? "/es/profesionales" : "/professionals";

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

  // The "See what applies" CTA funnels through here. Signed-in visitors are
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
          <h1>{c.heroTitle}</h1>
          <p className={styles.heroSub}>{c.heroSub}</p>
          <div className={styles.ctaRow}>
            <button type="button" className={styles.primary} onClick={() => void start()}>
              {c.seeWhatApplies}
            </button>
            <Link className={styles.secondary} href={professionalsHref}>
              {c.fileForClients}
            </Link>
          </div>
          <Link
            href="/voice"
            style={{
              display: "inline-block",
              marginTop: 14,
              fontSize: 15,
              color: "#5C574E",
              textDecoration: "underline",
              textUnderlineOffset: 3,
            }}
          >
            {c.talkItThrough}
          </Link>
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
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="how-it-works" ref={howRef} className={`${styles.section} ${styles.howSection}`}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.howKicker}</p>
            <h2>{c.howTitle}</h2>
            <div className={styles.stepsWrap}>
              <ol className={styles.stepList}>
                {c.steps.map((step) => (
                  <li key={step.title} className={styles.card}>
                    <h3>{step.title}</h3>
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
              <button type="button" className={styles.primary} onClick={() => void start()}>
                {c.seeWhatApplies}
              </button>
              <Link className={styles.secondary} href={professionalsHref}>
                {c.fileForClients}
              </Link>
            </div>
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
