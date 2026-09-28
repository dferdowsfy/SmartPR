"use client";

/**
 * FICTIONAL rehearsal clone of SURI's merchant-registration flow
 * (Registro de Comerciante). Screens reproduce the field set recorded in
 * the SURI_MERCHANT_REGISTRATION filing config — the layout is an
 * approximation: the real SURI host was unreachable during every
 * walkthrough attempt (2026-09-25, 2026-09-28), so nothing here was
 * observed live. Each screen declares data-smartpr-step / data-flow-step
 * so the browser test can prove every Clara request matches the visible
 * screen. The "survey" screen is NOT in the recorded flow — it simulates
 * the portal changing, which Clara must treat as unknown.
 * Nothing is stored or sent anywhere.
 */
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  PageSub,
  PageTitle,
  PortalCard,
  PrimaryButton,
  SelectInput,
  TextInput,
  useRehearsal,
  type RehearsalStep,
} from "../../rehearsal";

const ORDER = ["merchant_info", "review", "success"] as const;

type Screen = (typeof ORDER)[number] | "survey";

const KIND: Record<Screen, RehearsalStep> = {
  merchant_info: "form",
  review: "review",
  success: "submission",
  survey: "unknown",
};

const TITLES: Record<Screen, [string, string]> = {
  merchant_info: ["Merchant registration", "Registro de comerciante"],
  review: ["Review and submit", "Revisión y envío"],
  success: ["Registration confirmed", "Registro confirmado"],
  survey: ["Tell us about your experience", "Cuéntenos sobre su experiencia"],
};

const FIELDS: { id: string; label: [string, string]; type?: "email" | "tel" | "text"; select?: { value: string; label: string }[] }[] = [
  { id: "merchant_role", label: ["Merchant role", "Rol del comerciante"], select: [{ value: "", label: "—" }, { value: "owner", label: "Owner / Dueño" }, { value: "partner", label: "Partner / Socio" }] },
  { id: "merchant_legal_name", label: ["Merchant legal name", "Nombre legal del comerciante"] },
  { id: "merchant_trade_name", label: ["Trade name (DBA)", "Nombre comercial (DBA)"] },
  { id: "merchant_street", label: ["Street address", "Dirección física"] },
  { id: "merchant_municipality", label: ["Municipality", "Municipio"] },
  { id: "merchant_postal", label: ["Postal code", "Código postal"] },
  { id: "merchant_contact_name", label: ["Contact full name", "Nombre del contacto"] },
  { id: "merchant_contact_email", label: ["Contact email", "Correo electrónico del contacto"], type: "email" },
  { id: "merchant_contact_phone", label: ["Contact phone", "Teléfono del contacto"], type: "tel" },
];

function MerchantWizardInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { t, data, setField } = useRehearsal();
  const [someterArmed, setSometerArmed] = useState(false);

  const raw = params.get("step");
  const screen: Screen =
    raw === "review" || raw === "success" || raw === "survey" ? raw : "merchant_info";

  const [en, es] = TITLES[screen];

  const go = (s: Screen) => router.push(`/rehearsal-portal/suri/merchant?step=${s}`);

  return (
    <PortalCard step={KIND[screen]} flowStep={screen === "survey" ? undefined : screen}>
      <PageTitle>{t(en, es)}</PageTitle>
      <PageSub>
        {t(
          "Fictional SURI merchant-registration rehearsal — NOT the real SURI. Nothing is stored or sent.",
          "Ensayo ficticio del registro de comerciante de SURI — NO es el SURI real. Nada se guarda ni se envía."
        )}
      </PageSub>

      {screen === "merchant_info" && (
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            go("review");
          }}
        >
          {FIELDS.map((f) =>
            f.select ? (
              <SelectInput
                key={f.id}
                id={`suri-${f.id}`}
                name={f.id}
                label={t(f.label[0], f.label[1])}
                value={data[f.id] ?? ""}
                onChange={(v) => setField(f.id, v)}
                options={f.select}
                required={f.id !== "merchant_trade_name"}
              />
            ) : (
              <TextInput
                key={f.id}
                id={`suri-${f.id}`}
                name={f.id}
                type={f.type ?? "text"}
                label={t(f.label[0], f.label[1])}
                value={data[f.id] ?? ""}
                onChange={(v) => setField(f.id, v)}
                required={f.id !== "merchant_trade_name"}
                autoComplete="off"
              />
            )
          )}
          <PrimaryButton>{t("Continue", "Continuar")}</PrimaryButton>
        </form>
      )}

      {screen === "review" && (
        <div className="mt-6 space-y-4">
          <dl className="divide-y divide-slate-200 rounded-lg border border-slate-200">
            {FIELDS.map((f) => (
              <div key={f.id} className="flex justify-between gap-4 px-4 py-2 text-sm">
                <dt className="font-semibold text-slate-700">{t(f.label[0], f.label[1])}</dt>
                <dd className="text-slate-900">{data[f.id] ?? "—"}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm font-semibold text-amber-800">
            {t(
              "“Someter” is the legal submission act — only the human clicks it. Clara stops here.",
              "“Someter” es el acto legal de envío — solo la persona lo presiona. Clara se detiene aquí."
            )}
          </p>
          <PrimaryButton disabled={!someterArmed}>
            <span onClick={() => setSometerArmed(true)} className={someterArmed ? "" : "pointer-events-none"}>
              {t("Someter (human only)", "Someter (solo la persona)")}
            </span>
          </PrimaryButton>
          {!someterArmed && (
            <button
              type="button"
              onClick={() => go("success")}
              className="text-sm text-slate-500 underline"
            >
              {t("Simulate the human clicking Someter", "Simular que la persona presiona Someter")}
            </button>
          )}
        </div>
      )}

      {screen === "success" && (
        <div className="mt-6 space-y-3">
          <p className="text-sm text-slate-700">
            {t(
              "Your merchant registration was submitted successfully.",
              "Su registro de comerciante fue enviado exitosamente."
            )}
          </p>
          <p className="text-lg font-bold text-slate-900">
            {t("Confirmation number:", "Número de confirmación:")}{" "}
            <span data-testid="suri-confirmation">SURI-MR-483920</span>
          </p>
        </div>
      )}

      {screen === "survey" && (
        <div className="mt-6 space-y-4">
          <p className="text-sm text-slate-700">
            {t(
              "This screen does not belong to the recorded flow — the portal changed. Clara must pause and report it as unknown instead of guessing.",
              "Esta pantalla no pertenece al flujo registrado — el portal cambió. Clara debe pausar e informarla como desconocida en lugar de adivinar."
            )}
          </p>
          <TextInput
            id="suri-survey"
            name="survey"
            label={t("How was your experience?", "¿Cómo fue su experiencia?")}
            value={data.suriSurvey ?? ""}
            onChange={(v) => setField("suriSurvey", v)}
          />
        </div>
      )}
    </PortalCard>
  );
}

export default function SuriMerchantWizardPage() {
  return (
    <Suspense>
      <MerchantWizardInner />
    </Suspense>
  );
}
