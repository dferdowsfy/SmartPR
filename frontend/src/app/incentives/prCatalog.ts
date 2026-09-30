// A statically authored Act 60 (Puerto Rico Incentives Code) catalog.
// Mirrors guidance/pr.ts: no database/graph dependency, so it renders the
// same whether or not a knowledge-graph store is configured. Each program
// maps 1:1 to an intake `industry` value so the eligibility engine's
// automatic industry-scope check is the only gate — no invented facts.
import type { IncentiveBenefit, IncentiveCriterion, IncentiveProgram, IncentiveSource } from "./types";

const VERIFIED = "2026-09-04";

const ACT_60: IncentiveSource = {
  id: "SRC_ACT60",
  name: "Ley 60-2019, Código de Incentivos de Puerto Rico",
  sourceType: "statute",
  legalStatus: "effective",
  jurisdiction: "Puerto Rico",
  citation: "Ley Núm. 60-2019, según enmendada, Código de Incentivos de Puerto Rico",
  url: "https://www.ddec.pr.gov/",
  effectiveDate: "2019-07-01",
  lastVerifiedAt: VERIFIED,
  sourceVersion: "2019-60-consolidated",
};

const DDEC = { id: "AGENCY_DDEC", name: "Departamento de Desarrollo Económico y Comercio (DDEC)" };
const ICP = { id: "AGENCY_ICP", name: "Instituto de Cultura Puertorriqueña — Oficina Estatal de Conservación Histórica" };
const OCIF = { id: "AGENCY_OCIF", name: "Oficina del Comisionado de Instituciones Financieras (OCIF)" };

const benefit = (id: string, name: string, description: string, amountDescription?: string): IncentiveBenefit => ({
  id, name, description, benefitType: "tax_incentive", amountDescription: amountDescription ?? null,
  citation: ACT_60.citation,
});

/** A criterion the eligibility engine can ask about when the fact is
 * unknown, rather than a blocking requirement — unanswered still shows the
 * program as a potential opportunity with a follow-up question. `label` is
 * the short affirmative phrase shown once the fact is confirmed (e.g. in a
 * "why SmartPR matched this" checklist); `question` is only ever shown
 * while the fact is still unconfirmed. */
const factCriterion = (input: {
  id: string; factKey: string; label: string; question: string; description: string;
}): IncentiveCriterion => ({
  id: input.id, name: input.label, description: input.description, factKey: input.factKey,
  operator: "truthy", required: true, material: true,
  question: input.question, answerType: "boolean", answerOptions: [],
  evidenceTypeIds: [], evidenceCanSatisfy: false, citation: ACT_60.citation,
});

// Every Act 60 decree application asks for evidence that the applicant is a
// duly formed, tax-compliant Puerto Rico business — the same documents
// SmartPR's own Requirements checklist already tracks by these exact ids.
// Kept as {id, name} so the incentive workflow can cross-reference a user's
// actual filing (by requirement document_id) instead of guessing.
const BASELINE_EVIDENCE = [
  { id: "DOC_ARTICLES_ORGANIZATION", name: "Certificate/Articles of Organization or Incorporation" },
  { id: "DOC_EIN", name: "EIN confirmation" },
  { id: "DOC_MERCHANT_REGISTRATION", name: "Merchant Registration Certificate" },
  { id: "DOC_MUNICIPAL_TAX_COMPLIANCE", name: "Municipal Tax Compliance Certificate" },
];

