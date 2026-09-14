// ============================================================================
// Puerto Rico Regulatory Knowledge Pack.
//
// This is the first concrete jurisdiction. Everything Puerto Rico-specific that
// used to be scattered across kb.ts, potentialRequirements.ts, page.tsx, and the
// analyze-document route now lives here as data.
// ============================================================================

import type {
  KnowledgeBase,
  KBMunicipality,
  KBBusinessType,
  KBQuestion,
  KBDocument,
  KBRule,
} from "../../rulesEngine";
import type { JurisdictionPack } from "../types";
import { PR_REQUIREMENT_GUIDANCE } from "../../guidance/pr.ts";

import municipalitiesJson from "../../../kb/municipalities.json" with { type: "json" };
import businessTypesJson from "../../../kb/business_types.json" with { type: "json" };
import questionsJson from "../../../kb/questions.json" with { type: "json" };
import documentsJson from "../../../kb/documents.json" with { type: "json" };
import rulesJson from "../../../kb/rules.json" with { type: "json" };

const kb: KnowledgeBase = {
  municipalities: municipalitiesJson as KBMunicipality[],
  businessTypes: businessTypesJson as KBBusinessType[],
  questions: questionsJson as KBQuestion[],
  documents: (documentsJson as KBDocument[]).map(d => ({ ...d, ...(PR_REQUIREMENT_GUIDANCE[d.id] ? { requirement_guidance: PR_REQUIREMENT_GUIDANCE[d.id] } : {}) })),
  rules: rulesJson as KBRule[],
  extensions: {
    // DOC_ROOM_TAX_RETURN is a RECURRING obligation, distinct from the
    // one-time DOC_TOURISM_REGISTRATION (Innkeeper) registration that
    // unlocks it — see requirementGuidance below and compliance/server.ts's
    // renewal lookup, which reads this array.
    renewals: [
      { document_id: "DOC_ROOM_TAX_RETURN", frequency_months: 1, citation: "Act 272-2003, Art. 28(A)-(B), 13 L.P.R.A. § 2271s." },
      // Annual corporate obligation with the Department of State. For years
      // prior to 2025: informe anual due April 15 (Art. 15.01(A) domestic,
      // Art. 15.03 foreign corps). From 2025 the report is replaced by the
      // Art. 17.01 annual fee (cargo anual) per Law 65-2025; the fee's due
      // date is set by Dept of State order and is not yet verified, so
      // reminders anchor to the stored fee date only. Corrected 2026-09-14:
      // 21.03(C) removed — that is the LLC annual fee (due March 1), a
      // separate obligation.
      { document_id: "DOC_ANNUAL_REPORT", frequency_months: 12, citation: "Arts. 15.01(A)/15.03, Law 164-2009 — annual report due April 15 (years prior to 2025); Law 65-2025 replaces the report with the Art. 17.01 annual fee from 2025. Fee: statutory minimum $100 (Art. 17.01(A)(15)), Dept of State practice $150." },
      // Patente Municipal: annual declaration; payment in two semiannual
      // installments. Verified 2026-09-14.
      { document_id: "DOC_PATENTE_MUNICIPAL", frequency_months: 12, citation: "Arts. 7.207(a) and 7.208, Law 107-2020 (Puerto Rico Municipal Code); OGP Carta Circular 002-2022. Declaration filed annually; payment in two semiannual installments." },
      // Fire Safety Certification: statutory annual fire inspection of covered
      // commercial/public buildings; certification rides the annual Permiso
      // Único renewal cycle. Verified 2026-09-14.
      { document_id: "DOC_FIRE_CERT", frequency_months: 12, citation: "25 L.P.R.A. § 3566 (mandatory annual fire inspection); Reglamento Conjunto 2019, Tomo IV, Cap. 4.1, Regla 4.1.4.1 (fire certification renewed with each Permiso Único renewal); OGPe Permiso Único Applicant Manual v1.2." },
      // CFSE workers' comp: annual policy year with semiannual premium
      // installments. Verified 2026-09-14.
      { document_id: "DOC_WORKERS_COMP", frequency_months: 12, citation: "Art. 16, Law 45-1935 (11 L.P.R.A. § 19) — premiums paid each semester with seal showing the covered year and semester." },
      // Permiso Único: expressly renewable annually. Verified 2026-09-14.
      { document_id: "DOC_PERMISO_UNICO", frequency_months: 12, citation: "OGPe Permiso Único Applicant Manual v1.2 (Nov. 2023): 'El permiso único deberá ser renovado anualmente.'" },
      // Merchant Registration Certificate: two-year term, then renewed.
      // Verified 2026-09-14.
      { document_id: "DOC_MERCHANT_REGISTRATION", frequency_months: 24, citation: "Hacienda Circular Letter CC RI 16-12, § II(B)(5) — new Merchant Registration Certificates have a two-year term and must then be renewed." },
      // Health / Sanitary Permit (establishment Licencia Sanitaria): follows
      // the annual Permiso Único renewal cycle. Verified 2026-09-14.
      { document_id: "DOC_HEALTH_PERMIT", frequency_months: 12, citation: "Reglamento Conjunto 2019, Tomo IV, Cap. 4.1, Regla 4.1.4.1 (Licencia Sanitaria requested with each Permiso Único new filing or renewal); OGPe Permiso Único Applicant Manual v1.2 (annual renewal)." },
      // Commercial vehicle registration (marbete): annual. Verified 2026-09-14.
      { document_id: "DOC_VEHICLE_REGISTRATION", frequency_months: 12, citation: "Art. 23.01, Law 22-2000 (annual license rights; marbete valid for one year)." },
      // Trade name (nombre comercial): 10-year term, renewable within the
      // year before expiry. Verified 2026-09-14.
      { document_id: "DOC_DBA_REGISTRATION", frequency_months: 120, citation: "Law 23-1992 (Ley de Nombres Comerciales de Puerto Rico), via Dept of State Registro de Marcas y Nombres Comerciales: registration valid 10 years, renewable within the year before expiry." },
      // LLP registration: 1-year validity from filing/renewal date, renewed
      // by filing a renewal request on or before expiry. Anniversary-based,
      // not a fixed calendar date. Verified 2026-09-14.
      { document_id: "DOC_LLP_REGISTRATION", frequency_months: 12, citation: "Law 154-1996, Art. 3(f) (10 L.P.R.A. § 1862(f)): LLP registration valid 1 year from filing; renewed by renewal request on or before expiry (Dept of State form CORPOTR09)." },
      // Foreign corporation authorization: same annual cycle as domestic
      // corps — report pre-2025, annual fee from 2025. Verified 2026-09-14.
      { document_id: "DOC_FOREIGN_CORPORATION_AUTHORIZATION", frequency_months: 12, citation: "Art. 15.03, Law 164-2009 — foreign corps file annual report by April 15 (years prior to 2025); from 2025 replaced by Art. 17.01 annual fee per Law 65-2025." },
      // Nonprofit corporation: annual report like other domestic corps.
      // Verified 2026-09-14.
      { document_id: "DOC_NONPROFIT_REGISTRATION", frequency_months: 12, citation: "Art. 15.01(A), Law 164-2009 (applies to all domestic corps incl. nonprofits); Art. 17.01(C)(13) filing fee. Report due April 15 for years prior to 2025; from 2025 replaced by Art. 17.01 annual fee per Law 65-2025." },
      // Alcohol beverage license (licencia de rentas internas): annual license
      // per establishment; renewal through SURI in a ~60-day window around
      // expiry. Verified 2026-09-14.
      { document_id: "DOC_ALCOHOL_LICENSE", frequency_months: 12, citation: "13 L.P.R.A. § 32554 (Código de Rentas Internas 2011, Subt. C/E): license obtained 'anualmente' per establishment; Hacienda CC RI 18-14 — renewal via SURI, ~60-day window from first day of expiry month through end of following month; due date keyed to last digit of SSN/EIN." },
      // Tourism registration (travel agency / mayorista): annual fee per
      // fiscal year; CTPR publishes dedicated renewal requirements.
      // Verified 2026-09-14.
      { document_id: "DOC_TOURISM_REGISTRATION", frequency_months: 12, citation: "Ley 10-1970 (Compañía de Turismo licensing authority); CTPR requirements: 'arancel anual correspondiente al Año Fiscal' (July 1–June 30), not prorated; CTPR publishes 'Requisitos para Renovación' for agencies/mayoristas." },
      // NPDES industrial discharge permit: fixed term not to exceed 5 years.
      // Verified 2026-09-14.
      { document_id: "DOC_NPDES_INDUSTRIAL", frequency_months: 60, citation: "40 CFR §122.46(a): NPDES permits effective for a fixed term not to exceed 5 years. Maximum term — the facility's printed permit expiration governs; renewal application per 40 CFR §122.21(d) (typically ≥180 days before expiry)." },
      // Title V air emission permit: fixed term not to exceed 5 years.
      // Verified 2026-09-14.
      { document_id: "DOC_AIR_EMISSION_PERMIT", frequency_months: 60, citation: "CAA §502(b)(5)(B), 42 U.S.C. §7661a(b)(5)(B); 40 CFR §70.6(a)(2): Title V permits issued for a fixed term not to exceed 5 years. Maximum term — the facility's printed permit expiration governs." },
      // Pesticide applicator license: 4-year term, renewable for 4 more
      // years; renewal filed ≥90 days before expiry. Verified 2026-09-14.
      { document_id: "DOC_PESTICIDE_LICENSE", frequency_months: 48, citation: "PR Dept of Agriculture Reglamento de Plaguicidas, Art. 30(A): commercial/private applicator certificate expires 4 years after issuance, renewable for an additional 4 years; renewal application ≥90 days before expiry (Art. 30(B))." },
      // Childcare license (hogar de cuidado / home-based): 2-year term.
      // Scoped to home-based care under Reglamento 6475; center-based terms
      // (Reglamento 8860) not yet verified. Verified 2026-09-14.
      { document_id: "DOC_CHILDCARE_LICENSE", frequency_months: 24, citation: "Reglamento 6475 (Dept de la Familia — hogares de cuidado), Sec. 3.3(c): license granted for 2 years; Sec. 3.4: renewable for 2-year periods, renewal requested 60 days before expiry." },
      // Firearms dealer (armero) license: 1 year from issuance; renewal filed
      // 30 days before expiry. (Personal Licencia de Armas is 5 years — a
      // different license.) Verified 2026-09-14.
      { document_id: "DOC_FIREARMS_LICENSE", frequency_months: 12, citation: "Law 168-2019 (Ley de Armas de Puerto Rico de 2020), §464: dealer licenses expire 1 year from issuance; renewal filed 30 days before expiry." },
      // Bona fide farmer certification: 4-year validity. Verified 2026-09-14.
      { document_id: "DOC_AGRICULTURE_REGISTRATION", frequency_months: 48, citation: "Law 51-2021 amending Sec. 1020.08(a)(3), Law 60-2019 (Código de Incentivos de Puerto Rico): Certificación de Agricultor Bona Fide valid 4 years." },
      // Certified Food Protection Manager: certificate valid max 5 years.
      // Verified 2026-09-14.
      { document_id: "DOC_CFPM", frequency_months: 60, citation: "Conference for Food Protection, Standards for Accreditation of Food Protection Manager Certification Programs, §7.2: certificate valid for no more than 5 years." },
      // CBP continuous import bond: annual periods until terminated.
      // Verified 2026-09-14.
      { document_id: "DOC_CUSTOMS_BROKER_BOND", frequency_months: 12, citation: "19 CFR Part 113, App. D to Subpart G: continuous bond 'remains in force for one year beginning with the effective date and for each succeeding annual period, or until terminated' (termination per 19 CFR §113.27)." },
      // SAM.gov entity registration: must be renewed every 365 days to
      // remain active; required to bid on federal contracts and receive
      // federal grants/awards. Verified 2026-09-14.
      { document_id: "DOC_SAM_REGISTRATION", frequency_months: 12, citation: "GSA, Comply with contractual requirements: SAM.gov registration must be renewed annually to remain active; SAM Entity Registration guide (FAR 52.204-7): renewal every 365 days." },
      // DACO Registro de Contratistas / urbanizador-constructor: Ley 146-1995
      // charges $100 for annual inscription renewal. Verified 2026-09-14.
      { document_id: "DOC_CONTRACTOR_LICENSE", frequency_months: 12, citation: "Ley 146-1995, Art. 2 — Registro de Contratistas (DACO): $100 por la renovación anual de la inscripción; Regl. 8172 urbanizador/constructor application includes a Renovación option." },
      // Everything else stays absent = renewal cadence unknown = no renewal
      // reminders. Never invent a cadence: add entries here only with an
      // authoritative source recorded in the citation.
    ],
  },
};


