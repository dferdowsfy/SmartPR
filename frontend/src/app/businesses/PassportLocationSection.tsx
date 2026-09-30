"use client";

// Business Passport → Property / Location.
//
// Shows the business's saved, confirmed locations (primary first) with a map
// preview, coordinates, and geographic facts. Geographic facts appear ONLY
// when an explainable determination exists (spatial intersection with a
// versioned dataset, or an official record); otherwise they read "Not yet
// determined". Address text from a geocoder is labeled as such.

import { useCallback, useEffect, useMemo, useState } from "react";
import { MapPin } from "lucide-react";
import { PassportMap } from "../components/map/PassportMap";
import { LocationPickerDialog } from "./LocationPickerDialog";
import { LocationRequirementsPanel } from "./LocationRequirementsPanel";
import {
  currentGeography,
  formatCoordinate,
  isWithinPuertoRico,
  locationAddressLine,
  type GeographyType,
  type LocationGeography,
  type PassportLocationWithGeographies,
} from "../locations/geo";
import { isAuthoritative } from "../locations/locationContext";
import type { Lang } from "../forms/engine/types";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

type LoadState =
  | { status: "loading" }
  | { status: "ready"; locations: PassportLocationWithGeographies[]; canEdit: boolean }
  | { status: "error" };

const GEOGRAPHY_LABELS: Record<string, { en: string; es: string }> = {
  municipality: { en: "Municipality", es: "Municipio" },
  barrio: { en: "Barrio", es: "Barrio" },
  parcel: { en: "Parcel / Cadastral ID", es: "Parcela / Número catastral" },
  zoning_district: { en: "Zoning", es: "Zonificación" },
  flood_zone: { en: "Flood zone", es: "Zona inundable" },
  historic_district: { en: "Historic district", es: "Distrito histórico" },
  coastal_zone: { en: "Coastal zone", es: "Zona costera" },
  environmental_zone: { en: "Environmental zone", es: "Zona ambiental" },
  planning_zone: { en: "Planning zone", es: "Zona de planificación" },
  utility_service_area: { en: "Utility service area", es: "Área de servicio de utilidades" },
  special_overlay: { en: "Special overlay", es: "Distrito sobrepuesto" },
};

/** The four facts always shown, determined or not. */
const CORE_FACTS: GeographyType[] = ["municipality", "barrio", "parcel", "zoning_district"];

function geographyLabel(type: string, lang: Lang): string {
  const known = GEOGRAPHY_LABELS[type];
  return known ? (lang === "es" ? known.es : known.en) : type.replace(/_/g, " ");
}

function fmtDate(value: string, lang: Lang): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(lang === "es" ? "es-PR" : "en-US", { dateStyle: "medium" });
}