function program(input: {
  id: string;
  name: string;
  /** One industry (legacy shorthand) or several; omit both for a
   * cross-industry program (no industry gate at all). */
  industry?: string;
  industries?: string[];
  description: string;
  benefits: IncentiveBenefit[];
  applicationProcess: string;
  criteria?: IncentiveCriterion[];
  agency?: { id: string; name: string };
  sources?: IncentiveSource[];
  /** Documents beyond the standard formation/tax-compliance baseline that
   * this specific decree's application asks for. */
  extraEvidence?: { id: string; name: string }[];
}): IncentiveProgram {
  const agency = input.agency ?? DDEC;
  const industries = input.industries ?? (input.industry ? [input.industry] : []);
  return {
    id: input.id, name: input.name, programType: "tax_incentive",
    administeringAgency: agency, applicationAgency: DDEC,
    description: input.description, benefits: input.benefits,
    geography: { level: "island_wide", municipalityIds: [], municipalityNames: [], notes: null },
    applicableIndustries: { ids: [], names: industries },
    criteria: input.criteria ?? [], evidence: [...BASELINE_EVIDENCE, ...(input.extraEvidence ?? [])],
    applicationProcess: input.applicationProcess,
    applicationWindow: null,
    sources: input.sources ?? [ACT_60],
    status: "active", effectiveFrom: "2019-07-01", effectiveTo: null,
    lastVerifiedAt: VERIFIED, sourceVersion: "2026-09-04.1",
    supersedes: null, supersededBy: null,
    compatibleWith: [], conflictsWith: [], prerequisiteFor: [],
    automaticEligibility: false,
  };
}

