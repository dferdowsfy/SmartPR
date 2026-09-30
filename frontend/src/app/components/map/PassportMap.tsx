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

export interface PassportMapProps {
  point: MapPoint | null;
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
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

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
          style: MAP_STYLE_URL,
          center: start ? [start.longitude, start.latitude] : [PUERTO_RICO_CENTER.longitude, PUERTO_RICO_CENTER.latitude],
          zoom: start ? 16 : 7.6,
          maxBounds: MAX_BOUNDS,
          interactive,
          attributionControl: { compact: true },
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
      map.on("error", (event) => {
        // Individual tile hiccups are recoverable; a style that never loads is not.
        if (!map.isStyleLoaded() && !(event as { tile?: unknown }).tile) fail();
      });

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
  }, [interactive]);

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
