"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogOut, Settings, ShieldCheck, CalendarDays, RefreshCw, FileText } from "lucide-react";
import { createSupabaseBrowser, isAuthConfigured } from "../../lib/supabase/client";
import { BrandLogo } from "../components/brand/BrandProvider";
import { NotificationBell } from "../components/NotificationBell";
import { readLang, setLang } from "../useLang";

interface MeUser { id: string; email: string | null; name: string | null; avatar: string | null; isAdmin?: boolean }

/**
 * The app header is mounted once in the root layout and stays mounted
 * across route changes, so the segmented-menu pill glides between tabs
 * without remounting. The selected tab is derived from the route on the
 * very first render — there is never a temporary default selection.
 */
type TopNavTab = "start" | "businesses" | "enterprise";

const BUSINESSES_PREFIXES = ["/businesses", "/dashboard", "/calendar", "/filings", "/filing-package", "/history", "/settings"];

/** Which tab a route belongs to, or null when the header shows no selection. */
function routeTabFor(pathname: string | null): TopNavTab | null {
  if (!pathname) return null;
  if (pathname === "/") return "start";
  if (pathname === "/enterprise" || pathname.startsWith("/enterprise/")) return "enterprise";
  if (BUSINESSES_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"))) return "businesses";
  return null;
}

// Enterprise-tab probe result. Unknown until the first probe resolves; while
// unknown the tab renders as an invisible placeholder so the tab row never
// changes width when access resolves.
let cachedHasEnterprise: boolean | null = null;

function signOutNow() {
  try {
    if (isAuthConfigured()) void createSupabaseBrowser().auth.signOut().catch(() => {});
  } catch {
    /* server route below is the source of truth */
  }
  window.location.assign("/auth/signout");
}

export function TopNav() {
  const [user, setUser] = useState<MeUser | null | undefined>(undefined);
  const [menuOpen, setMenuOpen] = useState(false);
  const [lang, setLangState] = useState<"en" | "es">(() => readLang());
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuPanelRef = useRef<HTMLDivElement | null>(null);
  const avatarBtnRef = useRef<HTMLButtonElement | null>(null);
  // Enterprise section: visible only when the user holds view_records in a workspace.
  const [hasEnterprise, setHasEnterprise] = useState<boolean | null>(() => cachedHasEnterprise);

  const placeMenu = useCallback(() => {
    const btn = avatarBtnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    setMenuPos({ top: Math.round(r.bottom + 8), right: Math.round(window.innerWidth - r.right) });
  }, []);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setUser(d.user || null)).catch(() => setUser(null));
  }, []);

  // Enterprise nav gating: degrade gracefully if the probe fails.
  useEffect(() => {
    fetch("/api/enterprise/access")
      .then((r) => r.json())
      .then((d) => {
        const ws = (d.workspaces ?? []).some((w: { permissions?: string[] }) =>
          (w.permissions ?? []).includes("view_records")
        );
        cachedHasEnterprise = Boolean(ws);
        setHasEnterprise(cachedHasEnterprise);
      })
      .catch(() => {
        cachedHasEnterprise = false;
        setHasEnterprise(false);
      });
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

  // The selected tab is derived from the route on the very first render —
  // there is never a temporary default selection. `pendingTab` moves the
  // pill the instant a tab is clicked, before the next page has painted, so
  // the glide starts immediately.
  const pathname = usePathname();
  const routeTab = routeTabFor(pathname);
  const [pendingTab, setPendingTab] = useState<TopNavTab | null>(null);
  useEffect(() => {
    setPendingTab(null);
  }, [pathname]);
  const selectedTab = pendingTab ?? routeTab;
  // If the route is enterprise but the probe says no access, the enterprise
  // page itself handles the denial — keep My Businesses lit.
  const pillTab: TopNavTab | null =
    selectedTab === "enterprise" && hasEnterprise === false ? "businesses" : selectedTab;

  // Sliding selected-tab pill. Only the pill's position animates; the tabs
  // themselves never move, resize, or repaint.
  const navRef = useRef<HTMLElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Record<TopNavTab, HTMLElement | null>>({
    start: null,
    businesses: null,
    enterprise: null,
  });
  type PillRect = { left: number; top: number; width: number; height: number; animate: boolean };
  const [pill, setPill] = useState<PillRect | null>(null);
  const lastPillTab = useRef<TopNavTab | null>(null);
  const didMount = useRef(false);

  const measure = useCallback(
    (animate: boolean) => {
      const nav = navRef.current;
      const el = pillTab ? tabRefs.current[pillTab] : null;
      if (!nav || !el) {
        setPill(null);
        return;
      }
      const n = nav.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      setPill({
        left: r.left - n.left,
        top: r.top - n.top,
        width: r.width,
        height: r.height,
        animate,
      });
    },
    [pillTab],
  );

  // Measure after paint so the pill lands exactly on the selected tab on
  // first render. It animates only when the selected tab actually changed;
  // resizes (fonts, language, window) re-measure without animating.
  useLayoutEffect(() => {
    const animate = didMount.current && lastPillTab.current !== pillTab;
    lastPillTab.current = pillTab;
    didMount.current = true;
    measure(animate);
  }, [pillTab, hasEnterprise, lang, measure]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    // The observer fires once on observe — skip it so it can't cancel a
    // glide in flight.
    let primed = false;
    const ro = new ResizeObserver(() => {
      if (!primed) {
        primed = true;
        return;
      }
      measure(false);
    });
    ro.observe(nav);
    return () => ro.disconnect();
  }, [measure]);

  // Publish the header height for viewport-locked pages (the agency-run
  // workspace) so they can size to exactly viewport minus header.
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el || typeof document === "undefined") return;
    const set = () => {
      document.documentElement.style.setProperty("--topnav-h", `${Math.round(el.offsetHeight)}px`);
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const langToggle = (
    <div className="spr-context-language" aria-label={lang === "es" ? "Idioma" : "Language"}>
      <button type="button" className={lang === "en" ? "active" : ""} aria-pressed={lang === "en"} onClick={() => changeLang("en")}>EN</button>
      <button type="button" className={lang === "es" ? "active" : ""} aria-pressed={lang === "es"} onClick={() => changeLang("es")}>ES</button>
    </div>
  );

  return (
    <header ref={headerRef} className="appbar">
      <div className="appbar-inner">
        <div className="appbar-left">
          <Link href={user ? "/businesses" : "/"} className="brand" aria-label="SmartPR home">
            <BrandLogo size="app" />
          </Link>
        </div>

        <nav ref={navRef} className={`nav-tabs${pill ? " has-pill" : ""}`} aria-label="Sections">
          {pill && (
            <span
              aria-hidden="true"
              className={`nav-tab-pill${pill.animate ? "" : " no-anim"}`}
              style={{
                width: pill.width,
                height: pill.height,
                transform: `translate(${pill.left}px, ${pill.top}px)`,
              }}
            />
          )}
          <Link
            href="/?entry=new-business"
            data-tab="start"
            ref={(el) => { tabRefs.current.start = el; }}
            onClick={() => setPendingTab("start")}
            className={`nav-tab${pillTab === "start" ? " active" : ""}`}
            aria-current={routeTab === "start" ? "page" : undefined}
            data-active={pillTab === "start" ? "true" : undefined}
          >
            {navStart}
          </Link>
          <Link
            href="/businesses"
            data-tab="businesses"
            ref={(el) => { tabRefs.current.businesses = el; }}
            onClick={() => setPendingTab("businesses")}
            className={`nav-tab${pillTab === "businesses" ? " active" : ""}`}
            aria-current={routeTab === "businesses" ? "page" : undefined}
            data-active={pillTab === "businesses" ? "true" : undefined}
          >
            {navMyBiz}
          </Link>
          {hasEnterprise === null ? (
            // Access probe still pending: reserve the tab's exact slot so
            // the row never changes width when access resolves.
            <span
              aria-hidden="true"
              data-tab="enterprise"
              ref={(el) => { tabRefs.current.enterprise = el; }}
              className="nav-tab nav-tab-ghost"
            >
              {es ? "Empresarial" : "Enterprise"}
            </span>
          ) : hasEnterprise ? (
            <div className="nav-dropdown">
              <Link
                href="/enterprise"
                data-tab="enterprise"
                ref={(el) => { tabRefs.current.enterprise = el; }}
                onClick={() => setPendingTab("enterprise")}
                className={`nav-tab${pillTab === "enterprise" ? " active" : ""}`}
                aria-current={routeTab === "enterprise" ? "page" : undefined}
                data-active={pillTab === "enterprise" ? "true" : undefined}
              >
                {es ? "Empresarial" : "Enterprise"}
              </Link>
              <div className="nav-dropdown-menu" role="menu" aria-label={es ? "Secciones empresariales" : "Enterprise sections"}>
                <Link className="nav-dropdown-item" role="menuitem" href="/enterprise">
                  {es ? "Portafolio" : "Portfolio"}
                  <span className="sub">{es ? "Métricas en vivo por negocio y facilidad" : "Live metrics by business & facility"}</span>
                </Link>
                <Link className="nav-dropdown-item" role="menuitem" href="/enterprise/work">
                  {es ? "Cola de trabajo" : "Work queue"}
                  <span className="sub">{es ? "Requisitos, asignaciones y revisiones" : "Requirements, assignments & reviews"}</span>
                </Link>
                <Link className="nav-dropdown-item" role="menuitem" href="/enterprise/regulatory">
                  {es ? "Cambios regulatorios" : "Regulatory changes"}
                  <span className="sub">{es ? "Impacto y reconocimiento" : "Impact & acknowledgment"}</span>
                </Link>
                <Link className="nav-dropdown-item" role="menuitem" href="/enterprise/reports">
                  {es ? "Informes" : "Reports"}
                  <span className="sub">{es ? "Ejecutivos, CSV y PDF" : "Executive, CSV & PDF"}</span>
                </Link>
                <Link className="nav-dropdown-item" role="menuitem" href="/enterprise/admin">
                  {es ? "Administración" : "Organization admin"}
                  <span className="sub">{es ? "Equipo, roles y seguridad" : "Team, roles & security"}</span>
                </Link>
              </div>
            </div>
          ) : null}
        </nav>

        <div className="appbar-actions">
          {langToggle}
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
                      {user.isAdmin && (
                        <Link className="uitem" role="menuitem" href="/admin/emails" onClick={() => setMenuOpen(false)}>
                          <ShieldCheck className="i" /> {es ? "Correos de cumplimiento" : "Compliance emails"}
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
  if (score >= 70) return "var(--brand-primary)";
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
