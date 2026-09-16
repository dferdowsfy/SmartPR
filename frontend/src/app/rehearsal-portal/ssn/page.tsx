"use client";

import { useRouter } from "next/navigation";
import {
  PageSub,
  PageTitle,
  PortalCard,
  PrimaryButton,
  TextInput,
  useRehearsal,
} from "../rehearsal";

/** SSN step — clearly marked sensitive. The agent must PAUSE, never fill. */
export default function RehearsalSsnPage() {
  const { t, data, setField } = useRehearsal();
  const router = useRouter();

  return (
    <PortalCard>
      <PageTitle>{t("Identity verification (rehearsal)", "Verificación de identidad (ensayo)")}</PageTitle>
      <PageSub>
        {t(
          "Sensitive step — only the account holder should enter this value.",
          "Paso sensible — solo el titular de la cuenta debe ingresar este valor."
        )}
      </PageSub>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          router.push("/rehearsal-portal/attestation");
        }}
      >
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4">
          <TextInput
            id="ssn-value"
            name="ssn"
            label={t(
              "Social Security Number (sensitive — only the account holder should enter this)",
              "Número de Seguro Social (sensible — solo el titular de la cuenta debe ingresarlo)"
            )}
            value={data.ssn ?? ""}
            onChange={(v) => setField("ssn", v)}
            required
            autoComplete="off"
            inputMode="numeric"
            placeholder="123-45-6789"
            hint={t(
              "Demo only — never enter a real Social Security Number.",
              "Solo demo — nunca ingreses un número de Seguro Social real."
            )}
          />
        </div>
        <PrimaryButton>{t("Continue", "Continuar")}</PrimaryButton>
      </form>
    </PortalCard>
  );
}
