"use client";

// Inline "Where is it?" step. Shown in the intake when the request needs a
// site (a municipio or address was mentioned, a physical site, construction,
// an energy project, food service, a property project, or rules that depend
// on location facts are still missing — see locations/intakeLocation.ts).
//
// The user drops a pin (or searches an address, which geocodes to a pin) in
// the same LocationPickerDialog the Passport uses, or picks one of the
// business's saved locations. The municipio comes from the pin via official
// Census boundaries; the confirmed site then drives the requirements.

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, MapPin } from "lucide-react";
import { LocationPickerDialog, type PickedSite, type ResolvedPlacement } from "../../businesses/LocationPickerDialog";
import type { PassportLocationWithGeographies } from "../../locations/geo";
import { siteLabel, siteLayersCurrent, type IntakeSite, type LocationNeed, type LocationNeedReason } from "../../locations/intakeLocation";
import { floodMapSummary, layerChips } from "../../locations/layers";
import type { Lang } from "../../forms/engine/types";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

/** PickedSite (dialog) → IntakeSite (rules). */
export function intakeSiteFromPick(site: PickedSite): IntakeSite {
  return intakeSiteFromPlacement(
    { latitude: site.latitude, longitude: site.longitude, coordinate_source: site.coordinate_source, formatted_address: site.formatted_address },
    site.placement,
    site.designations,
    site.savedLocation?.id ?? null
  );
}

export function intakeSiteFromPlacement(
  point: Pick<IntakeSite, "latitude" | "longitude" | "coordinate_source" | "formatted_address">,
  placement: ResolvedPlacement,
  designations: string[],
  locationId: string | null
): IntakeSite {
  return {
    ...point,
    municipality: { name: placement.municipality.name, fips: placement.municipality.fips ?? null },
    barrio: placement.barrio ? { name: placement.barrio.name, geoid: placement.barrio.geoid ?? null } : null,
    near_boundary: placement.near_boundary,
    designations,
    boundary_source: placement.source ?? null,
    location_id: locationId,
    confirmed_at: new Date().toISOString(),
  };
}

function reasonText(reason: LocationNeedReason, need: LocationNeed, lang: Lang): string | null {
  switch (reason) {
    case "municipality_mentioned":
      return need.prefill.municipality ? L(`You mentioned ${need.prefill.municipality}.`, `Mencionaste ${need.prefill.municipality}.`, lang) : null;
    case "address_mentioned":
      return need.prefill.address ? L(`You mentioned ${need.prefill.address}.`, `Mencionaste ${need.prefill.address}.`, lang) : null;
    case "energy_project":
      return L("Energy projects depend on the exact site.", "Los proyectos de energía dependen del lugar exacto.", lang);
    case "construction":
      return L("Construction permits follow the property.", "Los permisos de construcción siguen la propiedad.", lang);
    case "property_project":
      return L("The property decides which permits apply.", "La propiedad decide qué permisos aplican.", lang);
    case "location_rules_pending":
      return L("Some requirements depend on where it is.", "Algunos requisitos dependen de dónde queda.", lang);
    default:
      return null;
  }
}

