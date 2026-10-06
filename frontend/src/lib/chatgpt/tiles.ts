// Tile proxy helpers (route: src/app/api/tiles/[z]/[x]/[y]/route.ts).
export const TILE_UPSTREAM_STREETS = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";
export const TILE_UPSTREAM_SATELLITE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const TILE_MIN_ZOOM = 7;
export const TILE_MAX_ZOOM = 19;
/** Puerto Rico incl. Mona, Desecheo, Vieques, Culebra — with a margin. */
export const TILE_BOUNDS = { west: -68.3, east: -65.0, south: 17.6, north: 18.75 };


function lng2x(lng: number, z: number) { return Math.floor(((lng + 180) / 360) * 2 ** z); }
function lat2y(lat: number, z: number) { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); }

/** z/x/y valid and the tile touches Puerto Rico's envelope. */
export function tileAllowed(z: number, x: number, y: number): boolean {
  if (![z, x, y].every(Number.isInteger) || z < TILE_MIN_ZOOM || z > TILE_MAX_ZOOM) return false;
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) return false;
  const b = TILE_BOUNDS;
  return x >= lng2x(b.west, z) && x <= lng2x(b.east, z) && y >= lat2y(b.north, z) && y <= lat2y(b.south, z);
}

export function upstreamUrl(style: "streets" | "satellite", z: number, x: number, y: number, env: Record<string, string | undefined> = process.env): string {
  const tpl = (style === "satellite" ? env.CHATGPT_TILE_URL_SATELLITE : env.CHATGPT_TILE_URL_STREETS)?.trim() || (style === "satellite" ? TILE_UPSTREAM_SATELLITE : TILE_UPSTREAM_STREETS);
  return tpl.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
}


/** Tile URL templates the widget uses (served by the proxy above on `origin`). */
export function tileTemplates(origin: string) {
  const o = origin.replace(/\/$/, "");
  return {
    streets: `${o}/api/tiles/{z}/{x}/{y}.png`,
    satellite: `${o}/api/tiles/{z}/{x}/{y}.png?s=sat`,
    attribution: {
      streets: "Tiles © Esri — Esri, HERE, Garmin, USGS, NGA, EPA, USDA, NPS; © OpenStreetMap contributors",
      satellite: "Imagery © Esri — Maxar, Earthstar Geographics, USDA, USGS, GIS User Community",
    },
  };
}