export const PR_ACT60_CATALOG: IncentiveProgram[] = [
  program({
    id: "PR_ACT60_TOURISM", name: "Tourism and Visitors Economy Incentive", industry: "Accommodation & Tourism",
    description: "Act 60's tourism chapter offers a reduced corporate tax rate and municipal exemptions for hotels, resorts, guesthouses, and other visitor-economy businesses.",
    benefits: [
      benefit("b1", "Fixed corporate tax rate", "A fixed corporate tax rate, typically 4%, on income from the tourism activity."),
      benefit("b2", "Municipal development tax exemption", "A 100% exemption on municipal development taxes."),
      benefit("b3", "Municipal license and property tax exemption", "Up to a 100% exemption on municipal license and property taxes."),
      benefit("b4", "Tourism tax credits", "30% to 40% tax credits on total eligible project costs for building or substantially renovating hotels, resorts, guesthouses, and theme parks."),
    ],
    applicationProcess: "Apply for a tourism tax exemption decree through DDEC's Tourism Incentives Office before or during project development.",
    extraEvidence: [{ id: "DOC_TOURISM_REGISTRATION", name: "Tourism Registration" }],
  }),
  program({
    id: "PR_ACT60_AGRICULTURE", name: "Agricultural Development Incentive", industry: "Agriculture & Farming",
    description: "Act 60's agricultural chapter exempts most income and property associated with bona fide farming activity.",
    benefits: [
      benefit("b1", "Income tax exemption", "A 90% income tax exemption on income derived directly from agricultural activities."),
      benefit("b2", "Property tax exemption", "A 100% exemption on real and personal property taxes."),
      benefit("b3", "Municipal license tax exemption", "A 100% exemption on municipal license taxes."),
      benefit("b4", "IVU exemption on inputs", "A 100% exemption on Sales and Use Tax (IVU) for raw materials and farming equipment."),
    ],
    applicationProcess: "Apply for Bona Fide Farmer certification and the related tax exemption decree through DDEC / Departamento de Agricultura.",
    extraEvidence: [{ id: "DOC_AGRICULTURE_REGISTRATION", name: "Agriculture Registration" }],
  }),
  program({
    id: "PR_ACT60_FILM", name: "Creative Industries and Film Production Incentive", industry: "Arts, Entertainment & Recreation",
    description: "Act 60's creative-industries chapter credits production spending and offers a reduced rate for local studios and distribution entities.",
    benefits: [
      benefit("b1", "Resident production tax credit", "A 40% tax credit on production expenditures paid to Puerto Rico residents."),
      benefit("b2", "Non-resident talent tax credit", "A 20% tax credit for payments made to non-resident talent."),
      benefit("b3", "Studio corporate tax rate", "A 4% corporate tax rate for local film studios, sound stages, and distribution entities."),
    ],
    applicationProcess: "Apply through DDEC's Puerto Rico Film Commission before production begins to preserve credit eligibility.",
  }),
  program({
    id: "PR_ACT60_AUTOMOTIVE_EXPORT", name: "Export Services Framework — Automotive", industry: "Automotive",
    description: "Automotive design, logistics consulting, or software built for international dealerships can qualify as an export service under Act 60. Local dealerships and repair shops serving only the island's retail market do not qualify.",
    benefits: [
      benefit("b1", "Export-services corporate tax rate", "A 4% corporate tax rate on income from qualifying export activity."),
    ],
    applicationProcess: "Confirm the activity is genuinely export-oriented (clients and revenue outside Puerto Rico), then apply for an export-services tax exemption decree through DDEC.",
  }),
  program({
    id: "PR_ACT60_BEAUTY_EXPORT", name: "Export Services Framework — Beauty & Personal Care", industry: "Beauty & Personal Care",
    description: "Manufacturing localized cosmetics, or providing corporate training/franchise management for international beauty brands from Puerto Rico, can qualify as an export service. Local salons, spas, and storefronts serving only island customers do not qualify.",
    benefits: [
      benefit("b1", "Export-services corporate tax rate", "A 4% corporate tax rate on income from qualifying export activity."),
    ],
    applicationProcess: "Confirm the activity is genuinely export-oriented, then apply for an export-services tax exemption decree through DDEC.",
  }),
  program({
    id: "PR_ACT60_CONSTRUCTION", name: "Infrastructure and Housing Development Incentive", industry: "Construction",
    description: "Act 60 and related opportunity-zone rules offer exemptions, credits, and accelerated depreciation for developers building affordable housing, multi-family units, or state-partnered infrastructure.",
    benefits: [
      benefit("b1", "Development tax exemptions and credits", "Specialized tax exemptions, credits, and accelerated depreciation for qualifying housing or infrastructure development."),
      benefit("b2", "Opportunity Zone deferral", "Projects sited within a designated distressed area (Opportunity Zone) can unlock tax deferrals and reduced capital gains treatment."),
    ],
    applicationProcess: "Apply for the applicable housing/infrastructure decree through DDEC, or confirm Opportunity Zone status for the project site.",
  }),
  program({
    id: "PR_ACT60_EDUCATION_EXPORT", name: "Export Services Framework — Education & Training", industry: "Education & Training",
    description: "Companies producing educational modules, digital courses, online programs, or remote corporate training for audiences outside Puerto Rico can qualify as an export service.",
    benefits: [
      benefit("b1", "Export-services corporate tax rate", "A 4% corporate tax rate on income from qualifying export activity."),
      benefit("b2", "Dividend distribution exemption", "A 100% tax exemption on dividend distributions from the exempt business."),
    ],
    applicationProcess: "Confirm the activity is genuinely export-oriented, then apply for an export-services tax exemption decree through DDEC.",
  }),
  program({
    id: "PR_ACT60_ENERGY", name: "Green Energy and Renewable Resources Incentive", industry: "Energy & Utilities",
    description: "Act 60's green-energy chapter offers a reduced rate and tax exemptions for businesses generating power from renewable systems.",
    benefits: [
      benefit("b1", "Renewable-generation corporate tax rate", "A fixed 4% corporate tax rate for businesses generating power via renewable systems (solar, wind, hydro)."),
      benefit("b2", "Excise tax exemption", "A 100% exemption from state excise taxes on energy-generation machinery and equipment."),
      benefit("b3", "IVU exemption on equipment", "A 100% exemption from Sales and Use Tax (IVU) on energy-generation machinery and equipment."),
    ],
    applicationProcess: "Apply for a green-energy tax exemption decree through DDEC before installing generation equipment.",
  }),
  program({
    id: "PR_ACT60_IFE", name: "International Financial Entities (IFE) Incentive", industry: "Finance & Insurance",
    description: "Act 60 offers a reduced corporate tax rate for offshore banking, international asset management, and clearinghouse activity, provided the business does not transact with local Puerto Rico residents.",
    benefits: [
      benefit("b1", "IFE corporate tax rate", "A 4% corporate tax rate for offshore banking units, international asset managers, and clearinghouses that do not transact business with local residents."),
    ],
    applicationProcess: "Apply for an International Financial Entity license through OCIF, then the related tax exemption decree through DDEC.",
    agency: OCIF,
  }),
  program({
    id: "PR_ACT60_INTL_INSURANCE", name: "International Insurers and Reinsurers Incentive", industry: "Finance & Insurance",
    description: "Act 60 offers a preferential corporate tax rate for entities managing cross-border insurance and reinsurance risk from Puerto Rico.",
    benefits: [
      benefit("b1", "International insurer/reinsurer rate", "A preferential corporate tax rate — as low as 1–2% in some configurations — for managing cross-border insurance or reinsurance risk."),
    ],
    applicationProcess: "Apply for an international insurer or reinsurer license through OCIF, then the related tax exemption decree through DDEC.",
    agency: OCIF,
  }),
  program({
    id: "PR_ACT60_FOOD_MANUFACTURING", name: "Manufacturing Framework — Food & Beverage Export", industry: "Food & Beverage",
    description: "Companies that process, blend, or package food or beverages on the island for export qualify under the industrial tax decree. Local restaurants, bars, and cafes serving island customers operate under standard Puerto Rico corporate tax rates instead.",
    benefits: [
      benefit("b1", "Manufacturing corporate tax rate", "A 4% corporate tax rate on qualifying export food/beverage manufacturing income."),
    ],
    applicationProcess: "Confirm the activity is manufacturing-for-export rather than local food service, then apply for an industrial tax exemption decree through DDEC.",
  }),
  program({
    id: "PR_ACT60_PHYSICIAN", name: "Resident Physician Incentive", industry: "Healthcare",
    description: "Act 60 offers a reduced personal income tax rate on income from medical professional services practiced locally, intended to retain physicians on the island. Telehealth or medical-billing platforms serving international clinics can separately qualify as an export service.",
    benefits: [
      benefit("b1", "Resident physician tax rate", "A 4% personal income tax rate on income derived from medical professional services practiced locally."),
      benefit("b2", "Medical services export rate", "A 4% corporate tax rate for telehealth or medical-billing platforms serving international clinics."),
    ],
    applicationProcess: "Apply for the physician or medical-export decree through DDEC.",
  }),
  program({
    id: "PR_ACT60_IT_EXPORT", name: "Export Services Framework — Information Technology", industry: "Information Technology",
    description: "Software development, blockchain engineering, cloud hosting, SaaS, cybersecurity, and tech-support services provided to entities outside Puerto Rico qualify as a core export service.",
    benefits: [
      benefit("b1", "Export-services corporate tax rate", "A 4% corporate tax rate on qualifying export-services income."),
      benefit("b2", "Dividend distribution exemption", "A 100% exemption on distributed dividends from the exempt business."),
    ],
    applicationProcess: "Apply for an export-services tax exemption decree through DDEC.",
  }),
  program({
    id: "PR_ACT60_MANUFACTURING", name: "Manufacturing and Industrial Development Incentive", industry: "Manufacturing",
    description: "Act 60's industrial-development chapter offers a fixed reduced corporate tax rate for manufacturers, with a further-reduced rate available for pioneer or critical-IP projects.",
    benefits: [
      benefit("b1", "Industrial corporate tax rate", "A fixed 4% corporate tax rate, which can drop to 1–2% for pioneer mega-projects or critical intellectual property."),
      benefit("b2", "Profit distribution exemption", "A 100% tax exemption on distributed profits."),
      benefit("b3", "Royalty/license withholding exemption", "A significant exemption on royalty or license payments made to foreign entities."),
    ],
    applicationProcess: "Apply for an industrial tax exemption decree through DDEC.",
  }),
  program({
    id: "PR_ACT60_PROFESSIONAL_EXPORT", name: "Professional Services Framework (Core Export Industry)", industry: "Professional Services",
    description: "Consultants, lawyers, architects, marketing agencies, corporate headquarters, and remote project managers exporting their services to clients outside Puerto Rico qualify as a core export industry.",
    benefits: [
      benefit("b1", "Export-services corporate tax rate", "A 4% corporate tax rate on qualifying export-services income."),
      benefit("b2", "Dividend tax exemption", "A 100% dividend tax exemption on distributions from the exempt business."),
    ],
    applicationProcess: "Apply for an export-services tax exemption decree through DDEC.",
  }),
  program({
    id: "PR_ACT60_REAL_ESTATE", name: "Real Estate Investment Vehicles & Resident Investor Incentive", industry: "Real Estate",
    description: "Structured real estate investment vehicles and the Individual Investor Resident Decree offer distinct Act 60 tax treatment for Puerto Rico real estate.",
    benefits: [
      benefit("b1", "REIT pass-through exemption", "Highly structured vehicles investing in local real estate projects (REIT-style structures) can receive substantial pass-through tax exemptions."),
      benefit("b2", "Resident investor capital gains rate", "Individuals buying local real estate as a primary residence under the Individual Investor Resident Decree secure a 0% (pre-2027, grandfathered track) or 4% (2027 onward, new track) rate on post-move long-term capital gains when selling."),
    ],
    applicationProcess: "Apply for the applicable REIT structuring or Individual Investor Resident Decree through DDEC.",
  }),
  program({
    id: "PR_ACT60_RETAIL_EXPORT", name: "E-Commerce Export Incentive", industry: "Retail",
    description: "Traditional physical retail stores do not qualify for Act 60 corporate tax exemptions. E-commerce drop-shippers, digital marketplaces, or distribution hubs that store inventory locally and ship items to global customers can qualify as an export activity.",
    benefits: [
      benefit("b1", "Export-services corporate tax rate", "A 4% corporate tax rate on qualifying e-commerce export income."),
    ],
    applicationProcess: "Confirm the activity is export-oriented e-commerce rather than local storefront retail, then apply through DDEC.",
  }),
  program({
    id: "PR_ACT60_LOGISTICS_EXPORT", name: "Export Logistics Incentive", industry: "Transportation & Logistics",
    description: "Companies using Puerto Rico as an international maritime transport hub, hub-and-spoke freight forwarder, or cross-border shipping management platform qualify for the export logistics rate.",
    benefits: [
      benefit("b1", "Export logistics corporate tax rate", "A 4% corporate tax rate on qualifying export logistics income."),
    ],
    applicationProcess: "Apply for an export-services tax exemption decree through DDEC.",
  }),
  program({
    id: "PR_ACT60_WHOLESALE_EXPORT", name: "Export Goods Incentive", industry: "Wholesale Distribution",
    description: "Businesses that buy wholesale merchandise locally or internationally, hold inventory on the island, and redistribute those goods exclusively to foreign markets qualify for the export goods decree.",
    benefits: [
      benefit("b1", "Export goods corporate tax rate", "A 4% corporate tax rate on qualifying export-goods income."),
    ],
    applicationProcess: "Confirm the redistribution is exclusively to markets outside Puerto Rico, then apply through DDEC.",
  }),
  program({
    id: "PR_ACT60_GOVT_CONTRACTOR_EXPORT", name: "Export Services Framework — Government Contractor", industry: "Government Contractor",
    description: "Federal or international government contractors who perform administrative work, software design, consulting, or project tracking from a Puerto Rico office for overseas agencies qualify as an export service.",
    benefits: [
      benefit("b1", "Export-services corporate tax rate", "A 4% corporate tax rate on qualifying export-services income."),
    ],
    applicationProcess: "Confirm the work is performed for agencies outside Puerto Rico, then apply for an export-services tax exemption decree through DDEC.",
  }),
  program({
    id: "PR_ACT60_NONPROFIT", name: "Nonprofit Exemption Decree", industry: "Nonprofit / Religious Organization",
    description: "Certified charitable entities, foundations, and religious organizations receive a full exemption from corporate, municipal, and property taxes, and are eligible recipients of the mandatory annual charitable donations required from Act 60 individual investors.",
    benefits: [
      benefit("b1", "Full tax exemption", "A 100% exemption from corporate income, municipal, and property taxes for certified nonprofit/religious entities."),
      benefit("b2", "Eligible investor-donation recipient", "Eligibility to receive the mandatory annual $15,000 charitable donation required from Act 60 individual investor decree holders."),
    ],
    applicationProcess: "Apply for nonprofit certification and the related exemption decree through DDEC and Departamento de Hacienda.",
  }),
  program({
    id: "PR_ACT60_RND", name: "Research and Development (R&D) Incentive", industry: "Other",
    description: "For any cross-functional or otherwise unlisted industry investing in scientific advancement, Act 60 offers a substantial tax credit for eligible R&D, clinical trial, or intellectual-property development spending.",
    benefits: [
      benefit("b1", "R&D investment tax credit", "A 50% tax credit for eligible investments in local R&D, clinical trials, or home-grown intellectual property development."),
    ],
    applicationProcess: "Apply for the R&D tax credit through DDEC, documenting the qualifying research or development spending.",
  }),

  // ---- Additional Act 60 programs beyond the one-per-industry set above:
  // a second, more specific decree within an industry already listed, and
  // cross-industry chapters that are not gated by `industry` at all. ----

  program({
    id: "PR_ACT60_AIR_MARITIME", name: "Air and Maritime Transportation Incentive", industry: "Transportation & Logistics",
    description: "Act 60 separately incentivizes international air carrier and maritime cargo/passenger operations based in Puerto Rico — a distinct chapter from the general export-logistics decree covering companies operating airport concessions, port facilities, or vessel/aircraft fleets serving international routes.",
    benefits: [
      benefit("b1", "Air/maritime carrier corporate tax rate", "A 4% corporate tax rate on qualifying income from international air or maritime transportation operations based in Puerto Rico."),
    ],
    applicationProcess: "Apply for an air/maritime transportation tax exemption decree through DDEC; port and airport concession terms are separately negotiated with the Puerto Rico Ports Authority.",
    extraEvidence: [{ id: "DOC_PORT_FACILITY_PERMIT", name: "Port Facility Permit" }],
  }),
  program({
    id: "PR_ACT60_HISTORIC_PRESERVATION", name: "Historic Preservation Tax Credit", industry: "Construction",
    description: "Rehabilitating a certified historic structure — common for businesses locating in a municipality's historic district — can qualify for a separate preservation tax credit on top of any housing/infrastructure incentive, administered jointly with Puerto Rico's historic preservation office.",
    benefits: [
      benefit("b1", "Rehabilitation tax credit", "A tax credit on qualified rehabilitation expenses for a certified historic structure, in addition to any applicable housing or infrastructure incentive."),
    ],
    applicationProcess: "Obtain certification of the structure and rehabilitation plan from the Oficina Estatal de Conservación Histórica (ICP) before work begins, then apply for the credit through DDEC.",
    criteria: [factCriterion({
      id: "historic_rehab_activity", factKey: "construction_or_rehabilitation_activity",
      label: "Certified historic rehabilitation",
      question: "Does the project involve rehabilitating a certified historic structure?",
      description: "The credit applies to certified historic rehabilitation, not new construction generally.",
    })],
    agency: ICP,
    extraEvidence: [{ id: "DOC_HISTORIC_DISTRICT_REVIEW", name: "Historic District Review" }, { id: "DOC_FACADE_PRESERVATION", name: "Facade Preservation Plan" }],
  }),
  program({
    id: "PR_ACT60_TRADING_COMPANY", name: "International Trading Company Incentive", industry: undefined,
    description: "A business that imports, exports, or re-distributes goods internationally through Puerto Rico can qualify as a trading company under Act 60, regardless of its primary industry classification.",
    benefits: [
      benefit("b1", "Trading company corporate tax rate", "A 4% corporate tax rate on qualifying international trading income."),
    ],
    applicationProcess: "Confirm the business genuinely imports, exports, or redistributes goods internationally, then apply for a trading-company tax exemption decree through DDEC.",
    criteria: [factCriterion({
      id: "trading_export_activity", factKey: "export_activity",
      label: "International import/export/redistribution activity",
      question: "Does the business import, export, or redistribute goods to markets outside Puerto Rico?",
      description: "Trading-company treatment requires genuine international import/export/redistribution activity.",
    })],
    extraEvidence: [{ id: "DOC_IMPORT_EXPORT_REG", name: "Import/Export Registration" }],
  }),
  program({
    id: "PR_ACT60_RENEWABLE_INVESTMENT", name: "Green Energy Equipment Exemption and Special Deduction (Act 60 decree holders)", industry: undefined,
    description: "Available only to an Exempt Business holding an Act 60 Green Energy decree (Ley 60-2019, Chapter 7, Subchapter B) that is engaged in the Green Energy activities of Section 2071.01(6)–(10). Such a decree holder gets a full IVU and state excise exemption on qualifying Green Energy machinery and equipment (Section 2072.05) and may elect to deduct its green-energy buildings, structures, machinery, and equipment in the year incurred (Section 2072.06). A business that only installs solar or storage for its own facility, without that decree, does not qualify through this provision.",
    benefits: [
      benefit("b1", "IVU and excise exemption on Green Energy equipment", "Decree holders only (Section 2072.05(a)(1)): full exemption from the Sales and Use Tax (IVU) and state excise taxes, during the decree's exemption period, on raw materials and on machinery, equipment, and accessories used for Green Energy production. Construction materials and electrical material affixed to structures are excluded (Section 2072.05(a)(2))."),
      benefit("b2", "Special deduction for Green Energy investment", "Decree holders only (Section 2072.06(a)): option to deduct, in the year incurred, the cost of buildings, structures, machinery, and equipment used solely in the Section 2071.01(6)–(10) activities, instead of capitalizing it — provided the property has not been depreciated or previously used by another business or person in Puerto Rico. This accelerates the deduction; it is not an additional one (Section 2072.06(b))."),
    ],
    applicationProcess: "Obtain an Act 60 Green Energy decree from DDEC for an eligible Section 2071.01(6)–(10) activity; the exemption and special deduction then apply to that decree holder's qualifying equipment and investment. Source: Ley 60-2019, Sections 2072.05–2072.06.",
    criteria: [
      factCriterion({
        id: "renewable_investment_fact", factKey: "renewable_energy_investment",
        label: "Green Energy equipment investment",
        question: "Is the business investing in Green Energy generation or storage equipment (solar, wind, hydro, battery storage)?",
        description: "The equipment must be used for Green Energy production (Section 2072.05(a)(1)(ii)); for the special deduction it must not have been depreciated or previously used in Puerto Rico (Section 2072.06(a)(1)).",
      }),
      factCriterion({
        id: "green_energy_decree_fact", factKey: "green_energy_decree",
        label: "Holds an Act 60 Green Energy decree",
        question: "Does the business hold (or is it applying for) an Act 60 Green Energy tax-exemption decree from DDEC?",
        description: "Sections 2072.05 and 2072.06 apply only to an Exempt Business holding a Decree granted under Chapter 7, Subchapter B (Green Energy) of Ley 60-2019, engaged in the activities of Section 2071.01(6)–(10).",
      }),
    ],
  }),
  program({
    id: "PR_ACT60_OPPORTUNITY_ZONE", name: "Opportunity Zone Incentive", industry: undefined,
    description: "A project physically located within one of Puerto Rico's federally designated Opportunity Zones — which cover the large majority of the island — can combine federal capital-gains deferral with additional Act 60 provisions for Opportunity Zone projects, regardless of industry.",
    benefits: [
      benefit("b1", "Capital gains deferral and reduction", "Federal capital-gains tax deferral, and potential reduction, for qualifying investment held in the Opportunity Zone project."),
      benefit("b2", "Priority decree processing", "Priority processing for the underlying Act 60 tax exemption decree when the project is sited in a designated zone."),
    ],
    applicationProcess: "Confirm the project address falls within a designated Opportunity Zone (Puerto Rico's zones are published by DDEC and the U.S. Treasury), then structure the investment through a Qualified Opportunity Fund.",
    criteria: [factCriterion({
      id: "opportunity_zone_fact", factKey: "opportunity_zone",
      label: "Opportunity Zone location",
      question: "Is the project located within a designated Opportunity Zone?",
      description: "Puerto Rico designated Opportunity Zones covering most of the island under the 2017 federal Tax Cuts and Jobs Act.",
    })],
    extraEvidence: [{ id: "DOC_PROPERTY_DEED", name: "Property Deed or Site Control Evidence" }],
  }),
];
