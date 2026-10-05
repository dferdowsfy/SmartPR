// ============================================================================
// Sample parcels for the Property & Site Report consistency suite and the
// government-data drift check. Every coordinate was chosen by querying the
// official layers the app already uses (CRIM parcels, JP calificación, FEMA
// NFHL + JP/FEMA advisory ABFE, NOAA/JP coastal zone) from the box on
// 2026-10-04 (ET); the parcel IDs listed are what CRIM returned at the pin.
// `expect` is what the official sources said at capture time — the fixture
// (fixtures/<id>.json, raw official responses) is the authority, these are
// labels for humans.
//
// Fixtures are re-recorded only by a person: `npm run geo:capture -- <id>`.
// The drift check (`npm run geo:drift`) never rewrites them.
// ============================================================================

export interface SiteCase {
  id: string;
  label: string;
  /** Census municipio the pin falls in (bundled TIGER boundaries). */
  municipality: string;
  latitude: number;
  longitude: number;
  /** Why this case is in the set. */
  category: Array<"coastal" | "flood_ae" | "flood_ve" | "floodway" | "riverine" | "rural" | "agricultural" | "town_center" | "historic" | "mountain" | "road_pin" | "water_pin" | "off_lot" | "advisory_differs" | "known_bug">;
  /** Official answers at capture time (human-readable; the fixture decides). */
  expect: { parcel: string | null; zoning: string | null; land_class: string | null; flood_pin: string | null; advisory: string | null; coastal: boolean | null };
  /** A road / water pin: the report must not present lot facts as the property's. */
  offLot?: "road" | "water" | "no_parcel";
}

