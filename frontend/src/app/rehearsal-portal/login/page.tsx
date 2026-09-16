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
 * Demo login — accepts anything. No working credentials are printed anywhere:
 * the rehearsing agent is expected to PAUSE at this gate (USER_LOGIN) rather
 * than typing credentials unprompted.
 */
export default function RehearsalLoginPage() {
  const { t, data, setField } = useRehearsal();
  const router = useRouter();

  return (
    <PortalCard>
      <PageTitle>{t("Log in", "Iniciar sesión")}</PageTitle>
      <PageSub>
        {t(
          "Demo only — any credentials are accepted. Nothing is verified or stored.",
          "Solo demo — se acepta cualquier credencial. No se verifica ni se guarda nada."
        )}
      </PageSub>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          router.push("/rehearsal-portal/search");
        }}
      >
        <TextInput
          id="login-email"
          name="email"
          type="email"
          label={t("Email", "Correo electrónico")}
          value={data.loginEmail ?? ""}
          onChange={(v) => setField("loginEmail", v)}
          required
          autoComplete="email"
          placeholder="demo@example.com"
        />
        <TextInput
          id="login-password"
          name="password"
          type="password"
          label={t("Password", "Contraseña")}
          value={data.loginPassword ?? ""}
          onChange={(v) => setField("loginPassword", v)}
          required
          autoComplete="current-password"
        />
        <PrimaryButton>{t("Log in", "Iniciar sesión")}</PrimaryButton>
      </form>
    </PortalCard>
  );
}
