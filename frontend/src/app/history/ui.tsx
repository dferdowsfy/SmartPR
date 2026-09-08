"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogOut, Settings, ShieldCheck, CalendarDays, RefreshCw } from "lucide-react";
import { createSupabaseBrowser, isAuthConfigured } from "../../lib/supabase/client";
import { SmartPRLogo } from "../components/brand/SmartPRLogo";

interface MeUser { id: string; email: string | null; name: string | null; avatar: string | null; isAdmin?: boolean }

function signOutNow() {
  try {
    if (isAuthConfigured()) void createSupabaseBrowser().auth.signOut().catch(() => {});
  } catch {
    /* server route below is the source of truth */
  }
  window.location.assign("/auth/signout");
}

export function TopNav({ active, extraActions }: { active: "dashboard" | "businesses" | "calendar" | "history" | "graph" | "admin" | "settings"; extraActions?: ReactNode }) {
  const [user, setUser] = useState<MeUser | null | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lang, setLang] = useState<"en" | "es">("en");
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setUser(d.user || null)).catch(() => setUser(null));
  }, []);

  // Only listen for outside clicks while open, and ignore the opening click.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (menuRef.current && target && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
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

  useEffect(() => {
    try { const s = localStorage.getItem("smartpr-lang"); if (s === "es" || s === "en") setLang(s); } catch {}
    const handler = (e: Event) => {
      const l = (e as CustomEvent<string>).detail;
      if (l === "en" || l === "es") setLang(l as "en" | "es");
    };
    window.addEventListener("smartpr-lang-change", handler);
    return () => window.removeEventListener("smartpr-lang-change", handler);
  }, []);

  const changeLang = (l: "en" | "es") => {
    setLang(l);
    try { localStorage.setItem("smartpr-lang", l); } catch {}
    window.dispatchEvent(new CustomEvent("smartpr-lang-change", { detail: l }));
  };

  const initials = (user?.name || user?.email || "?").slice(0, 1).toUpperCase();
  const navStart = lang === "es" ? "Comenzar" : "Start";
  const navMyBiz = lang === "es" ? "Mis Negocios" : "My Businesses";

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
          <Link href="/businesses" className={`nav-tab ${active === "businesses" || active === "calendar" || active === "history" || active === "settings" ? "active" : ""}`}>
            {navMyBiz}
          </Link>
        </nav>

        <div className="appbar-actions">
          {langToggle}
          {extraActions}
          {user === undefined ? null : user ? (
            <div className="account-menu" ref={menuRef}>
              <button
                className="avatar"
                type="button"
                aria-label="Account menu"
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
              <div className={`user-menu ${menuOpen ? "open" : ""}`} role="menu">
                <div className="uhead">
                  <div className="uname">{user.name || user.email}</div>
                  <div className="uemail">{user.email}</div>
                </div>
                <Link className="uitem" role="menuitem" href="/settings" onClick={() => setMenuOpen(false)}>
                  <Settings className="i" /> Settings
                </Link>
                <Link className="uitem" role="menuitem" href="/calendar" onClick={() => setMenuOpen(false)}>
                  <CalendarDays className="i" /> Calendar
                </Link>
                <Link className="uitem" role="menuitem" href="/history" onClick={() => setMenuOpen(false)}>
                  <RefreshCw className="i" /> History
                </Link>
                {user.isAdmin && (
                  <Link className="uitem" role="menuitem" href="/admin/knowledge-base" onClick={() => setMenuOpen(false)}>
                    <ShieldCheck className="i" /> Knowledge Graph
                  </Link>
                )}
                {user.isAdmin && (
                  <Link className="uitem" role="menuitem" href="/admin/requirements" onClick={() => setMenuOpen(false)}>
                    <ShieldCheck className="i" /> Admin Review
                  </Link>
                )}
                <button type="button" className="uitem uitem-danger" role="menuitem" onClick={signOutNow}>
                  <LogOut className="i" /> Log out
                </button>
              </div>
            </div>
          ) : (
            <Link href="/auth/login" className="nav-tab">Sign in</Link>
          )}
        </div>
      </div>
    </header>
  );
}

export function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return String(s);
  }
}

export function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
