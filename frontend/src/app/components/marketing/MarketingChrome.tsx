"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import styles from "./marketing.module.css";
import { SmartPRLogo } from "../brand/SmartPRLogo";

export type Language = "EN" | "ES";

/** Route pairs for the EN ⇄ ES toggle: toggling navigates between them. */
const LANG_PAIRS: Array<[string, string]> = [
  ["/", "/es"],
  ["/professionals", "/es/profesionales"],
  ["/about", "/es/nosotros"],
];

const copy = {
  EN: {
    how: "How it works",
    technology: "Technology",
    pricing: "Pricing",
    professionals: "For professionals",
    login: "Login",
    started: "Sign up",
    privacy: "Privacy Policy",
    about: "About",
    restaurantChecklist: "Restaurant opening checklist",
    openMenu: "Open menu",
    closeMenu: "Close menu",
  },
  ES: {
    how: "Cómo funciona",
    technology: "Tecnología",
    pricing: "Planes",
    professionals: "Para profesionales",
    login: "Iniciar sesión",
    started: "Registrarse",
    privacy: "Política de privacidad",
    about: "Nosotros",
    restaurantChecklist: "Abrir un restaurante",
    openMenu: "Abrir menú",
    closeMenu: "Cerrar menú",
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

/** Shared marketing header. `home` is the language-appropriate homepage path
 * ("/" or "/es"); anchors to homepage sections are prefixed with it so they
 * work from any page. */
export function SiteHeader({
  language,
  home,
  onLanguageChange,
}: {
  language: Language;
  home: "/" | "/es";
  onLanguageChange: (lang: Language) => void;
}) {
  const c = copy[language];
  const [navOpen, setNavOpen] = useState(false);
  const professionalsHref = language === "ES" ? "/es/profesionales" : "/professionals";

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link href={home} aria-label="SmartPR home">
          <SmartPRLogo className={styles.logo} size="landing" />
        </Link>
        <nav className={styles.desktopNav} aria-label="Main navigation">
          <a href={`${home}#how-it-works`}>{c.how}</a>
          <a href={`${home}#technology`}>{c.technology}</a>
          <Link href="/pricing">{c.pricing}</Link>
          <Link href={professionalsHref}>{c.professionals}</Link>
        </nav>
        <div className={styles.desktopActions}>
          <LanguageToggle language={language} onChange={onLanguageChange} />
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
          aria-label={navOpen ? c.closeMenu : c.openMenu}
        >
          {navOpen ? <X size={16} /> : <Menu size={16} />}
        </button>
      </div>
      {navOpen ? (
        <div id="mobile-nav" className={styles.mobileNav}>
          <a href={`${home}#how-it-works`} onClick={() => setNavOpen(false)}>
            {c.how}
          </a>
          <a href={`${home}#technology`} onClick={() => setNavOpen(false)}>
            {c.technology}
          </a>
          <Link href="/pricing" onClick={() => setNavOpen(false)}>
            {c.pricing}
          </Link>
          <Link href={professionalsHref} onClick={() => setNavOpen(false)}>
            {c.professionals}
          </Link>
          <div className={styles.mobileAccountRow}>
            <Link href="/auth/login?next=%2F%3Fentry%3Dnew-business">{c.login}</Link>
            <LanguageToggle language={language} onChange={onLanguageChange} />
          </div>
          <Link href="/signup" className={styles.primary} onClick={() => setNavOpen(false)}>
            {c.started}
          </Link>
        </div>
      ) : null}
    </header>
  );
}

/** Shared marketing footer with language-aware links. */
export function SiteFooter({
  language,
  home,
  onLanguageChange,
}: {
  language: Language;
  home: "/" | "/es";
  onLanguageChange: (lang: Language) => void;
}) {
  const c = copy[language];
  return (
    <footer className={styles.footer}>
      <div className={styles.footerInner}>
        <span>© 2026 SmartPR</span>
        <Link href={language === "ES" ? "/es/restaurantes" : "/restaurants"}>{c.restaurantChecklist}</Link>
        <Link href="/privacy">{c.privacy}</Link>
        <Link href={language === "ES" ? "/es/nosotros" : "/about"}>{c.about}</Link>
        <Link href={language === "ES" ? "/es/profesionales" : "/professionals"}>{c.professionals}</Link>
        <a href={`${home}#how-it-works`}>{c.how}</a>
        <a href={`${home}#technology`}>{c.technology}</a>
        <LanguageToggle language={language} onChange={onLanguageChange} />
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
