// ============================================================================
// Lightweight KB retrieval for natural-language intake.
//
// Picks a SMALL set of candidates out of the ACTIVE knowledge base (bundled
// JSON or the published snapshot — whichever the rules engine is currently
// using) so the model only ever chooses from real SmartPR ids. No external
// retrieval, no vector store, no second regulatory knowledge base.
// ============================================================================

import type { KnowledgeBase } from "../../rulesEngine.ts";
import { applicableQuestionIds, isApplicableQuestionId } from "./questionKeyMap.ts";

export interface BusinessTypeCandidate {
  id: string;
  name: string;
  industry_id?: string;
}

export interface QuestionCandidate {
  id: string;
  question: string;
  type: string;
  options?: string[];
}

export interface KbCandidates {
  businessTypes: BusinessTypeCandidate[];
  municipalities: string[];
  questions: QuestionCandidate[];
}

export const MAX_BUSINESS_TYPES = 14;
export const MAX_MUNICIPALITIES = 10;
export const MAX_QUESTIONS = 26;

/** Lowercase, strip accents/punctuation — "Bayamón" and "bayamon" must match. */
export function normalize(text: string): string {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "i", "a", "an", "the", "to", "in", "on", "at", "of", "for", "and", "or", "with", "want", "would",
  "like", "open", "opening", "start", "starting", "my", "we", "will", "be", "is", "are", "new",
  "business", "company", "puerto", "rico", "pr", "quiero", "abrir", "un", "una", "en", "con", "y",
  "de", "la", "el", "negocio", "mi",
]);

