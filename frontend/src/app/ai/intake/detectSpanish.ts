/**
 * Server-side Spanish detection on the user's own words — the UI language
 * toggle cannot be trusted here (a user may type Spanish while the UI is in
 * English, and vice versa). High-confidence Spanish stopwords/verb forms;
 * threshold >= 3 distinct hits keeps English text with a PR municipality
 * name (e.g. "open a restaurant in Bayamón") on the English path.
 */
const ES_STOPWORDS = new Set([
  "el", "los", "las", "una", "unos", "unas", "del", "con", "para", "por",
  "que", "qué", "como", "cómo", "pero", "porque", "donde", "dónde", "cuando",
  "cuándo", "sin", "entre", "hasta", "desde", "sobre", "durante", "según",
  "hacia", "aunque", "mientras", "además", "también", "muy", "más", "menos",
  "tan", "tanto", "todo", "todos", "todas", "cada", "otro", "otra", "otros",
  "otras", "este", "esta", "estos", "estas", "ese", "esa", "esos", "esas",
  "aquel", "aquella", "mis", "tus", "sus", "nuestro", "nuestra", "nuestros",
  "nuestras", "les", "aquí", "allí", "ahí", "ahora",
  "hoy", "ayer", "después", "antes", "luego", "entonces", "todavía", "aún",
  "siempre", "nunca", "jamás", "bien", "grande", "grandes", "pequeño",
  "pequeña", "pequeños", "pequeñas", "nuevo", "nueva", "nuevos", "nuevas",
  "primer", "primera", "mismo", "misma", "mucho", "mucha", "muchos", "muchas",
  "poco", "poca", "pocos", "pocas", "algo", "alguien", "nadie", "quien",
  "quienes", "cual", "cuál", "cuanto", "cuánto", "soy", "eres", "somos",
  "estoy", "estás", "está", "estamos", "están", "estaba", "estaban",
  "tengo", "tienes", "tiene", "tenemos", "tienen", "tenía", "tenían",
  "quiero", "quieres", "quiere", "queremos", "quieren", "quería", "voy",
  "vas", "vamos", "van", "puedo", "puede", "podemos", "pueden", "necesito",
  "necesita", "necesitamos", "necesitan", "hago", "hace", "hacemos", "hacen",
  "dice", "decimos", "hay", "había", "abrir", "abre", "abrimos", "abren",
  "abierto", "abierta", "operar", "opera", "operamos", "operan", "operando",
  "vender", "vende", "vendemos", "venden", "comprar", "trabajar", "trabajo",
  "trabaja", "trabajamos", "montar", "monto", "negocio", "negocios",
  "empresa", "empresas", "compañía", "compañías", "tienda", "tiendas",
  "restaurante", "restaurantes", "clínica", "clínicas", "oficina", "oficinas",
  "almacén", "casa", "edificio", "edificios", "propiedad", "propiedades",
  "terreno", "terrenos", "empleado", "empleados", "empleada", "empleadas",
  "dueño", "dueña", "dueños", "cliente", "clientes", "año", "años", "día",
  "días", "meses", "veces", "nombre", "dirección", "teléfono", "correo",
  "número", "fecha", "permiso", "permisos", "licencia", "licencias",
  "patente", "municipio", "municipios", "un", "en", "de", "la", "no", "solo",
  "yo", "sí", "si",
]);

export function detectSpanish(text: string): boolean {
  const words = (text || "").toLowerCase().match(/[a-záéíóúñü]+/g) || [];
  if (!words.length) return false;
  const uniq = new Set(words);
  let hits = 0;
  for (const w of uniq) if (ES_STOPWORDS.has(w)) hits++;
  // Short inputs (a sentence fragment) get a lower bar — "No voy a vender
  // alcohol." and "Solo yo." must still route to the Spanish prompt.
  if (hits >= (words.length <= 6 ? 2 : 3)) return true;
  const hasStrongPunct = /[¿¡]/.test(text);
  const accented = words.filter((w) => /[áéíóúñü]/.test(w)).length;
  if (hits >= 1 && (hasStrongPunct || accented >= 2)) return true;
  // Long unaccented Spanish text: fall back to stopword density.
  if (words.length >= 12 && hits / words.length >= 0.25) return true;
  return false;
}

