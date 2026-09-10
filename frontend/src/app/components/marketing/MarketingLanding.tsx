"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Menu, X } from "lucide-react";
import styles from "./marketing.module.css";
import { SmartPRLogo } from "../brand/SmartPRLogo";
import FilingPathStory from "./FilingPathStory";
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
    eyebrow: "Puerto Rico · Guided filing",
    hero: "Start your business in Puerto Rico.",
    heroAccent: "We make it easy.",
    heroSub:
      "Enter your business details and upload any documents you already have. SmartPR identifies the required permits, licenses, registrations, and supporting documents, flags what’s missing, and prepares the official government forms for you.",
    heroCta: "Start my application",
    seeHow: "See how it works",
    stepsTitle: "From uncertainty to submission-ready.",
    steps: [
      ["01", "Describe your business", "Tell SmartPR what you are trying to do in plain language."],
      ["02", "Know what applies", "SmartPR identifies applicable requirements across agencies from the facts you confirmed."],
      ["03", "Prepare everything", "SmartPR maps information into official government forms, checks supporting evidence and identifies missing items."],
      ["04", "Know when you're ready", "Receive a readiness assessment and an organized submission package."],
    ],
    portfolioTitle: "One business or fifty.",
    portfolioBody:
      "SmartPR supports individual owners, gestores, permitting firms, CPAs, law firms, consultants, and operators managing multiple Puerto Rico entities — each with its own filing, documents, and readiness.",
    filingsEyebrow: "Annual filings",
    filingsTitle: "Never miss an annual filing again.",
    filingsBody:
      "Opening is the easy part. Every year the Informe Anual, the Patente, the CRIM come back — and nobody reminds you. SmartPR tracks every recurring filing, reminds you 90, 60, 30 and 7 days before it's due, and queues next year's filing the moment you complete this one.",
    filingsPoints: [
      ["01", "Reminders that reach you", "Due-date alerts land in your SmartPR inbox before the deadline, not after."],
      ["02", "One view for every business", "Every yearly filing across your whole portfolio, with its status, in a single list."],
      ["03", "Next year queues itself", "Complete this year's filing and the next cycle — with its reminders — is created automatically."],
    ],
    ready: "ready",
    next: "Next",
    continue: "Continue",
    closeTitle: "Tell SmartPR what you want to build.",
    closeBody: "We'll map what comes next.",
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
    eyebrow: "Puerto Rico · Trámite guiado",
    hero: "Comience su negocio en Puerto Rico.",
    heroAccent: "Lo hacemos fácil.",
    heroSub:
      "Ingrese los datos de su negocio y cargue los documentos que ya tenga. SmartPR identifica los permisos, licencias, registros y documentos de apoyo requeridos, señala lo que falta y prepara los formularios oficiales del gobierno.",
    heroCta: "Comenzar mi solicitud",
    seeHow: "Vea cómo funciona",
    stepsTitle: "De la incertidumbre a estar listo para presentar.",
    steps: [
      ["01", "Describa su negocio", "Dígale a SmartPR lo que quiere hacer, en lenguaje sencillo."],
      ["02", "Sepa qué aplica", "SmartPR identifica los requisitos aplicables entre agencias a partir de los hechos que confirmó."],
      ["03", "Prepare todo", "SmartPR lleva la información a formularios oficiales, revisa la evidencia y señala lo que falta."],
      ["04", "Sepa cuándo está listo", "Reciba una evaluación de preparación y un paquete de presentación organizado."],
    ],
    portfolioTitle: "Un negocio o cincuenta.",
    portfolioBody:
      "SmartPR apoya a dueños, gestores, firmas de permisos, CPAs, bufetes, consultores y operadores con varias entidades en Puerto Rico — cada una con su propio trámite, documentos y preparación.",
    filingsEyebrow: "Radicaciones anuales",
    filingsTitle: "Que no se te pase ni una radicación.",
    filingsBody:
      "Abrir es lo fácil. Todos los años vuelven el Informe Anual, la Patente, el CRIM — y nadie te avisa. SmartPR lleva todas tus radicaciones recurrentes, te recuerda a los 90, 60, 30 y 7 días, y cuando completas la de este año, la del próximo queda montada sola.",
    filingsPoints: [
      ["01", "Avisos que sí te llegan", "Las alertas caen en tu buzón de SmartPR antes del vencimiento, no después."],
      ["02", "Todo en una sola vista", "Cada radicación anual de todos tus negocios, con su estatus, en una sola lista."],
      ["03", "El próximo año se monta solo", "Completas la de este año y el próximo ciclo — con sus avisos — se crea automático."],
    ],
    ready: "listo",
    next: "Siguiente",
    continue: "Continuar",
    closeTitle: "Dígale a SmartPR lo que quiere construir.",
    closeBody: "Trazamos lo que sigue.",
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

export default function MarketingLanding() {
  const router = useRouter();
  const [language, setLanguage] = useState<Language>("EN");
  const [navOpen, setNavOpen] = useState(false);
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadName, setLeadName] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadBusy, setLeadBusy] = useState(false);
  const [leadError, setLeadError] = useState<string | null>(null);
  const c = copy[language];

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
            <Link href="/pricing">{c.pricing}</Link>
            <a href="#professionals">{c.professionals}</a>
          </nav>
          <div className={styles.desktopActions}>
            <LanguageToggle language={language} onChange={setLanguage} />
            <Link href="/auth/login?next=%2F%3Fentry%3Dnew-business">{c.login}</Link>
            <button type="button" className={styles.primary} onClick={() => void start()}>
              {c.started}
            </button>
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
              <LanguageToggle language={language} onChange={setLanguage} />
            </div>
            <button type="button" className={styles.primary} onClick={() => { setNavOpen(false); void start(); }}>
              {c.started}
            </button>
          </div>
        ) : null}
      </header>

      <main>
        <div className={styles.showcase}>
          <section className={styles.hero}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>{c.eyebrow}</p>
              <h1>
                <span>{c.hero}</span>
                <strong>{c.heroAccent}</strong>
              </h1>
              <p className={styles.heroLead}>{c.heroSub}</p>
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

        <section className={styles.section}>
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
                />
              </label>
              <label className={styles.leadField}>{c.leadEmail}
                <input
                  type="email" value={leadEmail} onChange={(event) => setLeadEmail(event.target.value)}
                  placeholder="tu@email.com" autoComplete="email" maxLength={160} required
                />
              </label>
              <label className={styles.leadField}>{c.leadPhone}
                <input
                  type="tel" value={leadPhone} onChange={(event) => setLeadPhone(event.target.value)}
                  autoComplete="tel" maxLength={40}
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
          <LanguageToggle language={language} onChange={setLanguage} />
        </div>
      </footer>
    </div>
  );
}
