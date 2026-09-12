"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { LogOut, Settings, ShieldCheck, CalendarDays, RefreshCw, FileText } from "lucide-react";
import { createSupabaseBrowser, isAuthConfigured } from "../../lib/supabase/client";
import { SmartPRLogo } from "../components/brand/SmartPRLogo";
import { NotificationBell } from "../components/NotificationBell";
import { readLang, setLang } from "../useLang";

interface MeUser { id: string; email: string | null; name: string | null; avatar: string | null; isAdmin?: boolean }

function signOutNow() {
  try {
    if (isAuthConfigured()) void createSupabaseBrowser().auth.signOut().catch(() => {});
  } catch {
    /* server route below is the source of truth */
  }
  window.location.assign("/auth/signout");
}

export function TopNav({ active, extraActions }: { active: "dashboard" | "businesses" | "calendar" | "filings" | "history" | "graph" | "admin" | "settings"; extraActions?: ReactNode }) {
  const [user, setUser] = useState<MeUser | null | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lang, setLangState] = useState<"en" | "es">("en");
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const avatarBtnRef = useRef<HTMLButtonElement | null>(null);

  const placeMenu = useCallback(() => {
    const btn = avatarBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setMenuPos({ top: Math.round(r.bottom + 8), right: Math.round(window.innerWidth - r.right) });
  }, []);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setUser(d.user || null)).catch(() => setUser(null));
  }, []);

  // Only listen for outside clicks while open, and ignore the opening click.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target) || menuPanelRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onPointerDown);
      document.addEventListener("touchstart", onPointerDown);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [menuOpen]);

  // Keep the open menu pinned to the avatar in viewport space so Start's
  // collapsing sticky header (overflow:hidden + later chrome paint) can't clip it.
  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null);
      return;
    }
    placeMenu();
    const onReposition = () => placeMenu();
    window.addEventListener("resize", onReposition);
    // capture scroll from nested intake panes too
    window.addEventListener("scroll", onReposition, true);
    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [menuOpen, placeMenu]);

  useEffect(() => {
    setLangState(readLang());
    const handler = (e: Event) => {
      const l = (e as CustomEvent<string>).detail;
      if (l === "en" || l === "es") setLangState(l);
    };
    const storageHandler = (e: StorageEvent) => {
      if (e.key === "smartpr-lang") setLangState(readLang());
    };
    window.addEventListener("smartpr-lang-change", handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener("smartpr-lang-change", handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);

  // Broadcast so every mounted page's useLang() re-renders instantly.
  const changeLang = (l: "en" | "es") => {
    setLangState(l);
    setLang(l);
  };

  const initials = (user?.name || user?.email || "?").slice(0, 1).toUpperCase();
  const navStart = lang === "es" ? "Comenzar" : "Start";
  const navMyBiz = lang === "es" ? "Mis Negocios" : "My Businesses";
  const es = lang === "es";

  const langToggle = (
    <div className="spr-context-language" aria-label={lang === "es" ? "Idioma" : "Language"}>
      <button type="button" className={lang === "en" ? "active" : ""} aria-pressed={lang === "en"} onClick={() => changeLang("en")}>EN</button>
      <button type="button" className={lang === "es" ? "active" : ""} aria-pressed={lang === "es"} onClick={() => changeLang("es")}>ES</button>
    </div>
  );

  return (
    <header className="appbar">
      <div className="appbar-inner">
        <div className="appbar-left">
          <Link href={user ? "/businesses" : "/"} className="brand" aria-label="SmartPR home">
            <SmartPRLogo size="app" />
          </Link>
        </div>

        <nav className="nav-tabs" aria-label="Sections">
          <Link href="/?entry=new-business" className="nav-tab">{navStart}</Link>
          <Link href="/businesses" className={`nav-tab ${active === "businesses" || active === "calendar" || active === "filings" || active === "history" || active === "settings" ? "active" : ""}`}>
            {navMyBiz}
          </Link>
        </nav>

        <div className="appbar-actions">
          {langToggle}
          {extraActions}
          {user === undefined ? null : user ? (
            <>
            <NotificationBell />
            <div className="account-menu" ref={menuRef}>
              <button
                ref={avatarBtnRef}
                className="avatar"
                type="button"
                aria-label={es ? "Menú de cuenta" : "Account menu"}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
                title={user.name || user.email || "Account"}
              >
                {user.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatar} alt="" className="avatar-img" />
                ) : (
                  <span className="avatar-initial">{initials}</span>
                )}
              </button>
              {menuOpen && menuPos && typeof document !== "undefined"
                ? createPortal(
                    <div
                      ref={menuPanelRef}
                      className="user-menu open user-menu-fixed"
                      role="menu"
                      style={{ top: menuPos.top, right: menuPos.right }}
                    >
                      <div className="uhead">
                        <div className="uname">{user.name || user.email}</div>
                        <div className="uemail">{user.email}</div>
                      </div>
                      <Link className="uitem" role="menuitem" href="/settings" onClick={() => setMenuOpen(false)}>
                        <Settings className="i" /> {es ? "Ajustes" : "Settings"}
                      </Link>
                      <Link className="uitem" role="menuitem" href="/filings" onClick={() => setMenuOpen(false)}>
                        <FileText className="i" /> {es ? "Radicaciones anuales" : "Annual filings"}
                      </Link>
                      <Link className="uitem" role="menuitem" href="/calendar" onClick={() => setMenuOpen(false)}>
                        <CalendarDays className="i" /> {es ? "Calendario" : "Calendar"}
                      </Link>
                      <Link className="uitem" role="menuitem" href="/history" onClick={() => setMenuOpen(false)}>
                        <RefreshCw className="i" /> {es ? "Historial" : "History"}
                      </Link>
                      {user.isAdmin && (
                        <Link className="uitem" role="menuitem" href="/admin/knowledge-base" onClick={() => setMenuOpen(false)}>
                          <ShieldCheck className="i" /> {es ? "Grafo de conocimiento" : "Knowledge Graph"}
                        </Link>
                      )}
                      {user.isAdmin && (
                        <Link className="uitem" role="menuitem" href="/admin/requirements" onClick={() => setMenuOpen(false)}>
                          <ShieldCheck className="i" /> {es ? "Revisión admin" : "Admin Review"}
                        </Link>
                      )}
                      <button type="button" className="uitem uitem-danger" role="menuitem" onClick={signOutNow}>
                        <LogOut className="i" /> {es ? "Cerrar sesión" : "Log out"}
                      </button>
                    </div>,
                    document.body,
                  )
                : null}
            </div>
            </>
          ) : (
            <Link href="/auth/login" className="nav-tab">{es ? "Iniciar sesión" : "Sign in"}</Link>
          )}
        </div>
      </div>
    </header>
  );
}

