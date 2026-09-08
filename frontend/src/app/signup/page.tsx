"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check, Eye, EyeOff } from "lucide-react";
import { createSupabaseBrowser, isAuthConfigured } from "../../lib/supabase/client";
import { authRedirectUrl } from "../../lib/siteUrl";
import styles from "./signup.module.css";
import { SmartPRLogo } from "../components/brand/SmartPRLogo";
import { trackAcquisition } from "../restaurants/analytics";
import { GUEST_INTAKE, sanitizeNext } from "../../lib/safeNext";

type Intent = "start" | "manage";
type Language = "EN" | "ES";

const trustPoints = [
  "Find every permit, license, and registration that applies to your business",
  "Prepare filings and catch missing documents before they cost you",
  "Track renewals and deadlines automatically",
  "Manage one business or an entire client portfolio",
];

const esLabels: Record<string, string> = {
  "Find every permit, license, and registration that applies to your business": "Encuentra cada permiso, licencia y registro que aplica a tu negocio",
  "Prepare filings and catch missing documents before they cost you": "Prepara radicaciones y detecta documentos faltantes antes de que te cuesten",
  "Track renewals and deadlines automatically": "Controla renovaciones y fechas límite automáticamente",
  "Manage one business or an entire client portfolio": "Administra un negocio o una cartera completa de clientes",
  "First name": "Nombre", "Last name": "Apellido", "Work email": "Correo de trabajo", Password: "Contraseña", "Phone number": "Teléfono", optional: "opcional",
  "I am a…": "Soy…", "Business name": "Nombre del negocio", "Business owner": "Dueño de negocio", Gestor: "Gestor", "CPA / Accountant": "CPA / Contador", "Permitting firm": "Firma de permisos", "Attorney / Law firm": "Abogado / Bufete",
  "At least 8 characters": "Al menos 8 caracteres", "Your new business name": "Nombre de tu nuevo negocio",
  "I agree to the": "Acepto los", "Terms of Service": "Términos de servicio", and: "y la", "Privacy Policy": "Política de privacidad",
  "Creating account…": "Creando cuenta…", "Create Account": "Crear cuenta", "Already have an account?": "¿Ya tienes una cuenta?", "Log in": "Iniciar sesión", "← Back to smartpr.com": "← Volver a smartpr.com",
};

function LanguageToggle({ language, onChange }: { language: Language; onChange: (language: Language) => void }) {
  return <div className={styles.language}>{(["EN", "ES"] as const).map((item) => <button key={item} type="button" aria-pressed={language === item} onClick={() => onChange(item)}>{item.toLowerCase()}</button>)}</div>;
}

