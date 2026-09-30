"use client";

// Add / edit a Passport location: search an address, tap the map, drag the
// pin, or type coordinates — then explicitly confirm with "Use this
// location". Nothing is saved while the user explores the map.

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { PassportMap, type MapPoint } from "../components/map/PassportMap";
import {
  formatCoordinate,
  isWithinPuertoRico,
  validateCoordinates,
  type AddressSource,
  type CoordinateError,
  type CoordinateSource,
  type PassportLocationWithGeographies,
} from "../locations/geo";
import type { GeocodeCandidate } from "../../lib/geocoding";
import type { Lang } from "../forms/engine/types";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

/** Address metadata carried with the point (all provider- or user-derived). */
interface AddressDraft {
  formatted_address: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  municipality: string | null;
  state_or_region: string | null;
  postal_code: string | null;
  country_code: string | null;
  place_source: string | null;
  place_source_id: string | null;
  address_source: AddressSource;
}

const NO_ADDRESS: AddressDraft = {
  formatted_address: null,
  address_line_1: null,
  address_line_2: null,
  city: null,
  municipality: null,
  state_or_region: null,
  postal_code: null,
  country_code: null,
  place_source: null,
  place_source_id: null,
  address_source: "NONE",
};

function addressFromCandidate(c: GeocodeCandidate, source: AddressSource): AddressDraft {
  return {
    formatted_address: c.formatted_address,
    address_line_1: c.address_line_1,
    address_line_2: null,
    city: c.city,
    municipality: c.municipality,
    state_or_region: c.state_or_region,
    postal_code: c.postal_code,
    country_code: c.country_code,
    place_source: c.place_source,
    place_source_id: c.place_source_id,
    address_source: source,
  };
}

type LookupState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "found" }
  | { status: "none" }
  | { status: "unavailable" }
  | { status: "error" };

function coordinateErrorText(error: CoordinateError, lang: Lang): string {
  switch (error) {
    case "latitude_required":
      return L("Enter a latitude.", "Ingrese una latitud.", lang);
    case "longitude_required":
      return L("Enter a longitude.", "Ingrese una longitud.", lang);
    case "latitude_invalid":
      return L("Latitude must be a decimal number, e.g. 18.39123.", "La latitud debe ser un número decimal, p. ej. 18.39123.", lang);
    case "longitude_invalid":
      return L("Longitude must be a decimal number, e.g. -66.11784.", "La longitud debe ser un número decimal, p. ej. -66.11784.", lang);
    case "latitude_out_of_range":
      return L("Latitude must be between -90 and 90.", "La latitud debe estar entre -90 y 90.", lang);
    case "longitude_out_of_range":
      return L("Longitude must be between -180 and 180.", "La longitud debe estar entre -180 y 180.", lang);
  }
}

/** Deterministic Census placement of the selected point (/api/locations/resolve). */
export interface ResolvedPlacement {
  municipality: { fips: string; name: string };
  barrio: { geoid: string; name: string; barrio_pueblo: boolean } | null;
  near_boundary: boolean;
  boundary_distance_m: number;
  source: { id: string; name: string; version: string; url: string };
}

/** What pick mode hands back to the caller (e.g. the intake). */
export interface PickedSite {
  latitude: number;
  longitude: number;
  coordinate_source: CoordinateSource;
  formatted_address: string | null;
  placement: ResolvedPlacement;
  designations: string[];
  /** Set when the site was also saved to the business's Passport. */
  savedLocation: PassportLocationWithGeographies | null;
}

export interface LocationPickerDialogProps {
  /** Business whose Passport the location is saved to (required in save mode). */
  businessId?: string | null;
  lang: Lang;
  /**
   * "save" (default): add/edit a Passport location.
   * "pick": choose a site for a question that needs a location (intake); the
   * result is returned via onPicked, optionally also saved to the Passport.
   */
  mode?: "save" | "pick";
  /** Existing location to edit; omit to add a new one. */
  existing?: PassportLocationWithGeographies | null;
  /** Default name for a new location (e.g. the first one is the main premises). */
  defaultName?: string;
  /** Pick mode: offer "also save to the Passport" (needs businessId). */
  offerSave?: boolean;
  /**
   * Prefill the address search (e.g. a municipio or address the user already
   * mentioned) and run it once when the dialog opens.
   */
  initialQuery?: string | null;
  /** Dialog title override (pick mode). */
  title?: string;
  onClose: () => void;
  onSaved?: (location: PassportLocationWithGeographies, warnings: string[]) => void;
  onPicked?: (site: PickedSite) => void;
}

