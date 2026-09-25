"use client";

import { useRouter } from "next/navigation";
import { PageSub, PageTitle, PortalCard, PrimaryButton, useRehearsal } from "../rehearsal";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-slate-100 py-2 sm:flex-row sm:gap-4">
      <dt className="w-48 shrink-0 text-xs font-bold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm text-slate-900">{value || "—"}</dd>
    </div>
  );
}

/** Final review — summary of everything entered. Agent stops here; human submits. */
export default function RehearsalReviewPage() {
  const { t, data } = useRehearsal();
  const router = useRouter();
  const masked = (v?: string) => (v ? "••••" : "—");

  return (
    <PortalCard step="review">
      <PageTitle>{t("Review before submitting", "Revisa antes de enviar")}</PageTitle>
      <PageSub>
        {t(
          "A human must review and take this final step. Nothing here is sent anywhere real.",
          "Una persona debe revisar y dar este último paso. Nada aquí se envía a ningún lugar real."
        )}
      </PageSub>
      <dl className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2">
        <Row label={t("Entity", "Entidad")} value="DEMO ENTITY LLC" />
        <Row label={t("Registry number", "Número de registro")} value={data.registryNumber ?? ""} />
        <Row label={t("Contact", "Contacto")} value={data.contactName ?? ""} />
        <Row label={t("Email", "Correo electrónico")} value={data.contactEmail ?? ""} />
        <Row label={t("Phone", "Teléfono")} value={data.contactPhone ?? ""} />
        <Row
          label={t("Address", "Dirección")}
          value={[data.street, data.city, data.postalCode].filter(Boolean).join(", ")}
        />
        <Row label={t("Entity type", "Tipo de entidad")} value={data.entityType ?? ""} />
        <Row label={t("Profit status", "Fines de lucro")} value={data.profitStatus ?? ""} />
        <Row label={t("Fiscal year end", "Cierre del año fiscal")} value={data.fiscalYearEnd ?? ""} />
        <Row label={t("Activity", "Actividad")} value={data.activity ?? ""} />
        <Row label={t("SSN", "Seguro Social")} value={masked(data.ssn)} />
        <Row label={t("Signature", "Firma")} value={data.attestSignature ?? ""} />
        <Row label={t("Card", "Tarjeta")} value={masked(data.cardNumber)} />
      </dl>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          router.push("/rehearsal-portal/success");
        }}
      >
        <PrimaryButton>{t("Submit filing", "Enviar radicación")}</PrimaryButton>
      </form>
    </PortalCard>
  );
}
