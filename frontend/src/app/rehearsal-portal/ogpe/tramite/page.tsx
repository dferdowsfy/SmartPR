"use client";

/**
 * FICTIONAL rehearsal clone of OGPe's Single Business Portal Permiso Único
 * flow. Screens reproduce the field set recorded in the OGPE_PERMISO_UNICO
 * filing config — the layout is an approximation: the post-login SBP walk
 * is partially observed (uploads, payment and submission were never
 * observed live), so those screens are clearly marked approximations. Each
 * screen declares data-smartpr-step / data-flow-step so tests can prove
 * every Clara request matches the visible screen. The "survey" screen is NOT
 * in the recorded flow — it simulates the portal changing, which Clara must
 * treat as unknown. Nothing is stored or sent anywhere.
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
  "login",
  "crear_solicitud",
  "crear_proyecto",
  "permiso_unico",
  "anejos",
  "pago",
  "confirmacion",
] as const;

type Screen = (typeof ORDER)[number] | "survey";

const KIND: Record<Screen, RehearsalStep> = {
  login: "login",
  crear_solicitud: "form",
  crear_proyecto: "form",
  permiso_unico: "form",
  anejos: "upload",
  pago: "payment",
  confirmacion: "submission",
  survey: "unknown",
};

const TITLES: Record<Screen, [string, string]> = {
  login: ["Single Business Portal — Sign in", "Portal Único de Negocios — Acceder"],
  crear_solicitud: ["Crear Solicitud", "Crear Solicitud"],
  crear_proyecto: ["Crear Proyecto", "Crear Proyecto"],
  permiso_unico: ["Permiso Único", "Permiso Único"],
  anejos: ["Anejos — required uploads", "Anejos — documentos requeridos"],
  pago: ["Payment", "Pago"],
  confirmacion: ["Solicitud confirmada", "Application confirmed"],
  survey: ["Tell us about your experience", "Cuéntenos sobre su experiencia"],
};

const DISCLAIMER: [string, string] = [
  "Fictional OGPe Single Business Portal rehearsal — NOT the real portal. Nothing is stored or sent.",
  "Ensayo ficticio del Portal Único de Negocios de OGPe — NO es el portal real. Nada se guarda ni se envía.",
];

function OgpeWizardInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { t, data, setField } = useRehearsal();
  const [error, setError] = useState<string | null>(null);

  const raw = params.get("step");
  const screen: Screen = (ORDER as readonly string[]).includes(raw ?? "")
    ? (raw as Screen)
    : "login";

  const go = (s: Screen) =>
    router.push(`/rehearsal-portal/ogpe/tramite?step=${s}`);
  const next = () => {
    setError(null);
    const i = ORDER.indexOf(screen as (typeof ORDER)[number]);
    go(ORDER[Math.min(i + 1, ORDER.length - 1)]);
  };
  const simple = (e: React.FormEvent) => {
    e.preventDefault();
    next();
  };

  const field = (
    id: string,
    labelEn: string,
    labelEs: string,
    props: Partial<Parameters<typeof TextInput>[0]> = {}
  ) => (
    <TextInput
      id={`ogpe-${id}`}
      name={id}
      label={t(labelEn, labelEs)}
      value={data[`ogpe_${id}`] ?? ""}
      onChange={(v) => setField(`ogpe_${id}`, v)}
      {...props}
    />
  );

  const submitLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!data.ogpe_login_user || !data.ogpe_login_pass) {
      setError(t("Enter your username and password.", "Escriba su usuario y contraseña."));
      return;
    }
    next();
  };

  return (
    <PortalCard step={KIND[screen]} flowStep={screen === "survey" ? undefined : screen}>
      {screen === "login" && (
        <form className="mt-2 space-y-4" onSubmit={submitLogin}>
          <PageTitle>{t(...TITLES.login)}</PageTitle>
          <PageSub>{t(...DISCLAIMER)}</PageSub>
          {field("login_user", "Username", "Nombre de usuario", {
            required: true,
            autoComplete: "username",
          })}
          {field("login_pass", "Password", "Contraseña", {
            required: true,
            type: "password",
            autoComplete: "current-password",
          })}
          {error && <InlineError>{error}</InlineError>}
          <PrimaryButton>{t("Sign in", "Acceder")}</PrimaryButton>
        </form>
      )}

      {screen === "crear_solicitud" && (
        <form className="mt-2 space-y-4" onSubmit={simple}>
          <PageTitle>{t(...TITLES.crear_solicitud)}</PageTitle>
          <PageSub>
            {t(
              "Select the application type for this solicitud.",
              "Seleccione el tipo de solicitud."
            )}
          </PageSub>
          <SelectInput
            id="ogpe-solicitud-type"
            name="solicitud_type"
            label={t("Application type", "Tipo de solicitud")}
            value={data.ogpe_solicitud_type ?? ""}
            onChange={(v) => setField("ogpe_solicitud_type", v)}
            required
            options={[
              { value: "", label: "—" },
              { value: "permiso_unico", label: "Permiso Único" },
              { value: "permiso_construccion", label: t("Construction Permit", "Permiso de Construcción") },
              { value: "consulta_ubicacion", label: t("Location Consultation", "Consulta de Ubicación") },
            ]}
          />
          <PrimaryButton>{t("Continue", "Continuar")}</PrimaryButton>
        </form>
      )}

      {screen === "crear_proyecto" && (
        <form className="mt-2 space-y-4" onSubmit={simple}>
          <PageTitle>{t(...TITLES.crear_proyecto)}</PageTitle>
          {field("project_name", "Project name", "Nombre del proyecto", { required: true })}
          {field("project_legal_name", "Legal name", "Nombre legal", { required: true })}
          {field("project_trade_name", "Trade name (DBA)", "Nombre comercial (DBA)")}
          <SelectInput
            id="ogpe-project-entity-type"
            name="entity_type"
            label={t("Entity type", "Tipo de entidad")}
            value={data.ogpe_project_entity_type ?? ""}
            onChange={(v) => setField("ogpe_project_entity_type", v)}
            required
            options={[
              { value: "", label: "—" },
              { value: "llc", label: t("Limited Liability Company", "Sociedad de Responsabilidad Limitada") },
              { value: "corp", label: t("Corporation", "Corporación") },
              { value: "sole", label: t("Sole proprietorship", "Negocio propio") },
            ]}
          />
          {field("project_street", "Street address", "Dirección física", { required: true })}
          {field("project_street2", "Street address line 2", "Dirección física línea 2")}
          {field("project_municipality", "Municipality", "Municipio", { required: true })}
          {field("project_postal", "Postal code", "Código postal", { required: true })}
          {field("project_contact_name", "Contact full name", "Nombre del contacto", { required: true })}
          {field("project_contact_email", "Contact email", "Correo electrónico del contacto", {
            required: true,
            type: "email",
          })}
          {field("project_contact_phone", "Contact phone", "Teléfono del contacto", {
            required: true,
            type: "tel",
          })}
          <PrimaryButton>{t("Save project", "Guardar proyecto")}</PrimaryButton>
        </form>
      )}

      {screen === "permiso_unico" && (
        <form className="mt-2 space-y-4" onSubmit={simple}>
          <PageTitle>{t(...TITLES.permiso_unico)}</PageTitle>
          <PageSub>
            {t(
              "Complete the Permiso Único application for the project.",
              "Complete la solicitud de Permiso Único para el proyecto."
            )}
          </PageSub>
          {field("permiso_legal_name", "Legal name", "Nombre legal", { required: true })}
          {field("permiso_street", "Physical location address", "Dirección física del local", {
            required: true,
          })}
          {field("permiso_municipality", "Municipality", "Municipio", { required: true })}
          {field("permiso_postal", "Postal code", "Código postal", { required: true })}
          {field("permiso_contact_email", "Contact email", "Correo electrónico del contacto", {
            required: true,
            type: "email",
          })}
          {field("permiso_contact_phone", "Contact phone", "Teléfono del contacto", {
            required: true,
            type: "tel",
          })}
          <PrimaryButton>{t("Continue", "Continuar")}</PrimaryButton>
        </form>
      )}

      {screen === "anejos" && (
        <form className="mt-2 space-y-4" onSubmit={simple}>
          <PageTitle>{t(...TITLES.anejos)}</PageTitle>
          <PageSub>
            {t(
              "Approximation — the real anejos list was never observed. Upload the required documents.",
              "Aproximación — la lista real de anejos nunca fue observada. Suba los documentos requeridos."
            )}
          </PageSub>
          {[
            ["plano", "Location plan", "Plano de ubicación"],
            ["escritura", "Deed or lease agreement", "Escritura o contrato de arrendamiento"],
            ["deuda", "Tax debt certification", "Certificación de deuda contributiva"],
          ].map(([id, en, es]) => (
            <div key={id}>
              <label
                htmlFor={`ogpe-anejo-${id}`}
                className="block text-sm font-semibold text-slate-700"
              >
                {t(en, es)} <span className="text-rose-600">*</span>
              </label>
              <input
                id={`ogpe-anejo-${id}`}
                name={`anejo_${id}`}
                type="file"
                className="mt-1 block w-full text-sm text-slate-700"
              />
            </div>
          ))}
          <PrimaryButton>{t("Continue to payment", "Continuar al pago")}</PrimaryButton>
        </form>
      )}

      {screen === "pago" && (
        <div className="mt-2 space-y-4">
          <PageTitle>{t(...TITLES.pago)}</PageTitle>
          <PageSub>
            {t(
              "Approximation — the real payment screen was never observed. Payment details are a human gate: Clara never enters card data.",
              "Aproximación — la pantalla real de pago nunca fue observada. El pago es un paso humano: Clara nunca ingresa datos de tarjeta."
            )}
          </PageSub>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              next();
            }}
          >
            {field("card_number", "Card number", "Número de tarjeta", {
              required: true,
              autoComplete: "off",
            })}
            <div className="grid grid-cols-2 gap-4">
              {field("card_exp", "Expiry (MM/YY)", "Vencimiento (MM/AA)", { required: true, autoComplete: "off" })}
              {field("card_cvc", "CVC", "CVC", { required: true, autoComplete: "off" })}
            </div>
            <PrimaryButton>{t("Pay (human only)", "Pagar (solo la persona)")}</PrimaryButton>
          </form>
        </div>
      )}

      {screen === "confirmacion" && (
        <div className="mt-2 space-y-3">
          <PageTitle>{t(...TITLES.confirmacion)}</PageTitle>
          <p className="text-sm text-slate-700">
            {t(
              "Your Permiso Único solicitud was submitted successfully.",
              "Su solicitud de Permiso Único fue enviada exitosamente."
            )}
          </p>
          <p className="text-lg font-bold text-slate-900">
            {t("Confirmation number:", "Número de confirmación:")}{" "}
            <span data-testid="ogpe-confirmation">OGPE-2026-711684</span>
          </p>
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

export default function OgpeTramitePage() {
  return (
    <Suspense>
      <OgpeWizardInner />
    </Suspense>
  );
}
