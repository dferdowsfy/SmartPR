"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import styles from "./marketing.module.css";
import { SmartPRLogo } from "../brand/SmartPRLogo";

export type Language = "EN" | "ES";
export type HeaderVariant = "home" | "pro";

const DEMO_EMAIL = "contact@getsmartpr.com";
const TRUST_URL = "https://trust.getsmartpr.com";

/** Route pairs for the EN ⇄ ES toggle: toggling navigates between them. */
const LANG_PAIRS: Array<[string, string]> = [
  ["/", "/es"],
  ["/professionals", "/es/profesionales"],
  ["/about", "/es/nosotros"],
];

const copy = {
  EN: {
    homeNav: [
      { label: "What you get", href: "#what-you-get" },
      { label: "How it works", href: "#how-it-works" },
      { label: "For professionals", href: "/professionals" },
      { label: "Security", href: "#security" },
    ],
    proNav: [
      { label: "Product", href: "/" },
      { label: "Professionals", href: "/professionals" },
      { label: "Security", href: "/#security" },
    ],
    bookDemo: "Book a demo",
    demoSubject: "SmartPR demo request",
    signIn: "Sign in",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    homeFooter: [
      { label: "About", href: "/about" },
      { label: "Professionals", href: "/professionals" },
      { label: "Trust center", href: TRUST_URL, external: true },
      { label: "Pricing", href: "/pricing" },
      { label: "Privacy", href: "/privacy" },
    ],
    proFooter: [
      { label: "Home", href: "/" },
      { label: "About", href: "/about" },
      { label: "Trust center", href: TRUST_URL, external: true },
    ],
  },
  ES: {
    homeNav: [
      { label: "Lo que incluye", href: "#what-you-get" },
      { label: "Cómo funciona", href: "#how-it-works" },
      { label: "Para profesionales", href: "/es/profesionales" },
      { label: "Seguridad", href: "#security" },
    ],
    proNav: [
      { label: "Producto", href: "/es" },
      { label: "Profesionales", href: "/es/profesionales" },
      { label: "Seguridad", href: "/es#security" },
    ],
    bookDemo: "Agendar una demo",
    demoSubject: "SmartPR demo request",
    signIn: "Iniciar sesión",
    openMenu: "Abrir menú",
    closeMenu: "Cerrar menú",
    homeFooter: [
      { label: "Nosotros", href: "/es/nosotros" },
      { label: "Profesionales", href: "/es/profesionales" },
      { label: "Centro de confianza", href: TRUST_URL, external: true },
      { label: "Planes", href: "/pricing" },
      { label: "Privacidad", href: "/privacy" },
    ],
    proFooter: [
      { label: "Inicio", href: "/es" },
      { label: "Nosotros", href: "/es/nosotros" },
      { label: "Centro de confianza", href: TRUST_URL, external: true },
    ],
  },
} as const;

export function LanguageToggle({ language, onChange }: { language: Language; onChange: (lang: Language) => void }) {
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

/** Shared marketing header. `variant` selects the homepage or the
 * professionals-page navigation. `home` is the language-appropriate homepage
 * path ("/" or "/es"); same-page anchors are prefixed with it. */
export function SiteHeader({
  language,
  home,
  variant,
  onLanguageChange,
}: {
  language: Language;
  home: "/" | "/es";
  variant: HeaderVariant;
  onLanguageChange: (lang: Language) => void;
}) {
  const c = copy[language];
  const [navOpen, setNavOpen] = useState(false);
  const nav = variant === "home" ? c.homeNav : c.proNav;
  // "Book a demo" enters the free platform directly — the existing guest
  // intake entry — never a mailto.
  const demoHref = "/?entry=new-business";

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href={home} aria-label="SmartPR home">
          <SmartPRLogo className={styles.logo} size="landing" />
        </Link>
        <nav className={styles.desktopNav} aria-label="Main navigation">
          {nav.map((item) => (
            <a key={item.label} href={variant === "home" && item.href.startsWith("#") ? `${home}${item.href}` : item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className={styles.desktopActions}>
          <LanguageToggle language={language} onChange={onLanguageChange} />
          {variant === "pro" ? <a href={demoHref}>{c.bookDemo}</a> : null}
          <Link href="/auth/login?next=%2F%3Fentry%3Dnew-business">{c.signIn}</Link>
        </div>
        <button
          className={styles.menuButton}
          type="button"
          onClick={() => setNavOpen((open) => !open)}
          aria-expanded={navOpen}
          aria-controls="mobile-nav"
          aria-label={navOpen ? c.closeMenu : c.openMenu}
        >
          {navOpen ? <X size={16} /> : <Menu size={16} />}
        </button>
      </div>
      {navOpen ? (
        <div id="mobile-nav" className={styles.mobileNav}>
          {nav.map((item) => (
            <a
              key={item.label}
              href={variant === "home" && item.href.startsWith("#") ? `${home}${item.href}` : item.href}
              onClick={() => setNavOpen(false)}
            >
              {item.label}
            </a>
          ))}
          <div className={styles.mobileAccountRow}>
            <Link href="/auth/login?next=%2F%3Fentry%3Dnew-business">{c.signIn}</Link>
            <LanguageToggle language={language} onChange={onLanguageChange} />
          </div>
          {variant === "pro" ? (
            <a href={demoHref} onClick={() => setNavOpen(false)}>
              {c.bookDemo}
            </a>
          ) : null}
        </div>
      ) : null}
    </header>
  );
}

/** Shared marketing footer with language-aware links. */
export function SiteFooter({ language, variant }: { language: Language; variant: HeaderVariant }) {
  const c = copy[language];
  const links = variant === "home" ? c.homeFooter : c.proFooter;
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span>© 2026 SmartPR</span>
        <nav className={styles.footerNav} aria-label="Footer">
          {links.map((link) =>
            "external" in link && link.external ? (
              <a key={link.label} href={link.href} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ) : (
              <Link key={link.label} href={link.href}>
                {link.label}
              </Link>
            ),
          )}
          <a href={`mailto:${DEMO_EMAIL}`}>{DEMO_EMAIL}</a>
        </nav>
      </div>
    </footer>
  );
}

/** Language-toggle navigation shared by all marketing pages: toggles between
 * known EN/ES route pairs, otherwise swaps copy in place. */
export function useMarketingLanguage(initialLanguage: Language) {
  const router = useRouter();
  const pathname = usePathname();
  const [language, setLanguage] = useState<Language>(initialLanguage);

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    const pair = LANG_PAIRS.find(([en, es]) => pathname === en || pathname === es);
    if (pair) {
      const target = lang === "ES" ? pair[1] : pair[0];
      if (target !== pathname) router.push(target);
    }
  };

  return { language, handleLanguageChange };
}
