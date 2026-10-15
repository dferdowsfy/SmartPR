"use client";

// Interactive / preview map for Passport locations (MapLibre GL).
//
// Why MapLibre: open-source (BSD), vendor-neutral vector maps with mature
// touch/pinch support. The basemap is just a style URL, so the tile provider
// can change (OpenFreeMap default, or MapTiler/Stadia/self-hosted) without
// touching SmartPR code or data. Configure with NEXT_PUBLIC_MAP_STYLE_URL.
//
// This component only reports the point the user picked. It knows nothing
// about zoning, flood zones, or requirements.

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";
import { PUERTO_RICO_BOUNDS, PUERTO_RICO_CENTER } from "../../locations/geo";

/** Public basemap style. No secret: style URLs are browser-visible by design. */
export const MAP_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL?.trim() || "https://tiles.openfreemap.org/styles/liberty";

// Panning is limited to the Puerto Rico region (with margin), keeping the
// experience focused on SmartPR's current jurisdiction. The stored data is
// not limited — this is a UI bias only.
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [PUERTO_RICO_BOUNDS.west - 1.5, PUERTO_RICO_BOUNDS.south - 1.3],
  [PUERTO_RICO_BOUNDS.east + 1.5, PUERTO_RICO_BOUNDS.north + 1.3],
];

export interface MapPoint {
  latitude: number;
  longitude: number;
}

/** Base maps. "streets" (default) is the easiest to read; satellite shows the land itself. */
export type MapBase = "streets" | "satellite";
/** Official-data overlays drawn from the agencies' own map services. */
export type MapOverlay = "flood" | "zoning";

const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    satellite: {
      type: "raster" as const,
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    },
  },
  layers: [{ id: "satellite", type: "raster" as const, source: "satellite" }],
};

const OVERLAY_TILES: Record<MapOverlay, { url: string; attribution: string; opacity: number }> = {
  flood: {
    url: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show:28&f=image",
    attribution: "FEMA NFHL",
    opacity: 0.55,
  },
  zoning: {
    url: "https://sigejp.pr.gov/server/rest/services/calificacion/cali_vige/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&f=image",
    attribution: "Junta de Planificación",
    opacity: 0.5,
  },
};

export interface PassportMapProps {
  point: MapPoint | null;
  /** Centre the map on an area without placing a pin (an area is not a site). */
  focus?: (MapPoint & { zoom?: number }) | null;
  /** Verified parcel boundary (GeoJSON Polygon / MultiPolygon, EPSG:4326). */
  parcel?: unknown | null;
  /** Neighbouring parcel outlines (GeoJSON geometries) — drawn thin and grey so the selected parcel stands out. */
  neighbors?: unknown[];
  /** Shapes of findings covering only part of the parcel (GeoJSON geometries + colour). */
  highlights?: Array<{ id: string; geometry: unknown; color: string }>;
  /** Base map (default "streets"). */
  base?: MapBase;
  overlays?: MapOverlay[];
  /** Pan / zoom (mouse wheel, pinch, +/−) without placing a pin. */
  navigable?: boolean;
  /** Shows the base-map / overlay switcher. */
  layerControls?: boolean;
  layerLabels?: { streets: string; satellite: string; flood: string; zoning: string; parcel: string; layers: string };
  /** Interactive picker (click/tap to place, drag to adjust) vs static preview. */
  interactive?: boolean;
  onPick?: (point: MapPoint) => void;
  /** Accessible description of the map region. */
  label: string;
  /** Message shown if the map cannot load. */
  errorText: string;
  loadingText: string;
  className?: string;
  onStatusChange?: (status: "loading" | "ready" | "error") => void;
}

const BRAND = "#245c5c";