export const puertoRicoPack: JurisdictionPack = {
  meta: {
    id: "pr",
    name: "Puerto Rico",
    productName: "SmartPR",
    tagline: "Puerto Rico Business Licensing Readiness",
    defaultLanguage: "en",
    languages: ["en", "es"],
  },

  geo: {
    subdivisionLabel: "Municipality",
    subdivisionLabelPlural: "Municipalities",
  },

  kb,

  docMappings: {
    // Map KB document ids to the app's legacy requirement codes so existing
    // behavior (upload matching, submission filename ordering) is preserved.
    legacyCode: {
      DOC_CERT_INCORPORATION: "certificate_of_incorporation",
      DOC_FOREIGN_CORPORATION_AUTHORIZATION: "foreign_corporation_authorization",
      DOC_LLP_REGISTRATION: "llp_registration",
      DOC_EIN: "ein_letter",
      DOC_MERCHANT_REGISTRATION: "merchant_registration",
      DOC_PERMISO_UNICO: "permiso_unico",
      DOC_PATENTE_MUNICIPAL: "patente_municipal",
      DOC_HEALTH_PERMIT: "health_permit",
      DOC_FIRE_CERT: "fire_certification",
      DOC_SAM_REGISTRATION: "sam_registration",
      DOC_CFPM: "food_manager_cert",
      DOC_ALCOHOL_LICENSE: "alcohol_permit",
      DOC_WORKERS_COMP: "workers_comp",
      DOC_LEASE_AGREEMENT: "lease_or_property_docs",
      DOC_CONTRACTOR_LICENSE: "contractor_license",
      DOC_CRIM_CLEARANCE: "crim_clearance",
      DOC_PROFESSIONAL_LICENSE: "professional_licenses",
      DOC_ENVIRONMENTAL_PERMIT: "environmental_permit",
      DOC_TRANSPORT_PERMIT: "transportation_permit",
      DOC_TOURISM_REGISTRATION: "tourism_registration",
      DOC_SIGN_PERMIT: "sign_permit",
      DOC_OUTDOOR_SEATING_AUTH: "outdoor_seating_auth",
      DOC_ENTERTAINMENT_PERMIT: "entertainment_permit",
      DOC_IMPORT_EXPORT_REG: "import_export_reg",
      DOC_HOME_DECLARATION: "home_declaration",
      DOC_HOA_AUTHORIZATION: "hoa_authorization",
      DOC_ROOM_TAX_RETURN: "room_tax_return",
    },
    recommended: [
      "DOC_INSURANCE",
      "DOC_CRIM_CLEARANCE",
      "DOC_SIGN_PERMIT",
      "DOC_OUTDOOR_SEATING_AUTH",
      "DOC_ENTERTAINMENT_PERMIT",
      "DOC_FLOOR_PLANS",
      "DOC_DBA_REGISTRATION",
    ],
    order: [
      "DOC_CERT_INCORPORATION",
      "DOC_ARTICLES_ORGANIZATION",
      "DOC_EIN",
      "DOC_MERCHANT_REGISTRATION",
      "DOC_SURI_REGISTRATION",
      "DOC_PERMISO_UNICO",
      "DOC_ZONING",
      "DOC_PATENTE_MUNICIPAL",
      "DOC_MUNICIPAL_REGISTRATION",
      "DOC_MUNICIPAL_TAX_COMPLIANCE",
      "DOC_HEALTH_PERMIT",
      "DOC_FIRE_CERT",
      "DOC_CFPM",
      "DOC_ALCOHOL_LICENSE",
      "DOC_PROFESSIONAL_LICENSE",
      "DOC_CONTRACTOR_LICENSE",
      "DOC_SAM_REGISTRATION",
      "DOC_TOURISM_REGISTRATION",
      "DOC_HOA_AUTHORIZATION",
      "DOC_ROOM_TAX_RETURN",
    ],
  },

  flagAdvisories: {
    order: ["island", "coastal", "tourism", "historic", "metro", "capital", "industrial_port", "airport_host"],
    byFlag: {
      island: {
        flag: "island",
        flagLabel: "Island Municipality",
        document: "ATM Ferry Logistics + Island Waste Management",
        agency: "Autoridad de Transporte Marítimo (ATM) + Municipal Solid Waste",
        why:
          "Vieques and Culebra depend on Autoridad de Transporte Marítimo (ATM) ferry service for inventory, staff, and customer access, and have limited island landfill capacity. Hospitality, F&B, retail, and tour operators here typically need an ATM ferry-logistics manifest and a commercial waste-collection contract.",
        followUp:
          "Will this business transport goods, equipment, employees, food, materials, or customers to/from the island, or generate regular commercial waste?",
      },
      coastal: {
        flag: "coastal",
        flagLabel: "Coastal Municipality",
        document: "Coastal / Environmental Zone Review",
        agency: "Departamento de Recursos Naturales y Ambientales (DRNA)",
        why:
          "This municipality lies in a coastal zone. Businesses operating near the maritime-terrestrial zone may require an environmental or coastal review depending on location and activities.",
        followUp:
          "Will this business operate, build, store, or discharge anything near the coast, beach, or maritime-terrestrial zone?",
      },
      tourism: {
        flag: "tourism",
        flagLabel: "Tourism Municipality",
        document: "Tourism Registration",
        agency: "Compañía de Turismo de Puerto Rico",
        why:
          "This municipality is a designated tourism zone. Businesses serving visitors (lodging, tours, experiences, transport) may need to register with the Tourism Company.",
        followUp:
          "Will this business provide lodging, tours, experiences, or services primarily aimed at tourists/visitors?",
      },
      historic: {
        flag: "historic",
        flagLabel: "Historic District Municipality",
        document: "Historic District Review",
        agency:
          "Instituto de Cultura Puertorriqueña / Oficina Estatal de Conservación Histórica",
        why:
          "This municipality contains a designated historic district. Hospitality, F&B, retail, and personal-care businesses operating in the historic zone face additional review: facade preservation, structural/interior alteration approval, and stricter signage variances distinct from a regular sign permit.",
        followUp:
          "Will this business occupy, renovate, alter the interior, or place signage on a building within the historic district?",
      },
      metro: {
        flag: "metro",
        flagLabel: "Major Metro Municipality",
        document: "Additional Municipal Review",
        agency: "Municipal Permits Office",
        why:
          "This municipality is a major metropolitan area with additional municipal ordinances. Businesses here may face supplementary zoning, traffic, or municipal review depending on size and location.",
        followUp:
          "Will this business have significant foot/vehicle traffic, a large footprint, or operate in a dense commercial zone?",
      },
      capital: {
        flag: "capital",
        flagLabel: "Capital City (San Juan)",
        document: "San Juan-Specific Municipal Review",
        agency: "Municipio Autónomo de San Juan",
        why:
          "San Juan applies city-specific ordinances on top of the standard metro requirements (Old San Juan facade preservation, stricter noise ordinance, dedicated loading zones, San Juan Municipal Use Permit).",
        followUp:
          "Will this business operate in San Juan? It may need additional San Juan-specific permits beyond the standard metro requirements.",
      },
      industrial_port: {
        flag: "industrial_port",
        flagLabel: "Industrial / Port Corridor",
        document: "Heavy Industry & Port Compliance",
        agency: "Autoridad de los Puertos + EPA / Junta de Calidad Ambiental",
        why:
          "Ponce, Cataño, Guayanilla, Salinas, and Yabucoa sit along Puerto Rico's heavy-industry / port corridor. Manufacturing, logistics, and waste-handling businesses here face EPA/JCA point-source discharge (NPDES industrial), RCRA hazardous-waste handler registration, Title V air emissions, and Port Authority docking authorization — obligations that don't apply to ordinary coastal towns.",
        followUp:
          "Does this business manufacture, store hazardous materials, generate point-source discharge, or operate at or near a port facility?",
      },
      airport_host: {
        flag: "airport_host",
        flagLabel: "Airport-Host Municipality",
        document: "Airport-Adjacent Federal Compliance",
        agency: "U.S. Customs and Border Protection + TSA + Aerostar / Autoridad de los Puertos",
        why:
          "Carolina (LMM/SJU), Aguadilla (BQN), and Ponce (Mercedita) host customs-active airports. Air-cargo logistics, freight forwarding, importers, and airport-area car rentals face CBP customs brokerage bonds, TSA Known Shipper / Indirect Air Carrier certification, and airport-area concession agreements that don't apply elsewhere.",
        followUp:
          "Does this business ship cargo by air, clear customs, or operate as a concession in or directly adjacent to the airport?",
      },
    },
  },

  intakeCompat: {
    // Reverse of buildEngineInput()'s translation table: the wizard answer key
    // each KB question corresponds to. Kept 1:1 so snapshot-driven discovery
    // questions keep writing the same profile fields the engine already reads.
    uiKeyByQuestionId: {
      Q_FOOD_PREPARED: "food_prepared_on_site",
      Q_FOOD_SOLD: "food_sold",
      Q_FOOD_SERVED: "food_served",
      Q_ALCOHOL_SOLD: "alcohol_sold",
      Q_ALCOHOL_SERVED: "alcohol_served",
      Q_HEALTHCARE_SERVICES: "healthcare_services",
      Q_CONTROLLED_SUBSTANCES: "controlled_substances",
      Q_MEDICAL_WASTE: "medical_waste",
      Q_BIOHAZARD_WASTE: "biohazard_waste",
      Q_EMPLOYEES_HIRED: "employees_work_on_site",
      Q_COMMERCIAL_VEHICLES: "commercial_vehicles",
      Q_HAZARDOUS_MATERIALS: "hazardous_materials",
      Q_HAZARDOUS_FLUIDS: "hazardous_fluids",
      Q_CHEMICALS_USED: "chemicals_used",
      Q_PRODUCTS_MANUFACTURED: "products_manufactured",
      Q_IMPORT_EXPORT: "import_export",
      Q_PROFESSIONAL_LICENSES: "professional_licenses_required",
      Q_COMMERCIAL_SIGNAGE: "commercial_signage",
      Q_OUTDOOR_SEATING: "outdoor_seating",
      Q_LIVE_ENTERTAINMENT: "live_entertainment",
      Q_SHORT_TERM_RENTAL: "short_term_rental",
      Q_TOURISM_ACTIVITY: "tourism_activity",
      Q_OWNS_PROPERTY: "owns_property",
      Q_EXISTING_LEASE: "existing_lease",
      Q_CHILDREN_PRESENT: "children_present",
      Q_PESTICIDES: "pesticides",
      Q_AGRICULTURE_PRODUCTION: "agriculture_production",
      Q_FIREARMS_SOLD: "firearms_sold",
      Q_NONPROFIT_STATUS: "nonprofit_status",
      Q_RENOVATIONS: "renovations",
      Q_VEHICLE_REPAIR: "vehicles_repaired",
    },
    profileStageQuestionIds: [
      "Q_BUSINESS_STRUCTURE",
      "Q_PHYSICAL_LOCATION",
      "Q_HOME_BASED",
      "Q_ONLINE_ONLY",
      "Q_LOCATION_TYPE",
    ],
  },

  documentIntelligence: {
    analystSubject: "Puerto Rico business licensing",
    documentClasses: [
      "Certificate of Incorporation",
      "Articles of Organization",
      "IRS EIN Letter",
      "Merchant Registration Certificate",
      "Permiso Único",
      "Patente Municipal",
      "Health Permit",
      "Fire Certification",
      "CFPM Certificate",
      "Professional License",
      "Contractor License",
      "Tourism Registration",
      "Lease Agreement",
      "Property Deed",
      "Floor Plan",
      "Insurance Certificate",
      "Workers Compensation Certificate",
      "Medical Waste Contract",
      "Alcohol Permit",
      "Environmental Permit",
      "Sign Permit",
      "Background Check Documentation",
      "Business Address Documentation",
      "Unknown",
    ],
    extractionHints: [
      {
        match: ["ein"],
        instructions: `SPECIALIZED INSTRUCTIONS FOR THIS UPLOAD (EIN Letter):
- Treat the provided text as OCR output from an official IRS EIN confirmation letter.
- Specifically hunt for and extract the 9-digit Employer Identification Number (EIN). It usually appears as XX-XXXXXXX (e.g. 66-1234567).
- Prioritize placing the clean EIN into "license_or_permit_number".
- Also extract business_name / entity_name exactly as shown.
- Validation checks MUST include "EIN Format Valid", "EIN Found", "Business Name Match".
- If no properly formatted EIN is present, set overall_status to "Missing Information" or "Needs Review".`,
      },
      {
        match: ["health", "sanitary"],
        instructions: `SPECIALIZED INSTRUCTIONS FOR THIS UPLOAD (Health / Sanitary Permit):
- Treat the provided text as OCR from a Departamento de Salud Health Permit.
- Extract the permit number, facility name, expiration date, and any "uso"/classification.
- Place the permit number in "permit_number".
- Validation checks MUST include "Health Permit Number Found", "Not Expired", "Facility Name Match".`,
      },
      {
        match: ["fire", "bombero"],
        instructions: `SPECIALIZED INSTRUCTIONS FOR THIS UPLOAD (Fire Certification):
- Treat the provided text as OCR from a Certificado de Bomberos / Fire Safety document.
- Extract the certificate number, business name, and expiration.
- Place certificate number in "license_or_permit_number".
- Validation checks MUST include "Fire Certificate Number Found", "Not Expired".`,
      },
      {
        match: ["permiso", "unico"],
        instructions: `SPECIALIZED INSTRUCTIONS FOR THIS UPLOAD (Permiso Único):
- Treat the provided text as OCR from an official OGPe Permiso Único.
- Extract permit number, business name, address, expiration, and use classification.
- Place permit number in "permit_number".
- Validation checks MUST include "Permit Number Found", "Address Match", "Permit Active".`,
      },
      {
        match: ["merchant", "registro"],
        instructions: `SPECIALIZED INSTRUCTIONS FOR THIS UPLOAD (Merchant Registration):
- Treat the provided text as OCR from Hacienda Registro de Comerciante / Merchant Certificate.
- Extract the Merchant Number (often SURI-related), business name, and address.
- Place merchant number in "merchant_number".
- Validation checks MUST include "Merchant Number Extracted", "Merchant Registration Found".`,
      },
      {
        match: ["patente"],
        instructions: `SPECIALIZED INSTRUCTIONS FOR THIS UPLOAD (Patente Municipal):
- Extract the municipal account / patente number, municipality name, and business name.
- Place the account number in "license_or_permit_number".`,
      },
      {
        match: ["lease"],
        instructions: `SPECIALIZED INSTRUCTIONS FOR THIS UPLOAD (Lease Agreement):
- Extract tenant name, property address, lease start/end dates, landlord.
- Validate that the tenant roughly matches the business context.`,
      },
    ],
  },

};
