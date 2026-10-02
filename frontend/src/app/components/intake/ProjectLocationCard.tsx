"use client";

/**
 * ProjectLocationCard — the one location component in SmartPR.
 *
 *   mode="edit"     Intake: address search + interactive map + selection
 *                   details + "Use this location".
 *   mode="summary"  Requirements: the saved site (map + details) with
 *                   "Edit location", which reactivates the same edit
 *                   controls inline (never a modal).
 *
 * Both modes read/write the same IntakeSite through the intake's existing
 * `onConfirm` (confirmIntakeSite → municipality, Passport save, official map
 * layers). Reused, unchanged: /api/geocode (search + reverse),
 * /api/locations/resolve (Census municipio/barrio + KB designations),
 * PassportMap (tap to pin, drag, zoom, geolocate), coordinate validation,
 * intakeSiteFromPlacement, SiteLayerChips.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Building2, CheckCircle2, Hash, Info, Landmark, Loader2, MapPin, Pencil, Search } from "lucide-react";
import { PassportMap, type MapPoint } from "../map/PassportMap";
import { formatCoordinate, validateCoordinates, type CoordinateSource, type PassportLocationWithGeographies } from "../../locations/geo";
import type { IntakeSite } from "../../locations/intakeLocation";
import { siteAddressParts } from "../../locations/siteAddress";
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

/** Selection details: status pill, clean address hierarchy, metadata. */
function SiteDetails({ site, lang, status }: { site: IntakeSite; lang: Lang; status: "selected" | "saved" | "confirmed" }) {
  const a = siteAddressParts(site);
  const approximate = site.coordinate_source === "GEOCODED_ADDRESS";
  const pill =
    status === "saved"
      ? L("Location saved", "Ubicación guardada", lang)
      : status === "selected"
        ? L("Exact site selected", "Lugar exacto seleccionado", lang)
        : approximate
          ? L("Site from address", "Lugar según la dirección", lang)
          : L("Exact site confirmed", "Lugar exacto confirmado", lang);
  return (
    <div className="spr-plc-details" data-testid="location-rules-for">
      <span className={`spr-plc-pill${status === "confirmed" && approximate ? " spr-plc-pill-approx" : ""}`} data-testid="location-rules-for-label">
        <CheckCircle2 aria-hidden="true" /> {pill}
      </span>
      <p className="spr-plc-primary" data-testid="project-location-address">{a.primary}</p>
      <p className="spr-plc-secondary">{a.secondary}</p>
      <hr className="spr-plc-divider" />
      <dl className="spr-plc-meta">
        <div>
          <dt><Landmark aria-hidden="true" /> {L("Municipality", "Municipio", lang)}</dt>
          <dd data-testid="project-location-municipality">{site.municipality.name}</dd>
        </div>
        <div>
          <dt>
            <Hash aria-hidden="true" /> {L("Coordinates", "Coordenadas", lang)}
            <span className="spr-plc-info" title={L("Latitude, longitude of the pin. Site checks use this exact point.", "Latitud, longitud del pin. Las verificaciones usan este punto exacto.", lang)}>
              <Info aria-hidden="true" />
            </span>
          </dt>
          <dd data-testid="project-location-coordinates">{formatCoordinate(site.latitude)}, {formatCoordinate(site.longitude)}</dd>
        </div>
        {a.placeName && (
          <div>
            <dt><Building2 aria-hidden="true" /> {L("Place name", "Nombre del lugar", lang)}</dt>
            <dd data-testid="project-location-place">{a.placeName}</dd>
          </div>
        )}
      </dl>
      {site.near_boundary && <p className="spr-plc-note">{L("Near a municipal boundary — check the pin on the map.", "Cerca de un límite municipal — verifique el pin en el mapa.", lang)}</p>}
    </div>
  );
}