function tokens(text: string): string[] {
  return normalize(text).split(" ").filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/** Overlap score between a phrase and the description. */
function scorePhrase(phrase: string, descNorm: string, descTokens: Set<string>): number {
  const p = normalize(phrase);
  if (!p) return 0;
  // Whole-phrase hit is the strongest signal ("coffee shop" in the text).
  if (descNorm.includes(p)) return 10 + p.length / 20;
  const parts = p.split(" ").filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  if (parts.length === 0) return 0;
  const hits = parts.filter((w) => descTokens.has(w)).length;
  return hits === 0 ? 0 : hits / parts.length;
}

/**
 * Extra vocabulary that maps everyday phrasing onto SmartPR question topics.
 * These only decide WHICH questions get shown to the model as options — the
 * model still decides the answer, and rules.json still decides requirements.
 */
const QUESTION_HINTS: Record<string, string[]> = {
  Q_FOOD_PREPARED: ["food", "kitchen", "cook", "restaurant", "cafe", "coffee", "bakery", "menu", "comida", "cocina"],
  Q_FOOD_SOLD: ["food", "sell", "grocery", "market", "snack", "comida", "vender"],
  Q_FOOD_SERVED: ["food", "serve", "eat", "dine", "dining", "restaurant", "cafe", "coffee", "table", "comer"],
  Q_ALCOHOL_SOLD: ["alcohol", "beer", "wine", "liquor", "cocktail", "bar", "spirits", "cerveza", "vino", "licor"],
  Q_ALCOHOL_SERVED: ["alcohol", "beer", "wine", "liquor", "cocktail", "bar", "spirits", "serve", "cerveza", "vino"],
  Q_OUTDOOR_SEATING: ["outdoor", "outside", "patio", "terrace", "sidewalk", "al fresco", "tables outside", "terraza", "afuera"],
  Q_LIVE_ENTERTAINMENT: ["music", "live", "band", "dj", "entertainment", "dancing", "show", "musica"],
  Q_EMPLOYEES_HIRED: ["employee", "staff", "hire", "hiring", "worker", "team", "empleado", "personal"],
  Q_HEALTHCARE_SERVICES: ["clinic", "health", "medical", "doctor", "dental", "patient", "therapy", "nurse", "salud", "medico"],
  Q_MEDICAL_WASTE: ["medical", "clinic", "waste", "sharps", "biohazard"],
  Q_BIOHAZARD_WASTE: ["biohazard", "medical", "lab", "blood"],
  Q_CONTROLLED_SUBSTANCES: ["pharmacy", "controlled", "prescription", "narcotic", "farmacia"],
  Q_PROFESSIONAL_LICENSES: ["licensed", "professional", "attorney", "lawyer", "accountant", "engineer", "architect", "cpa", "consulting", "consultant", "therapist", "salon", "barber"],
  Q_COMMERCIAL_SIGNAGE: ["sign", "signage", "billboard", "rotulo", "letrero"],
  Q_SHORT_TERM_RENTAL: ["airbnb", "rental", "short term", "guest", "overnight", "hotel", "hostel", "lodging", "alquiler"],
  Q_TOURISM_ACTIVITY: ["tour", "tourism", "tourist", "excursion", "kayak", "snorkel", "diving", "turismo"],
  Q_COMMERCIAL_VEHICLES: ["vehicle", "truck", "van", "fleet", "delivery", "transport", "camion"],
  Q_VEHICLE_REPAIR: ["repair", "mechanic", "auto", "body shop", "garage", "taller"],
  Q_RENEWABLE_INSTALL: ["solar", "placas solares", "paneles solares", "paneles", "placas", "renewable", "energia solar", "energía solar", "fotovoltaico", "fotovoltaic"],
  Q_SOLAR_MOUNTING: ["rooftop", "roof", "techo", "ground", "suelo", "terreno", "mounted"],
  Q_SOLAR_SIZE: ["mw", "megawatt", "kilowatt", "kw", "capacity", "capacidad"],
  Q_SOLAR_STRUCTURE: ["existing", "existente", "structure", "estructura", "building", "edificio"],
  Q_SOLAR_OWNERSHIP: ["own", "lease", "rent", "dueño", "propietario", "arrendar", "alquilar", "propiedad"],
  Q_SOLAR_BATTERY: ["battery", "bateria", "batería", "storage", "almacenamiento", "powerwall"],
  Q_HAZARDOUS_MATERIALS: ["hazardous", "chemical", "toxic", "flammable", "quimico"],
  Q_HAZARDOUS_FLUIDS: ["fluid", "oil", "fuel", "solvent", "gasoline"],
  Q_CHEMICALS_USED: ["chemical", "cleaning", "solvent", "dye", "quimico"],
  Q_PRODUCTS_MANUFACTURED: ["manufacture", "produce", "factory", "assembly", "fabricar"],
  Q_IMPORT_EXPORT: ["import", "export", "shipping", "customs", "importar", "exportar"],
  Q_CHILDREN_PRESENT: ["child", "children", "kid", "daycare", "childcare", "school", "tutoring", "nino"],
  Q_PESTICIDES: ["pesticide", "fumigation", "pest", "spray", "plaga"],
  Q_AGRICULTURE_PRODUCTION: ["farm", "agriculture", "crop", "livestock", "harvest", "finca", "agricola"],
  Q_FIREARMS_SOLD: ["firearm", "gun", "weapon", "ammunition", "arma"],
  Q_NONPROFIT_STATUS: ["nonprofit", "non-profit", "charity", "foundation", "sin fines de lucro"],
  Q_RENOVATIONS: ["renovation", "construction", "remodel", "build out", "buildout", "renovacion", "construccion"],
  Q_OWNS_PROPERTY: ["own the", "owns the", "purchased", "bought", "my building", "propiedad"],
  Q_EXISTING_LEASE: ["lease", "rent", "renting", "leasing", "arrendar", "alquilar"],
  Q_HOME_BASED: ["home", "house", "home-based", "from home", "casa", "desde casa"],
  Q_ONLINE_ONLY: ["online", "e-commerce", "ecommerce", "website", "virtual", "remote", "en linea"],
  Q_PHYSICAL_LOCATION: ["location", "storefront", "shop", "store", "office", "space", "local", "tienda"],
};

/** Questions always offered — they shape the core of every requirement set. */
const ALWAYS_INCLUDE = ["Q_PHYSICAL_LOCATION", "Q_HOME_BASED", "Q_ONLINE_ONLY", "Q_EMPLOYEES_HIRED"];

/**
 * Everyday phrasing that does not share tokens with the KB business-type name.
 * Without this, "coffee shop" would never surface BT_CAFE as an option.
 * These only widen the CANDIDATE list — the model still picks, and only ids
 * that exist in the active KB survive validation.
 */
const BUSINESS_TYPE_SYNONYMS: Record<string, string[]> = {
  BT_CAFE: ["coffee shop", "coffee house", "coffeehouse", "coffee", "espresso", "cafeteria", "cafetin"],
  BT_BAR: ["pub", "tavern", "cocktail lounge", "wine bar", "beer garden", "barra"],
  BT_RESTAURANT: ["eatery", "bistro", "diner", "restaurante"],
  BT_FOOD_TRUCK: ["food truck", "mobile kitchen", "food cart"],
  BT_BAKERY: ["panaderia", "pastry shop", "patisserie"],
  BT_CONSULTING_FIRM: ["consulting", "consultant", "consultancy", "advisory", "consultoria"],
  BT_LAW_FIRM: ["lawyer", "attorney", "legal practice", "abogado"],
  BT_GUEST_HOUSE: ["airbnb", "bed and breakfast", "b&b", "short term rental", "hostal"],
  BT_BEAUTY_SALON: ["hair salon", "barbershop", "barber shop", "peluqueria", "salon"],
  BT_DAYCARE: ["childcare", "child care", "nursery", "preschool", "cuido"],
  BT_SOLAR_INSTALLER: ["solar installer", "solar company", "solar panels", "placas solares", "instalador solar", "compañia solar"],
  BT_BATTERY_STORAGE_INSTALLER: ["battery installer", "battery storage", "baterias", "almacenamiento"],
  BT_RENEWABLE_ENERGY_COMPANY: ["renewable energy", "energia renovable", "energia limpia"],
};

/** Coarse industry detection used to top up thin candidate lists. */
const INDUSTRY_HINTS: Record<string, string[]> = {
  IND_FOOD: ["food", "restaurant", "cafe", "coffee", "bakery", "bar", "kitchen", "dining", "eat", "menu", "comida"],
  IND_PROF: ["consulting", "consultant", "advisory", "law", "legal", "accounting", "engineering", "architecture", "marketing", "agency"],
  IND_HEALTH: ["clinic", "medical", "health", "dental", "doctor", "therapy", "salud"],
  IND_TOURISM: ["hotel", "airbnb", "guest", "lodging", "tour", "tourism", "rental", "hostel"],
  IND_BEAUTY: ["salon", "barber", "spa", "beauty", "nails", "hair"],
  IND_EDUCATION: ["school", "daycare", "childcare", "tutoring", "training", "academy"],
  IND_RETAIL: ["retail", "store", "shop", "boutique", "tienda"],
  IND_ENERGY: ["energy", "solar", "energia", "placas", "electric", "utilities"],
};

function detectIndustryIds(descNorm: string): string[] {
  return Object.entries(INDUSTRY_HINTS)
    .map(([id, words]) => ({ id, score: words.reduce((a, w) => a + (descNorm.includes(normalize(w)) ? 1 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id);
}

/**
 * Build the candidate context for one description. Everything returned is
 * guaranteed to exist in the supplied (active) KB.
 */
export function buildKbCandidates(kb: KnowledgeBase, description: string): KbCandidates {
  const descNorm = normalize(description);
  const descTokens = new Set(tokens(description));

  // --- Business types: name overlap + synonyms, topped up by industry ------
  const allTypes = kb.businessTypes || [];
  const scored = allTypes
    .map((bt) => {
      const nameScore = scorePhrase(bt.name, descNorm, descTokens);
      const synonyms = BUSINESS_TYPE_SYNONYMS[bt.id] || [];
      const synScore = synonyms.reduce((acc, s) => {
        const n = normalize(s);
        return acc + (n && descNorm.includes(n) ? 12 + n.length / 20 : 0);
      }, 0);
      return { bt, score: nameScore + synScore };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const picked = scored.slice(0, MAX_BUSINESS_TYPES).map((x) => x.bt);
  // Thin list: offer a few siblings from the detected industry so the model has
  // a realistic choice instead of being forced into a poor match.
  if (picked.length < 5) {
    const seen = new Set(picked.map((b) => b.id));
    for (const industryId of detectIndustryIds(descNorm)) {
      for (const bt of allTypes) {
        if (picked.length >= MAX_BUSINESS_TYPES) break;
        if (bt.industry_id !== industryId || seen.has(bt.id)) continue;
        seen.add(bt.id);
        picked.push(bt);
      }
      if (picked.length >= MAX_BUSINESS_TYPES) break;
    }
  }
  const scoredTypes = picked
    .slice(0, MAX_BUSINESS_TYPES)
    .map((bt) => ({ id: bt.id, name: bt.name, industry_id: bt.industry_id }));

  // --- Municipalities: exact/substring hits, else the full name list -------
  const matched = (kb.municipalities || [])
    .filter((m) => descNorm.includes(normalize(m.name)))
    .map((m) => m.name);
  const municipalities = matched.length > 0
    ? matched.slice(0, MAX_MUNICIPALITIES)
    // No hit: names alone are tiny and let the model resolve "Old San Juan".
    : (kb.municipalities || []).map((m) => m.name);

  // --- Questions: only ones SmartPR can actually apply ---------------------
  const applicable = new Set(applicableQuestionIds());
  const byId = new Map((kb.questions || []).map((q) => [q.id, q]));
  const scoredQuestions = [...applicable]
    .filter((id) => byId.has(id))
    .map((id) => {
      const q = byId.get(id)!;
      const hints = QUESTION_HINTS[id] || [];
      const hintScore = hints.reduce((acc, h) => acc + (descNorm.includes(normalize(h)) ? 5 : 0), 0);
      const textScore = scorePhrase(q.question, descNorm, descTokens);
      const base = ALWAYS_INCLUDE.includes(id) ? 1 : 0;
      return { q, score: hintScore + textScore + base };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_QUESTIONS)
    .map((x) => ({
      id: x.q.id,
      question: x.q.question,
      type: x.q.type,
      ...(x.q.options ? { options: x.q.options } : {}),
    }));

  return { businessTypes: scoredTypes, municipalities, questions: scoredQuestions };
}

/** Guard against an oversized candidate payload reaching the model. */
export function clampCandidates(c: KbCandidates): KbCandidates {
  return {
    businessTypes: (c.businessTypes || []).slice(0, MAX_BUSINESS_TYPES),
    municipalities: (c.municipalities || []).slice(0, 80),
    questions: (c.questions || []).filter((q) => isApplicableQuestionId(q.id)).slice(0, MAX_QUESTIONS),
  };
}
