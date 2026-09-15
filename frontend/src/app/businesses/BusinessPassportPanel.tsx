"use client";

// Business Passport editor — single edit surface on the business profile.
// Writes the same CanonicalApplicationData the artifact engine already reads.

import { useCallback, useEffect, useMemo, useState } from "react";
import { CoreApplicationDetails } from "../forms/engine/CoreApplicationDetails";
import {
  canonicalFromBusinessRow,
  passportCoverage,
  passportJsonFromCanonical,
  type BusinessRowFacts,
} from "../forms/engine/businessPassport";
import type { CanonicalApplicationData, Lang } from "../forms/engine/types";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

export interface BusinessPassportPanelProps {
  businessId: string;
  business: BusinessRowFacts & { id?: string };
  lang: Lang;
  onSaved?: (next: { passport_json: unknown; denormalized: Record<string, string | null> }) => void;
}

export function BusinessPassportPanel({ businessId, business, lang, onSaved }: BusinessPassportPanelProps) {
  const initial = useMemo(() => canonicalFromBusinessRow(business), [business]);
  const [canonical, setCanonical] = useState<CanonicalApplicationData>(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setCanonical(initial);
    setDirty(false);
  }, [initial]);

  const coverage = useMemo(() => passportCoverage(canonical), [canonical]);

  const onChange = useCallback((next: CanonicalApplicationData) => {
    setCanonical(next);
    setDirty(true);
    setMessage(null);
  }, []);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const passport_json = passportJsonFromCanonical(canonical);
      const response = await fetch(`/api/businesses/${businessId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passport: passport_json }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.error || L("Could not save passport.", "No se pudo guardar el pasaporte.", lang));
        return;
      }
      setDirty(false);
      setMessage(L(
        "Passport saved. Regenerated downloads will use these values.",
        "Pasaporte guardado. Las descargas regeneradas usarán estos valores.",
        lang
      ));
      onSaved?.({
        passport_json: result.business?.passport_json ?? passport_json,
        denormalized: {
          legal_name: result.business?.legal_name ?? null,
          municipality: result.business?.municipality ?? null,
          physical_address: result.business?.physical_address ?? null,
          business_structure: result.business?.business_structure ?? null,
          entity_number: result.business?.entity_number ?? null,
        },
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/[0.02]">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[#161616]">
            {L("Business Passport", "Pasaporte comercial", lang)}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {L(
              `${coverage.filled.length} of ${coverage.filled.length + coverage.empty.length} passport fields filled. Empty fields stay blank on forms — SmartPR never invents values.`,
              `${coverage.filled.length} de ${coverage.filled.length + coverage.empty.length} campos del pasaporte completados. Los campos vacíos quedan en blanco en los formularios — SmartPR nunca inventa valores.`,
              lang
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={!dirty || busy}
          onClick={() => void save()}
          className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-[#f6f3ea] disabled:opacity-40"
        >
          {busy
            ? L("Saving…", "Guardando…", lang)
            : dirty
              ? L("Save passport", "Guardar pasaporte", lang)
              : L("Saved", "Guardado", lang)}
        </button>
      </div>
      <CoreApplicationDetails canonical={canonical} lang={lang} onChange={onChange} passportMode />
      {message && <p className="mt-3 text-xs font-medium text-emerald-700">{message}</p>}
      <p className="mt-3 text-[11px] text-slate-500">
        {L(
          "Refresh path: populate / download again after saving — working copies are generated from the current passport. Previously prepared forms that used changed fields are flagged Needs refresh in intake.",
          "Ruta de actualización: vuelva a generar o descargar después de guardar — las copias de trabajo se generan desde el pasaporte actual. Los formularios preparados que usaban campos cambiados se marcan Necesita actualización en el intake.",
          lang
        )}
      </p>
    </section>
  );
}