export function PassportMap({
  point,
  focus = null,
  parcel = null,
  neighbors = [],
  highlights = [],
  base: baseProp,
  overlays: overlaysProp,
  layerControls = false,
  navigable = false,
  layerLabels,
  interactive = false,
  onPick,
  label,
  errorText,
  loadingText,
  className,
  onStatusChange,
}: PassportMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<MapLibreMarker | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const onPickRef = useRef(onPick);
  const statusRef = useRef(onStatusChange);
  const initialPoint = useRef(point);
  const initialFocus = useRef(focus);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [baseState, setBase] = useState<MapBase>(baseProp ?? "streets");
  const [overlayState, setOverlays] = useState<MapOverlay[]>(overlaysProp ?? []);
  const [showParcel, setShowParcel] = useState(true);
  const [layersOpen, setLayersOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const base = baseProp ?? baseState;
  const overlays = overlaysProp ?? overlayState;
  const extrasRef = useRef<{ parcel: unknown | null; overlays: MapOverlay[]; showParcel: boolean; neighbors: unknown[]; highlights: Array<{ id: string; geometry: unknown; color: string }> }>({ parcel, overlays, showParcel, neighbors, highlights });
  extrasRef.current = { parcel, overlays, showParcel, neighbors, highlights };
  const styleBase = useRef<MapBase>(base);

  useEffect(() => {
    onPickRef.current = onPick;
    statusRef.current = onStatusChange;
  }, [onPick, onStatusChange]);

  useEffect(() => {
    statusRef.current?.(status);
  }, [status]);

  // Create the map once per mount.
  useEffect(() => {
    let cancelled = false;
    let loadTimer: ReturnType<typeof setTimeout> | null = null;
    const fail = () => {
      if (!cancelled) setStatus("error");
    };

    (async () => {
      let lib: typeof import("maplibre-gl");
      try {
        // maplibre-gl ships a UMD bundle: depending on bundler interop the
        // API arrives as named exports or on `default`.
        const mod = await import("maplibre-gl");
        lib = (mod as unknown as { default?: typeof mod }).default ?? mod;
      } catch {
        fail();
        return;
      }
      if (cancelled || !containerRef.current) return;
      libRef.current = lib;
      const start = initialPoint.current;
      let map: MapLibreMap;
      try {
        map = new lib.Map({
          container: containerRef.current,
          style: styleBase.current === "satellite" ? SATELLITE_STYLE : MAP_STYLE_URL,
          center: start ? [start.longitude, start.latitude] : initialFocus.current ? [initialFocus.current.longitude, initialFocus.current.latitude] : [PUERTO_RICO_CENTER.longitude, PUERTO_RICO_CENTER.latitude],
          zoom: start ? 16 : initialFocus.current ? initialFocus.current.zoom ?? 12.5 : 7.6,
          maxBounds: MAX_BOUNDS,
          interactive: interactive || navigable,
          // The tile licences require a visible credit; it is rendered below as
          // plain text (no outbound links), not MapLibre's clickable control.
          attributionControl: false,
          cooperativeGestures: false,
        });
      } catch {
        // No WebGL, blocked worker, etc.
        fail();
        return;
      }
      mapRef.current = map;
      loadTimer = setTimeout(() => {
        if (!map.loaded() && !cancelled) fail();
      }, 20000);
      map.on("load", () => {
        if (loadTimer) clearTimeout(loadTimer);
        if (!cancelled) setStatus("ready");
      });
      // G8: some basemap styles paint tiles before "load" settles (or stick
      // on loading when sprite icons 404). Idle with a loaded style means the
      // map is usable — clear the "Loading map…" overlay.
      map.on("idle", () => {
        if (cancelled || !map.isStyleLoaded()) return;
        if (loadTimer) clearTimeout(loadTimer);
        setStatus((s) => (s === "loading" ? "ready" : s));
      });
      // G7: OpenFreeMap/liberty references Maki icons (swimming_pool, recycling,
      // office, running, …) that are missing from the sprite — MapLibre then
      // logs styleimagemissing and null-number paint warnings. Provide a
      // transparent 1×1 placeholder so POIs simply omit the icon.
      map.on("styleimagemissing", (event) => {
        const id = (event as { id?: string }).id;
        if (!id || map.hasImage(id)) return;
        const data = new Uint8Array(4);
        map.addImage(id, { width: 1, height: 1, data }, { pixelRatio: 1 });
      });
      // Overlays and the parcel live on top of whichever base style is loaded.
      map.on("style.load", () => drawExtras());
      map.on("error", (event) => {
        // Individual tile hiccups and missing-sprite notices are recoverable;
        // a style that never loads is not.
        const e = event as { tile?: unknown; error?: { status?: number; message?: string } };
        if (e.tile) return;
        const msg = e.error?.message ?? "";
        if (/image|sprite|icon/i.test(msg)) return;
        if (!map.isStyleLoaded()) fail();
      });

      if (navigable && !interactive) map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
      if (interactive) {
        map.addControl(new lib.NavigationControl({ showCompass: false }), "top-right");
        map.addControl(
          new lib.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }),
          "top-right"
        );
        map.on("click", (event) => {
          onPickRef.current?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
        });
      }
      if (start) placeMarker(start, false);
    })();

    return () => {
      cancelled = true;
      if (loadTimer) clearTimeout(loadTimer);
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the map is created once per mount
  }, [interactive, navigable]);

  function drawExtras() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const { parcel: geo, overlays: ov, showParcel: sp, neighbors: nb, highlights: hl } = extrasRef.current;
    for (const id of Object.keys(OVERLAY_TILES) as MapOverlay[]) {
      const on = ov.includes(id);
      const has = !!map.getSource(`ov-${id}`);
      if (on && !has) {
        const t = OVERLAY_TILES[id];
        map.addSource(`ov-${id}`, { type: "raster", tiles: [t.url], tileSize: 256, attribution: t.attribution });
        // Below the first label layer, so street and place names stay readable.
        const firstLabel = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
        map.addLayer({ id: `ov-${id}`, type: "raster", source: `ov-${id}`, paint: { "raster-opacity": t.opacity } }, firstLabel);
      } else if (!on && has) {
        map.removeLayer(`ov-${id}`);
        map.removeSource(`ov-${id}`);
      }
    }
    const setOrAdd = (id: string, data: unknown, layers: () => void) => {
      const s = map.getSource(id) as { setData?: (d: unknown) => void } | undefined;
      if (s?.setData) s.setData(data);
      else { map.addSource(id, { type: "geojson", data: data as never }); layers(); }
    };
    // Neighbouring parcels: thin grey outlines.
    setOrAdd("neighbors", { type: "FeatureCollection", features: sp ? nb.map((g) => ({ type: "Feature", properties: {}, geometry: g })) : [] }, () => {
      map.addLayer({ id: "neighbors-line", type: "line", source: "neighbors", paint: { "line-color": "#7b8a90", "line-width": 1, "line-dasharray": [2, 2], "line-opacity": 0.85 } });
    });
    // Findings that cover only part of the parcel.
    setOrAdd("partials", { type: "FeatureCollection", features: sp ? hl.map((h) => ({ type: "Feature", properties: { color: h.color, id: h.id }, geometry: h.geometry })) : [] }, () => {
      map.addLayer({ id: "partials-fill", type: "fill", source: "partials", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.38 } });
      map.addLayer({ id: "partials-line", type: "line", source: "partials", paint: { "line-color": ["get", "color"], "line-width": 1.5 } });
    });
    // The selected parcel: light fill, white casing + strong outline.
    const data = geo && sp ? { type: "Feature", properties: {}, geometry: geo } : { type: "FeatureCollection", features: [] };
    setOrAdd("parcel", data, () => {
      map.addLayer({ id: "parcel-fill", type: "fill", source: "parcel", paint: { "fill-color": "#2f8f83", "fill-opacity": 0.12 } });
      map.addLayer({ id: "parcel-casing", type: "line", source: "parcel", paint: { "line-color": "#ffffff", "line-width": 6, "line-opacity": 0.9 } });
      map.addLayer({ id: "parcel-line", type: "line", source: "parcel", paint: { "line-color": "#0f766e", "line-width": 3 } });
    });
    // Above the overlays, below labels: neighbours, partial findings, then the selected parcel on top.
    const firstLabel = map.getStyle().layers?.find((l) => l.type === "symbol")?.id;
    for (const id of ["neighbors-line", "partials-fill", "partials-line", "parcel-fill", "parcel-casing", "parcel-line"]) if (map.getLayer(id)) map.moveLayer(id, firstLabel);
  }

  // Base map switch: swap the style; overlays/parcel are re-added on style.load.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleBase.current === base) return;
    styleBase.current = base;
    map.setStyle(base === "satellite" ? (SATELLITE_STYLE as never) : MAP_STYLE_URL);
  }, [base]);

  // Parcel / overlay changes.
  const parcelKey = (parcel ? JSON.stringify(parcel).length + ":" + JSON.stringify(parcel).slice(0, 80) : "") + `|n${neighbors.length}|h${highlights.map((h) => h.id).join(",")}`;
  useEffect(() => {
    if (status !== "ready") return;
    drawExtras();
    // Fit the whole parcel when one arrives.
    const map = mapRef.current;
    if (map && parcel && showParcel) {
      const coords: number[][] = JSON.stringify(parcel).match(/-?\d+\.\d+,-?\d+\.\d+/g)?.map((p) => p.split(",").map(Number)) ?? [];
      if (coords.length > 2) {
        const xs = coords.map((c) => c[0]!), ys = coords.map((c) => c[1]!);
        map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 36, maxZoom: 18, duration: 500 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drawExtras reads refs
  }, [status, parcelKey, overlays.join(","), showParcel]);

  // Area focus (no pin).
  const fLat = focus?.latitude, fLng = focus?.longitude, fZoom = focus?.zoom;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fLat === undefined || fLng === undefined || point) return;
    map.easeTo({ center: [fLng, fLat], zoom: fZoom ?? 12.5, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- point only gates
  }, [fLat, fLng, fZoom, status]);

  function placeMarker(next: MapPoint, move: boolean) {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib) return;
    const lngLat: [number, number] = [next.longitude, next.latitude];
    if (!markerRef.current) {
      const marker = new lib.Marker({ color: BRAND, draggable: interactive }).setLngLat(lngLat).addTo(map);
      if (interactive) {
        marker.on("dragend", () => {
          const p = marker.getLngLat();
          onPickRef.current?.({ latitude: p.lat, longitude: p.lng });
        });
      }
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat(lngLat);
    }
    if (move) {
      const zoom = Math.max(map.getZoom(), interactive ? 15 : 16);
      map.easeTo({ center: lngLat, zoom, duration: 600 });
    }
  }

  // Follow the controlled point (search result, manual entry, reset).
  const lat = point?.latitude;
  const lng = point?.longitude;
  useEffect(() => {
    if (status !== "ready" && !mapRef.current) return;
    if (lat === undefined || lng === undefined) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const current = markerRef.current?.getLngLat();
    const same = current && Math.abs(current.lat - lat) < 1e-9 && Math.abs(current.lng - lng) < 1e-9;
    if (same) return;
    // Recentre only when the new point is off-screen (a pin dropped by tap
    // is already where the user is looking; a search result may not be).
    const bounds = mapRef.current?.getBounds();
    const visible = bounds ? bounds.contains([lng, lat]) : false;
    placeMarker({ latitude: lat, longitude: lng }, !visible || !interactive);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placeMarker reads refs only
  }, [lat, lng, status]);

  return (
    <div className={`relative overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${className ?? ""}`}>
      <div
        ref={containerRef}
        // Explicit size: maplibre-gl.css sets `.maplibregl-map { position: relative }`
        // on this element, so absolute positioning cannot be relied on for height.
        className="h-full w-full"
        role={interactive ? "application" : "img"}
        aria-label={label}
        data-testid={interactive ? "location-map-picker" : "location-map-preview"}
      />
      {status === "ready" && (
        <span className="spr-map-credit" aria-hidden="true" data-testid="map-credit">
          {base === "satellite" ? "Imagery © Esri" : "© OpenMapTiles © OpenStreetMap"}
          {overlays.includes("flood") ? " · FEMA" : ""}{overlays.includes("zoning") ? " · JP" : ""}
        </span>
      )}
      {layerControls && status === "ready" && (
        <div className={`spr-map-layers${panelOpen ? " open" : ""}`} role="group" aria-label={layerLabels?.layers ?? "Map layers"} data-testid="map-layer-controls">
          <button type="button" className="spr-map-layers-toggle" aria-expanded={panelOpen} onClick={() => setPanelOpen((v) => !v)} data-testid="map-layers-toggle">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg>
            <span>{layerLabels?.layers ?? "Map layers"}</span>
          </button>
          {panelOpen && <>
          <div className="spr-map-layers-base">
            {(["streets", "satellite"] as const).map((b) => (
              <button key={b} type="button" aria-pressed={base === b} onClick={() => setBase(b)} data-testid={`map-base-${b}`}>
                {layerLabels?.[b] ?? (b === "streets" ? "Map" : "Satellite")}
              </button>
            ))}
          </div>
          <details className="spr-map-layers-more" open={layersOpen} onToggle={(e) => setLayersOpen((e.target as HTMLDetailsElement).open)}>
          <summary>{layerLabels?.layers ?? "Map layers"}</summary>
          <div className="spr-map-layers-overlays">
            {parcel ? (
              <label><input type="checkbox" checked={showParcel} onChange={(e) => setShowParcel(e.target.checked)} /> {layerLabels?.parcel ?? "Parcel"}</label>
            ) : null}
            {(["flood", "zoning"] as const).map((o) => (
              <label key={o}>
                <input type="checkbox" checked={overlays.includes(o)} onChange={(e) => setOverlays((cur) => (e.target.checked ? [...cur, o] : cur.filter((x) => x !== o)))} data-testid={`map-overlay-${o}`} />{" "}
                {layerLabels?.[o] ?? (o === "flood" ? "Flood zones" : "Zoning")}
              </label>
            ))}
          </div>
          </details>
          </>}
        </div>
      )}
      {status === "loading" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs font-medium text-slate-500">
          {loadingText}
        </div>
      )}
      {status === "error" && (
        <div
          role="status"
          className="absolute inset-0 flex items-center justify-center bg-slate-50 px-4 text-center text-xs font-medium text-slate-600"
        >
          {errorText}
        </div>
      )}
    </div>
  );
}
