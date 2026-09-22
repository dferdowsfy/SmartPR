"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./marketing.module.css";
import { SiteHeader, SiteFooter, useMarketingLanguage, type Language } from "./MarketingChrome";
import HowItWorks from "./HowItWorks";
import FilingPathStory from "./FilingPathStory";
import LeadModal from "./LeadModal";
import { createSupabaseBrowser } from "../../../lib/supabase/client";

const copy = {
  EN: {
    heroTitle: "Know which permits your Puerto Rico business needs — and get filing-ready.",
    heroSub:
      "SmartPR maps every requirement across agencies, prepares your official forms, and tracks your filings year after year.",
    path1Title: "I'm a business owner",
    path1Body: "See exactly what applies to your business.",
    path1Cta: "Start my application",
    path2Title: "I manage filings for clients",
    path2Body: "Prepare permits and filings for every client in one place.",
    path2Cta: "See the professional platform",
    whatNext:
      "Clicking 'Start my application' takes 30 seconds: leave your name and email so we can save your progress, then answer questions about your business. You immediately get your requirements checklist — free. Official filled forms and exportable submission packages are part of paid plans (see Pricing). If you're already signed in, you skip the form and go straight to the assessment.",
    savingsEyebrow: "Productivity",
    savingsTitle: "How much time does SmartPR save?",
    savingsBody:
      "We're measuring it. SmartPR is in pilot with Puerto Rico businesses and firms right now. When pilots complete, this section will show real numbers — hours saved per filing, fewer rejected submissions, faster time to readiness. No estimates. No guesses.",
    securityEyebrow: "Security",
    securityTitle: "Your business data, protected.",
    securityBullets: [
      {
        title: "Your documents stay yours.",
        body: "Business profiles, forms, and uploads live in your private workspace. We never sell your data.",
      },
      {
        title: "Access controls.",
        body: "Only people you authorize can see a business. Sensitive actions are gated by role and plan.",
      },
      {
        title: "Passwords handled properly.",
        body: "Sign-in is handled by a dedicated authentication provider; passwords are never stored in plain text.",
      },
    ],
    teaserTitle: "Run every client's filings from one place.",
    teaserBody:
      "Gestores, CPAs, permitting firms, law firms, consultants, and operators — one dashboard for every client, reusable business profiles, and readiness you can see at a glance.",
    teaserCta: "Explore the professional platform",
    techEyebrow: "How SmartPR decides",
    techTitle: "Every answer shows its work.",
    techBullets: [
      {
        title: "Every requirement traces to its legal source.",
        body: "Each requirement links the statute, regulation, or official guidance that creates it — so you can check the \"why\" behind every \"what.\"",
      },
      {
        title: "SmartPR reasons only from facts you confirm.",
        body: "Stale or unconfirmed details never trigger or suppress requirements. When the facts don't support an answer, it asks — it doesn't guess.",
      },
      {
        title: "Frozen tests keep it honest.",
        body: "Twenty-five real-world scenarios with locked expectations run on every change. Those expectations are never rewritten to make SmartPR pass.",
      },
      {
        title: "Under continuous expert review.",
        body: "Rules are checked against primary sources and kept under ongoing expert review — not a one-time stamp of approval.",
      },
    ],
    closeTitle: "Tell SmartPR what you want to build.",
    closeBody: "We'll show you what comes next.",
    closeCta: "Sign up",
    whyEyebrow: "Why SmartPR",
    whyTitle: "A chatbot gives you an answer. SmartPR gets the filing right.",
    whyLead:
      "General AI is good at explaining. It wasn't built for the moment a reviewer looks at your paperwork. SmartPR was.",
    whyPoints: [
      ["01", "Every requirement cites the law", "Registro de Comerciante → Sec. 4060.01(a), Ley 1-2011. If a rule can't point to its authority, it doesn't ship as verified."],
      ["02", "Same facts, same requirements — every time", "No improvisation. The same business profile always produces the same checklist."],
      ["03", "When a fact is missing, it asks", "If a controlling detail isn't confirmed, SmartPR asks you instead of guessing an obligation."],
      ["04", "Tested like a reviewer would test it", "25 frozen real-world scenarios run against the engine — and the expectations are never rewritten to make SmartPR pass."],
    ],
    offerEyebrow: "What you get",
    offerTitle: "Three ways SmartPR carries the paperwork.",
    offerCards: [
      ["Know what applies", "Tell us about the business. We identify every permit, license, and registration across agencies.", "How it works", "#how-it-works"],
      ["Stay compliant every year", "Renewals and annual filings tracked with 60-, 30-, and 7-day reminders. Next year's filing queues itself.", "Annual filings", "#annual-filings"],
      ["We prepare it all", "Official forms completed from your business profile, documents checked, submission-ready package.", "The technology", "#technology"],
    ],
    filingsEyebrow: "Annual filings",
    filingsTitle: "Never miss another annual filing.",
    filingsBody:
      "Opening is the easy part. Every year the Informe Anual, the Patente, and CRIM come back around — and nobody reminds you. SmartPR tracks every recurring filing, reminds you 60, 30, and 7 days before it's due, and sets up next year's filing as soon as you finish this year's.",
    filingsPoints: [
      ["01", "Reminders that reach you", "Due-date alerts arrive in your SmartPR inbox well before the deadline."],
      ["02", "One view for every business", "Every annual filing in your portfolio, with its status, in a single list."],
      ["03", "Next year sets itself up", "Finish this year's filing and the next cycle — reminders included — is created automatically."],
    ],
  },
  ES: {
    heroTitle: "Sepa qué permisos necesita su negocio en Puerto Rico — y deje todo listo para radicar.",
    heroSub:
      "SmartPR mapea cada requisito en todas las agencias, prepara sus formularios oficiales y le lleva los trámites año tras año.",
    path1Title: "Soy dueño de negocio",
    path1Body: "Vea exactamente qué le aplica a su negocio.",
    path1Cta: "Comenzar mi solicitud",
    path2Title: "Manejo trámites de clientes",
    path2Body: "Prepare permisos y trámites para todos sus clientes en un solo lugar.",
    path2Cta: "Ver la plataforma profesional",
    whatNext:
      "Pulsar 'Comenzar mi solicitud' toma 30 segundos: deje su nombre y email para guardar su progreso, y conteste preguntas sobre su negocio. Al momento recibe su lista de requisitos — gratis. Los formularios oficiales llenados y los paquetes de radicación exportables son parte de los planes pagos (ver Planes). Si ya inició sesión, va directo a la evaluación.",
    savingsEyebrow: "Productividad",
    savingsTitle: "¿Cuánto tiempo ahorra SmartPR?",
    savingsBody:
      "Lo estamos midiendo. SmartPR está en piloto con negocios y firmas de Puerto Rico ahora mismo. Cuando los pilotos terminen, esta sección mostrará números reales — horas ahorradas por trámite, menos radicaciones rechazadas, más rapidez para estar listo. Sin estimados. Sin inventos.",
    securityEyebrow: "Seguridad",
    securityTitle: "Los datos de su negocio, protegidos.",
    securityBullets: [
      {
        title: "Sus documentos son suyos.",
        body: "Perfiles, formularios y archivos viven en su espacio privado. Nunca vendemos sus datos.",
      },
      {
        title: "Controles de acceso.",
        body: "Solo las personas que usted autorice pueden ver un negocio. Las acciones sensibles están limitadas por rol y plan.",
      },
      {
        title: "Contraseñas bien manejadas.",
        body: "El inicio de sesión lo maneja un proveedor de autenticación dedicado; las contraseñas nunca se guardan en texto plano.",
      },
    ],
    teaserTitle: "Maneje los trámites de todos sus clientes desde un solo lugar.",
    teaserBody:
      "Gestores, CPAs, firmas de permisos, bufetes, consultores y operadores — un panel para cada cliente, perfiles de negocio reutilizables y un estatus de preparación visible de un vistazo.",
    teaserCta: "Explorar la plataforma profesional",
    techEyebrow: "Cómo decide SmartPR",
    techTitle: "Cada respuesta muestra su trabajo.",
    techBullets: [
      {
        title: "Cada requisito lleva a su fuente legal.",
        body: "Cada requisito enlaza el estatuto, reglamento o guía oficial que lo crea — para que pueda verificar el \"por qué\" detrás de cada \"qué.\"",
      },
      {
        title: "SmartPR razona solo con los datos que usted confirma.",
        body: "Datos viejos o sin confirmar nunca activan ni suprimen requisitos. Cuando los datos no sustentan una respuesta, pregunta — no adivina.",
      },
      {
        title: "Pruebas congeladas lo mantienen honesto.",
        body: "Veinticinco escenarios reales con expectativas fijas corren con cada cambio. Esas expectativas nunca se reescriben para que SmartPR pase.",
      },
      {
        title: "Bajo revisión experta continua.",
        body: "Las reglas se verifican contra fuentes primarias y se mantienen bajo revisión experta constante — no es un sello de aprobación de una sola vez.",
      },
    ],
    closeTitle: "Dígale a SmartPR lo que quiere construir.",
    closeBody: "Trazamos lo que sigue.",
    closeCta: "Registrarse",
    whyEyebrow: "Por qué SmartPR",
    whyTitle: "Un chatbot te da una respuesta. SmartPR te deja la radicación bien hecha.",
    whyLead:
      "La IA general es buena explicando. Pero no está hecha para el momento en que un revisor mira tu papeleo. SmartPR sí.",
    whyPoints: [
      ["01", "Cada requisito cita la ley", "Registro de Comerciante → Sec. 4060.01(a), Ley 1-2011. Si una regla no puede señalar su autoridad, no sale como verificada."],
      ["02", "Los mismos datos, los mismos requisitos — siempre", "Sin improvisar. El mismo perfil de negocio siempre produce la misma lista."],
      ["03", "Si falta un dato, pregunta", "Si un dato clave no está confirmado, SmartPR te pregunta en vez de inventarse una obligación."],
      ["04", "Probado como lo probaría un revisor", "25 escenarios reales congelados corren contra el motor — y las expectativas nunca se reescriben para que SmartPR pase."],
    ],
    offerEyebrow: "Lo que obtienes",
    offerTitle: "Tres formas en que SmartPR carga con el papeleo.",
    offerCards: [
      ["Sepa qué le aplica", "Cuéntanos del negocio. Identificamos cada permiso, licencia y registro en todas las agencias.", "Cómo funciona", "#how-it-works"],
      ["Al día, todos los años", "Renovaciones y radicaciones anuales con avisos a los 60, 30 y 7 días. La del próximo año se monta sola.", "Radicaciones anuales", "#annual-filings"],
      ["Lo preparamos todo", "Formularios oficiales llenados desde tu perfil, documentos revisados, paquete listo para radicar.", "La tecnología", "#technology"],
    ],
    filingsEyebrow: "Radicaciones anuales",
    filingsTitle: "Que no se te pase ni una radicación.",
    filingsBody:
      "Abrir es lo fácil. Todos los años vuelven el Informe Anual, la Patente y el CRIM — y nadie te avisa. SmartPR lleva tus radicaciones recurrentes, te avisa 60, 30 y 7 días antes del vencimiento, y en cuanto completas la de este año, la del próximo queda lista.",
    filingsPoints: [
      ["01", "Avisos que sí te llegan", "Las alertas llegan a tu buzón de SmartPR antes del vencimiento."],
      ["02", "Todo en una sola vista", "Cada radicación anual de todos tus negocios, con su estatus, en una sola lista."],
      ["03", "El próximo año se monta solo", "Terminas la de este año y el próximo ciclo — con sus avisos — se crea solo."],
    ],
  },
} as const;

