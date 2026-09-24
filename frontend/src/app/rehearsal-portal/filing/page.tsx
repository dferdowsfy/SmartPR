"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckRow,
  PageSub,
  PageTitle,
  PortalCard,
  PrimaryButton,
  RadioGroup,
  SelectInput,
  TextAreaInput,
  TextInput,
  useRehearsal,
} from "../rehearsal";

/**
 * Rehearsal annual-report form. Full field variety for prefill testing.
 *
 * DETERMINISTIC VALIDATION: the FIRST submit always fails on exactly one
 * correctable field (phone format) with an inline portal error, so the
 * rehearsal exercises the humanized-error-surfacing path in chat. The
 * SECOND submit succeeds. (Local component state — deterministic per visit.)
 */
export default function RehearsalFilingPage() {
  const { t, data, setField } = useRehearsal();
  const router = useRouter();
  const [attempts, setAttempts] = useState(0);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (attempts === 0) {
      setAttempts(1);
      setPhoneError(
        t(
          "Phone number must have 10 digits.",
          "El número de teléfono debe tener 10 dígitos."
        )
      );
      return;
    }
    setPhoneError(null);
    router.push("/rehearsal-portal/ssn");
  };

  return (
    <PortalCard>
      <PageTitle>{t("Annual report (rehearsal)", "Informe anual (ensayo)")}</PageTitle>
      <PageSub>
        {t(
          "Fictional filing for DEMO ENTITY LLC. All fields are local to this rehearsal.",
          "Radicación ficticia para DEMO ENTITY LLC. Todos los campos son locales a este ensayo."
        )}
      </PageSub>
      <form className="mt-6 space-y-5" onSubmit={submit}>
        <TextInput
          id="filing-contact-name"
          name="contactName"
          label={t("Contact full name", "Nombre completo del contacto")}
          value={data.contactName ?? ""}
          onChange={(v) => setField("contactName", v)}
          required
          autoComplete="name"
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput
            id="filing-email"
            name="email"
            type="email"
            label={t("Email", "Correo electrónico")}
            value={data.contactEmail ?? ""}
            onChange={(v) => setField("contactEmail", v)}
            required
            autoComplete="email"
          />
          <TextInput
            id="filing-phone"
            name="phone"
            type="tel"
            label={t("Phone (10 digits)", "Teléfono (10 dígitos)")}
            value={data.contactPhone ?? ""}
            onChange={(v) => {
              setField("contactPhone", v);
              setPhoneError(null);
            }}
            required
            autoComplete="tel"
            placeholder="7875550100"
            error={phoneError}
          />
        </div>
        <TextInput
          id="filing-street"
          name="street"
          label={t("Street address", "Dirección física")}
          value={data.street ?? ""}
          onChange={(v) => setField("street", v)}
          required
          autoComplete="street-address"
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <TextInput
            id="filing-city"
            name="city"
            label={t("City", "Ciudad")}
            value={data.city ?? ""}
            onChange={(v) => setField("city", v)}
            required
            autoComplete="address-level2"
          />
          <TextInput
            id="filing-postal"
            name="postalCode"
            label={t("Postal code", "Código postal")}
            value={data.postalCode ?? ""}
            onChange={(v) => setField("postalCode", v)}
            required
            autoComplete="postal-code"
            placeholder="00901"
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <SelectInput
            id="filing-entity-type"
            name="entityType"
            label={t("Entity type", "Tipo de entidad")}
            value={data.entityType ?? ""}
            onChange={(v) => setField("entityType", v)}
            required
            options={[
              { value: "sole_prop", label: t("Sole proprietorship", "Negocio por cuenta propia") },
              { value: "llc", label: t("Limited Liability Company (LLC)", "Sociedad de Responsabilidad Limitada (LLC)") },
              { value: "corp", label: t("Corporation", "Corporación") },
              { value: "nonprofit", label: t("Nonprofit organization", "Organización sin fines de lucro") },
            ]}
          />
          <TextInput
            id="filing-fiscal-year"
            name="fiscalYearEnd"
            type="date"
            label={t("Fiscal year end", "Cierre del año fiscal")}
            value={data.fiscalYearEnd ?? ""}
            onChange={(v) => setField("fiscalYearEnd", v)}
            required
          />
        </div>
        <RadioGroup
          name="profitStatus"
          label={t("Profit status", "Fines de lucro")}
          value={data.profitStatus ?? ""}
          onChange={(v) => setField("profitStatus", v)}
          options={[
            { value: "for-profit", label: t("For-profit", "Con fines de lucro") },
            { value: "nonprofit", label: t("Nonprofit", "Sin fines de lucro") },
          ]}
        />
        <div className="space-y-2">
          <CheckRow
            id="filing-cert-true"
            name="certTrue"
            label={t(
              "The information provided is true and correct.",
              "La información provista es verdadera y correcta."
            )}
            checked={data.certTrue === "yes"}
            onChange={(v) => setField("certTrue", v ? "yes" : "")}
          />
          <CheckRow
            id="filing-cert-standing"
            name="certStanding"
            label={t(
              "The entity is in good standing.",
              "La entidad está en cumplimiento (good standing)."
            )}
            checked={data.certStanding === "yes"}
            onChange={(v) => setField("certStanding", v ? "yes" : "")}
          />
        </div>
        <TextAreaInput
          id="filing-activity"
          name="activity"
          label={t("Business activity description", "Descripción de la actividad del negocio")}
          value={data.activity ?? ""}
          onChange={(v) => setField("activity", v)}
          rows={3}
        />
        <PrimaryButton>{t("Continue", "Continuar")}</PrimaryButton>
      </form>
    </PortalCard>
  );
}
