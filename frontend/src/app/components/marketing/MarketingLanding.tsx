"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import styles from "./marketing.module.css";
import { SmartPRLogo } from "../brand/SmartPRLogo";
import FilingPathStory from "./FilingPathStory";
import VoiceCapabilities from "./VoiceCapabilities";
import FilingAssistant from "./FilingAssistant";
import { createSupabaseBrowser } from "../../../lib/supabase/client";

type Language = "EN" | "ES";

const copy = {
  EN: {
    how: "How it works",
    pricing: "Pricing",
    professionals: "For professionals",
    login: "Login",
    started: "Sign up",
    privacy: "Privacy Policy",
    hero: "Business requirements, simplified.",
    heroCta: "Start my application",
    seeHow: "See how it works",
    stepsTitle: "From uncertainty to submission-ready.",
    steps: [
      ["01", "Describe your business", "Tell SmartPR what you want to do, in plain language."],
      ["02", "Know what applies", "See every requirement that applies across agencies, based on the facts you confirm."],
      ["03", "Prepare everything", "SmartPR fills your information into official government forms, checks your supporting documents, and flags what's missing."],
      ["04", "Know when you're ready", "Get a readiness check and a complete submission package."],
    ],
    portfolioTitle: "One business or fifty.",
    portfolioBody:
      "Built for owners, gestores, permitting firms, CPAs, law firms, consultants, and operators managing multiple Puerto Rico entities — each with its own filings, documents, and readiness.",
    filingsEyebrow: "Annual filings",
    filingsTitle: "Never miss another annual filing.",
    filingsBody:
      "Opening is the easy part. Every year the Informe Anual, the Patente, and CRIM come back around — and nobody reminds you. SmartPR tracks every recurring filing, reminds you 60, 30, and 7 days before it's due, and sets up next year's filing as soon as you finish this year's.",
    filingsPoints: [
      ["01", "Reminders that reach you", "Due-date alerts arrive in your SmartPR inbox well before the deadline."],
      ["02", "One view for every business", "Every annual filing in your portfolio, with its status, in a single list."],
      ["03", "Next year sets itself up", "Finish this year's filing and the next cycle — reminders included — is created automatically."],
    ],
    ready: "ready",
    next: "Next",
    continue: "Continue",
    tech: "Technology",
    techEyebrow: "The technology behind SmartPR",
    techTitle: "Built so nothing falls through the cracks.",
    techBody:
      "SmartPR tracks every regulation, permit, form, and deadline that can apply to your business — and the connections between them. Enter your business once: it prepares every official form and bundles your complete submission package.",
    techStats: [
      ["1,516", "Regulations, permits, forms, and deadlines — tracked in one place."],
      ["3,692", "Connections linking every requirement to its agency, form, deadline, and fee."],
      ["40", "Government agencies covered — Hacienda, Estado, OGPe, Salud, Bomberos & more."],
      ["16", "Official forms filled automatically from your business profile."],
    ],
    techDownload: "Download the technology sheet (PDF)",
    techTrust: "Same facts, same requirements, every time. Verified by human experts before anything goes live.",
    closeTitle: "Tell SmartPR what you want to build.",
    closeBody: "We'll show you what comes next.",
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
    leadTitle: "Before you start",
    leadBody: "Leave your name and email so we can save your progress and follow up. That's it — no spam, ever.",
    leadName: "Name",
    leadEmail: "Email",
    leadPhone: "Phone (optional)",
    leadInvalidEmail: "Enter a valid email to continue.",
    leadCancel: "Cancel",
    rows: [
      { name: "Amigos Restaurant", muni: "Bayamón", type: "Restaurant", ready: 78, next: "Upload lease agreement" },
      { name: "HealthPR", muni: "San Juan", type: "Healthcare", ready: 40, next: "Complete Department of State formation" },
    ],
  },
  ES: {
    how: "Cómo funciona",
    pricing: "Planes",
    professionals: "Para profesionales",
    login: "Iniciar sesión",
    started: "Registrarse",
    privacy: "Política de privacidad",
    hero: "Requisitos de negocio, simplificados.",
    heroCta: "Comenzar mi solicitud",
    seeHow: "Vea cómo funciona",
    stepsTitle: "De la incertidumbre a estar listo para presentar.",
    steps: [
      ["01", "Describa su negocio", "Dígale a SmartPR lo que quiere hacer, en lenguaje sencillo."],
      ["02", "Sepa qué aplica", "Vea cada requisito que le aplica, en todas las agencias, según los datos que usted confirme."],
      ["03", "Prepare todo", "SmartPR lleva su información a los formularios oficiales, revisa sus documentos y señala lo que falta."],
      ["04", "Sepa cuándo está listo", "Reciba una revisión de preparación y un paquete de radicación completo."],
    ],
    portfolioTitle: "Un negocio o cincuenta.",
    portfolioBody:
      "Para dueños, gestores, firmas de permisos, CPAs, bufetes, consultores y operadores con varias entidades en Puerto Rico — cada una con sus propios trámites, documentos y preparación.",
    filingsEyebrow: "Radicaciones anuales",
    filingsTitle: "Que no se te pase ni una radicación.",
    filingsBody:
      "Abrir es lo fácil. Todos los años vuelven el Informe Anual, la Patente y el CRIM — y nadie te avisa. SmartPR lleva tus radicaciones recurrentes, te avisa 60, 30 y 7 días antes del vencimiento, y en cuanto completas la de este año, la del próximo queda lista.",
    filingsPoints: [
      ["01", "Avisos que sí te llegan", "Las alertas llegan a tu buzón de SmartPR antes del vencimiento."],
      ["02", "Todo en una sola vista", "Cada radicación anual de todos tus negocios, con su estatus, en una sola lista."],
      ["03", "El próximo año se monta solo", "Terminas la de este año y el próximo ciclo — con sus avisos — se crea solo."],
    ],
    ready: "listo",
    next: "Siguiente",
    continue: "Continuar",
    tech: "Tecnología",
    techEyebrow: "La tecnología detrás de SmartPR",
    techTitle: "Hecha para que nada se quede fuera.",
    techBody:
      "SmartPR lleva cada reglamento, permiso, formulario y vencimiento que puede aplicar a tu negocio — y las conexiones entre todo. Registra tu negocio una vez: prepara cada formulario oficial y organiza tu paquete de radicación completo.",
    techStats: [
      ["1,516", "Reglamentos, permisos, formularios y vencimientos — todo en un solo lugar."],
      ["3,692", "Conexiones atando cada requisito a su agencia, formulario, vencimiento y cargo."],
      ["40", "Agencias gubernamentales cubiertas — Hacienda, Estado, OGPe, Salud, Bomberos y más."],
      ["16", "Formularios oficiales que se llenan solos desde tu perfil."],
    ],
    techDownload: "Descargar la hoja de tecnología (PDF)",
    techTrust: "Los mismos datos → los mismos requisitos, siempre. Verificado por expertos antes de publicarse.",
    closeTitle: "Dígale a SmartPR lo que quiere construir.",
    closeBody: "Trazamos lo que sigue.",
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
    leadTitle: "Antes de empezar",
    leadBody: "Déjanos tu nombre y tu email para guardarte el progreso y darte seguimiento. Eso es todo — cero spam.",
    leadName: "Nombre",
    leadEmail: "Email",
    leadPhone: "Teléfono (opcional)",
    leadInvalidEmail: "Escribe un email válido para continuar.",
    leadCancel: "Cancelar",
    rows: [
      { name: "Amigos Restaurant", muni: "Bayamón", type: "Restaurante", ready: 78, next: "Subir contrato de arrendamiento" },
      { name: "HealthPR", muni: "San Juan", type: "Salud", ready: 40, next: "Completar constitución en el Departamento de Estado" },
    ],
  },
} as const;

