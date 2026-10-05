// The 78 municipios of Puerto Rico, hardcoded so the client can recognise the
// municipality a geocoder's address names without another lookup.
export const MUNICIPIOS: readonly string[] = [
  "Adjuntas", "Aguada", "Aguadilla", "Aguas Buenas", "Aibonito", "Añasco", "Arecibo", "Arroyo", "Barceloneta", "Barranquitas",
  "Bayamón", "Cabo Rojo", "Caguas", "Camuy", "Canóvanas", "Carolina", "Cataño", "Cayey", "Ceiba", "Ciales",
  "Cidra", "Coamo", "Comerío", "Corozal", "Culebra", "Dorado", "Fajardo", "Florida", "Guánica", "Guayama",
  "Guayanilla", "Guaynabo", "Gurabo", "Hatillo", "Hormigueros", "Humacao", "Isabela", "Jayuya", "Juana Díaz", "Juncos",
  "Lajas", "Lares", "Las Marías", "Las Piedras", "Loíza", "Luquillo", "Manatí", "Maricao", "Maunabo", "Mayagüez",
  "Moca", "Morovis", "Naguabo", "Naranjito", "Orocovis", "Patillas", "Peñuelas", "Ponce", "Quebradillas", "Rincón",
  "Río Grande", "Sabana Grande", "Salinas", "San Germán", "San Juan", "San Lorenzo", "San Sebastián", "Santa Isabel", "Toa Alta", "Toa Baja",
  "Trujillo Alto", "Utuado", "Vega Alta", "Vega Baja", "Vieques", "Villalba", "Yabucoa", "Yauco",
];

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/^municipio de\s+/, "").replace(/\s+/g, " ").trim();
const BY_FOLD = new Map(MUNICIPIOS.map((m) => [fold(m), m]));

/** The municipio an address names: the last comma segment that is one of the 78 (null if none). */
export function addressMunicipio(formatted: string | null | undefined): string | null {
  const segs = (formatted ?? "").split(",").map((s) => fold(s.replace(/\b00[6-9]\d{2}(?:-\d{4})?\b/, "").replace(/\s+PR$/i, "")));
  for (let i = segs.length - 1; i >= 0; i--) {
    const m = BY_FOLD.get(segs[i]!);
    if (m) return m;
  }
  return null;
}

export const sameMunicipio = (a: string, b: string) => fold(a) === fold(b);
