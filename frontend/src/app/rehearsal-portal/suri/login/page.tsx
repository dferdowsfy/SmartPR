"use client";

import { useRouter } from "next/navigation";
import {
  PageSub,
  PageTitle,
  PortalCard,
  PrimaryButton,
  TextInput,
  useRehearsal,
} from "../../rehearsal";

/**
 * FICTIONAL clone of the SURI (Hacienda) login for the merchant-registration
 * fixture. Accepts anything; stores nothing. The human signs in here during
 * takeover — Clara never types credentials.
 */
export default function SuriRehearsalLogin() {
  const { t, data, setField } = useRehearsal();
  const router = useRouter();
  return (
    <PortalCard step="login" flowStep="login">
      <PageTitle>{t("Log in to SURI", "Acceda a SURI")}</PageTitle>
      <PageSub>
        {t(
          "Fictional rehearsal clone of Hacienda's SURI portal — NOT the real SURI. Any credentials work; nothing is stored or sent.",
          "Clon ficticio de ensayo del portal SURI de Hacienda — NO es el SURI real. Cualquier credencial sirve; nada se guarda ni se envía."
        )}
      </PageSub>
      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          router.push("/rehearsal-portal/suri/home");
        }}
      >
        <TextInput id="suri-login-username" name="username" type="text" label={t("Username", "Usuario")} value={data.suriUsername ?? ""} onChange={(v) => setField("suriUsername", v)} required autoComplete="off" placeholder={t("your username", "su usuario")} />
        <TextInput id="suri-login-password" name="password" type="password" label={t("Password", "Contraseña")} value={data.suriPassword ?? ""} onChange={(v) => setField("suriPassword", v)} required autoComplete="off" />
        <PrimaryButton>{t("Log in", "Acceder")}</PrimaryButton>
      </form>
    </PortalCard>
  );
}
