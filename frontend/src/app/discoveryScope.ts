// Which business types the intake ASKS a cross-cutting discovery question.
//
// The knowledge graph links a few questions to every business type (contract
// construction work, federal contracts/grants). Asked of a restaurant or a
// nail salon they read as unrelated. This scopes only the question shown in
// the intake; the rules are unchanged — an answer given elsewhere (the
// description, the Passport, an inline requirement answer) still triggers
// the same requirement.

type BusinessTypeRef = { id: string; industry_id?: string };

interface Scope { industries: string[]; businessTypes: string[] }

export const DISCOVERY_QUESTION_SCOPE: Record<string, Scope> = {
  // DACO contractor registration (Ley 146-1995): trades that build, install
  // or repair on buildings for others.
  Q_OFFERS_CONSTRUCTION_SERVICES: {
    industries: ["IND_CONSTRUCTION"],
    businessTypes: [
      "BT_SOLAR_INSTALLER", "BT_BATTERY_STORAGE_INSTALLER", "BT_UTILITY_CONTRACTOR", "BT_RENEWABLE_ENERGY_COMPANY",
      "BT_CONSTRUCTION_GOVERNMENT_CONTRACTOR", "BT_FACILITIES_GOVERNMENT_CONTRACTOR", "BT_SECURITY_CONTRACTOR",
      "BT_REAL_ESTATE_DEVELOPER", "BT_PROPERTY_MANAGEMENT_COMPANY", "BT_ENGINEERING_FIRM", "BT_ARCHITECTURE_FIRM",
      "BT_HARDWARE_STORE",
    ],
  },
  // SAM.gov registration: businesses that plausibly bid on federal contracts
  // or apply for federal grants/awards.
  Q_FEDERAL_CONTRACTS_GRANTS: {
    industries: [
      "IND_GOVCON", "IND_PROF", "IND_IT", "IND_CONSTRUCTION", "IND_MANUFACTURING", "IND_TRANSPORT",
      "IND_ENERGY", "IND_WHOLESALE", "IND_NONPROFIT", "IND_EDUCATION", "IND_HEALTH", "IND_AGRICULTURE",
    ],
    businessTypes: ["BT_REAL_ESTATE_DEVELOPER", "BT_CATERING_BUSINESS", "BT_THEATER", "BT_ART_GALLERY"],
  },
  // G10 (live 2026-10-14): overnight / short-term-rental questions were linked
  // to every tourism BT (tour operators, kayak rentals, car rentals). Intake
  // only — lodging rules still fire if answered elsewhere.
  Q_GUESTS_OVERNIGHT: {
    industries: [],
    businessTypes: [
      "BT_HOTEL", "BT_RESORT", "BT_GUEST_HOUSE", "BT_AIRBNB_SHORT_TERM_RENTAL",
    ],
  },
  Q_SHORT_TERM_RENTAL: {
    industries: [],
    businessTypes: [
      "BT_HOTEL", "BT_RESORT", "BT_GUEST_HOUSE", "BT_AIRBNB_SHORT_TERM_RENTAL",
    ],
  },
  // G10: "Will food be sold?" on a hardware store (and other non-food retail).
  // Keep it for food businesses and retail that commonly sell packaged food.
  Q_FOOD_SOLD: {
    industries: ["IND_FOOD"],
    businessTypes: [
      "BT_CONVENIENCE_STORE", "BT_GIFT_SHOP", "BT_PHARMACY", "BT_FARM",
      "BT_FOOD_MANUFACTURING", "BT_WHOLESALE_FOOD_DISTRIBUTOR",
    ],
  },
};

/** True when the intake should ask this question for this business type. */
export function discoveryQuestionApplies(questionId: string, bt: BusinessTypeRef): boolean {
  const scope = DISCOVERY_QUESTION_SCOPE[questionId];
  if (!scope) return true;
  return scope.businessTypes.includes(bt.id) || (!!bt.industry_id && scope.industries.includes(bt.industry_id));
}