export function ProjectLocationCard({
  mode, lang, site, businessId, onConfirm, onRetryLayers, initialQuery, municipalityFallback, searchInputId, missingNote, invalid, knownMunicipality, onClear,
}: {
  mode: "edit" | "summary";
  lang: Lang;
  site: IntakeSite | null;
  businessId: string | null;
  onConfirm: (site: IntakeSite) => void;
  onRetryLayers?: () => void;
  /** Something the user already said (e.g. their municipio) to prefill the search. */
  initialQuery?: string | null;
  /** The intake's municipality select — shown only when detection fails. */
  municipalityFallback?: ReactNode;
  /** id for the search input (the "Still needed" chip focuses it). */
  searchInputId: string;
  missingNote?: ReactNode;
  invalid?: boolean;
  /** Municipality already known without a site (description / Passport). */
  knownMunicipality?: string | null;
  /** Drop a previously confirmed site (a new address/pin couldn't be resolved). */
  onClear?: () => void;
}) {
  const headingId = useId();
  const helpId = useId();
  const [editing, setEditing] = useState(!site);
  const [started, setStarted] = useState(false);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [busy, setBusy] = useState<null | "search" | "resolve">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<GeocodeCandidate[]>([]);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<MapPoint | null>(null);
  /** Resolved but not yet saved ("Use this location"). */
  const [draft, setDraft] = useState<IntakeSite | null>(null);
  const seq = useRef(0);

  // A site confirmed elsewhere (another card, Passport) closes the editor.
  const lastSite = useRef(site);
  useEffect(() => {
    if (site && site !== lastSite.current && !draft && !busy) setEditing(false);
    if (!site && !lastSite.current) setEditing(true);
    lastSite.current = site;
  }, [site, draft, busy]);

  const shown = draft ?? (editing && (pending || failed) ? null : site);
  const point: MapPoint | null = pending ?? (shown ? { latitude: shown.latitude, longitude: shown.longitude } : null);

  /** Resolve the municipio for a point → draft selection. */
  const select = useCallback(
    async (p: MapPoint, source: CoordinateSource, address: string | null, savedId: string | null = null) => {
      const v = validateCoordinates(p.latitude, p.longitude);
      if (!v.ok) {
        setMessage(L("That point isn't a valid location.", "Ese punto no es una ubicación válida.", lang));
        return;
      }
      const my = ++seq.current;
      setStarted(true);
      setPending({ latitude: v.latitude, longitude: v.longitude });
      setBusy("resolve");
      setFailed(false);
      const r = await resolvePoint({ latitude: v.latitude, longitude: v.longitude });
      if (my !== seq.current) return;
      setBusy(null);
      if (r === "error" || !r.placement) {
        // The old site no longer matches what the user entered: don't keep it.
        setDraft(null);
        onClear?.();
        setFailed(true);
        setMessage(null);
        return;
      }
      setPending(null);
      setDraft(intakeSiteFromPlacement({ latitude: v.latitude, longitude: v.longitude, coordinate_source: source, formatted_address: address }, r.placement, r.designations, savedId));
    },
    [lang, onClear]
  );

  const save = () => {
    if (!draft) return;
    onConfirm(draft);
    setDraft(null);
    setEditing(false);
    setAlternatives([]);
  };

  /** Address → first match: pin it, center the map, determine the municipio. */
  const runSearch = async (raw: string) => {
    const q = raw.trim();
    if (!q) return;
    setStarted(true);
    setBusy("search");
    setMessage(null);
    setAlternatives([]);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&lang=${lang}`, { cache: "no-store" });
      if (!res.ok) {
        setBusy(null);
        setMessage(
          res.status === 429
            ? L("Too many searches — wait a moment and try again.", "Demasiadas búsquedas — espere un momento e intente de nuevo.", lang)
            : L("Address search isn't available right now. Place the pin on the map instead.", "La búsqueda de direcciones no está disponible. Coloque el pin en el mapa.", lang)
        );
        return;
      }
      const data = (await res.json()) as { results: GeocodeCandidate[] };
      if (!data.results.length) {
        setBusy(null);
        setMessage(L("No matching address in Puerto Rico. Try a nearby landmark, or place the pin on the map.", "No se encontró la dirección en Puerto Rico. Pruebe un punto de referencia cercano o coloque el pin en el mapa.", lang));
        return;
      }
      const [first, ...rest] = data.results;
      setAlternatives(rest.slice(0, 4));
      setQuery(first!.formatted_address ?? q);
      await select({ latitude: first!.latitude, longitude: first!.longitude }, "GEOCODED_ADDRESS", first!.formatted_address ?? null);
    } catch {
      setBusy(null);
      setMessage(L("Address search failed. Check your connection, or place the pin on the map.", "La búsqueda falló. Verifique su conexión o coloque el pin en el mapa.", lang));
    }
  };

  /** Map tap / pin drag → reverse-geocode the address, then resolve. */
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
      await select(p, "MAP_PIN", address);
    },
    [select, lang]
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

  const startEdit = () => {
    setEditing(true);
    setStarted(true);
    setQuery(site?.formatted_address ?? query);
    requestAnimationFrame(() => document.getElementById(searchInputId)?.focus());
  };
  const cancelEdit = () => {
    seq.current++;
    setEditing(false);
    setDraft(null);
    setPending(null);
    setBusy(null);
    setFailed(false);
    setMessage(null);
    setAlternatives([]);
  };

  const isSaved = !editing && !!site;
  const workspace = isSaved || started || !!site || !!draft;
  const summary = mode === "summary";

  return (
    <section
      className={`spr-plc${summary ? " spr-plc-summary" : ""}`}
      aria-labelledby={headingId}
      data-testid="project-location"
      data-mode={mode}
      data-state={isSaved ? "saved" : draft ? "selected" : "editing"}
    >
      <header className="spr-plc-head">
        <span className="spr-plc-head-icon" aria-hidden="true"><MapPin /></span>
        <div className="spr-plc-head-text">
          <h2 id={headingId} className="spr-plc-title">{L("Project location", "Ubicación del proyecto", lang)}</h2>
          <p id={helpId} className="spr-plc-help">
            {isSaved && summary
              ? L("This is the exact site we're analyzing for requirements.", "Este es el lugar exacto que analizamos para los requisitos.", lang)
              : L(
                  "Enter an address or select the exact site. SmartPR uses this location to determine municipal and site-specific requirements.",
                  "Escribe una dirección o selecciona el lugar exacto. SmartPR usa esta ubicación para determinar los requisitos municipales y del lugar.",
                  lang
                )}
          </p>
        </div>
        {isSaved ? (
          <button type="button" className="spr-plc-edit" onClick={startEdit} data-testid="location-change">
            <Pencil aria-hidden="true" /> {L("Edit location", "Editar ubicación", lang)}
          </button>
        ) : site ? (
          <button type="button" className="spr-plc-edit" onClick={cancelEdit} data-testid="location-edit-cancel">
            {L("Cancel", "Cancelar", lang)}
          </button>
        ) : null}
      </header>

      {!isSaved && (
        <>
          <form role="search" className="spr-plc-search" onSubmit={(e) => { e.preventDefault(); void runSearch(query); }}>
            <label htmlFor={searchInputId} className="sr-only">{L("Search address, business, or place", "Buscar dirección, negocio o lugar", lang)}</label>
            <Search className="spr-plc-search-icon" aria-hidden="true" />
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
              className="spr-plc-input"
              data-testid="project-location-search"
            />
            <button type="submit" className="spr-plc-find" disabled={!query.trim() || busy !== null} data-testid="project-location-find">
              {busy === "search" ? <Loader2 className="spr-loc-spin" aria-hidden="true" /> : L("Find", "Buscar", lang)}
            </button>
          </form>
          {missingNote}
          <div className="spr-plc-under">
            {!workspace && (
              <button type="button" className="spr-plc-map-toggle" onClick={() => setStarted(true)} data-testid="project-location-map-toggle">
                <MapPin aria-hidden="true" /> {L("Or place the pin on the map", "O coloca el pin en el mapa", lang)}
              </button>
            )}
            {saved.length > 0 && !site && !draft && (
              <span className="spr-plc-saved" role="group" aria-label={L("Saved locations", "Ubicaciones guardadas", lang)}>
                {saved.map((loc) => (
                  <button
                    key={loc.id}
                    type="button"
                    className="spr-plc-saved-item"
                    onClick={() => void select({ latitude: loc.latitude, longitude: loc.longitude }, loc.coordinate_source, loc.formatted_address, loc.id)}
                    data-testid="location-saved-option"
                  >
                    {loc.name || loc.formatted_address || `${formatCoordinate(loc.latitude, 4)}, ${formatCoordinate(loc.longitude, 4)}`}
                  </button>
                ))}
              </span>
            )}
          </div>
          <div aria-live="polite">
            {message && <p className="spr-plc-message" role="status">{message}</p>}
            {alternatives.length > 0 && (
              <div className="spr-plc-alts">
                <span>{L("Not the right place?", "¿No es el lugar correcto?", lang)}</span>
                {alternatives.map((c, i) => (
                  <button key={c.place_source_id ?? i} type="button" className="spr-link" onClick={() => { setQuery(c.formatted_address ?? ""); setAlternatives([]); void select({ latitude: c.latitude, longitude: c.longitude }, "GEOCODED_ADDRESS", c.formatted_address ?? null); }}>
                    {c.formatted_address ?? `${formatCoordinate(c.latitude)}, ${formatCoordinate(c.longitude)}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {workspace && (
        <div className="spr-plc-body">
          <div className="spr-plc-map" data-testid="project-location-map">
            <PassportMap
              interactive={!isSaved}
              point={point}
              onPick={isSaved ? undefined : (p) => void onMapPick(p)}
              label={isSaved
                ? L(`Map of the project site in ${site!.municipality.name}`, `Mapa del lugar del proyecto en ${site!.municipality.name}`, lang)
                : L("Map of Puerto Rico — tap to place the pin, drag it to adjust", "Mapa de Puerto Rico — toque para colocar el pin y arrástrelo para ajustar", lang)}
              loadingText={L("Loading map…", "Cargando mapa…", lang)}
              errorText={L("The map could not load. Search for the address instead.", "El mapa no pudo cargar. Busque la dirección.", lang)}
              className="spr-plc-map-canvas touch-none"
            />
            {shown && !pending && (
              <span className="spr-plc-map-label" aria-hidden="true">
                <strong>{shown.barrio && shown.barrio.name !== shown.municipality.name ? shown.barrio.name : shown.municipality.name}</strong>
                <span>{shown.municipality.name}, PR</span>
              </span>
            )}
          </div>

          <div className="spr-plc-side">
            {busy === "resolve" ? (
              <p className="spr-plc-empty" role="status"><Loader2 className="spr-loc-spin" aria-hidden="true" /> {L("Finding the municipality…", "Buscando el municipio…", lang)}</p>
            ) : failed ? (
              <div className="spr-plc-fallback" data-testid="project-location-fallback">
                <p>{L("We couldn’t determine the municipality. Please select it below.", "No pudimos determinar el municipio. Selecciónalo abajo.", lang)}</p>
                {municipalityFallback}
              </div>
            ) : shown ? (
              <div className="spr-plc-confirmed" data-testid="project-location-confirmed">
                <SiteDetails site={shown} lang={lang} status={draft ? "selected" : summary ? "confirmed" : "saved"} />
                {draft && (
                  <button type="button" className="spr-plc-use" onClick={save} data-testid="project-location-use">
                    {L("Use this location", "Usar esta ubicación", lang)}
                  </button>
                )}
              </div>
            ) : (
              <div className="spr-plc-empty-state">
                <MapPin aria-hidden="true" />
                <p className="spr-plc-empty-title">{L("Select your project site", "Selecciona el lugar del proyecto", lang)}</p>
                <p className="spr-plc-empty">{L("Search for an address or place a pin on the map.", "Busca una dirección o coloca un pin en el mapa.", lang)}</p>
                {knownMunicipality && (
                  <p className="spr-plc-empty" data-testid="project-location-known">{L(`Municipality so far: ${knownMunicipality}`, `Municipio por ahora: ${knownMunicipality}`, lang)}</p>
                )}
                <button type="button" className="spr-plc-use" disabled data-testid="project-location-use">
                  {L("Use this location", "Usar esta ubicación", lang)}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {isSaved && !summary && site && (
        <div className="spr-plc-intel">
          <SiteLayerChips site={site} lang={lang} onRetry={onRetryLayers} />
        </div>
      )}

      {!workspace && knownMunicipality && (
        <p className="spr-plc-message" data-testid="project-location-known">{L(`Municipality: ${knownMunicipality} — add the address or pin for site-specific checks.`, `Municipio: ${knownMunicipality} — añade la dirección o el pin para revisar el lugar.`, lang)}</p>
      )}
    </section>
  );
}
