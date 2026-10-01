"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogOut, Settings, ShieldCheck, CalendarDays, RefreshCw, FileText } from "lucide-react";
import { createSupabaseBrowser, isAuthConfigured } from "../../lib/supabase/client";
import { NotificationBell } from "./NotificationBell";
import { readLang, setLang } from "../useLang";

interface MeUser {
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
  isAdmin?: boolean;
}

/**
 * Shared header utilities: language toggle, notification bell, and account
 * menu. Rendered in the global nav AND in the sticky workflow stepper —
 * exactly one instance is visible at a time (CSS toggles via the
 * `nav-is-scrolled` class on <html>, driven by an IntersectionObserver on
 * the global nav). Each instance owns its state; language stays in sync
 * through the smartpr-lang broadcast, so toggling in either location
 * updates both.
 */
export function HeaderUtilities({ idPrefix = "hu" }: { idPrefix?: string }) {
  const [user, setUser] = useState<MeUser | null | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lang, setLangState] = useState<"en" | "es">(() => readLang());
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const avatarBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setUser(d.user || null)).catch(() => setUser(null));
  }, []);

  // Stay in sync when the language is toggled from the other instance.
  useEffect(() => {
    setLangState(readLang());
    const handler = (e: Event) => {
      const l = (e as CustomEvent<string>).detail;
      if (l === "en" || l === "es") setLangState(l);
    };
    window.addEventListener("smartpr-lang-change", handler);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "smartpr-lang") setLangState(readLang());
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("smartpr-lang-change", handler);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const changeLang = (l: "en" | "es") => {
    setLang(l);
    setLangState(l);
  };

  const placeMenu = useCallback(() => {
    const btn = avatarBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setMenuPos({ top: Math.round(r.bottom + 8), right: Math.round(window.innerWidth - r.right) });
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    placeMenu();
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
  }, [menuOpen, placeMenu]);

  const signOutNow = useCallback(async () => {
    try {
      if (isAuthConfigured()) {
        const supabase = createSupabaseBrowser();
        await supabase.auth.signOut();
      }
    } catch { /* best-effort */ }
    window.location.href = "/";
  }, []);

  const es = lang === "es";
  const initials = (user?.name || user?.email || "?").slice(0, 1).toUpperCase();

  return (
    <div className="spr-header-utilities" data-utilities={idPrefix}>
      <div className="spr-context-language" aria-label={es ? "Idioma" : "Language"}>
        <button type="button" className={lang === "en" ? "active" : ""} aria-pressed={lang === "en"} onClick={() => changeLang("en")}>EN</button>
        <button type="button" className={lang === "es" ? "active" : ""} aria-pressed={lang === "es"} onClick={() => changeLang("es")}>ES</button>
      </div>
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
  );
}
