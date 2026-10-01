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
import { MapPin } from "lucide-react";
import { LocationPickerDialog, type PickedSite, type ResolvedPlacement } from "../../businesses/LocationPickerDialog";
import type { PassportLocationWithGeographies } from "../../locations/geo";
import { siteLabel, type IntakeSite, type LocationNeed, type LocationNeedReason } from "../../locations/intakeLocation";
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
}: {
  lang: Lang;
  need: LocationNeed;
  site: IntakeSite | null;
  /** Persisted business the site is saved to (same model as Settings); null for guests / new drafts. */
  businessId: string | null;
  onConfirm: (site: IntakeSite) => void;
  /** Requirements summary variant: one line. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [savedFor, setSavedFor] = useState<{ businessId: string; locations: PassportLocationWithGeographies[] } | null>(null);
  const saved = businessId && savedFor?.businessId === businessId ? savedFor.locations : [];
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The business's saved locations (Passport → Property / Location).
  useEffect(() => {
    if (!businessId) return;
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
  }, [businessId]);

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