function LanguageToggle({ language, onChange }: { language: Language; onChange: (lang: Language) => void }) {
  return (
    <div className={styles.language} aria-label={language === "ES" ? "Idioma" : "Language"}>
      {(["EN", "ES"] as const).map((lang) => (
        <button
          key={lang}
          type="button"
          aria-pressed={language === lang}
          aria-label={lang === "EN" ? "English" : "Español"}
          title={lang === "EN" ? "English" : "Español"}
          onClick={() => onChange(lang)}
        >
          {lang.toLowerCase()}
        </button>
      ))}
    </div>
  );
}

export default function MarketingLanding({ initialLanguage = "EN" }: { initialLanguage?: Language }) {
  const router = useRouter();
  const pathname = usePathname();
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [navOpen, setNavOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const c = copy[language];

  // Keep the URL shareable: the Spanish homepage lives at /es, so toggling
  // the language on the homepage navigates between / and /es instead of
  // only swapping copy in place.
  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    if (lang === "ES" && pathname === "/") router.push("/es");
    else if (lang === "EN" && pathname === "/es") router.push("/");
  };

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
    setLeadError(null);
    setLeadOpen(true);
  }

  async function submitLead(event: React.FormEvent) {
    event.preventDefault();
    const email = leadEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setLeadError(c.leadInvalidEmail);
      return;
    }
    setLeadBusy(true);
    try {
      await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: leadName.trim(),
          email,
          phone: leadPhone.trim() || undefined,
          source: "landing_start_assessment",
          language: language.toLowerCase(),
        }),
      });
    } catch {
      // A failed capture must never block the assessment.
    } finally {
      setLeadBusy(false);
    }
    setLeadOpen(false);
    goToAssessment();
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" aria-label="SmartPR home">
            <SmartPRLogo className={styles.logo} size="landing" />
          </Link>
          <nav className={styles.desktopNav} aria-label="Main navigation">
            <a href="#how-it-works">{c.how}</a>
            <a href="#technology">{c.tech}</a>
            <Link href="/pricing">{c.pricing}</Link>
            <a href="#professionals">{c.professionals}</a>
          </nav>
          <div className={styles.desktopActions}>
            <LanguageToggle language={language} onChange={handleLanguageChange} />
            <Link href="/auth/login?next=%2F%3Fentry%3Dnew-business">{c.login}</Link>
            <Link href="/signup" className={styles.primary}>
              {c.started}
            </Link>
          </div>
          <button
            className={styles.menuButton}
            type="button"
            onClick={() => setNavOpen((open) => !open)}
            aria-expanded={navOpen}
            aria-controls="mobile-nav"
            aria-label={navOpen ? (language === "ES" ? "Cerrar menú" : "Close menu") : (language === "ES" ? "Abrir menú" : "Open menu")}
          >
            {navOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
        {navOpen ? (
          <div id="mobile-nav" className={styles.mobileNav}>
            <a href="#how-it-works" onClick={() => setNavOpen(false)}>
              {c.how}
            </a>
            <Link href="/pricing" onClick={() => setNavOpen(false)}>
              {c.pricing}
            </Link>
            <a href="#professionals" onClick={() => setNavOpen(false)}>
              {c.professionals}
            </a>
            <div className={styles.mobileAccountRow}>
              <Link href="/auth/login?next=%2F%3Fentry%3Dnew-business">{c.login}</Link>
              <LanguageToggle language={language} onChange={handleLanguageChange} />
            </div>
            <Link href="/signup" className={styles.primary} onClick={() => setNavOpen(false)}>
              {c.started}
            </Link>
          </div>
        ) : null}
      </header>

      <main>
        <div className={styles.showcase}>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <h1>
                <span>{c.hero}</span>
              </h1>
              <div className={styles.heroActions}>
                <button type="button" className={styles.primary} onClick={() => void start()}>
                  {c.heroCta}
                </button>
                <a className={styles.ghost} href="#how-it-works">
                  {c.seeHow} <span aria-hidden>→</span>
                </a>
              </div>
            </div>
          </section>

          <FilingPathStory language={language} />
        </div>

        <section className={styles.section} aria-label={language === "ES" ? "Capacidades de voz" : "Voice capabilities"}>
          <div className={styles.sectionInner}>
            <VoiceCapabilities language={language} />
          </div>
        </section>

        <section id="filing-assistant" className={styles.section}>
          <div className={styles.sectionInner}>
            <FilingAssistant language={language} cta={c.heroCta} onStart={() => void start()} />
          </div>
        </section>

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

        <section id="how-it-works" className={styles.section}>
          <div className={styles.sectionInner}>
            <h2>{c.stepsTitle}</h2>
            <ol className={styles.cards}>
              {c.steps.map(([n, title, body]) => (
                <li key={n} className={styles.card}>
                  <span>{n}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
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

        <section id="professionals" className={styles.section}>
          <div className={styles.sectionInner}>
            <h2>{c.portfolioTitle}</h2>
            <p className={styles.lead}>{c.portfolioBody}</p>
            <ul className={styles.portfolio}>
              {c.rows.map((row) => (
                <li key={row.name}>
                  <div>
                    <strong>{row.name}</strong>
                    <small>
                      {row.muni} · {row.type}
                    </small>
                  </div>
                  <p className={styles.meta}>
                    {row.ready}% {c.ready} · {c.next}: {row.next}
                  </p>
                  <button type="button" className={styles.continue} onClick={() => void start()}>
                    {c.continue}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="technology" className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.techEyebrow}</p>
            <h2>{c.techTitle}</h2>
            <p className={styles.lead}>{c.techBody}</p>
            <ul className={styles.techStats}>
              {c.techStats.map(([n, label]) => (
                <li key={n} className={styles.techStat}>
                  <span className={styles.techNum}>{n}</span>
                  <p>{label}</p>
                </li>
              ))}
            </ul>
            <div className={styles.techCta}>
              <a
                className={styles.primary}
                href={language === "ES" ? "/docs/smartpr-tech-slick-sheet-es.pdf" : "/docs/smartpr-tech-slick-sheet.pdf"}
                target="_blank"
                rel="noreferrer"
              >
                {c.techDownload}
              </a>
            </div>
            <p className={styles.techTrust}>{c.techTrust}</p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.close}>
            <h2>{c.closeTitle}</h2>
            <p className={styles.lead}>{c.closeBody}</p>
            <button type="button" className={styles.primary} onClick={() => void start()}>
              {c.started}
            </button>
          </div>
        </section>
      </main>

      {leadOpen && (
        <div className={styles.leadOverlay} onClick={() => { if (!leadBusy) setLeadOpen(false); }}>
          <div
            role="dialog" aria-modal="true" aria-label={c.leadTitle}
            className={styles.leadDialog}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className={styles.leadTitle}>{c.leadTitle}</h2>
            <p className={styles.leadBody}>{c.leadBody}</p>
            <form onSubmit={submitLead}>
              <label className={styles.leadField}>{c.leadName}
                <input
                  value={leadName} onChange={(event) => setLeadName(event.target.value)}
                  placeholder={c.leadName} autoComplete="name" maxLength={120}
                  enterKeyHint="next"
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
                />
              </label>
              <label className={styles.leadField}>{c.leadEmail}
                <input
                  type="email" value={leadEmail} onChange={(event) => setLeadEmail(event.target.value)}
                  placeholder="tu@email.com" autoComplete="email" maxLength={160} required
                  enterKeyHint="next"
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
                />
              </label>
              <label className={styles.leadField}>{c.leadPhone}
                <input
                  type="tel" value={leadPhone} onChange={(event) => setLeadPhone(event.target.value)}
                  autoComplete="tel" maxLength={40}
                  enterKeyHint="go"
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
                />
              </label>
              {leadError && <p className={styles.leadError}>{leadError}</p>}
              <div className={styles.leadActions}>
                <button type="button" className={styles.leadCancel} disabled={leadBusy} onClick={() => setLeadOpen(false)}>
                  {c.leadCancel}
                </button>
                <button type="submit" className={styles.primary} disabled={leadBusy}>
                  {leadBusy ? "…" : c.heroCta}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>© 2026 SmartPR</span>
          <Link href={language === "ES" ? "/es/restaurantes" : "/restaurants"}>{language === "ES" ? "Abrir un restaurante" : "Restaurant opening checklist"}</Link>
          <Link href="/privacy">{c.privacy}</Link>
          <a href="#how-it-works">{c.how}</a>
          <a href="#technology">{c.tech}</a>
          <LanguageToggle language={language} onChange={handleLanguageChange} />
        </div>
      </footer>
    </div>
  );
}
