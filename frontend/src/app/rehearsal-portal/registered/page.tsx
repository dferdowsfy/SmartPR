"use client";

import { useRouter } from "next/navigation";
import {
  PageSub,
  PageTitle,
  PortalCard,
  PrimaryButton,
  useRehearsal,
} from "../rehearsal";

/**
 * Post-registration landing — the demo portal issues a FICTIONAL registry
 * number for the brand-new account and sends the filer STRAIGHT to the
 * filing form. There is no entity search on the registration path: a new
 * registration cannot have a registry number to search for.
 */
export default function RehearsalRegisteredPage() {
  const { t, data } = useRehearsal();
  const router = useRouter();
  const fictionalNumber = data.fictionalRegistryNumber || "482916";

  return (
    <PortalCard step="form">
      <PageTitle>{t("Account created", "Cuenta creada")}</PageTitle>
      <PageSub>
        {t(
          "Demo only — this account and registry number are fictional.",
          "Solo demo — esta cuenta y este número de registro son ficticios."
        )}
      </PageSub>

      <div className="mt-6 rounded-xl border border-emerald-300 bg-emerald-50 p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">
          {t("Your fictional registry number", "Tu número de registro ficticio")}
        </p>
        <p className="mt-1 text-3xl font-extrabold tracking-[0.2em] text-emerald-950">
          {fictionalNumber}
        </p>
        <p className="mt-2 text-sm text-emerald-900">
          {t(
            "No search needed — continue straight to your filing.",
            "No necesitas buscar — continúa directo a tu radicación."
          )}
        </p>
      </div>

      <form
        className="mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          router.push("/rehearsal-portal/filing");
        }}
      >
        <PrimaryButton>
          {t("Continue to filing", "Continuar a la radicación")}
        </PrimaryButton>
      </form>
    </PortalCard>
  );
}
