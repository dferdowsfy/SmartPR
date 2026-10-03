"use client";

/**
 * FICTIONAL rehearsal clone of SURI's taxpayer-registration flow
 * (Registro de Contribuyente). Screens reproduce the field set recorded in
 * the SURI_REGISTER_TAXPAYER filing config — the layout is an approximation:
 * the real SURI host was unreachable during every walkthrough attempt
 * (2026-09-25, 2026-09-28), so nothing here was observed live. Each screen
 * declares data-smartpr-step / data-flow-step so tests can prove every Clara
 * request matches the visible screen. The "survey" screen is NOT in the
 * recorded flow — it simulates the portal changing, which Clara must treat
 * as unknown. Nothing is stored or sent anywhere.
 */
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  InlineError,
  PageSub,
  PageTitle,
  PortalCard,
  PrimaryButton,
  SelectInput,
  TextInput,
  useRehearsal,
  type RehearsalStep,
} from "../../rehearsal";

const ORDER = [
  "id_type_ssn",
  "taxpayer_verification",
  "correspondence",
  "merchant_info",
  "web_user",
  "review",
  "confirmation",
  "first_login",
  "otp",
  "dashboard",
] as const;

type Screen = (typeof ORDER)[number] | "survey";

const KIND: Record<Screen, RehearsalStep> = {
  id_type_ssn: "identity",
  taxpayer_verification: "identity",
  correspondence: "form",
  merchant_info: "form",
  web_user: "login",
  review: "review",
  confirmation: "submission",
  first_login: "login",
  otp: "identity",
  dashboard: "landing",
  survey: "unknown",
};

const TITLES: Record<Screen, [string, string]> = {
  id_type_ssn: ["Taxpayer identification", "Identificación del contribuyente"],
  taxpayer_verification: ["Verify your identity", "Verifique su identidad"],
  correspondence: ["Correspondence", "Correspondencia"],
  merchant_info: ["Merchant information", "Información del comerciante"],
  web_user: ["Create your web user", "Cree su usuario web"],
  review: ["Review and submit", "Revisión y envío"],
  confirmation: ["Registration confirmed", "Registro confirmado"],
  first_login: ["Sign in to SURI", "Inicie sesión en SURI"],
  otp: ["One-time code", "Código de un solo uso"],
  dashboard: ["SURI dashboard", "Panel de SURI"],
  survey: ["Tell us about your experience", "Cuéntenos sobre su experiencia"],
};

const DISCLAIMER: [string, string] = [
  "Fictional SURI taxpayer-registration rehearsal — NOT the real SURI. Nothing is stored or sent.",
  "Ensayo ficticio del registro de contribuyente de SURI — NO es el SURI real. Nada se guarda ni se envía.",
];

function RegisterWizardInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { t, data, setField } = useRehearsal();
  const [error, setError] = useState<string | null>(null);

  const raw = params.get("step");
  const screen: Screen = (ORDER as readonly string[]).includes(raw ?? "")
    ? (raw as Screen)
    : "id_type_ssn";

  const go = (s: Screen) =>
    router.push(`/rehearsal-portal/suri/register?step=${s}`);
  const next = () => {
    setError(null);
    const i = ORDER.indexOf(screen as (typeof ORDER)[number]);
    go(ORDER[Math.min(i + 1, ORDER.length - 1)]);
  };

  const field = (
    id: string,
    labelEn: string,
    labelEs: string,
    props: Partial<Parameters<typeof TextInput>[0]> = {}
  ) => (
    <TextInput
      id={`suri-reg-${id}`}
      name={id}
      label={t(labelEn, labelEs)}
      value={data[`suri_reg_${id}`] ?? ""}
      onChange={(v) => setField(`suri_reg_${id}`, v)}
      {...props}
    />
  );

  const submitIdSsn = (e: React.FormEvent) => {
    e.preventDefault();
    const ssn = data.suri_reg_ssn ?? "";
    const confirm = data.suri_reg_ssn_confirm ?? "";
    if (!/^\d{3}-?\d{2}-?\d{4}$/.test(ssn)) {
      setError(t("Enter a valid SSN (9 digits).", "Escriba un SSN válido (9 dígitos)."));
      return;
    }
    if (ssn.replace(/\D/g, "") !== confirm.replace(/\D/g, "")) {
      setError(
        t(
          "The SSN entries do not match. Re-enter both fields.",
          "Los SSN no coinciden. Vuelva a escribir ambos campos."
        )
      );
      return;
    }
    next();
  };

  const submitOtp = (e: React.FormEvent) => {
    e.preventDefault();
    if ((data.suri_reg_otp ?? "").replace(/\D/g, "") !== "000000") {
      setError(
        t(
          "Invalid code. (Rehearsal hint: the test code is 000000.)",
          "Código inválido. (Pista del ensayo: el código de prueba es 000000.)"
        )
      );
      return;
    }
    next();
  };

  const submitLogin = (e: React.FormEvent) => {
    e.preventDefault();
    const u = data.suri_reg_login_user ?? "";
    const p = data.suri_reg_login_pass ?? "";
    const createdUser = data.suri_reg_web_username ?? "";
    const createdPass = data.suri_reg_web_password ?? "";
    if (!u || !p) {
      setError(t("Enter your username and password.", "Escriba su usuario y contraseña."));
      return;
    }
    if (createdUser && u !== createdUser) {
      setError(
        t(
          "Unknown username. Use the web user you created during registration.",
          "Usuario desconocido. Use el usuario web que creó durante el registro."
        )
      );
      return;
    }
    if (createdPass && p !== createdPass) {
      setError(t("Incorrect password.", "Contraseña incorrecta."));
      return;
    }
    next();
  };

  const simple = (e: React.FormEvent) => {
    e.preventDefault();
    next();
  };

  return (
    <PortalCard step={KIND[screen]} flowStep={screen === "survey" ? undefined : screen}>
      {screen === "id_type_ssn" && (
        <form className="mt-2 space-y-4" onSubmit={submitIdSsn}>
          <PageTitle>{t(...TITLES.id_type_ssn)}</PageTitle>
          <PageSub>{t(...DISCLAIMER)}</PageSub>
          <SelectInput
            id="suri-reg-id-type"
            name="id_type"
            label={t("ID type", "Tipo de identificación")}
            value={data.suri_reg_id_type ?? ""}
            onChange={(v) => setField("suri_reg_id_type", v)}
            required
            options={[
              { value: "", label: "—" },
              { value: "ssn", label: t("Social Security Number", "Seguro Social") },
              { value: "ein", label: "EIN" },
            ]}
          />
          {field("ssn", "Social Security Number", "Seguro Social", {
            required: true,
            autoComplete: "off",
          })}
          {field("ssn_confirm", "Confirm Social Security Number", "Confirme el Seguro Social", {
            required: true,
            autoComplete: "off",
          })}
          {error && <InlineError>{error}</InlineError>}
          <PrimaryButton>{t("Continue", "Continuar")}</PrimaryButton>
        </form>
      )}

      {screen === "taxpayer_verification" && (
        <form className="mt-2 space-y-4" onSubmit={simple}>
          <PageTitle>{t(...TITLES.taxpayer_verification)}</PageTitle>
          <PageSub>
            {t(
              "Enter the verification amount from your most recently filed return.",
              "Escriba la cantidad de verificación de su planilla más reciente."
            )}
          </PageSub>
          {field("verification_amount", "Verification amount", "Cantidad de verificación", {
            required: true,
            autoComplete: "off",
          })}
          <PrimaryButton>{t("Verify", "Verificar")}</PrimaryButton>
        </form>
      )}

      {screen === "correspondence" && (
        <form className="mt-2 space-y-4" onSubmit={simple}>
          <PageTitle>{t(...TITLES.correspondence)}</PageTitle>
          <PageSub>
            {t(
              "A correspondence step appears here on the real portal. In this rehearsal, review the notice below and continue.",
              "En el portal real aparece aquí un paso de correspondencia. En este ensayo, revise el aviso y continúe."
            )}
          </PageSub>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
            {t(
              "Fictional notice: your identity documents are on file. No action needed to continue this rehearsal.",
              "Aviso ficticio: sus documentos de identidad están archivados. No se requiere acción para continuar este ensayo."
            )}
          </div>
          <PrimaryButton>{t("Continue", "Continuar")}</PrimaryButton>
        </form>
      )}

      {screen === "merchant_info" && (
        <form className="mt-2 space-y-4" onSubmit={simple}>
          <PageTitle>{t(...TITLES.merchant_info)}</PageTitle>
          <SelectInput
            id="suri-reg-merchant-role"
            name="merchant_role"
            label={t("Merchant role", "Rol del comerciante")}
            value={data.suri_reg_merchant_role ?? ""}
            onChange={(v) => setField("suri_reg_merchant_role", v)}
            required
            options={[
              { value: "", label: "—" },
              { value: "owner", label: t("Owner", "Dueño") },
              { value: "partner", label: t("Partner", "Socio") },
            ]}
          />
          {field("merchant_legal_name", "Legal name", "Nombre legal", { required: true })}
          {field("merchant_trade_name", "Trade name (DBA)", "Nombre comercial (DBA)")}
          {field("merchant_street", "Street address", "Dirección física", { required: true })}
          {field("merchant_municipality", "Municipality", "Municipio", { required: true })}
          {field("merchant_postal", "Postal code", "Código postal", { required: true })}
          {field("merchant_contact_name", "Contact full name", "Nombre del contacto", { required: true })}
          {field("merchant_contact_email", "Contact email", "Correo electrónico del contacto", {
            required: true,
            type: "email",
          })}
          {field("merchant_contact_phone", "Contact phone", "Teléfono del contacto", {
            required: true,
            type: "tel",
          })}
          <PrimaryButton>{t("Continue", "Continuar")}</PrimaryButton>
        </form>
      )}

      {screen === "web_user" && (
        <form className="mt-2 space-y-4" onSubmit={simple}>
          <PageTitle>{t(...TITLES.web_user)}</PageTitle>
          <PageSub>
            {t(
              "Choose the username and password you will use to sign in to SURI.",
              "Elija el usuario y la contraseña que usará para entrar a SURI."
            )}
          </PageSub>
          {field("web_username", "Username", "Nombre de usuario", { required: true, autoComplete: "off" })}
          {field("web_password", "Password", "Contraseña", {
            required: true,
            type: "password",
            autoComplete: "new-password",
          })}
          <SelectInput
            id="suri-reg-secret-q"
            name="secret_question"
            label={t("Secret question", "Pregunta secreta")}
            value={data.suri_reg_secret_q ?? ""}
            onChange={(v) => setField("suri_reg_secret_q", v)}
            required
            options={[
              { value: "", label: "—" },
              { value: "pet", label: t("What was your first pet's name?", "¿Cómo se llamaba su primera mascota?") },
              { value: "school", label: t("What elementary school did you attend?", "¿A qué escuela elemental asistió?") },
            ]}
          />
          {field("secret_a", "Secret answer", "Respuesta secreta", { required: true, autoComplete: "off" })}
          <PrimaryButton>{t("Create user", "Crear usuario")}</PrimaryButton>
        </form>
      )}

      {screen === "review" && (
        <form className="mt-2 space-y-4" onSubmit={simple}>
          <PageTitle>{t(...TITLES.review)}</PageTitle>
          <dl className="divide-y divide-slate-200 rounded-lg border border-slate-200">
            {[
              ["ID type", "Tipo de identificación", data.suri_reg_id_type],
              ["Legal name", "Nombre legal", data.suri_reg_merchant_legal_name],
              ["Trade name (DBA)", "Nombre comercial (DBA)", data.suri_reg_merchant_trade_name],
              ["Municipality", "Municipio", data.suri_reg_merchant_municipality],
              ["Contact email", "Correo del contacto", data.suri_reg_merchant_contact_email],
              ["Username", "Nombre de usuario", data.suri_reg_web_username],
            ].map(([en, es, v]) => (
              <div key={en} className="flex justify-between gap-4 px-4 py-2 text-sm">
                <dt className="font-semibold text-slate-700">{t(en, es)}</dt>
                <dd className="text-slate-900">{v || "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm font-semibold text-amber-800">
            {t(
              "Submitting creates the taxpayer account — only the human clicks it. Clara stops here.",
              "Enviar crea la cuenta del contribuyente — solo la persona lo presiona. Clara se detiene aquí."
            )}
          </p>
          <PrimaryButton>{t("Submit registration (human only)", "Enviar registro (solo la persona)")}</PrimaryButton>
        </form>
      )}

      {screen === "confirmation" && (
        <form className="mt-2 space-y-3" onSubmit={simple}>
          <PageTitle>{t(...TITLES.confirmation)}</PageTitle>
          <p className="text-sm text-slate-700">
            {t(
              "Your taxpayer registration was submitted successfully.",
              "Su registro de contribuyente fue enviado exitosamente."
            )}
          </p>
          <p className="text-lg font-bold text-slate-900">
            {t("Confirmation number:", "Número de confirmación:")}{" "}
            <span data-testid="suri-reg-confirmation">SURI-2026-482913</span>
          </p>
          <PrimaryButton>{t("Continue to sign in", "Continuar al inicio de sesión")}</PrimaryButton>
        </form>
      )}

      {screen === "first_login" && (
        <form className="mt-2 space-y-4" onSubmit={submitLogin}>
          <PageTitle>{t(...TITLES.first_login)}</PageTitle>
          <PageSub>
            {t(
              "Sign in with the web user you just created.",
              "Inicie sesión con el usuario web que acaba de crear."
            )}
          </PageSub>
          {field("login_user", "Username", "Nombre de usuario", { required: true, autoComplete: "username" })}
          {field("login_pass", "Password", "Contraseña", {
            required: true,
            type: "password",
            autoComplete: "current-password",
          })}
          {error && <InlineError>{error}</InlineError>}
          <PrimaryButton>{t("Sign in", "Iniciar sesión")}</PrimaryButton>
        </form>
      )}

      {screen === "otp" && (
        <form className="mt-2 space-y-4" onSubmit={submitOtp}>
          <PageTitle>{t(...TITLES.otp)}</PageTitle>
          <PageSub>
            {t(
              "We sent a one-time code to your device. Enter it below.",
              "Enviamos un código de un solo uso a su dispositivo. Escríbalo abajo."
            )}
          </PageSub>
          {field("otp", "One-time code", "Código de un solo uso", { required: true, autoComplete: "off" })}
          {error && <InlineError>{error}</InlineError>}
          <PrimaryButton>{t("Verify", "Verificar")}</PrimaryButton>
        </form>
      )}

      {screen === "dashboard" && (
        <div className="mt-2 space-y-3">
          <PageTitle>{t(...TITLES.dashboard)}</PageTitle>
          <p className="text-sm text-slate-700">
            {t(
              "You are signed in. This rehearsal dashboard mirrors what an authenticated SURI session shows after registration.",
              "Ha iniciado sesión. Este panel ficticio refleja lo que muestra una sesión autenticada de SURI tras el registro."
            )}
          </p>
          <dl className="divide-y divide-slate-200 rounded-lg border border-slate-200">
            {[
              ["Taxpayer", "Contribuyente", data.suri_reg_merchant_legal_name],
              ["Username", "Usuario", data.suri_reg_web_username],
              ["Status", "Estatus", t("Active", "Activo")],
            ].map(([en, es, v]) => (
              <div key={en} className="flex justify-between gap-4 px-4 py-2 text-sm">
                <dt className="font-semibold text-slate-700">{t(en, es)}</dt>
                <dd className="text-slate-900">{v || "—"}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {screen === "survey" && (
        <div className="mt-2 space-y-4">
          <PageTitle>{t(...TITLES.survey)}</PageTitle>
          <p className="text-sm text-slate-700">
            {t(
              "This screen does not belong to the recorded flow — the portal changed. Clara must pause and report it as unknown instead of guessing.",
              "Esta pantalla no pertenece al flujo registrado — el portal cambió. Clara debe pausar e informarla como desconocida en lugar de adivinar."
            )}
          </p>
        </div>
      )}
    </PortalCard>
  );
}

export default function SuriRegisterPage() {
  return (
    <Suspense>
      <RegisterWizardInner />
    </Suspense>
  );
}