type PlacementState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; placement: ResolvedPlacement | null; designations: string[] }
  | { status: "error" };

export function LocationPickerDialog({
  businessId,
  lang,
  mode = "save",
  existing,
  defaultName,
  offerSave = false,
  initialQuery = null,
  title,
  onClose,
  onSaved,
  onPicked,
}: LocationPickerDialogProps) {
  const pickMode = mode === "pick";
  const titleId = useId();
  const latId = useId();
  const lngId = useId();
  const nameId = useId();
  const searchId = useId();
  const addressId = useId();
  const coordErrId = useId();

  const [name, setName] = useState(existing?.name ?? defaultName ?? "");
  const [point, setPoint] = useState<MapPoint | null>(
    existing ? { latitude: existing.latitude, longitude: existing.longitude } : null
  );
  const [coordinateSource, setCoordinateSource] = useState<CoordinateSource>(existing?.coordinate_source ?? "MAP_PIN");
  const [latText, setLatText] = useState(existing ? String(existing.latitude) : "");
  const [lngText, setLngText] = useState(existing ? String(existing.longitude) : "");
  const [coordErrors, setCoordErrors] = useState<CoordinateError[]>([]);
  const [address, setAddress] = useState<AddressDraft>(
    existing
      ? {
          formatted_address: existing.formatted_address,
          address_line_1: existing.address_line_1,
          address_line_2: existing.address_line_2,
          city: existing.city,
          municipality: existing.municipality,
          state_or_region: existing.state_or_region,
          postal_code: existing.postal_code,
          country_code: existing.country_code,
          place_source: existing.place_source,
          place_source_id: existing.place_source_id,
          address_source: existing.address_source,
        }
      : NO_ADDRESS
  );
  const [addressText, setAddressText] = useState(existing?.formatted_address ?? "");
  const [lookup, setLookup] = useState<LookupState>({ status: "idle" });

  const [query, setQuery] = useState(initialQuery?.trim() ?? "");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GeocodeCandidate[] | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [searchConfigured, setSearchConfigured] = useState(true);

  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [placement, setPlacement] = useState<PlacementState>(existing ? { status: "loading" } : { status: "idle" });
  const [saveToPassport, setSaveToPassport] = useState(true);
  const placementSeq = useRef(0);

  const lookupSeq = useRef(0);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // Escape closes (unless a save is in flight). Read through a ref so the
  // mount-only effect below never re-runs and steals focus mid-edit.
  const closeRef = useRef<() => void>(() => {});
  useEffect(() => {
    closeRef.current = () => {
      if (!saving) onClose();
    };
  }, [onClose, saving]);

  // Mount only: initial focus, Escape handler, body scroll lock; restore focus on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    firstFieldRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  /**
   * Describe the new point with a reverse lookup. Confirmation waits for it
   * (so the save carries the address the summary shows), but only briefly: a
   * slow or failed lookup ends in "couldn't be looked up" and saving resumes.
   */
  const reverseLookup = useCallback(
    async (p: MapPoint) => {
      const seq = ++lookupSeq.current;
      setLookup({ status: "loading" });
      try {
        const res = await fetch(
          `/api/geocode?lat=${encodeURIComponent(p.latitude)}&lng=${encodeURIComponent(p.longitude)}&lang=${lang}`,
          { cache: "no-store", signal: AbortSignal.timeout(12_000) }
        );
        if (seq !== lookupSeq.current) return;
        if (res.status === 503) {
          setSearchConfigured(false);
          setSearchMessage(
            L(
              "Address search isn't available right now. Tap the map to place the pin, or enter coordinates below.",
              "La búsqueda de direcciones no está disponible. Toque el mapa para colocar el pin o ingrese coordenadas abajo.",
              lang
            )
          );
          setLookup({ status: "unavailable" });
          return;
        }
        if (!res.ok) {
          setLookup({ status: "error" });
          return;
        }
        const data = (await res.json()) as { result: GeocodeCandidate | null };
        if (seq !== lookupSeq.current) return;
        if (data.result && (data.result.formatted_address || data.result.address_line_1)) {
          const next = addressFromCandidate(data.result, "PROVIDER_REVERSE_GEOCODE");
          setAddress(next);
          setAddressText(next.formatted_address ?? "");
          setLookup({ status: "found" });
        } else {
          setLookup({ status: "none" });
        }
      } catch {
        if (seq === lookupSeq.current) setLookup({ status: "error" });
      }
    },
    [lang]
  );

  /** Census municipio/barrio for the point — local and fast, never blocks. */
  const resolvePlacement = useCallback(async (p: MapPoint) => {
    const seq = ++placementSeq.current;
    setPlacement({ status: "loading" });
    try {
      const res = await fetch(`/api/locations/resolve?lat=${encodeURIComponent(p.latitude)}&lng=${encodeURIComponent(p.longitude)}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { placement: ResolvedPlacement | null; designations: string[] };
      if (seq === placementSeq.current) setPlacement({ status: "ready", placement: data.placement, designations: data.designations ?? [] });
    } catch {
      if (seq === placementSeq.current) setPlacement({ status: "error" });
    }
  }, []);

  // An existing pin (edit) is described immediately.
  useEffect(() => {
    if (!existing) return;
    // Initial state is already "loading" for an existing pin.
    const seq = ++placementSeq.current;
    fetch(`/api/locations/resolve?lat=${encodeURIComponent(existing.latitude)}&lng=${encodeURIComponent(existing.longitude)}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { placement: ResolvedPlacement | null; designations: string[] };
        if (seq === placementSeq.current) setPlacement({ status: "ready", placement: data.placement, designations: data.designations ?? [] });
      })
      .catch(() => {
        if (seq === placementSeq.current) setPlacement({ status: "error" });
      });
  }, [existing]);

  /** Any change of point: the previous address no longer describes it. */
  const movePoint = useCallback(
    (p: MapPoint, source: CoordinateSource, lookupAddress: boolean) => {
      const v = validateCoordinates(p.latitude, p.longitude);
      if (!v.ok) {
        setCoordErrors(v.errors);
        return;
      }
      const next = { latitude: v.latitude, longitude: v.longitude };
      setPoint(next);
      setCoordinateSource(source);
      setLatText(String(next.latitude));
      setLngText(String(next.longitude));
      setCoordErrors([]);
      setSaveError(null);
      void resolvePlacement(next);
      if (lookupAddress) {
        setAddress(NO_ADDRESS);
        setAddressText("");
        void reverseLookup(next);
      }
    },
    [reverseLookup, resolvePlacement]
  );

  const onMapPick = useCallback((p: MapPoint) => movePoint(p, "MAP_PIN", true), [movePoint]);

  const applyManual = () => {
    const v = validateCoordinates(latText, lngText);
    if (!v.ok) {
      setCoordErrors(v.errors);
      return;
    }
    movePoint({ latitude: v.latitude, longitude: v.longitude }, "MANUAL_ENTRY", true);
  };

  const runSearch = async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setSearching(true);
    setSearchMessage(null);
    setResults(null);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&lang=${lang}`, { cache: "no-store" });
      if (res.status === 503) {
        setSearchConfigured(false);
        setSearchMessage(
          L(
            "Address search isn't available right now. Tap the map to place the pin, or enter coordinates below.",
            "La búsqueda de direcciones no está disponible. Toque el mapa para colocar el pin o ingrese coordenadas abajo.",
            lang
          )
        );
        return;
      }
      if (res.status === 429) {
        setSearchMessage(L("Too many searches — wait a moment and try again.", "Demasiadas búsquedas — espere un momento e intente de nuevo.", lang));
        return;
      }
      if (!res.ok) {
        setSearchMessage(
          L(
            "Address search failed. You can still place the pin on the map or enter coordinates.",
            "La búsqueda falló. Aún puede colocar el pin en el mapa o ingresar coordenadas.",
            lang
          )
        );
        return;
      }
      const data = (await res.json()) as { results: GeocodeCandidate[] };
      setResults(data.results);
      if (!data.results.length) {
        setSearchMessage(
          L(
            "No matching address in Puerto Rico. Try a nearby landmark, or place the pin directly on the map.",
            "No se encontró la dirección en Puerto Rico. Pruebe un punto de referencia cercano o coloque el pin en el mapa.",
            lang
          )
        );
      }
    } catch {
      setSearchMessage(L("Address search failed. Check your connection.", "La búsqueda falló. Verifique su conexión.", lang));
    } finally {
      setSearching(false);
    }
  };

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    await runSearch(query);
  };

  // A prefilled query (what the user already told us) is searched once on open.
  const initialSearchDone = useRef(false);
  useEffect(() => {
    if (initialSearchDone.current || !initialQuery?.trim()) return;
    initialSearchDone.current = true;
    void runSearch(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);


  const chooseResult = (c: GeocodeCandidate) => {
    lookupSeq.current += 1; // cancel any in-flight reverse lookup
    movePoint({ latitude: c.latitude, longitude: c.longitude }, "GEOCODED_ADDRESS", false);
    const next = addressFromCandidate(c, "PROVIDER_GEOCODE");
    setAddress(next);
    setAddressText(next.formatted_address ?? "");
    setLookup({ status: "found" });
    setResults(null);
  };

  const onAddressEdit = (value: string) => {
    // The user's own text wins: cancel any in-flight reverse lookup so a late
    // provider result can never overwrite it (or relabel its provenance).
    lookupSeq.current += 1;
    setLookup((prev) => (prev.status === "loading" ? { status: "idle" } : prev));
    setAddressText(value);
    // A hand-edited address is user-provided text; provider parts no longer apply.
    setAddress({ ...NO_ADDRESS, formatted_address: value.trim() || null, address_source: value.trim() ? "USER_PROVIDED" : "NONE" });
  };

  /** Persist to the Passport; returns the saved location, or null (error shown). */
  const persist = async (): Promise<{ location: PassportLocationWithGeographies; warnings: string[] } | null> => {
    if (!point || !businessId) return null;
    try {
      const body = {
        name: name.trim() || null,
        latitude: point.latitude,
        longitude: point.longitude,
        coordinate_source: coordinateSource,
        ...address,
      };
      const url = existing
        ? `/api/businesses/${encodeURIComponent(businessId)}/locations/${encodeURIComponent(existing.id)}`
        : `/api/businesses/${encodeURIComponent(businessId)}/locations`;
      const res = await fetch(url, {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const details = Array.isArray(data.details) ? (data.details as string[]) : [];
        const coordProblems = details.filter((d): d is CoordinateError => /^(latitude|longitude)_/.test(d));
        if (coordProblems.length) setCoordErrors(coordProblems);
        setSaveError(
          res.status === 401
            ? L("Your session expired. Sign in again to save.", "Su sesión expiró. Inicie sesión para guardar.", lang)
            : res.status === 404
              ? L("This business or location is no longer available.", "Este negocio o ubicación ya no está disponible.", lang)
              : coordProblems.length
                ? L("Fix the coordinates and try again.", "Corrija las coordenadas e intente de nuevo.", lang)
                : L("The location could not be saved. Try again.", "No se pudo guardar la ubicación. Intente de nuevo.", lang)
        );
        return null;
      }
      return { location: data.location as PassportLocationWithGeographies, warnings: (data.warnings as string[]) ?? [] };
    } catch {
      setSaveError(L("The location could not be saved. Check your connection and try again.", "No se pudo guardar la ubicación. Verifique su conexión e intente de nuevo.", lang));
      return null;
    }
  };

  const save = async () => {
    if (!point) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (pickMode) {
        if (placement.status !== "ready" || !placement.placement) return;
        let savedLocation: PassportLocationWithGeographies | null = null;
        if (offerSave && businessId && saveToPassport) {
          const saved = await persist();
          if (!saved) return;
          savedLocation = saved.location;
        }
        onPicked?.({
          latitude: point.latitude,
          longitude: point.longitude,
          coordinate_source: coordinateSource,
          formatted_address: address.formatted_address,
          placement: placement.placement,
          designations: placement.designations,
          savedLocation,
        });
        return;
      }
      const saved = await persist();
      if (saved) onSaved?.(saved.location, saved.warnings);
    } finally {
      setSaving(false);
    }
  };

  const outsidePR = point ? !isWithinPuertoRico(point.latitude, point.longitude) : false;
  const inputCls =
    "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base font-normal text-[#161616] sm:text-sm";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/40 sm:items-center sm:p-4"
      onClick={() => !saving && onClose()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-[100dvh] w-full flex-col bg-white shadow-xl sm:h-auto sm:max-h-[92vh] sm:max-w-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
        data-testid="location-picker-dialog"
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 id={titleId} className="text-base font-bold text-[#161616]">
              {pickMode
                ? title ?? L("Find the site on the map", "Busque el lugar en el mapa", lang)
                : existing
                  ? L("Edit location", "Editar ubicación", lang)
                  : L("Add location", "Agregar ubicación", lang)}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {L(
                "Search for an address, or tap the map where the property is. Drag the pin to the exact spot.",
                "Busque una dirección o toque el mapa donde está la propiedad. Arrastre el pin al lugar exacto.",
                lang
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label={L("Close", "Cerrar", lang)}
            className="-mr-2 rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {(!pickMode || (offerSave && businessId && saveToPassport)) && (
            <div className="mb-4">
          <label htmlFor={nameId} className="block text-xs font-semibold text-slate-600">
              {L("Location name", "Nombre de la ubicación", lang)}
              <span className="font-normal text-slate-400"> {L("(optional)", "(opcional)", lang)}</span>
            </label>
            <input
              id={nameId}
              ref={firstFieldRef}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              placeholder={L("e.g. Guaynabo Manufacturing Facility", "p. ej. Planta de manufactura en Guaynabo", lang)}
              className={inputCls}
            />
            </div>
          )}
          <form onSubmit={search} role="search">
            <label htmlFor={searchId} className="block text-xs font-semibold text-slate-600">
              {L("Search address or place", "Buscar dirección o lugar", lang)}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id={searchId}
                type="search"
                value={query}
                maxLength={200}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={L("123 Calle Ejemplo, Guaynabo", "123 Calle Ejemplo, Guaynabo", lang)}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2.5 text-base text-[#161616] sm:text-sm"
                disabled={!searchConfigured}
              />
              <button
                type="submit"
                disabled={searching || !query.trim() || !searchConfigured}
                className="shrink-0 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-40"
              >
                {searching ? L("Searching…", "Buscando…", lang) : L("Search", "Buscar", lang)}
              </button>
            </div>
          </form>
          <div aria-live="polite">
            {searchMessage && <p className="mt-2 text-xs text-slate-600">{searchMessage}</p>}
            {results && results.length > 0 && (
              <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
                {results.map((r, i) => (
                  <li key={`${r.place_source_id ?? i}`}>
                    <button
                      type="button"
                      onClick={() => chooseResult(r)}
                      className="w-full px-3 py-2.5 text-left text-sm text-[#161616] hover:bg-slate-50"
                    >
                      {r.formatted_address ?? `${formatCoordinate(r.latitude)}, ${formatCoordinate(r.longitude)}`}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p id={`${titleId}-map-help`} className="mt-4 text-xs text-slate-500">
            {L(
              "Map: pinch or use + / − to zoom, drag to pan, tap to drop the pin, then drag the pin to adjust. If the map is hard to use, type the coordinates instead.",
              "Mapa: pellizque o use + / − para acercar, arrastre para mover, toque para colocar el pin y arrástrelo para ajustar. Si el mapa es difícil de usar, escriba las coordenadas.",
              lang
            )}
          </p>
          <PassportMap
            interactive
            point={point}
            onPick={onMapPick}
            onStatusChange={setMapStatus}
            label={L("Map of Puerto Rico for choosing the property location", "Mapa de Puerto Rico para escoger la ubicación de la propiedad", lang)}
            loadingText={L("Loading map…", "Cargando mapa…", lang)}
            errorText={L(
              "The map could not load. Enter the latitude and longitude below — the location can still be saved.",
              "El mapa no pudo cargar. Ingrese la latitud y longitud abajo — aún puede guardar la ubicación.",
              lang
            )}
            className="mt-2 h-[42dvh] min-h-[260px] touch-none sm:h-72"
          />

          <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-3" aria-live="polite">
            {point ? (
              <>
                <div className="text-[11px] font-medium text-slate-500">{L("Selected point", "Punto seleccionado", lang)}</div>
                <div className="mt-0.5 break-words font-mono text-sm font-semibold text-[#161616]" data-testid="location-selected-coordinates">
                  {L("Latitude", "Latitud", lang)}: {formatCoordinate(point.latitude)}
                  <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
                  {L("Longitude", "Longitud", lang)}: {formatCoordinate(point.longitude)}
                </div>
                {addressText && lookup.status !== "loading" && (
                  <div className="mt-1 break-words text-sm text-[#161616]" data-testid="location-selected-address">
                    {addressText}
                  </div>
                )}
                <div className="mt-1 text-xs text-slate-700" data-testid="location-selected-placement">
                  {placement.status === "loading" && L("Finding the municipio…", "Buscando el municipio…", lang)}
                  {placement.status === "error" &&
                    L("The municipio couldn't be determined right now.", "No se pudo determinar el municipio ahora.", lang)}
                  {placement.status === "ready" &&
                    (placement.placement ? (
                      <>
                        <span className="font-semibold">
                          {L("Municipio", "Municipio", lang)}: {placement.placement.municipality.name}
                        </span>
                        {placement.placement.barrio && (
                          <>
                            <span className="mx-1.5 text-slate-300" aria-hidden="true">·</span>
                            {L("Barrio", "Barrio", lang)}: {placement.placement.barrio.name}
                            {placement.placement.barrio.barrio_pueblo ? L(" (pueblo)", " (pueblo)", lang) : ""}
                          </>
                        )}
                        <span className="block text-[11px] text-slate-500">
                          {L("From U.S. Census boundaries", "Según los límites del Censo de EE. UU.", lang)} ({placement.placement.source.version})
                          {placement.placement.near_boundary &&
                            L(" — very close to a boundary, confirm the pin", " — muy cerca de un límite, confirme el pin", lang)}
                        </span>
                      </>
                    ) : (
                      <span className="font-medium text-amber-800">
                        {L("This point isn't inside a Puerto Rico municipio.", "Este punto no está dentro de un municipio de Puerto Rico.", lang)}
                      </span>
                    ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-600">
                {L("No point selected yet.", "Aún no ha seleccionado un punto.", lang)}
              </p>
            )}
            {outsidePR && (
              <p className="mt-2 text-xs font-medium text-amber-800" role="status">
                {L(
                  "This point is outside Puerto Rico. SmartPR currently evaluates Puerto Rico requirements — double-check the pin.",
                  "Este punto está fuera de Puerto Rico. SmartPR evalúa actualmente requisitos de Puerto Rico — verifique el pin.",
                  lang
                )}
              </p>
            )}
            {lookup.status === "loading" && (
              <p className="mt-2 text-xs text-slate-500">{L("Looking up the address for this point…", "Buscando la dirección de este punto…", lang)}</p>
            )}
            {lookup.status === "none" && (
              <p className="mt-2 text-xs text-slate-600">
                {L(
                  "No street address was found for this point. That's common for land, construction sites and rural parcels — you can still save the coordinates.",
                  "No se encontró una dirección para este punto. Es común en terrenos, obras y fincas — aún puede guardar las coordenadas.",
                  lang
                )}
              </p>
            )}
            {(lookup.status === "unavailable" || lookup.status === "error") && (
              <p className="mt-2 text-xs text-slate-600">
                {L(
                  "The address for this point couldn't be looked up. You can still save the coordinates and type an address below.",
                  "No se pudo buscar la dirección de este punto. Aún puede guardar las coordenadas y escribir una dirección abajo.",
                  lang
                )}
              </p>
            )}
            {mapStatus === "error" && !point && (
              <p className="mt-2 text-xs text-slate-600">
                {L("Enter coordinates below to continue.", "Ingrese coordenadas abajo para continuar.", lang)}
              </p>
            )}
          </div>

          <label htmlFor={addressId} className="mt-3 block text-xs font-semibold text-slate-600">
            {L("Address or site description", "Dirección o descripción del lugar", lang)}
            <span className="font-normal text-slate-400"> {L("(optional)", "(opcional)", lang)}</span>
          </label>
          <input
            id={addressId}
            value={addressText}
            maxLength={400}
            onChange={(e) => onAddressEdit(e.target.value)}
            placeholder={L("e.g. Carr. 2 km 14.2, Bo. Pueblo Viejo", "p. ej. Carr. 2 km 14.2, Bo. Pueblo Viejo", lang)}
            className={inputCls}
          />
          {address.address_source === "PROVIDER_GEOCODE" || address.address_source === "PROVIDER_REVERSE_GEOCODE" ? (
            <p className="mt-1 text-[11px] text-slate-500">
              {L(
                "From address lookup. The pin's coordinates are what SmartPR uses; the address is for reference.",
                "De la búsqueda de direcciones. SmartPR usa las coordenadas del pin; la dirección es de referencia.",
                lang
              )}
            </p>
          ) : null}

          <fieldset className="mt-4">
            <legend className="text-xs font-semibold text-slate-600">
              {L("Coordinates (WGS84)", "Coordenadas (WGS84)", lang)}
            </legend>
            <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label htmlFor={latId} className="block text-[11px] font-medium text-slate-500">
                {L("Latitude", "Latitud", lang)}
                <input
                  id={latId}
                  inputMode="decimal"
                  autoComplete="off"
                  value={latText}
                  onChange={(e) => setLatText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyManual())}
                  aria-invalid={coordErrors.some((c) => c.startsWith("latitude"))}
                  aria-describedby={coordErrId}
                  placeholder="18.39123"
                  className={inputCls}
                  data-testid="location-latitude"
                />
              </label>
              <label htmlFor={lngId} className="block text-[11px] font-medium text-slate-500">
                {L("Longitude", "Longitud", lang)}
                <input
                  id={lngId}
                  inputMode="decimal"
                  autoComplete="off"
                  value={lngText}
                  onChange={(e) => setLngText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyManual())}
                  aria-invalid={coordErrors.some((c) => c.startsWith("longitude"))}
                  aria-describedby={coordErrId}
                  placeholder="-66.11784"
                  className={inputCls}
                  data-testid="location-longitude"
                />
              </label>
              <button
                type="button"
                onClick={applyManual}
                className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                {L("Place pin", "Colocar pin", lang)}
              </button>
            </div>
            <div id={coordErrId} role="alert" className="mt-1 space-y-0.5">
              {coordErrors.map((err) => (
                <p key={err} className="text-xs font-medium text-red-700">
                  {coordinateErrorText(err, lang)}
                </p>
              ))}
            </div>
          </fieldset>

          {pickMode && offerSave && businessId && (
            <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={saveToPassport}
                onChange={(e) => setSaveToPassport(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                {L(
                  "Also save this site to the business's Passport locations, so projects and filings can reuse it.",
                  "Guardar también este lugar en las ubicaciones del Pasaporte del negocio, para reutilizarlo en proyectos y trámites.",
                  lang
                )}
              </span>
            </label>
          )}

          {saveError && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-700">
              {saveError}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-end">
          {/* Always-visible summary of what "Use this location" will save. */}
          <div className="min-w-0 text-xs text-slate-600 sm:mr-auto" data-testid="location-footer-summary" aria-hidden="true">
            {point ? (
              <>
                <div className="font-mono font-semibold text-[#161616]">
                  {formatCoordinate(point.latitude)}, {formatCoordinate(point.longitude)}
                </div>
                <div className="truncate">
                  {lookup.status === "loading"
                    ? L("Looking up address…", "Buscando dirección…", lang)
                    : addressText || L("No street address", "Sin dirección", lang)}
                </div>
                {placement.status === "ready" && placement.placement && (
                  <div className="truncate font-semibold text-[#161616]">
                    {placement.placement.barrio ? `${placement.placement.barrio.name}, ` : ""}
                    {placement.placement.municipality.name}
                  </div>
                )}
              </>
            ) : (
              <span>{L("Tap the map to choose a point", "Toque el mapa para escoger un punto", lang)}</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-11 rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-40"
          >
            {L("Cancel", "Cancelar", lang)}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={
              !point ||
              saving ||
              lookup.status === "loading" ||
              // Pick mode hands back a municipio, so it needs one.
              (pickMode && (placement.status !== "ready" || !placement.placement))
            }
            className="min-h-11 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-[#f6f3ea] disabled:opacity-40"
            data-testid="location-confirm"
          >
            {saving
              ? L("Saving…", "Guardando…", lang)
              : lookup.status === "loading"
                ? L("Finding address…", "Buscando dirección…", lang)
                : pickMode
                  ? L("Use this site", "Usar este lugar", lang)
                  : L("Use this location", "Usar esta ubicación", lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