function SignupForm() {
  const params = useSearchParams();
  const initialIntent = params.get("intent") === "manage" ? "manage" : "start";
  const [intent, setIntent] = useState<Intent>(initialIntent);
  const [language, setLanguage] = useState<Language>(params.get("lang") === "es" ? "ES" : "EN");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("owner");
  const [businessName, setBusinessName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState<"session" | "confirmation" | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);

  const requestedNext = params.get("next");
  const nextPath = sanitizeNext(requestedNext, intent === "manage" ? "/businesses/import" : GUEST_INTAKE);
  const valid = useMemo(() => firstName.trim().length > 0 && lastName.trim().length > 0 && /\S+@\S+\.\S+/.test(email) && password.length >= 8 && agreed, [agreed, email, firstName, lastName, password]);
  const isSpanish = language === "ES";
  const t = (value: string) => isSpanish ? (esLabels[value] || value) : value;

  async function bootstrapPlatform() {
    const response = await fetch("/api/auth/bootstrap", { method: "POST" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error || "Your account was created, but SmartPR could not initialize your workspace.");
      setWorkspaceReady(false);
      return false;
    }
    setError(null);
    setWorkspaceReady(true);
    return true;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || busy) return;
    if (!isAuthConfigured()) {
      setError("Account creation is unavailable because Supabase authentication is not configured in this environment.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowser();
      const { data, error: signupError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: authRedirectUrl(nextPath),
          data: {
            full_name: `${firstName.trim()} ${lastName.trim()}`,
            first_name: firstName.trim(),
            last_name: lastName.trim(),
            phone: phone.trim() || null,
            professional_role: role,
            onboarding_intent: intent,
            business_name: businessName.trim() || null,
          },
        },
      });
      if (signupError) throw signupError;
      const acquisition = new URLSearchParams(nextPath.split("?")[1] || "");
      if ((acquisition.get("acquisition") === "restaurant" || acquisition.get("acquisition") === "clinic") && data.user && data.user.identities?.length) {
        trackAcquisition("account_created", acquisition.get("source") || "direct", language.toLowerCase());
      }
      if (data.session) {
        await bootstrapPlatform();
        setComplete("session");
      } else {
        setComplete("confirmation");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't create your account. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.shell}>
      <aside className={styles.leftPanel}>
        <div className={styles.glow} />
        <Link href="/"><SmartPRLogo className={styles.logo} inverted size="auth" /></Link>
        <div className={styles.pitch}>
          <h1>{isSpanish ? "Todo lo que el cumplimiento en Puerto Rico necesita, en un solo lugar." : "Everything Puerto Rico compliance needs, in one place."}</h1>
          <p>{isSpanish ? "Únete a dueños de negocios, gestores, CPA y bufetes que usan SmartPR para adelantarse a cada requisito." : "Join business owners, gestores, CPAs, and law firms who use SmartPR to stay ahead of every requirement."}</p>
          <ul>{trustPoints.map((point) => <li key={point}><i><Check size={13} /></i>{t(point)}</li>)}</ul>
        </div>
        <small>{isSpanish ? "SmartPR es una plataforma independiente. Las agencias gubernamentales siguen siendo las autoridades que aprueban permisos, licencias, registros y radicaciones." : "SmartPR is an independent platform. Government agencies remain the approving authorities for permits, licenses, registrations, and filings."}</small>
      </aside>

      <section className={styles.formPanel}>
        <div className={styles.topBar}>
          <Link className={styles.mobileLogo} href="/"><SmartPRLogo className={styles.logo} size="auth" /></Link>
          <div><Link href={`/auth/login?next=${encodeURIComponent(nextPath)}`}>{t("Log in")}</Link><LanguageToggle language={language} onChange={setLanguage} /></div>
        </div>
        <div className={styles.formWrap}>
          {complete ? <div className={styles.success}>
            <i><Check size={28} /></i>
            <h2>{isSpanish ? `Todo listo, ${firstName}.` : `You're all set, ${firstName}.`}</h2>
            <p>{complete === "confirmation"
              ? (isSpanish ? `Enviamos un enlace de confirmación a ${email}. Ábrelo para terminar de crear tu cuenta.` : `We sent a confirmation link to ${email}. Open it to finish creating your account.`)
              : (isSpanish ? `Tu cuenta de SmartPR está lista. A continuación, configuraremos ${intent === "manage" ? "tu negocio existente" : "tu negocio nuevo"}.` : `Your SmartPR account has been created. Next, we'll walk you through ${intent === "manage" ? "connecting your existing business" : "setting up your new business"}.`)}</p>
            {error && <div className={styles.error} role="alert">{error}</div>}
            {complete === "session" && !workspaceReady ? (
              <button className={styles.submitButton} type="button" onClick={() => void bootstrapPlatform()}>
                {isSpanish ? "Reintentar conexión →" : "Retry workspace connection →"}
              </button>
            ) : (
              <Link className={styles.submitButton} href={complete === "session" ? nextPath : `/auth/login?next=${encodeURIComponent(nextPath)}`}>
                {complete === "session" ? (isSpanish ? "Continuar a SmartPR →" : "Continue to SmartPR →") : (isSpanish ? "Ir a iniciar sesión →" : "Go to log in →")}
              </Link>
            )}
          </div> : <form onSubmit={submit} noValidate>
            <h2>{isSpanish ? "Crea tu cuenta" : "Create your account"}</h2>
            <p className={styles.subhead}>{isSpanish ? "Toma cerca de 2 minutos. No requiere tarjeta de crédito." : "Takes about 2 minutes. No credit card required."}</p>

            <fieldset className={styles.intent}>
              <legend>{isSpanish ? "¿Qué harás hoy?" : "What are you doing today?"}</legend>
              <div><button type="button" aria-pressed={intent === "start"} className={intent === "start" ? styles.active : ""} onClick={() => setIntent("start")}>{isSpanish ? "Comenzar un negocio" : "Start a New Business"}</button><button type="button" aria-pressed={intent === "manage"} className={intent === "manage" ? styles.active : ""} onClick={() => setIntent("manage")}>{isSpanish ? "Administrar un negocio" : "Manage an Existing Business"}</button></div>
            </fieldset>

            <div className={styles.nameGrid}>
              <label>{t("First name")}<input required autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} placeholder="Maria" /></label>
              <label>{t("Last name")}<input required autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} placeholder="Rodríguez" /></label>
            </div>
            <label>{t("Work email")}<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="maria@negocio.com" /></label>
            <label>{t("Password")}
              <span className={styles.passwordField}><input required minLength={8} type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t("At least 8 characters")} /><button type="button" onClick={() => setShowPassword((show) => !show)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span>
            </label>
            <label>{t("Phone number")} <em>({t("optional")})</em><input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(787) 555-0123" /></label>
            <label>{t("I am a…")}<select value={role} onChange={(event) => setRole(event.target.value)}><option value="owner">{t("Business owner")}</option><option value="gestor">{t("Gestor")}</option><option value="cpa">{t("CPA / Accountant")}</option><option value="permitting">{t("Permitting firm")}</option><option value="attorney">{t("Attorney / Law firm")}</option></select></label>
            <label>{t("Business name")} <em>({t("optional")})</em><input value={businessName} onChange={(event) => setBusinessName(event.target.value)} placeholder={intent === "manage" ? "Luna Café LLC" : t("Your new business name")} /></label>

            <label className={styles.terms}><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /><span>{t("I agree to the")} <Link href="/privacy">{t("Privacy Policy")}</Link>.</span></label>
            {error && <div className={styles.error} role="alert">{error}</div>}
            <button className={styles.submitButton} disabled={!valid || busy} type="submit">{busy ? t("Creating account…") : t("Create Account")}</button>
            <p className={styles.existing}>{t("Already have an account?")} <Link href={`/auth/login?next=${encodeURIComponent(nextPath)}`}>{t("Log in")}</Link></p>
          </form>}
        </div>
        <Link className={styles.back} href={GUEST_INTAKE}>{isSpanish ? "Continuar sin cuenta" : "Continue without an account"}</Link>
        <Link className={styles.back} href="/">{t("← Back to smartpr.com")}</Link>
        <Link className={styles.back} href="/privacy">{t("Privacy Policy")}</Link>
      </section>
    </main>
  );
}

export default function SignupPage() {
  return <Suspense fallback={<div className={styles.loading}>Loading…</div>}><SignupForm /></Suspense>;
}
