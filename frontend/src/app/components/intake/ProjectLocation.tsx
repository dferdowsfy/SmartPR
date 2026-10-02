"use client";

/**
 * "Project location" — one embedded intake workflow for where the project is.
 *
 * Address search is the primary input; "Choose on map" expands the existing
 * PassportMap inline (no modal). Either way the result is the existing
 * IntakeSite object (coordinates + resolved address + Census municipio +
 * designations), handed to the intake's existing `onConfirm`
 * (confirmIntakeSite), which sets the municipality, saves it to the Passport
 * when a business exists, and runs the official-map lookups.
 *
 * Reused, unchanged: /api/geocode (search + reverse), /api/locations/resolve
 * (Census municipio/barrio + KB designations), PassportMap (tap to pin, drag
 * to adjust, zoom/pan), coordinate validation, intakeSiteFromPick/Placement,
 * SiteLayerChips (FEMA / zoning / parcel results).
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, MapPin, Search } from "lucide-react";
import { PassportMap, type MapPoint } from "../map/PassportMap";
import { formatCoordinate, validateCoordinates, type CoordinateSource, type PassportLocationWithGeographies } from "../../locations/geo";
import type { IntakeSite } from "../../locations/intakeLocation";
import type { ResolvedPlacement } from "../../businesses/LocationPickerDialog";
import type { GeocodeCandidate } from "../../../lib/geocoding";
import type { Lang } from "../../forms/engine/types";
import { intakeSiteFromPlacement, SiteLayerChips } from "./LocationStepCard";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

type Resolve = { placement: ResolvedPlacement | null; designations: string[] } | "error";

async function resolvePoint(p: MapPoint): Promise<Resolve> {
  try {
    const res = await fetch(`/api/locations/resolve?lat=${encodeURIComponent(p.latitude)}&lng=${encodeURIComponent(p.longitude)}`, { cache: "no-store" });
    if (!res.ok) return "error";
    const data = (await res.json()) as { placement: ResolvedPlacement | null; designations?: string[] };
    return { placement: data.placement, designations: data.designations ?? [] };
  } catch {
    return "error";
  }
}

export function ProjectLocation({
  lang, site, businessId, onConfirm, onRetryLayers, initialQuery, municipalityFallback, searchInputId, missingNote, invalid, knownMunicipality, onClear,
}: {
  lang: Lang;
  site: IntakeSite | null;
  businessId: string | null;
  onConfirm: (site: IntakeSite) => void;
  onRetryLayers?: () => void;
  /** Something the user already said (e.g. their municipio) to prefill the search. */
  initialQuery?: string | null;
  /** The intake's municipality select — shown only when detection fails. */
  municipalityFallback: ReactNode;
  /** id for the search input (the "Still needed" chip focuses it). */
  searchInputId: string;
  /** Inline "still needed" note when the location is the next/missing answer. */
  missingNote?: ReactNode;
  invalid?: boolean;
  /** Municipality already known without a site (description / Passport). */
  knownMunicipality?: string | null;
  /** Drop a previously confirmed site (a new address/pin couldn't be resolved). */
  onClear?: () => void;
}) {
  const headingId = useId();
  const helpId = useId();
  const [query, setQuery] = useState(site?.formatted_address ?? initialQuery ?? "");
  const [mapOpen, setMapOpen] = useState(false);
  const [busy, setBusy] = useState<null | "search" | "resolve">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<GeocodeCandidate[]>([]);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<MapPoint | null>(null);
  const seq = useRef(0);
  const point: MapPoint | null = pending ?? (site ? { latitude: site.latitude, longitude: site.longitude } : null);

  /** Resolve the municipio for a point and hand the site to the intake. */
  const commit = useCallback(
    async (p: MapPoint, source: CoordinateSource, address: string | null, savedId: string | null = null) => {
      const v = validateCoordinates(p.latitude, p.longitude);
      if (!v.ok) {
        setMessage(L("That point isn't a valid location.", "Ese punto no es una ubicación válida.", lang));
        return;
      }
      const my = ++seq.current;
      setPending({ latitude: v.latitude, longitude: v.longitude });
      setBusy("resolve");
      setFailed(false);
      const r = await resolvePoint({ latitude: v.latitude, longitude: v.longitude });
      if (my !== seq.current) return;
      setBusy(null);
      if (r === "error" || !r.placement) {
        // The old site no longer matches what the user entered: don't keep it.
        onClear?.();
        setFailed(true);
        setMessage(null);
        return;
      }
      setPending(null);
      onConfirm(intakeSiteFromPlacement({ latitude: v.latitude, longitude: v.longitude, coordinate_source: source, formatted_address: address }, r.placement, r.designations, savedId));
    },
    [lang, onConfirm, onClear]
  );

  /** Address → first match: pin it, center the map, determine the municipio. */
  const runSearch = async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setBusy("search");
    setMessage(null);
    setAlternatives([]);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&lang=${lang}`, { cache: "no-store" });
      if (res.status === 503 || res.status === 429 || !res.ok) {
        setBusy(null);
        setMessage(
          res.status === 429
            ? L("Too many searches — wait a moment and try again.", "Demasiadas búsquedas — espere un momento e intente de nuevo.", lang)
            : L("Address search isn't available right now. Choose the site on the map instead.", "La búsqueda de direcciones no está disponible. Escoja el lugar en el mapa.", lang)
        );
        if (res.status === 503) setMapOpen(true);
        return;
      }
      const data = (await res.json()) as { results: GeocodeCandidate[] };
      if (!data.results.length) {
        setBusy(null);
        setMessage(L("No matching address in Puerto Rico. Try a nearby landmark, or choose the site on the map.", "No se encontró la dirección en Puerto Rico. Pruebe un punto de referencia cercano o escoja el lugar en el mapa.", lang));
        return;
      }
      const [first, ...rest] = data.results;
      setAlternatives(rest.slice(0, 4));
      setQuery(first!.formatted_address ?? q);
      await commit({ latitude: first!.latitude, longitude: first!.longitude }, "GEOCODED_ADDRESS", first!.formatted_address ?? null);
    } catch {
      setBusy(null);
      setMessage(L("Address search failed. Check your connection, or choose the site on the map.", "La búsqueda falló. Verifique su conexión o escoja el lugar en el mapa.", lang));
    }
  };

  /** Map tap / pin drag → reverse-geocode the address, then resolve and confirm. */
  const onMapPick = useCallback(
    async (p: MapPoint) => {
      setAlternatives([]);
      setPending(p);
      let address: string | null = null;
      try {
        const res = await fetch(`/api/geocode?lat=${encodeURIComponent(p.latitude)}&lng=${encodeURIComponent(p.longitude)}&lang=${lang}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
        if (res.ok) {
          const data = (await res.json()) as { result: GeocodeCandidate | null };
          address = data.result?.formatted_address ?? data.result?.address_line_1 ?? null;
        }
      } catch {
        /* no address — the pin is exact on its own */
      }
      if (address) setQuery(address);
      await commit(p, "MAP_PIN", address);
    },
    [commit, lang]
  );

  // The business's saved locations (Passport → Property / Location).
  const [saved, setSaved] = useState<PassportLocationWithGeographies[]>([]);
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    fetch(`/api/businesses/${encodeURIComponent(businessId)}/locations`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { locations: [] }))
      .then((d: { locations?: PassportLocationWithGeographies[] }) => { if (!cancelled) setSaved(Array.isArray(d.locations) ? d.locations : []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [businessId]);

  const confirmed = site && !pending && !busy;

  return (
    <section className="spr-ploc" aria-labelledby={headingId} data-testid="project-location">
      <h2 id={headingId} className="spr-ploc-title">{L("Project location", "Ubicación del proyecto", lang)}</h2>
      <p id={helpId} className="spr-ploc-help">
        {L(
          "Enter the address or select the exact site on the map. SmartPR will determine the municipality and location-specific requirements.",
          "Escribe la dirección o selecciona el lugar exacto en el mapa. SmartPR determinará el municipio y los requisitos según la ubicación.",
          lang
        )}
      </p>

      <form role="search" className="spr-ploc-search" onSubmit={(e) => { e.preventDefault(); void runSearch(query); }}>
        <label htmlFor={searchInputId} className="sr-only">{L("Search address, business, or place", "Buscar dirección, negocio o lugar", lang)}</label>
        <Search className="spr-ploc-search-icon" aria-hidden="true" />
        <input
          id={searchInputId}
          type="search"
          value={query}
          maxLength={200}
          autoComplete="street-address"
          onChange={(e) => setQuery(e.target.value)}
          placeholder={L("Search address, business, or place", "Buscar dirección, negocio o lugar", lang)}
          aria-describedby={missingNote ? `${helpId} spr-missing-municipality` : helpId}
          aria-invalid={invalid || undefined}
          className="spr-ploc-input"
          data-testid="project-location-search"
        />
        <button type="submit" className="spr-ploc-find" disabled={!query.trim() || busy !== null} data-testid="project-location-find">
          {busy === "search" ? <Loader2 className="spr-loc-spin" aria-hidden="true" /> : L("Find", "Buscar", lang)}
        </button>
      </form>
      {missingNote}

      <div className="spr-ploc-actions">
        <button type="button" className="spr-ploc-map-toggle" aria-expanded={mapOpen} aria-controls={`${headingId}-map`} onClick={() => setMapOpen((o) => !o)} data-testid="project-location-map-toggle">
          <MapPin aria-hidden="true" /> {mapOpen ? L("Hide map", "Ocultar mapa", lang) : L("Choose on map", "Escoger en el mapa", lang)}
        </button>
        {saved.length > 0 && !site && (
          <span className="spr-ploc-saved" role="group" aria-label={L("Saved locations", "Ubicaciones guardadas", lang)}>
            {saved.map((loc) => (
              <button
                key={loc.id}
                type="button"
                className="spr-ploc-saved-item"
                onClick={() => void commit({ latitude: loc.latitude, longitude: loc.longitude }, loc.coordinate_source, loc.formatted_address, loc.id)}
                data-testid="location-saved-option"
              >
                {loc.name || loc.formatted_address || `${formatCoordinate(loc.latitude, 4)}, ${formatCoordinate(loc.longitude, 4)}`}
              </button>
            ))}
          </span>
        )}
      </div>

      <div aria-live="polite">
        {message && <p className="spr-ploc-message" role="status">{message}</p>}
        {alternatives.length > 0 && (
          <div className="spr-ploc-alts">
            <span>{L("Not the right place?", "¿No es el lugar correcto?", lang)}</span>
            {alternatives.map((c, i) => (
              <button key={c.place_source_id ?? i} type="button" className="spr-link" onClick={() => { setQuery(c.formatted_address ?? ""); setAlternatives([]); void commit({ latitude: c.latitude, longitude: c.longitude }, "GEOCODED_ADDRESS", c.formatted_address ?? null); }}>
                {c.formatted_address ?? `${formatCoordinate(c.latitude)}, ${formatCoordinate(c.longitude)}`}
              </button>
            ))}
          </div>
        )}
      </div>

      {mapOpen && (
        <div id={`${headingId}-map`} className="spr-ploc-map" data-testid="project-location-map">
          <PassportMap
            interactive
            point={point}
            onPick={(p) => void onMapPick(p)}
            label={L("Map of Puerto Rico — tap to place the pin, drag it to adjust", "Mapa de Puerto Rico — toque para colocar el pin y arrástrelo para ajustar", lang)}
            loadingText={L("Loading map…", "Cargando mapa…", lang)}
            errorText={L("The map could not load. Search for the address above instead.", "El mapa no pudo cargar. Busque la dirección arriba.", lang)}
            className="h-[min(52dvh,420px)] min-h-[260px] touch-none"
          />
        </div>
      )}

      {busy === "resolve" && (
        <p className="spr-ploc-message" role="status"><Loader2 className="spr-loc-spin" aria-hidden="true" /> {L("Finding the municipality…", "Buscando el municipio…", lang)}</p>
      )}

      {failed && (
        <div className="spr-ploc-fallback" data-testid="project-location-fallback">
          <p>{L("We couldn’t determine the municipality automatically. Please select it below.", "No pudimos determinar el municipio automáticamente. Selecciónalo abajo.", lang)}</p>
          {municipalityFallback}
        </div>
      )}

      {!site && !pending && !busy && !failed && knownMunicipality && (
        <p className="spr-ploc-message" data-testid="project-location-known">{L(`Municipality: ${knownMunicipality} — add the address or pin for site-specific checks.`, `Municipio: ${knownMunicipality} — añade la dirección o el pin para revisar el lugar.`, lang)}</p>
      )}

      {confirmed && (
        <div className="spr-ploc-confirmed" data-testid="project-location-confirmed">
          <p className="spr-ploc-confirmed-title"><CheckCircle2 aria-hidden="true" /> {L("Location confirmed", "Ubicación confirmada", lang)}</p>
          <p className="spr-ploc-confirmed-address" data-testid="project-location-address">
            {site.formatted_address || L("No street address — the pin is exact", "Sin dirección — el pin es exacto", lang)}
          </p>
          <dl className="spr-ploc-facts">
            <div><dt>{L("Municipality", "Municipio", lang)}:</dt><dd data-testid="project-location-municipality">{site.municipality.name}{site.barrio && site.barrio.name !== site.municipality.name ? ` · ${site.barrio.name}` : ""}</dd></div>
            <div><dt>{L("Coordinates", "Coordenadas", lang)}:</dt><dd data-testid="project-location-coordinates">{formatCoordinate(site.latitude)}, {formatCoordinate(site.longitude)}</dd></div>
          </dl>
          {site.near_boundary && <p className="spr-ploc-note">{L("Near a municipal boundary — check the pin on the map.", "Cerca de un límite municipal — verifique el pin en el mapa.", lang)}</p>}
          <SiteLayerChips site={site} lang={lang} onRetry={onRetryLayers} />
        </div>
      )}
    </section>
  );
}
