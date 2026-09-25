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
 * FICTIONAL clone of the Dept. of State registry login, for the
 * corporation-formation flow fixture. Accepts anything; stores nothing.
 * The human signs in here during takeover — Clara never does.
 */
export default function DeptStateRehearsalLogin() {
  const { t, data, setField } = useRehearsal();
  const router = useRouter();
  return (
    <PortalCard step="login" flowStep="login">
      <PageTitle>{t("Log in", "Iniciar sesión")}</PageTitle>
      <PageSub>
        {t(
          "Rehearsal clone of the Corporate & Entities Registry — NOT the Department of State. Any credentials work; nothing is stored.",
          "Clon de ensayo del Registro de Corporaciones — NO es el Departamento de Estado. Cualquier credencial sirve; nada se guarda."
        )}
      </PageSub>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          router.push("/rehearsal-portal/dept-state/wizard?step=name_availability");
        }}
      >
        <TextInput id="dos-login-email" name="email" type="email" label={t("Email", "Correo electrónico")} value={data.dosEmail ?? ""} onChange={(v) => setField("dosEmail", v)} required autoComplete="off" />
        <TextInput id="dos-login-password" name="password" type="password" label={t("Password", "Contraseña")} value={data.dosPassword ?? ""} onChange={(v) => setField("dosPassword", v)} required autoComplete="off" />
        <PrimaryButton>{t("Log in", "Iniciar sesión")}</PrimaryButton>
      </form>
    </PortalCard>
  );
}