export default function MarketingLanding({ initialLanguage = "EN" }: { initialLanguage?: Language }) {
  const router = useRouter();
  const { language, handleLanguageChange } = useMarketingLanguage(initialLanguage);
  const [leadOpen, setLeadOpen] = useState(false);
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

  // Every "start" entry point funnels through here. Signed-in visitors are
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
      <SiteHeader language={language} home={home} onLanguageChange={handleLanguageChange} />

      <main>
        <div className={styles.showcase}>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <h1>
                <span>{c.heroTitle}</span>
              </h1>
              <p className={styles.heroLead}>{c.heroSub}</p>
              <ol className={styles.cards}>
                <li className={styles.card}>
                  <h3>{c.path1Title}</h3>
                  <p>{c.path1Body}</p>
                  <button type="button" className={styles.primary} onClick={() => void start()}>
                    {c.path1Cta}
                  </button>
                </li>
                <li className={styles.card}>
                  <h3>{c.path2Title}</h3>
                  <p>{c.path2Body}</p>
                  <Link className={styles.primary} href={professionalsHref}>
                    {c.path2Cta}
                  </Link>
                </li>
              </ol>
              <p className={styles.lead}>{c.whatNext}</p>
            </div>
          </section>
          <FilingPathStory language={language} />
        </div>

        <HowItWorks language={language} cta={c.path1Cta} onStart={() => void start()} />

        <section id="why-smartpr" className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.whyEyebrow}</p>
            <h2>{c.whyTitle}</h2>
            <p className={styles.lead}>{c.whyLead}</p>
            <ol className={styles.cards}>
              {c.whyPoints.map(([n, title, body]) => (
                <li key={n} className={styles.card}>
                  <span>{n}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="offerings" className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.offerEyebrow}</p>
            <h2>{c.offerTitle}</h2>
            <ol className={styles.cards}>
              {c.offerCards.map(([title, body, linkLabel, href]) => (
                <li key={title} className={styles.card}>
                  <h3>{title}</h3>
                  <p>{body}</p>
                  <a className={styles.ghost} href={href}>
                    {linkLabel} <span aria-hidden>→</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="annual-filings" className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.filingsEyebrow}</p>
            <h2>{c.filingsTitle}</h2>
            <p className={styles.lead}>{c.filingsBody}</p>
            <ol className={styles.cards}>
              {c.filingsPoints.map(([n, title, body]) => (
                <li key={n} className={styles.card}>
                  <span>{n}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="time-savings" className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.savingsEyebrow}</p>
            <h2>{c.savingsTitle}</h2>
            <p className={styles.lead}>{c.savingsBody}</p>
          </div>
        </section>

        <section id="security" className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.securityEyebrow}</p>
            <h2>{c.securityTitle}</h2>
            <ol className={styles.cards}>
              {c.securityBullets.map((bullet, i) => (
                <li key={bullet.title} className={styles.card}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <h3>{bullet.title}</h3>
                  <p>{bullet.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="for-professionals" className={styles.section}>
          <div className={styles.sectionInner}>
            <h2>{c.teaserTitle}</h2>
            <p className={styles.lead}>{c.teaserBody}</p>
            <Link className={styles.ghost} href={professionalsHref}>
              {c.teaserCta} <span aria-hidden>→</span>
            </Link>
          </div>
        </section>

        <section id="technology" className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.techEyebrow}</p>
            <h2>{c.techTitle}</h2>
            <ol className={styles.cards}>
              {c.techBullets.map((bullet, i) => (
                <li key={bullet.title} className={styles.card}>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <h3>{bullet.title}</h3>
                  <p>{bullet.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.close}>
            <h2>{c.closeTitle}</h2>
            <p className={styles.lead}>{c.closeBody}</p>
            <button type="button" className={styles.primary} onClick={() => void start()}>
              {c.closeCta}
            </button>
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

      <SiteFooter language={language} home={home} onLanguageChange={handleLanguageChange} />
    </div>
  );
}
