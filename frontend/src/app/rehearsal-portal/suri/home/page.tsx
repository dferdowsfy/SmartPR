"use client";

import { useRouter } from "next/navigation";
import { PageSub, PageTitle, PortalCard, useRehearsal } from "../../rehearsal";

/**
 * FICTIONAL SURI home after login — the post-login menu Clara must navigate
 * to find the merchant-registration path (Registro de Comerciante).
 */
export default function SuriRehearsalHome() {
  const { t } = useRehearsal();
  const router = useRouter();
  const items = [
    { key: "register", label: t("Registro de Comerciante", "Registro de Comerciante"), target: "/rehearsal-portal/suri/merchant?step=merchant_info" },
    { key: "taxes", label: t("File and pay taxes", "Radicar y pagar contribuciones"), target: "/rehearsal-portal/suri/home" },
    { key: "accounts", label: t("My accounts", "Mis cuentas"), target: "/rehearsal-portal/suri/home" },
  ];
  return (
    <PortalCard step="form" flowStep="dashboard">
      <PageTitle>{t("Welcome to SURI", "Bienvenido a SURI")}</PageTitle>
      <PageSub>
        {t(
          "Choose a service. Fictional rehearsal clone — NOT the real SURI.",
          "Elija un servicio. Clon ficticio de ensayo — NO es el SURI real."
        )}
      </PageSub>
      <div className="mt-6 space-y-3">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={() => router.push(it.target)}
            className="block w-full rounded-lg border border-slate-300 bg-white px-4 py-3 text-left font-semibold text-slate-800 hover:border-slate-500"
          >
            {it.label}
          </button>
        ))}
      </div>
    </PortalCard>
  );
}
