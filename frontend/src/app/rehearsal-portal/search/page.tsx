"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  InlineError,
  PageSub,
  PageTitle,
  PortalCard,
  PrimaryButton,
  TextInput,
  useRehearsal,
} from "../rehearsal";

/** Entity search — any 6+ digit registry number returns the fictional entity. */
export default function RehearsalSearchPage() {
  const { t, data, setField } = useRehearsal();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = (data.registryNumber ?? "").replace(/\D/g, "");
    if (digits.length < 6) {
      setError(t("Enter at least 6 digits.", "Escribe al menos 6 dígitos."));
      setFound(false);
      return;
    }
    setError(null);
    setFound(true);
  };

  return (
    <PortalCard>
      <PageTitle>{t("Find your entity", "Busca tu entidad")}</PageTitle>
      <PageSub>
        {t(
          "Search the fictional registry by registry number.",
          "Busca en el registro ficticio por número de registro."
        )}
      </PageSub>
      <p className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-900">
        {t(
          "Demo: enter any 6+ digits (e.g. 482916) — any number works here.",
          "Demo: escribe cualquier número de 6+ dígitos (p. ej. 482916) — cualquiera funciona aquí."
        )}
      </p>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <TextInput
          id="search-registry"
          name="registryNumber"
          label={t("Registry number", "Número de registro")}
          value={data.registryNumber ?? ""}
          onChange={(v) => {
            setField("registryNumber", v);
            setFound(false);
          }}
          required
          inputMode="numeric"
          placeholder="123456"
          error={error}
        />
        <PrimaryButton>{t("Search", "Buscar")}</PrimaryButton>
      </form>

      {found && (
        <div className="mt-6 rounded-xl border border-slate-300 bg-slate-50 p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {t("Search result", "Resultado de la búsqueda")}
          </p>
          <p className="mt-1 text-lg font-extrabold text-slate-900">DEMO ENTITY LLC</p>
          <p className="text-sm text-slate-600">
            {t("Fictional entity for rehearsal only.", "Entidad ficticia solo para el ensayo.")}
          </p>
          <button
            type="button"
            onClick={() => router.push("/rehearsal-portal/filing")}
            className="mt-4 inline-flex items-center justify-center rounded-xl bg-slate-900 px-6 py-3 text-sm font-bold text-white hover:bg-slate-700"
          >
            {t("Continue", "Continuar")}
          </button>
        </div>
      )}
      {error && !found && <div className="sr-only"><InlineError>{error}</InlineError></div>}
    </PortalCard>
  );
}
