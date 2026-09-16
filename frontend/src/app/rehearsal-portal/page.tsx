"use client";

import Link from "next/link";
import { PageSub, PageTitle, PortalCard, useRehearsal } from "./rehearsal";

export default function RehearsalLandingPage() {
  const { t } = useRehearsal();
  return (
    <PortalCard>
      <PageTitle>{t("Demo Filing Portal", "Portal de Radicación Demo")}</PageTitle>
      <PageSub>
        {t(
          "A fictional portal for SmartPR filing rehearsals. No real entity, no real credentials, no government system — everything here is make-believe.",
          "Un portal ficticio para ensayos de radicación de SmartPR. Ninguna entidad real, ninguna credencial real, ningún sistema del gobierno — todo aquí es de mentira."
        )}
      </PageSub>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link
          href="/rehearsal-portal/login"
          className="rounded-xl border-2 border-slate-900 bg-white px-5 py-6 text-center transition hover:bg-slate-900 hover:text-white"
        >
          <span className="block text-base font-extrabold">{t("Log in", "Iniciar sesión")}</span>
          <span className="mt-1 block text-xs opacity-70">
            {t("I already have a demo account", "Ya tengo una cuenta demo")}
          </span>
        </Link>
        <Link
          href="/rehearsal-portal/register"
          className="rounded-xl border-2 border-slate-900 bg-white px-5 py-6 text-center transition hover:bg-slate-900 hover:text-white"
        >
          <span className="block text-base font-extrabold">{t("Create account", "Crear cuenta")}</span>
          <span className="mt-1 block text-xs opacity-70">
            {t("I'm new to this portal", "Soy nuevo en este portal")}
          </span>
        </Link>
      </div>
    </PortalCard>
  );
}
