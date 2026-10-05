import { createRequire } from "node:module"; const sharp = createRequire(import.meta.url)("sharp"); const dec = async (png: ArrayBuffer) => { const { data, info } = await sharp(Buffer.from(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { width: info.width, height: info.height, channels: info.channels, data: new Uint8Array(data) }; };
import { resolveSiteLayers, LayerCache } from "../src/app/locations/layerService.ts";
import { locateInPuertoRico } from "../src/app/locations/boundaries.ts";
const pts = process.argv.slice(2).map((s) => s.split(",").map(Number));
for (const [lat, lng] of pts) {
  const place = locateInPuertoRico(lat, lng);
  const L = await resolveSiteLayers(lat, lng, { cache: new LayerCache(), decodePng: dec, isOnLand: (p) => locateInPuertoRico(p.latitude, p.longitude) !== null, skipOptional: true });
  const s = L.results.map((r) => `${r.layer}=${r.status === "resolved" ? r.code + (r.layer === "zoning" ? `(${r.name})` : "") + (r.tags.length ? "[" + r.tags.join(",") + "]" : "") : r.status + (r.reason ? `(${String(r.reason).slice(0, 40)})` : "")}${r.layer==="parcel"&&r.attributes?.TIPO?` TIPO=${r.attributes.TIPO}`:""}`).join(" | ");
  console.log(`${lat},${lng} ${place?.municipio.name}/${place?.barrio?.name} :: ${s}`);
}