function GeographyFact({
  label,
  geography,
  fallback,
  lang,
}: {
  label: string;
  geography: LocationGeography | null;
  /** Non-authoritative text to show (labeled) when nothing is determined. */
  fallback?: { value: string; note: string } | null;
  lang: Lang;
}) {
  const [open, setOpen] = useState(false);
  const value = geography ? geography.geography_name ?? geography.geography_code : null;
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
      <div className="text-[11px] font-medium text-slate-500">{label}</div>
      {geography && value ? (
        <>
          <div className="mt-0.5 break-words text-sm font-semibold text-[#161616]">
            {value}
            {geography.metadata?.barrio_pueblo === true && (
              <span className="ml-1 font-normal text-slate-500">({L("barrio-pueblo", "barrio-pueblo", lang)})</span>
            )}
          </div>
          {geography.metadata?.near_boundary === true && (
            <div className="mt-0.5 text-[11px] font-medium text-amber-800">
              {L("Very close to a boundary — confirm the pin", "Muy cerca de un límite — confirme el pin", lang)}
            </div>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-1 text-[11px] font-medium text-brand hover:underline"
          >
            {L("Why?", "¿Por qué?", lang)}
          </button>
          {open && (
            <div className="mt-1 space-y-0.5 text-[11px] text-slate-600">
              <p>
                {geography.determination_method === "SPATIAL_INTERSECTION"
                  ? L(
                      `This location's coordinates fall inside a boundary in ${geography.source_name ?? geography.source_id}.`,
                      `Las coordenadas de esta ubicación caen dentro de un límite en ${geography.source_name ?? geography.source_id}.`,
                      lang
                    )
                  : geography.determination_method === "OFFICIAL_RECORD"
                    ? L(
                        `From an official record: ${geography.source_name ?? geography.source_id}.`,
                        `De un registro oficial: ${geography.source_name ?? geography.source_id}.`,
                        lang
                      )
                    : L("Entered by a user; not independently verified.", "Ingresado por un usuario; no verificado.", lang)}
              </p>
              {geography.source_version && (
                <p>
                  {L("Dataset version", "Versión del conjunto de datos", lang)}: {geography.source_version}
                </p>
              )}
              {geography.source_url && (
                <p className="break-all">
                  {L("Source", "Fuente", lang)}:{" "}
                  <a href={geography.source_url} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                    {geography.source_url}
                  </a>
                </p>
              )}
              <p>
                {L("Checked", "Verificado", lang)}: {fmtDate(geography.determined_at, lang)}
              </p>
            </div>
          )}
        </>
      ) : fallback ? (
        <>
          <div className="mt-0.5 break-words text-sm font-semibold text-[#161616]">{fallback.value}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">{fallback.note}</div>
        </>
      ) : (
        <div className="mt-0.5 text-sm italic text-slate-500">{L("Not yet determined", "Aún no determinado", lang)}</div>
      )}
    </div>
  );
}

export function PassportLocationSection({
  businessId,
  lang,
  onPassportUpdated,
}: {
  businessId: string;
  lang: Lang;
  /** Called after this section updates the Passport (e.g. municipality from the pin). */
  onPassportUpdated?: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ mode: "add" } | { mode: "edit"; location: PassportLocationWithGeographies } | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "warning" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/businesses/${encodeURIComponent(businessId)}/locations`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as { locations: PassportLocationWithGeographies[]; can_edit?: boolean };
        if (!cancelled) setState({ status: "ready", locations: data.locations, canEdit: data.can_edit !== false });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [businessId, reloadKey]);

  const locations = useMemo(() => (state.status === "ready" ? state.locations : []), [state]);
  // Workspace viewers see saved locations but get no mutation controls
  // (the API enforces the same rule).
  const canEdit = state.status === "ready" && state.canEdit;
  const selected = locations.find((l) => l.id === selectedId) ?? locations[0] ?? null;

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const onSaved = (location: PassportLocationWithGeographies, warnings: string[]) => {
    setDialog(null);
    setConfirmRemove(false);
    setSelectedId(location.id);
    setNotice(
      warnings.includes("outside_puerto_rico")
        ? {
            kind: "warning",
            text: L(
              "Location saved. Note: the point is outside Puerto Rico.",
              "Ubicación guardada. Nota: el punto está fuera de Puerto Rico.",
              lang
            ),
          }
        : { kind: "success", text: L("Location saved to the Passport.", "Ubicación guardada en el Pasaporte.", lang) }
    );
    // Show the saved row immediately, then refresh from the server.
    setState((prev) =>
      prev.status === "ready"
        ? {
            status: "ready",
            canEdit: prev.canEdit,
            locations: [
              ...prev.locations
                .filter((l) => l.id !== location.id)
                .map((l) => (location.is_primary ? { ...l, is_primary: false } : l)),
              location,
            ],
          }
        : prev
    );
    reload();
  };

  const mutate = async (fn: () => Promise<Response>, success: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fn();
      if (!res.ok) throw new Error(String(res.status));
      setNotice({ kind: "success", text: success });
      reload();
    } catch {
      setNotice({ kind: "error", text: L("That change could not be saved. Try again.", "No se pudo guardar el cambio. Intente de nuevo.", lang) });
    } finally {
      setBusy(false);
      setConfirmRemove(false);
    }
  };

  const makePrimary = (loc: PassportLocationWithGeographies) =>
    mutate(
      () =>
        fetch(`/api/businesses/${encodeURIComponent(businessId)}/locations/${encodeURIComponent(loc.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...loc, geographies: undefined, is_primary: true }),
        }),
      L("Primary location updated.", "Ubicación principal actualizada.", lang)
    );

  const remove = (loc: PassportLocationWithGeographies) =>
    mutate(
      () => fetch(`/api/businesses/${encodeURIComponent(businessId)}/locations/${encodeURIComponent(loc.id)}`, { method: "DELETE" }),
      L("Location removed.", "Ubicación eliminada.", lang)
    ).then(() => setSelectedId(null));

  const municipalityFallback = (loc: PassportLocationWithGeographies) => {
    const authoritative = currentGeography(loc.geographies, "municipality");
    if (authoritative && isAuthoritative(authoritative.determination_method)) return null;
    if (!loc.municipality) return null;
    return {
      value: loc.municipality,
      note:
        loc.address_source === "USER_PROVIDED"
          ? L("From the address entered — not boundary-verified", "De la dirección ingresada — no verificado por límites", lang)
          : L("From address lookup — not boundary-verified", "De la búsqueda de dirección — no verificado por límites", lang),
    };
  };

  const extraGeographies = selected
    ? selected.geographies.filter(
        (g) => !CORE_FACTS.includes(g.geography_type) && isAuthoritative(g.determination_method)
      )
    : [];

  return (
    <div className="mt-4 rounded-xl border border-slate-200 px-4 py-3" data-testid="passport-location-section">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold text-[#161616]">{L("Property / Location", "Propiedad / Ubicación", lang)}</div>
        {canEdit && locations.length > 0 && (
          <button
            type="button"
            onClick={() => setDialog({ mode: "add" })}
            className="text-xs font-semibold text-brand hover:underline"
          >
            {L("+ Add location", "+ Agregar ubicación", lang)}
          </button>
        )}
      </div>

      {state.status === "loading" && (
        <p className="mt-1 text-xs text-slate-500" role="status">
          {L("Loading locations…", "Cargando ubicaciones…", lang)}
        </p>
      )}

      {state.status === "error" && (
        <div className="mt-2 flex flex-wrap items-center gap-3" role="alert">
          <p className="text-xs text-red-700">
            {L("Saved locations could not be loaded.", "No se pudieron cargar las ubicaciones guardadas.", lang)}
          </p>
          <button type="button" onClick={reload} className="text-xs font-semibold text-brand hover:underline">
            {L("Retry", "Reintentar", lang)}
          </button>
        </div>
      )}

      {state.status === "ready" && locations.length === 0 && (
        <div className="mt-2">
          <p className="text-xs text-slate-500">
            {L(
              "Pin the exact spot of the property, facility or site. Agencies can require map coordinates, and requirements can depend on precise geography.",
              "Marque el lugar exacto de la propiedad, instalación u obra. Las agencias pueden exigir coordenadas y los requisitos pueden depender de la geografía exacta.",
              lang
            )}
          </p>
          {canEdit ? (
          <button
            type="button"
            onClick={() => setDialog({ mode: "add" })}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-[#f6f3ea]"
            data-testid="location-add"
          >
            <MapPin className="h-4 w-4" aria-hidden="true" />
            {L("Add location", "Agregar ubicación", lang)}
          </button>
          ) : (
            <p className="mt-2 text-xs italic text-slate-500">
              {L("No location saved yet.", "Aún no hay una ubicación guardada.", lang)}
            </p>
          )}
        </div>
      )}

      {state.status === "ready" && selected && (
        <div className="mt-2">
          {locations.length > 1 && (
            <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label={L("Saved locations", "Ubicaciones guardadas", lang)}>
              {locations.map((loc) => {
                const active = loc.id === selected.id;
                return (
                  <button
                    key={loc.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => {
                      setSelectedId(loc.id);
                      setConfirmRemove(false);
                    }}
                    className={`max-w-full rounded-lg border px-3 py-1.5 text-left text-xs ${
                      active ? "border-brand bg-brand/5 text-[#161616]" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <span className="block truncate font-semibold">
                      {loc.name || L("Unnamed location", "Ubicación sin nombre", lang)}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {loc.is_primary ? L("Primary · ", "Principal · ", lang) : ""}
                      {currentGeography(loc.geographies, "municipality")?.geography_name ?? loc.municipality ?? `${formatCoordinate(loc.latitude, 4)}, ${formatCoordinate(loc.longitude, 4)}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="break-words text-sm font-semibold text-[#161616]" data-testid="location-name">
                  {selected.name || L("Business location", "Ubicación del negocio", lang)}
                </div>
                {selected.is_primary && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                    {L("Primary", "Principal", lang)}
                  </span>
                )}
              </div>
              {locationAddressLine(selected) ? (
                <div className="mt-0.5 break-words text-sm text-slate-700">{locationAddressLine(selected)}</div>
              ) : (
                <div className="mt-0.5 text-xs italic text-slate-500">
                  {L("No street address — located by coordinates.", "Sin dirección — ubicado por coordenadas.", lang)}
                </div>
              )}
            </div>
            {canEdit && (
            <button
              type="button"
              onClick={() => setDialog({ mode: "edit", location: selected })}
              className="min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
              data-testid="location-edit"
            >
              {L("Edit location", "Editar ubicación", lang)}
            </button>
            )}
          </div>

          <PassportMap
            key={`${selected.id}:${selected.latitude}:${selected.longitude}`}
            point={{ latitude: selected.latitude, longitude: selected.longitude }}
            label={L(
              `Map preview with the saved pin for ${selected.name || "this location"}`,
              `Vista del mapa con el pin guardado de ${selected.name || "esta ubicación"}`,
              lang
            )}
            loadingText={L("Loading map…", "Cargando mapa…", lang)}
            errorText={L("Map preview unavailable. The saved coordinates are below.", "Vista del mapa no disponible. Las coordenadas guardadas están abajo.", lang)}
            className="mt-3 h-44 sm:h-56"
          />

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5 sm:col-span-2">
              <div className="text-[11px] font-medium text-slate-500">{L("Coordinates", "Coordenadas", lang)}</div>
              <div className="mt-0.5 break-all font-mono text-sm font-semibold text-[#161616]" data-testid="location-coordinates">
                {formatCoordinate(selected.latitude)}, {formatCoordinate(selected.longitude)}
              </div>
              {!isWithinPuertoRico(selected.latitude, selected.longitude) && (
                <div className="mt-0.5 text-[11px] font-medium text-amber-800">
                  {L("Outside Puerto Rico", "Fuera de Puerto Rico", lang)}
                </div>
              )}
            </div>
            {CORE_FACTS.map((type) => {
              const geography = currentGeography(selected.geographies, type);
              return (
                <GeographyFact
                  key={type}
                  label={geographyLabel(type, lang)}
                  geography={
                    geography &&
                    (isAuthoritative(geography.determination_method) || geography.determination_method === "USER_PROVIDED")
                      ? geography
                      : null
                  }
                  fallback={type === "municipality" ? municipalityFallback(selected) : null}
                  lang={lang}
                />
              );
            })}
            {extraGeographies.map((g) => (
              <GeographyFact key={g.id} label={geographyLabel(g.geography_type, lang)} geography={g} lang={lang} />
            ))}
          </div>

          <LocationRequirementsPanel
            businessId={businessId}
            locationId={selected.id}
            version={selected.updated_at}
            isPrimary={selected.is_primary}
            canEdit={canEdit}
            lang={lang}
            onPassportUpdated={onPassportUpdated}
          />

          {canEdit && (
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
            {!selected.is_primary && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void makePrimary(selected)}
                className="font-semibold text-brand hover:underline disabled:opacity-40"
              >
                {L("Make primary", "Hacer principal", lang)}
              </button>
            )}
            {confirmRemove ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-slate-600">
                  {L("Remove this location? Projects using it will need a new one.", "¿Eliminar esta ubicación? Los proyectos que la usan necesitarán otra.", lang)}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove(selected)}
                  className="font-semibold text-red-700 hover:underline disabled:opacity-40"
                >
                  {L("Remove", "Eliminar", lang)}
                </button>
                <button type="button" onClick={() => setConfirmRemove(false)} className="font-semibold text-slate-600 hover:underline">
                  {L("Keep", "Conservar", lang)}
                </button>
              </span>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmRemove(true)}
                className="font-semibold text-slate-500 hover:underline disabled:opacity-40"
              >
                {L("Remove location", "Eliminar ubicación", lang)}
              </button>
            )}
          </div>
          )}
        </div>
      )}

      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mt-3 text-xs font-medium ${
            notice.kind === "error" ? "text-red-700" : notice.kind === "warning" ? "text-amber-800" : "text-emerald-700"
          }`}
        >
          {notice.text}
        </p>
      )}

      {dialog && (
        <LocationPickerDialog
          businessId={businessId}
          lang={lang}
          existing={dialog.mode === "edit" ? dialog.location : null}
          defaultName={dialog.mode === "add" && locations.length === 0 ? L("Main location", "Ubicación principal", lang) : ""}
          onClose={() => setDialog(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