function currentLocale(): string {
  try {
    return window.localStorage.getItem("smartpr-lang") === "es" ? "es-PR" : "en-US";
  } catch { return "en-US"; }
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString(typeof window === "undefined" ? "en-US" : currentLocale(), { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return String(s);
  }
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString(typeof window === "undefined" ? "en-US" : currentLocale(), { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return String(s);
  }
}

export function statusLabel(score: number | null | undefined, stored?: string | null): string {
  if (stored) return stored;
  if (score == null) return "In Progress";
  if (score >= 90) return "Ready For Submission";
  if (score >= 70) return "Nearly Ready";
  if (score >= 40) return "Needs Documents";
  return "Missing Requirements";
}

export function scoreColor(score: number | null | undefined): string {
  if (score == null) return "#5a5a5a";
  if (score >= 90) return "#1f5a3a";
  if (score >= 70) return "#245c5c";
  if (score >= 40) return "#8a5a12";
  return "#8a2f2f";
}

export function ScorePill({ score }: { score: number | null | undefined }) {
  const c = scoreColor(score);
  return (
    <span style={{ background: c + "1a", color: c, border: `1px solid ${c}55` }} className="rounded-full px-2.5 py-0.5 text-sm font-medium">
      {score == null ? "—" : `${score}%`}
    </span>
  );
}

export function NotConnected() {
  return (
    <div className="max-w-3xl mx-auto mt-10 p-6 rounded-2xl border border-[#161616]/15 bg-[#fbf8f2]">
      <div className="font-medium text-[#161616]">No submission history yet</div>
      <p className="text-sm text-[#5a5a5a] mt-1">
        Submission history appears here once you complete an assessment.
        Each readiness assessment is saved automatically — revisit, compare, and resume from this workspace.
      </p>
    </div>
  );
}
