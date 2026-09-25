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

/**
 * Demo registration — name/email prefillable from the passport. The agent must
 * PAUSE at password creation and never invent one.
 */
export default function RehearsalRegisterPage() {
  const { t, data, setField } = useRehearsal();
  const router = useRouter();

  return (
    <PortalCard step="login">
      <PageTitle>{t("Create account", "Crear cuenta")}</PageTitle>
      <PageSub>
        {t(
          "Demo only — this account exists only in this rehearsal. Choose your own password; never share a real one.",
          "Solo demo — esta cuenta solo existe en este ensayo. Escoge tu propia contraseña; nunca compartas una real."
        )}
      </PageSub>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          // A brand-new registration has no registry number yet — the demo
          // portal issues a fictional one so the filing can continue without
          // ever visiting the entity search page.
          const fictional = String(
            Math.floor(100000 + Math.random() * 900000)
          );
          setField("fictionalRegistryNumber", fictional);
          router.push("/rehearsal-portal/registered");
        }}
      >
        <TextInput
          id="reg-name"
          name="fullName"
          label={t("Full name", "Nombre completo")}
          value={data.regName ?? ""}
          onChange={(v) => setField("regName", v)}
          required
          autoComplete="name"
        />
        <TextInput
          id="reg-email"
          name="email"
          type="email"
          label={t("Email", "Correo electrónico")}
          value={data.regEmail ?? ""}
          onChange={(v) => setField("regEmail", v)}
          required
          autoComplete="email"
        />
        <TextInput
          id="reg-password"
          name="newPassword"
          type="password"
          label={t("Create a password", "Crea una contraseña")}
          value={data.regPassword ?? ""}
          onChange={(v) => setField("regPassword", v)}
          required
          autoComplete="new-password"
          hint={t(
            "Sensitive — the account holder must choose this. Never invent or reuse a real password.",
            "Sensible — el titular de la cuenta debe escogerla. Nunca inventes ni reutilices una contraseña real."
          )}
        />
        <PrimaryButton>{t("Create account", "Crear cuenta")}</PrimaryButton>
      </form>
    </PortalCard>
  );
}
