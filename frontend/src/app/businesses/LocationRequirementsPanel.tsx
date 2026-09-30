"use client";

// Passport → Property / Location → "What this location means".
//
// Shows what the rules engine derives from a saved pin: the Census municipio
// and barrio, the municipio's knowledge-base designations, the requirements
// those designations trigger for this business type, the obligations that
// are issued for this specific site/municipio, and whether the Passport's
// municipality (used for municipal filings and form autofill) matches the pin.
// Evaluated fresh by the server on every load — nothing here is stored.

import { useCallback, useEffect, useState } from "react";
import { DESIGNATION_LABELS } from "../locations/geo";
import type { LocationRequirement, LocationRequirementsView } from "../locations/requirements";
import type { Lang } from "../forms/engine/types";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

type Loaded = { key: string; status: "ready"; view: LocationRequirementsView } | { key: string; status: "error" };

function RequirementRow({ req, lang }: { req: LocationRequirement; lang: Lang }) {
  return (
    <li className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5" data-testid="location-requirement">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="break-words text-sm font-semibold text-[#161616]">{req.name}</div>
          {req.agency && <div className="text-[11px] text-slate-500">{req.agency}</div>}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
            req.tracked ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
          }`}
        >
          {req.tracked ? L("In your checklist", "En su lista", lang) : L("Not in your checklist", "No está en su lista", lang)}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-600">{req.reason}</p>
      {req.citation_url && (
        <a
          href={req.citation_url}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block break-all text-[11px] font-medium text-brand hover:underline"
        >
          {req.citation ?? L("Legal basis", "Base legal", lang)}
        </a>
      )}
    </li>
  );
}

export function LocationRequirementsPanel({
  businessId,
  locationId,
  version,
  isPrimary,
  canEdit,
  lang,
  onPassportUpdated,
}: {
  businessId: string;
  locationId: string;
  /** Changes when the location is edited (re-evaluates). */
  version: string;
  isPrimary: boolean;
  canEdit: boolean;
  lang: Lang;
  onPassportUpdated?: () => void;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Loading is derived: a result for a different request key is stale.
  const requestKey = `${locationId}|${version}|${reloadKey}`;
  const state = loaded && loaded.key === requestKey ? loaded : ({ status: "loading" } as const);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const key = `${locationId}|${version}|${reloadKey}`;
    fetch(
      `/api/businesses/${encodeURIComponent(businessId)}/locations/${encodeURIComponent(locationId)}/requirements`,
      { cache: "no-store" }
    )
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const view = (await r.json()) as LocationRequirementsView;
        if (!cancelled) setLoaded({ key, status: "ready", view });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, locationId, version, reloadKey]);

  const applyPinMunicipality = useCallback(
    async (municipality: string) => {
      setUpdating(true);
      setUpdateError(null);
      try {
        const res = await fetch(`/api/businesses/${encodeURIComponent(businessId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passport: { addresses: { municipality } }, mergePassport: true }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setReloadKey((k) => k + 1);
        onPassportUpdated?.();
      } catch {
        setUpdateError(L("The Passport could not be updated. Try again.", "No se pudo actualizar el Pasaporte. Intente de nuevo.", lang));
      } finally {
        setUpdating(false);
      }
    },
    [businessId, lang, onPassportUpdated]
  );

  if (state.status === "loading") {
    return (
      <p className="mt-3 text-xs text-slate-500" role="status">
        {L("Checking what this location means for requirements…", "Verificando qué significa esta ubicación para los requisitos…", lang)}
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-3" role="alert">
        <p className="text-xs text-red-700">
          {L("Location requirements could not be evaluated.", "No se pudieron evaluar los requisitos de la ubicación.", lang)}
        </p>
        <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="text-xs font-semibold text-brand hover:underline">
          {L("Retry", "Reintentar", lang)}
        </button>
      </div>
    );
  }

  const v = state.view;
  const muni = v.municipality?.name;
  return (
    <section className="mt-4 rounded-xl border border-slate-200 px-3 py-3" data-testid="location-requirements" aria-labelledby={`loc-req-${locationId}`}>
      <h3 id={`loc-req-${locationId}`} className="text-sm font-bold text-[#161616]">
        {L("What this location means for requirements", "Qué significa esta ubicación para los requisitos", lang)}
      </h3>

      {!muni ? (
        <p className="mt-1 text-xs text-slate-600">
          {L(
            "This pin isn't inside a Puerto Rico municipio boundary, so no municipal or location rules can be evaluated. Check the pin.",
            "Este pin no está dentro de un municipio de Puerto Rico, así que no se pueden evaluar reglas municipales ni de ubicación. Verifique el pin.",
            lang
          )}
        </p>
      ) : (
        <>
          <p className="mt-1 text-xs text-slate-600">
            {L(
              `The pin is in ${muni}${v.barrio ? `, barrio ${v.barrio.name}${v.barrio.barrio_pueblo ? " (pueblo)" : ""}` : ""}, per ${v.municipality?.source_name ?? "official boundaries"}.`,
              `El pin está en ${muni}${v.barrio ? `, barrio ${v.barrio.name}${v.barrio.barrio_pueblo ? " (pueblo)" : ""}` : ""}, según ${v.municipality?.source_name ?? "límites oficiales"}.`,
              lang
            )}
            {v.municipality?.near_boundary &&
              L(
                " It's very close to a boundary — confirm the pin is on the right side.",
                " Está muy cerca de un límite — confirme que el pin está del lado correcto.",
                lang
              )}
          </p>

          {v.designations.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5" aria-label={L("Municipio designations", "Designaciones del municipio", lang)}>
              {v.designations.map((d) => (
                <span key={d} className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                  {DESIGNATION_LABELS[d] ? (lang === "es" ? DESIGNATION_LABELS[d].es : DESIGNATION_LABELS[d].en) : d.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}

          {/* The Passport municipality drives municipal filings and form autofill. */}
          {isPrimary && v.passport_matches === false && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status" data-testid="location-passport-mismatch">
              {L(
                `Your Passport lists ${v.passport_municipality} as the business municipality, but this primary location's pin is in ${muni}. Municipal filings (like the patente) and prefilled forms use the Passport municipality.`,
                `Su Pasaporte indica ${v.passport_municipality} como municipio del negocio, pero el pin de esta ubicación principal está en ${muni}. Los trámites municipales (como la patente) y los formularios prellenados usan el municipio del Pasaporte.`,
                lang
              )}
              {canEdit && (
                <button
                  type="button"
                  disabled={updating}
                  onClick={() => void applyPinMunicipality(muni)}
                  className="mt-2 block rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-[#f6f3ea] disabled:opacity-40"
                >
                  {updating ? L("Updating…", "Actualizando…", lang) : L(`Use ${muni} in the Passport`, `Usar ${muni} en el Pasaporte`, lang)}
                </button>
              )}
            </div>
          )}
          {isPrimary && v.passport_municipality === null && canEdit && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700" role="status">
              {L(
                "Your Passport has no business municipality yet; municipal filings and prefilled forms need one.",
                "Su Pasaporte aún no tiene municipio; los trámites municipales y los formularios prellenados lo necesitan.",
                lang
              )}
              <button
                type="button"
                disabled={updating}
                onClick={() => void applyPinMunicipality(muni)}
                className="mt-2 block rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-[#f6f3ea] disabled:opacity-40"
              >
                {updating ? L("Updating…", "Actualizando…", lang) : L(`Use ${muni} in the Passport`, `Usar ${muni} en el Pasaporte`, lang)}
              </button>
            </div>
          )}
          {updateError && (
            <p role="alert" className="mt-2 text-xs font-medium text-red-700">
              {updateError}
            </p>
          )}

          <h4 className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">
            {L("Triggered by this location", "Activados por esta ubicación", lang)}
          </h4>
          {!v.business_type ? (
            <p className="mt-1 text-xs text-slate-600">
              {L(
                "Add the business type to the profile to see location rules that apply to this kind of business.",
                "Agregue el tipo de negocio al perfil para ver las reglas de ubicación que aplican a este tipo de negocio.",
                lang
              )}
            </p>
          ) : v.triggered_by_location.length === 0 ? (
            <p className="mt-1 text-xs text-slate-600">
              {L(
                `SmartPR's current rules add no extra requirements for a ${v.business_type} because of ${muni}'s designations.`,
                `Las reglas actuales de SmartPR no añaden requisitos adicionales para ${v.business_type} por las designaciones de ${muni}.`,
                lang
              )}
            </p>
          ) : (
            <ul className="mt-1 space-y-2">
              {v.triggered_by_location.map((r) => (
                <RequirementRow key={r.document_id} req={r} lang={lang} />
              ))}
            </ul>
          )}

          {v.site_scoped.length > 0 && (
            <>
              <h4 className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">
                {L("Issued for this site or municipio", "Expedidos para este lugar o municipio", lang)}
              </h4>
              <ul className="mt-1 space-y-2">
                {v.site_scoped.map((r) => (
                  <RequirementRow key={r.document_id} req={r} lang={lang} />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <p className="mt-3 text-[11px] text-slate-500">
        {L(
          `Evaluated just now against SmartPR's ${v.knowledge_source === "PUBLISHED_SNAPSHOT" ? "published" : "built-in"} rules. Zoning, flood zones and other overlays aren't loaded yet, so they aren't evaluated.`,
          `Evaluado ahora con las reglas ${v.knowledge_source === "PUBLISHED_SNAPSHOT" ? "publicadas" : "integradas"} de SmartPR. Zonificación, zonas inundables y otras capas aún no están cargadas, así que no se evalúan.`,
          lang
        )}
      </p>
    </section>
  );
}