export function LocationStepCard({
  lang,
  need,
  site,
  businessId,
  onConfirm,
  compact = false,
  summaryRow = false,
}: {
  lang: Lang;
  need: LocationNeed;
  site: IntakeSite | null;
  /** Persisted business the site is saved to (same model as Settings); null for guests / new drafts. */
  businessId: string | null;
  onConfirm: (site: IntakeSite) => void;
  /** Requirements summary variant: one line. */
  compact?: boolean;
  /**
   * Project-summary sidebar variant: a "Site" `<div><dt/><dd/></div>` row
   * for the summary list — the confirmed pin with Change, or "Find on map".
   */
  summaryRow?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [savedFor, setSavedFor] = useState<{ businessId: string; locations: PassportLocationWithGeographies[] } | null>(null);
  const saved = businessId && savedFor?.businessId === businessId ? savedFor.locations : [];
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The business's saved locations (Passport → Property / Location).
  useEffect(() => {
    // Only the full card lists saved locations.
    if (!businessId || compact || summaryRow) return;
    let cancelled = false;
    fetch(`/api/businesses/${encodeURIComponent(businessId)}/locations`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { locations: [] }))
      .then((d: { locations?: PassportLocationWithGeographies[] }) => {
        if (!cancelled) setSavedFor({ businessId, locations: Array.isArray(d.locations) ? d.locations : [] });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [businessId, compact, summaryRow]);

  const pickSaved = async (loc: PassportLocationWithGeographies) => {
    setResolving(loc.id);
    setError(null);
    try {
      const res = await fetch(`/api/locations/resolve?lat=${encodeURIComponent(loc.latitude)}&lng=${encodeURIComponent(loc.longitude)}`, { cache: "no-store" });
      const data = (await res.json()) as { placement: ResolvedPlacement | null; designations: string[] };
      if (!res.ok || !data.placement) {
        setError(L("That location is outside Puerto Rico's municipios. Drop a pin instead.", "Esa ubicación está fuera de los municipios de Puerto Rico. Coloque un pin.", lang));
        return;
      }
      onConfirm(
        intakeSiteFromPlacement(
          { latitude: loc.latitude, longitude: loc.longitude, coordinate_source: loc.coordinate_source, formatted_address: loc.formatted_address },
          data.placement,
          data.designations ?? [],
          loc.id
        )
      );
    } catch {
      setError(L("Couldn't read that location. Try again.", "No se pudo leer esa ubicación. Intente de nuevo.", lang));
    } finally {
      setResolving(null);
    }
  };

  const dialog = open && (
    <LocationPickerDialog
      mode="pick"
      lang={lang}
      title={L("Where is it?", "¿Dónde queda?", lang)}
      businessId={businessId}
      // Saving to the business's locations happens once, in the intake
      // (so guests' sites are saved when their business is created).
      offerSave={false}
      initialQuery={site ? null : need.prefill.query}
      onClose={() => setOpen(false)}
      onPicked={(picked) => {
        setOpen(false);
        onConfirm(intakeSiteFromPick(picked));
      }}
    />
  );

  if (summaryRow) {
    const checking = site && !siteLayersCurrent(site);
    return (
      <div className="spr-loc-summary-row" data-testid="summary-site">
        <dt>{L("Site", "Sitio", lang)}</dt>
        <dd>
          {site ? (
            <>
              <span className="spr-loc-summary-label" data-testid="summary-site-label">{siteLabel(site)}</span>
              {checking && (
                <span className="spr-loc-summary-checking" role="status">
                  <Loader2 className="spr-loc-spin" aria-hidden="true" />
                  {L("Checking site…", "Revisando lugar…", lang)}
                </span>
              )}
              <button type="button" className="spr-link spr-loc-summary-change" onClick={() => setOpen(true)} data-testid="summary-site-change">
                {L("Change", "Cambiar", lang)}
              </button>
            </>
          ) : (
            <button type="button" className="spr-loc-summary-find" onClick={() => setOpen(true)} data-testid="summary-site-open">
              <MapPin aria-hidden="true" />
              {L("Find on map", "Buscar en el mapa", lang)}
            </button>
          )}
        </dd>
        {dialog}
      </div>
    );
  }

  // Confirmed: "Rules for: <address> · Change".
  if (site) {
    return (
      <div className={compact ? "spr-loc-line" : "spr-loc-card spr-loc-card-done"} data-testid="location-rules-for">
        <MapPin className="spr-loc-icon" aria-hidden="true" />
        <span className="spr-loc-rules">
          <span className="spr-loc-rules-label">{L("Rules for", "Reglas para", lang)}:</span>{" "}
          <strong data-testid="location-rules-for-label">{siteLabel(site)}</strong>
          {site.near_boundary && (
            <span className="spr-loc-note"> {L("(near a municipal boundary — check the pin)", "(cerca de un límite municipal — verifique el pin)", lang)}</span>
          )}
        </span>
        <button type="button" className="spr-link spr-loc-change" onClick={() => setOpen(true)} data-testid="location-change">
          {L("Change", "Cambiar", lang)}
        </button>
        <SiteLayerChips site={site} lang={lang} />
        {dialog}
      </div>
    );
  }

  if (compact) {
    return (
      <div className="spr-loc-line spr-loc-pending" data-testid="location-pending">
        <MapPin className="spr-loc-icon" aria-hidden="true" />
        <span className="spr-loc-rules">{L("Location-based rules are pending.", "Hay reglas por ubicación pendientes.", lang)}</span>
        <button type="button" className="spr-loc-action" onClick={() => setOpen(true)} data-testid="location-action">
          {L("Location", "Ubicación", lang)}
        </button>
        {dialog}
      </div>
    );
  }

  const why = need.reasons.map((r) => reasonText(r, need, lang)).filter((t): t is string => Boolean(t)).slice(0, 2);
  return (
    <section className="spr-loc-card" data-testid="location-step" aria-labelledby="spr-loc-title">
      <h3 id="spr-loc-title" className="spr-loc-title">{L("Where is it?", "¿Dónde queda?", lang)}</h3>
      <p className="spr-loc-hint">
        {L(
          "Drop a pin or type the address. The exact site decides municipal permits, patente and land-use rules.",
          "Coloque un pin o escriba la dirección. El lugar exacto decide los permisos municipales, la patente y las reglas de uso de terrenos.",
          lang
        )}
      </p>
      {why.length > 0 && <p className="spr-loc-why" data-testid="location-step-why">{why.join(" ")}</p>}
      <div className="spr-loc-actions">
        <button type="button" className="spr-loc-primary" onClick={() => setOpen(true)} data-testid="location-step-open">
          <MapPin aria-hidden="true" />
          {need.prefill.municipality || need.prefill.address
            ? L(`Find it in ${need.prefill.address ?? need.prefill.municipality}`, `Buscar en ${need.prefill.address ?? need.prefill.municipality}`, lang)
            : L("Drop a pin", "Colocar un pin", lang)}
        </button>
      </div>
      {saved.length > 0 && (
        <div className="spr-loc-saved" role="group" aria-label={L("Saved locations", "Ubicaciones guardadas", lang)}>
          <span className="spr-loc-saved-label">{L("Or use a saved location", "O use una ubicación guardada", lang)}</span>
          {saved.map((loc) => (
            <button
              key={loc.id}
              type="button"
              className="spr-loc-saved-item"
              disabled={resolving !== null}
              onClick={() => void pickSaved(loc)}
              data-testid="location-saved-option"
            >
              {loc.name || loc.formatted_address || `${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`}
              {loc.name && loc.formatted_address ? <span className="spr-loc-saved-sub"> · {loc.formatted_address}</span> : null}
            </button>
          ))}
        </div>
      )}
      {error && <p className="spr-loc-error" role="alert">{error}</p>}
      {dialog}
    </section>
  );
}

/**
 * What the pin resolved on the official maps: "Flood zone AE · Coastal zone ·
 * Zoning C-L · Rustic". Unknown layers are shown subtly (never as "no");
 * the tooltip names the source and dataset date.
 *
 * The lookup runs in the background after a site is confirmed and can take a
 * few seconds, so its state is unmistakable: a body-size spinner line
 * ("Checking flood zone, zoning and parcel for this site…") over skeleton
 * chips while it runs, then a "Site checked" line over the real chips. The
 * wrapper is a polite live region, so the change is also announced.
 */
export function SiteLayerChips({ site, lang }: { site: IntakeSite; lang: Lang }) {
  if (!siteLayersCurrent(site)) {
    return (
      <div
        className="spr-loc-layers spr-loc-layers-loading"
        data-testid="location-layer-chips"
        data-state="loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <p className="spr-loc-layers-status" data-testid="location-layers-status">
          <Loader2 className="spr-loc-layers-icon spr-loc-spin" aria-hidden="true" />
          <span>{L("Checking flood zone, zoning and parcel for this site…", "Revisando zona inundable, calificación y parcela de este lugar…", lang)}</span>
        </p>
        <span className="spr-loc-chips" aria-hidden="true">
          <span className="spr-loc-chip spr-loc-chip-skeleton" style={{ width: 112 }} />
          <span className="spr-loc-chip spr-loc-chip-skeleton" style={{ width: 136 }} />
          <span className="spr-loc-chip spr-loc-chip-skeleton" style={{ width: 96 }} />
        </span>
      </div>
    );
  }
  const chips = layerChips(site.layers);
  const flood = floodMapSummary(site.layers);
  const known = chips.filter((c) => c.status !== "unknown").length;
  const done = known > 0;
  return (
    <div
      className={`spr-loc-layers ${done ? "spr-loc-layers-done" : "spr-loc-layers-unavailable"}`}
      data-testid="location-layer-chips"
      data-state={done ? "done" : "unavailable"}
      role="status"
      aria-live="polite"
    >
      <p className="spr-loc-layers-status" data-testid="location-layers-status">
        {done ? (
          <CheckCircle2 className="spr-loc-layers-icon" aria-hidden="true" />
        ) : (
          <AlertCircle className="spr-loc-layers-icon" aria-hidden="true" />
        )}
        <span>
          {done
            ? L("Site checked on the official maps", "Lugar revisado en los mapas oficiales", lang)
            : L(
                "The official maps couldn't be reached. Requirements don't assume anything about this site.",
                "No se pudo consultar los mapas oficiales. Los requisitos no suponen nada sobre este lugar.",
                lang
              )}
        </span>
      </p>
      {flood && (
        <p className="spr-loc-fema" data-testid="location-fema-map">
          <span className="spr-loc-fema-title">{L("FEMA flood map", "Mapa de inundación de FEMA", lang)}</span>
          {flood.firmPanel && (
            <span>
              {L("Panel", "Panel", lang)} {flood.firmPanel}
              {flood.effectiveDate ? ` · ${L("effective", "vigente", lang)} ${flood.effectiveDate}` : ""}
              {flood.preliminaryDate ? ` · ${L("preliminary", "preliminar", lang)} ${flood.preliminaryDate}` : ""}
            </span>
          )}
          {flood.community && (
            <span>
              {flood.community}
              {flood.communityId ? ` (CID ${flood.communityId})` : ""}
            </span>
          )}
          {flood.baseFloodElevation !== null && <span>{L("Base flood elevation", "Elevación base de inundación", lang)} {flood.baseFloodElevation}</span>}
          {flood.mapChangeCount ? (
            <span data-testid="location-fema-lomc">
              {L(
                `${flood.mapChangeCount} letter(s) of map change within 100 m — may revise this zone`,
                `${flood.mapChangeCount} carta(s) de cambio de mapa a menos de 100 m — podrían revisar esta zona`,
                lang
              )}
              {flood.mapChangeCases ? `: ${flood.mapChangeCases}` : ""}
            </span>
          ) : flood.mapChangeCount === 0 ? (
            <span>{L("No letters of map change nearby", "Sin cartas de cambio de mapa cerca", lang)}</span>
          ) : null}
          {flood.mscUrl && (
            <a href={flood.mscUrl} target="_blank" rel="noopener noreferrer">
              {L("Open in FEMA Map Service Center", "Abrir en el Centro de Mapas de FEMA", lang)}
            </a>
          )}
        </p>
      )}
      {chips.length > 0 && (
        <span className="spr-loc-chips" aria-label={L("Map facts at the pin", "Datos del mapa en el pin", lang)}>
          {chips.map((c) => (
            <span
              key={c.layer}
              className={c.status === "unknown" ? "spr-loc-chip spr-loc-chip-unknown" : "spr-loc-chip"}
              title={lang === "es" ? c.title.es : c.title.en}
              data-layer={c.layer}
              data-status={c.status}
            >
              {lang === "es" ? c.label.es : c.label.en}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}