export const SITE_CASES: readonly SiteCase[] = [
  // ---- Arroyo (south-east coast) -------------------------------------------------
  { id: "arroyo_town_center", label: "Arroyo pueblo — town center lot (FIRM X, advisory A)", municipality: "Arroyo", latitude: 17.9655, longitude: -66.061, category: ["town_center", "coastal", "advisory_differs"], expect: { parcel: "443-001-028-14", zoning: "R-I", land_class: "SU", flood_pin: "X", advisory: "A", coastal: true } },
  { id: "arroyo_town_ae", label: "Arroyo pueblo — lot in FEMA AE near the shore", municipality: "Arroyo", latitude: 17.9645, longitude: -66.0606, category: ["town_center", "coastal", "flood_ae"], expect: { parcel: "443-001-031-07", zoning: "R-I", land_class: "SU", flood_pin: "AE", advisory: "A", coastal: true } },
  { id: "arroyo_floodway", label: "Arroyo Palmas — coastal lot with regulatory floodway (AE floodway)", municipality: "Arroyo", latitude: 17.9643, longitude: -66.0595, category: ["coastal", "flood_ae", "floodway", "riverine"], expect: { parcel: "443-001-061-01", zoning: "RT-I", land_class: "SREP-A", flood_pin: "AE", advisory: "A", coastal: true } },
  { id: "arroyo_coastal_ve", label: "Arroyo Palmas — beachfront conservation lot (FEMA VE)", municipality: "Arroyo", latitude: 17.962, longitude: -66.05, category: ["coastal", "flood_ve"], expect: { parcel: "443-000-002-05", zoning: "C-R", land_class: "SREP-E", flood_pin: "VE", advisory: "VE", coastal: true } },
  { id: "arroyo_agricultural", label: "Arroyo Guásimas — agricultural lot (A-P, SREP-A)", municipality: "Arroyo", latitude: 17.985, longitude: -66.066, category: ["rural", "agricultural"], expect: { parcel: "420-000-005-03", zoning: "A-P", land_class: "SREP-A", flood_pin: "X", advisory: null, coastal: false } },
  { id: "arroyo_road_pin", label: "Arroyo pueblo — pin on a street (VIAL) inside FEMA AE", municipality: "Arroyo", latitude: 17.964, longitude: -66.06, category: ["road_pin", "off_lot", "flood_ae", "coastal"], expect: { parcel: null, zoning: "VIAL", land_class: "VIAL", flood_pin: "AE", advisory: "A", coastal: true }, offLot: "road" },
  { id: "arroyo_water_pin", label: "Arroyo Guásimas — pin in the river channel (AGUA)", municipality: "Arroyo", latitude: 17.978, longitude: -66.072, category: ["water_pin", "off_lot", "riverine"], expect: { parcel: null, zoning: "AGUA", land_class: "AGUA", flood_pin: "X", advisory: null, coastal: false }, offLot: "water" },
  // ---- Patillas (south-east coast) -------------------------------------------------
  { id: "patillas_town_riverine", label: "Patillas pueblo — riverine FEMA AE lot (letters of map change nearby)", municipality: "Patillas", latitude: 18.0063, longitude: -66.0157, category: ["town_center", "flood_ae", "riverine"], expect: { parcel: "398-078-017-01", zoning: "R-C", land_class: "SU", flood_pin: "AE", advisory: "A", coastal: false } },
  { id: "patillas_coastal", label: "Patillas Bajo — coastal rural lot", municipality: "Patillas", latitude: 17.981, longitude: -65.995, category: ["coastal", "rural"], expect: { parcel: "422-000-001-41", zoning: "R-G", land_class: "SRC", flood_pin: "X", advisory: null, coastal: true } },
  { id: "patillas_beach_ve", label: "Patillas Bajo — pin on the beach strip (FEMA VE, no parcel, no calificación)", municipality: "Patillas", latitude: 17.9775, longitude: -65.998, category: ["coastal", "flood_ve", "off_lot"], expect: { parcel: null, zoning: null, land_class: null, flood_pin: "VE", advisory: "VE", coastal: true }, offLot: "no_parcel" },
  { id: "patillas_rural", label: "Patillas Cacao Alto — rural lot (R-G, SRC)", municipality: "Patillas", latitude: 18.018, longitude: -66.03, category: ["rural"], expect: { parcel: "398-000-003-57", zoning: "R-G", land_class: "SRC", flood_pin: "X", advisory: null, coastal: false } },
  { id: "patillas_mountain", label: "Patillas Mulas — mountain conservation lot (C-R, SREP-E)", municipality: "Patillas", latitude: 18.05, longitude: -66.03, category: ["mountain", "rural"], expect: { parcel: "374-000-004-33", zoning: "C-R", land_class: "SREP-E", flood_pin: "X", advisory: null, coastal: false } },
  // ---- Elsewhere ---------------------------------------------------------------------
  { id: "old_san_juan", label: "Old San Juan — historic district lot", municipality: "San Juan", latitude: 18.4655, longitude: -66.1167, category: ["historic", "coastal", "town_center"], expect: { parcel: "040-002-034-02", zoning: "D", land_class: "SU", flood_pin: "X", advisory: null, coastal: true } },
  { id: "isla_verde", label: "Isla Verde (Carolina) — coastal lot, parcel spans X / X 0.2% / AE (the 'Zone AE · X · X' chip)", municipality: "Carolina", latitude: 18.443404, longitude: -66.018583, category: ["coastal", "flood_ae", "advisory_differs", "known_bug"], expect: { parcel: "041-077-003-26", zoning: "RT-5", land_class: "SU", flood_pin: "X", advisory: "AO", coastal: true } },
  { id: "caguas_town", label: "Caguas pueblo — town center lot", municipality: "Caguas", latitude: 18.2341, longitude: -66.0391, category: ["town_center"], expect: { parcel: "225-044-031-13", zoning: "DT-G", land_class: "SU", flood_pin: "X", advisory: null, coastal: false } },
  { id: "loiza_pinones", label: "Loíza Piñones — beachfront-area lot in FEMA AE", municipality: "Loíza", latitude: 18.447, longitude: -65.96, category: ["coastal", "flood_ae", "rural"], expect: { parcel: "042-067-329-14", zoning: "ARD", land_class: "SRC", flood_pin: "AE", advisory: "AE", coastal: true } },
  { id: "jayuya_mountain", label: "Jayuya Veguitas — inland mountain rural lot (high landslide susceptibility)", municipality: "Jayuya", latitude: 18.21, longitude: -66.58, category: ["mountain", "rural", "agricultural"], expect: { parcel: "242-000-005-31", zoning: "A-4", land_class: "SREP-A", flood_pin: "X", advisory: null, coastal: false } },
];

export const siteCase = (id: string): SiteCase | undefined => SITE_CASES.find((c) => c.id === id);
