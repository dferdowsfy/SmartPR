"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import JSZip from 'jszip';
import { L } from './i18n';
import { computeRequirementsFromKB, runRulesEngineForProfile, buildEngineInput, KB, initKbFromServer, discoveryQuestionsForBusinessType, readinessWeightFor } from './kb';
import { ACTIVE_JURISDICTION } from './jurisdictions';
import { buildRequirementGuidance } from './requirementGuidance';
import { captureEvent, newSubmissionId } from './graph/client';
import type { CapturedAnswer, CapturedRequirement } from './graph/types';
import {
  mergeConfirmedPotentialRequirements,
  potentialItemsForFlags,
  type PotentialDecision,
  type PotentialDef,
} from './potentialRequirements';
import { buildExtraction, type ExtractionResult } from './documentFields';
import { IntakeQuestion } from './components/intake/IntakeQuestion';
import {
  ISSUED_DOCUMENT_GUIDANCE,
  ISSUED_DOCUMENT_GUIDANCE_ES,
  generateSampleApplicationPdf,
  getSampleApplication,
  missingRequiredSampleFields,
  prefillSampleApplication,
  type PreparedSampleApplication,
  type SampleFormData,
  type SampleFormValue,
} from './sampleApplicationForms';
// Schema-driven government form engine (CORPREG01–CORPREG06).
import { GovernmentFormModal } from './forms/engine/GovernmentFormModal';
import { CoreApplicationDetails } from './forms/engine/CoreApplicationDetails';
// Optional AI-assisted natural-language intake shortcut. The interpreter only
// fills EXISTING intake fields — the rules engine still decides requirements.
import { NaturalLanguageIntake } from './components/NaturalLanguageIntake';
import { mirrorAnswersToProfile, questionIdForAnswerKey } from './ai/intake/questionKeyMap';
// Intake is a connected fact model: the resolver derives every fact that is
// logically certain from what the user already told us, so SmartPR never asks a
// question it can answer. It produces facts only — requirements still come
// exclusively from the rules engine.
import { resolveIntakeFacts, type ResolutionResult } from './ai/intake/relationships';
import type { IntakePatch } from './ai/intake/validateInterpretation';
import { getDefinition, type RegistryEntry } from './forms/engine/registry';
import { selectFormForRequirement, selectEntriesForRequirement } from './forms/engine/routing';
import { buildCanonicalFromIntake, entityTypeFromLegacyStructure } from './forms/engine/intake';
import { requirementFormState, actionsForFormState } from './forms/engine/application';
import { generatePreparationPdf } from './forms/engine/pdfGenerator';
import { getTemplate, isOfficialArtifact } from './forms/artifacts/catalog';
import { entityTypeRequirements, exclusiveFormationRequirements, type MinimalRequirement } from './forms/engine/requirementAugment';
import type { CanonicalApplicationData, EntityType, FormData as GovFormData, GeneratedApplication } from './forms/engine/types';
import { localize } from './forms/engine/types';
import {
  FilingWorkflowShell,
  type FilingStage,
  type SmartPRLiveData,
} from './components/filing/FilingWorkflowShell';
import { RequirementCard, type RequirementAction, type RequirementBadge, type RequirementSecondaryAction } from './components/filing/RequirementCard';
import { ReadinessControl } from './components/filing/ReadinessControl';
import { iconToneFor, primaryStartLabelFor, secondaryUploadCopy, uploadOnlyCopy } from './components/filing/requirementCopy';
import { SmartPRChatbot } from './components/chat/SmartPRChatbot';
import { IncentivesSidebar } from './components/incentives/IncentivesSidebar';
import type { IncentiveAssessment, IncentiveEligibilityResult, ProjectFactValue } from './incentives/types';
import { IncentiveWorkflowPanel } from './components/incentives/IncentiveWorkflowPanel';
import { classifyPotentialItem, type Applicability, type RequirementKind, type RequirementStage } from './requirementApplicability';
import { saveGuestDraft, loadGuestDraft, clearGuestDraft } from '../lib/guestDraft';
import { readRestaurantHandoff } from './restaurants/model';
import { readClinicHandoff } from './clinics/model';
import { trackAcquisition } from './restaurants/analytics';
import { jsPDF } from 'jspdf';
import {
  CheckCircle, AlertTriangle, Info, FileText,
  ArrowRight, RefreshCw, Download, Building2, Archive, ExternalLink,
  ReceiptText, Store, Landmark, Waves, ShieldCheck, ScrollText, Eye,
  Star, ChevronDown, Sparkles,
} from 'lucide-react';

// SmartPR
// Puerto Rico Business Licensing Readiness Platform
// Real LLM-powered document identification and validation (AI via backend)

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

interface BusinessProfile {
  name: string;
  business_stage: 'new' | 'existing';
  municipality: string;
  industry: string;
  business_type: string;
  location_type: string;
  business_structure: string;
  number_of_employees: number | null;
  // Counts the relationship resolver maps onto the KB's own select buckets
  // (Q_FLEET_SIZE / Q_RENTAL_UNITS) and onto the matching boolean questions.
  number_of_vehicles?: number | null;
  number_of_rental_units?: number | null;
  customers_visit: boolean | null;
  food_prepared_or_sold: boolean | null;
  alcohol_sold: boolean | null;
  professional_licenses_required: boolean | null;
  healthcare_services: boolean | null;
  hazardous_materials: boolean | null;
  employees_hired: boolean | null;
  physical_location: boolean | null;
  products_manufactured: boolean | null;
  vehicles_used: boolean | null;
  commercial_signage: boolean | null;
  outdoor_seating: boolean | null;
  live_entertainment: boolean | null;
  short_term_rental: boolean | null;
  medical_waste: boolean | null;
  import_export: boolean | null;
}

interface Finding {
  severity: 'critical' | 'warning' | 'informational';
  title: string;
  description: string;
  recommended_action: string;
}

interface Requirement {
  code: string;
  name: string;
  mandatory: boolean;
  status: 'pending' | 'uploaded' | 'passed' | 'warning';
  agency: string;
  reason: string;
  document_id?: string;
  category?: string;
  source_rule?: string;
  applicability?: Applicability;
  kind?: RequirementKind;
  stage?: RequirementStage;
  triggerFacts?: string[];
  acceptsOfficialUpload?: boolean;
  /** Set only when this requirement was added because the user chose to
   * pursue an incentive that needs it — never on requirements the rules
   * engine would have surfaced anyway. Shown as a small contextual label. */
  incentiveLabel?: string;
}

function potentialItemsForProfile(
  profile: Pick<BusinessProfile, 'municipality'>,
  baseRequirements: Requirement[]
): PotentialDef[] {
  const municipality = KB.municipalities.find(
    (item) => item.name.toLowerCase() === (profile.municipality || '').toLowerCase()
  );
  const mandatoryNames = new Set(
    baseRequirements
      .filter((requirement) => requirement.mandatory)
      .map((requirement) => requirement.name.toLowerCase())
  );

  return potentialItemsForFlags(municipality ? (municipality.flags as string[]) : [])
    .filter((item) => !mandatoryNames.has(item.document.toLowerCase()));
}

const INDUSTRIES = [
  "Accommodation & Tourism",
  "Agriculture & Farming",
  "Arts, Entertainment & Recreation",
  "Automotive",
  "Beauty & Personal Care",
  "Construction",
  "Education & Training",
  "Energy & Utilities",
  "Finance & Insurance",
  "Food & Beverage",
  "Healthcare",
  "Information Technology",
  "Manufacturing",
  "Professional Services",
  "Real Estate",
  "Retail",
  "Transportation & Logistics",
  "Wholesale Distribution",
  "Government Contractor",
  "Nonprofit / Religious Organization",
  "Other"
];

const BUSINESS_TYPES: Record<string, string[]> = {
  "Food & Beverage": [
    "Restaurant",
    "Fast Food Restaurant",
    "Food Truck",
    "Bakery",
    "Cafe",
    "Coffee Shop",
    "Bar",
    "Nightclub",
    "Catering Business",
    "Commercial Kitchen",
    "Ice Cream Shop",
    "Juice Bar",
    "Convenience Store with Food",
    "Grocery Store",
    "Supermarket",
    "Liquor Store"
  ],
  "Healthcare": [
    "Medical Office",
    "Dental Office",
    "Pharmacy",
    "Laboratory",
    "Mental Health Practice",
    "Psychologist Office",
    "Physical Therapy Clinic",
    "Veterinary Clinic",
    "Home Health Agency",
    "Urgent Care Center",
    "Diagnostic Imaging Center"
  ],
  "Professional Services": [
    "Attorney Office",
    "CPA Firm",
    "Tax Preparation Firm",
    "Consulting Firm",
    "Marketing Agency",
    "Engineering Firm",
    "Architecture Firm",
    "Insurance Agency",
    "Real Estate Brokerage",
    "Property Management Company",
    "Staffing Agency",
    "Bookkeeping Service",
    "Business Consulting Firm"
  ],
  "Retail": [
    "Clothing Store",
    "Jewelry Store",
    "Electronics Store",
    "Furniture Store",
    "Hardware Store",
    "Sporting Goods Store",
    "Pet Store",
    "Gift Shop",
    "Convenience Store",
    "E-Commerce Business",
    "Cannabis Dispensary"
  ],
  "Construction": [
    "General Contractor",
    "Electrical Contractor",
    "Plumbing Contractor",
    "HVAC Contractor",
    "Roofing Contractor",
    "Concrete Contractor",
    "Landscaping Company",
    "Surveying Company",
    "Engineering Contractor",
    "Architecture Firm",
    "Construction Management Firm"
  ],
  "Accommodation & Tourism": [
    "Hotel",
    "Resort",
    "Airbnb",
    "Short-Term Rental",
    "Vacation Rental Manager",
    "Tour Operator",
    "Excursion Company",
    "Car Rental Business",
    "Water Sports Company",
    "Marina",
    "Travel Agency"
  ],
  "Beauty & Personal Care": [
    "Beauty Salon",
    "Barbershop",
    "Nail Salon",
    "Spa",
    "Massage Therapy",
    "Tattoo Shop",
    "Cosmetic Clinic",
    "Esthetics Studio"
  ],
  "Manufacturing": [
    "Food Manufacturing",
    "Pharmaceutical Manufacturing",
    "Medical Device Manufacturing",
    "Textile Manufacturing",
    "Furniture Manufacturing",
    "Beverage Manufacturing",
    "Consumer Products Manufacturing"
  ],
  "Transportation & Logistics": [
    "Trucking Company",
    "Courier Service",
    "Moving Company",
    "Taxi Service",
    "Rideshare Fleet",
    "Logistics Company",
    "Warehouse Operator",
    "Maritime Transportation",
    "Delivery Service"
  ],
  "Education & Training": [
    "Private School",
    "Daycare",
    "Tutoring Center",
    "Vocational School",
    "Training Company",
    "Educational Services Company"
  ],
  "Information Technology": [
    "Software Company",
    "SaaS Company",
    "IT Consulting Firm",
    "Cybersecurity Firm",
    "Managed Services Provider",
    "Data Analytics Firm",
    "AI Startup",
    "Technology Services Company"
  ],
  "Finance & Insurance": [
    "Insurance Agency",
    "Mortgage Broker",
    "Financial Advisor",
    "Accounting Firm",
    "Tax Services",
    "Investment Firm",
    "Credit Services"
  ],
  "Real Estate": [
    "Real Estate Brokerage",
    "Property Management",
    "Real Estate Investment Company",
    "Short-Term Rental Operator",
    "Developer",
    "Real Estate Consulting"
  ],
  "Automotive": [
    "Auto Repair Shop",
    "Body Shop",
    "Car Dealership",
    "Motorcycle Repair",
    "Auto Parts Store",
    "Vehicle Rental"
  ],
  "Agriculture & Farming": [
    "Farm",
    "Livestock Operation",
    "Aquaculture",
    "Food Production",
    "Agricultural Services"
  ]
};

// Snapshot-first: when a published knowledge-base snapshot defines discovery
// questions for this business type, they win; the hardcoded lists below are
// the fallback (and the only source until the first snapshot is published).
function getQuestionsForBusinessType(businessType: string): DiscoveryQuestion[] {
  const fromSnapshot = discoveryQuestionsForBusinessType(businessType);
  if (fromSnapshot) return fromSnapshot;
  return hardcodedQuestionsForBusinessType(businessType);
}

function hardcodedQuestionsForBusinessType(businessType: string): DiscoveryQuestion[] {
  const bt = businessType.toLowerCase().trim();

  // Short-Term Rental / Airbnb is its own archetype — property, ownership,
  // HOA, and Innkeeper-ID facts, never the restaurant/tour-operator
  // questions (food, alcohol, water activities) an ordinary residential
  // rental has no bearing on.
  if ([
    "airbnb", "short-term rental", "short term rental", "vacation rental manager",
    "short-term rental operator", "vacation rental", "vrbo", "guest rental",
    "tourist apartment", "vacation home rental",
  ].some(k => bt.includes(k))) {
    return [
      {
        id: "short_term_rental",
        text: "Will you rent this property to guests for stays of 90 days or less?",
        whyWeAsk: "Puerto Rico's short-term-rental rules apply specifically to lodging rented for 90 days or less — your answer determines whether this is treated as a short-term rental at all.",
      },
      {
        id: "str_property_type",
        text: "What type of property will you rent?",
        whyWeAsk: "This helps SmartPR describe your requirements in your own terms and flag rules specific to attached or shared residences.",
        options: [
          { value: "house", label: "House" },
          { value: "apartment", label: "Apartment / Condo" },
          { value: "other", label: "Other" },
        ],
      },
      {
        id: "str_ownership",
        text: "What is your relationship to the property?",
        whyWeAsk: "This determines what evidence SmartPR asks for: owners need proof of title, tenants need a lease, and managers need the owner's authorization.",
        options: [
          { value: "own", label: "I own it" },
          { value: "lease", label: "I lease it" },
          { value: "manage", label: "I manage it for the owner" },
        ],
      },
      {
        id: "str_hoa_condo",
        text: "Is the property part of a condominium, HOA, or other residential association?",
        whyWeAsk: "Some residential associations restrict or prohibit short-term rentals. If yours does, SmartPR needs evidence that short-term rentals are permitted.",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
          { value: "not_sure", label: "Not sure" },
        ],
      },
      {
        id: "str_existing_innkeeper_id",
        text: "Do you already have a Puerto Rico Tourism Company Innkeeper ID for this property?",
        whyWeAsk: "If you're already registered, SmartPR won't ask you to start a new registration — just confirm the existing one.",
        options: [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
          { value: "not_sure", label: "Not sure" },
        ],
      },
      {
        id: "employees_hired",
        text: "Will you directly employ anyone to operate or maintain the rental?",
        whyWeAsk: "This is about people you employ directly — not independent cleaners or property managers you hire as contractors. It determines whether employer registration and payroll obligations apply.",
      },
    ];
  }

  if (["restaurant", "fast food restaurant", "bakery", "cafe", "coffee shop", "bar", "nightclub", "food truck", "catering business", "commercial kitchen", "ice cream shop", "juice bar", "grocery store", "supermarket", "liquor store"].some(k => bt.includes(k))) {
    return [
      { id: "food_prepared_on_site", text: "Will food be prepared on-site?" },
      { id: "customers_consume_on_site", text: "Will customers consume food on-site?" },
      { id: "alcohol_sold", text: "Will alcohol be sold?" },
      { id: "outdoor_seating", text: "Will there be outdoor seating?" },
      { id: "live_entertainment", text: "Will there be live entertainment?" },
      { id: "food_delivered", text: "Will food be delivered?" },
      { id: "employees_work_on_site", text: "Will employees work on-site?" },
      { id: "food_truck_or_mobile", text: "Will this operate from a food truck or mobile unit?" },
    ];
  }

  if (["medical office", "dental office", "pharmacy", "laboratory", "mental health practice", "physical therapy clinic", "veterinary clinic", "urgent care center", "diagnostic imaging center", "medical spa", "assisted living facility", "elder care facility"].some(k => bt.includes(k))) {
    return [
      { id: "patients_visit", text: "Will patients visit this location?" },
      { id: "controlled_substances", text: "Will controlled substances be stored?" },
      { id: "medical_waste", text: "Will medical waste be generated?" },
      { id: "diagnostic_testing", text: "Will diagnostic testing be performed?" },
      { id: "healthcare_professionals", text: "Will healthcare professionals provide services?" },
      { id: "employees_work_on_site", text: "Will employees work on-site?" },
    ];
  }

  if (["attorney office", "cpa firm", "tax preparation firm", "consulting firm", "marketing agency", "engineering firm", "architecture firm", "insurance agency", "real estate brokerage", "property management company", "staffing agency", "bookkeeping service", "business consulting firm", "notary services", "translation services"].some(k => bt.includes(k))) {
    return [
      { id: "clients_visit", text: "Will clients visit your location?" },
      { id: "licensed_professionals", text: "Will licensed professionals provide services?" },
      { id: "employees_hired", text: "Will employees be hired?" },
      { id: "services_online", text: "Will services be delivered entirely online?" },
    ];
  }

  if (["software company", "saas company", "it consulting firm", "cybersecurity firm", "managed services provider", "data analytics firm", "ai startup", "technology services company", "web development agency"].some(k => bt.includes(k))) {
    return [
      { id: "physical_office", text: "Will employees work from a physical office?" },
      { id: "customers_visit", text: "Will customers visit the location?" },
      { id: "inventory_stored", text: "Will inventory be stored?" },
      { id: "hardware_sold", text: "Will hardware be sold?" },
    ];
  }

  if (["clothing store", "jewelry store", "electronics store", "furniture store", "hardware store", "sporting goods store", "pet store", "gift shop", "convenience store", "e-commerce business", "cannabis dispensary", "cosmetics store", "pharmacy retail", "home goods store"].some(k => bt.includes(k))) {
    return [
      { id: "customers_visit", text: "Will customers visit the location?" },
      { id: "products_stored", text: "Will products be stored on-site?" },
      { id: "food_sold", text: "Will food be sold?" },
      { id: "alcohol_sold", text: "Will alcohol be sold?" },
      { id: "deliveries_made", text: "Will deliveries be made?" },
    ];
  }

  if (["general contractor", "electrical contractor", "plumbing contractor", "hvac contractor", "roofing contractor", "concrete contractor", "landscaping company", "surveying company", "engineering contractor", "architecture firm", "construction management firm", "specialty trade contractor"].some(k => bt.includes(k))) {
    return [
      { id: "employees_hired", text: "Will employees be hired?" },
      { id: "commercial_vehicles", text: "Will commercial vehicles be used?" },
      { id: "hazardous_materials", text: "Will hazardous materials be stored?" },
      { id: "equipment_stored", text: "Will equipment be stored at a facility?" },
    ];
  }

  if (["hotel", "resort", "guest house", "tour operator", "excursion company", "car rental business", "water sports company", "marina", "travel agency"].some(k => bt.includes(k))) {
    return [
      { id: "guests_stay_overnight", text: "Will guests stay overnight?" },
      { id: "food_served", text: "Will food be served?" },
      { id: "alcohol_served", text: "Will alcohol be served?" },
      { id: "water_activities", text: "Will water activities be offered?" },
      { id: "employees_work_on_site", text: "Will employees work on-site?" },
    ];
  }

  if (["beauty salon", "barbershop", "nail salon", "spa", "massage therapy", "tattoo shop", "cosmetic clinic", "esthetics studio", "makeup studio", "hair removal studio"].some(k => bt.includes(k))) {
    return [
      { id: "customers_receive_services", text: "Will customers receive services on-site?" },
      { id: "needles_or_invasive", text: "Will needles or invasive procedures be used?" },
      { id: "biohazard_waste", text: "Will biohazard waste be generated?" },
      { id: "licensed_professionals", text: "Will licensed professionals provide services?" },
    ];
  }

  if (["food manufacturing", "pharmaceutical manufacturing", "medical device manufacturing", "textile manufacturing", "furniture manufacturing", "beverage manufacturing", "consumer products manufacturing", "chemical manufacturing", "industrial manufacturing"].some(k => bt.includes(k))) {
    return [
      { id: "products_manufactured_on_site", text: "Will products be manufactured on-site?" },
      { id: "hazardous_materials", text: "Will hazardous materials be stored?" },
      { id: "employees_work_on_site", text: "Will employees work on-site?" },
      { id: "products_distributed", text: "Will products be distributed?" },
    ];
  }

  if (["trucking company", "courier service", "moving company", "taxi service", "rideshare fleet", "logistics company", "warehouse operator", "maritime transportation", "delivery service", "freight forwarding"].some(k => bt.includes(k))) {
    return [
      { id: "commercial_vehicles", text: "Will commercial vehicles be used?" },
      { id: "goods_stored", text: "Will goods be stored?" },
      { id: "hazardous_materials_transported", text: "Will hazardous materials be transported?" },
      { id: "employees_hired", text: "Will employees be hired?" },
    ];
  }

  if (["private school", "daycare", "tutoring center", "vocational school", "training company", "educational services company", "after-school program", "childcare center"].some(k => bt.includes(k))) {
    return [
      { id: "children_present", text: "Will children be present?" },
      { id: "classes_on_site", text: "Will classes be held on-site?" },
      { id: "employees_hired", text: "Will employees be hired?" },
      { id: "food_served", text: "Will food be served?" },
    ];
  }

  if (["software company", "saas company", "it consulting firm", "cybersecurity firm", "managed services provider", "data analytics firm", "ai startup", "technology services company", "web development agency"].some(k => bt.includes(k))) {
    return [
      { id: "physical_office", text: "Will employees work from a physical office?" },
      { id: "customers_visit", text: "Will customers visit the location?" },
      { id: "inventory_stored", text: "Will inventory be stored?" },
      { id: "hardware_sold", text: "Will hardware be sold?" },
    ];
  }

  if (["insurance agency", "mortgage broker", "financial advisor", "accounting firm", "tax services", "investment firm", "credit services", "bookkeeping firm", "payroll services"].some(k => bt.includes(k))) {
    return [
      { id: "clients_visit", text: "Will clients visit the office?" },
      { id: "employees_hired", text: "Will employees be hired?" },
      { id: "properties_managed", text: "Will properties be managed on behalf of others?" },
    ];
  }

  if (["auto repair shop", "body shop", "car dealership", "motorcycle repair", "auto parts store", "vehicle rental", "car wash", "tire shop"].some(k => bt.includes(k))) {
    return [
      { id: "vehicles_repaired", text: "Will vehicles be repaired?" },
      { id: "hazardous_fluids", text: "Will hazardous fluids be stored?" },
      { id: "customers_visit", text: "Will customers visit the facility?" },
    ];
  }

  if (["farm", "livestock operation", "aquaculture", "food production", "agricultural services", "nursery / plant business"].some(k => bt.includes(k))) {
    return [
      { id: "food_products_sold", text: "Will food products be sold?" },
      { id: "chemicals_stored", text: "Will chemicals be stored?" },
      { id: "employees_hired", text: "Will employees be hired?" },
    ];
  }

  if (["gym / fitness studio", "dance studio", "music venue", "event venue", "theater", "art gallery", "sports facility", "recreation facility", "entertainment venue"].some(k => bt.includes(k))) {
    return [
      { id: "customers_visit", text: "Will customers visit the location?" },
      { id: "employees_hired", text: "Will employees be hired?" },
      { id: "live_entertainment", text: "Will there be live entertainment?" },
    ];
  }

  if (["solar installer", "energy consulting", "utility contractor", "battery storage installer", "electrical services", "renewable energy company"].some(k => bt.includes(k))) {
    return [
      { id: "physical_office", text: "Will employees work from a physical office?" },
      { id: "hazardous_materials", text: "Will hazardous materials be stored?" },
      { id: "employees_hired", text: "Will employees be hired?" },
    ];
  }

  if (["wholesale food distributor", "wholesale goods distributor", "import / export business", "warehouse distributor", "beverage distributor"].some(k => bt.includes(k))) {
    return [
      { id: "goods_stored", text: "Will goods be stored?" },
      { id: "hazardous_materials", text: "Will hazardous materials be stored?" },
      { id: "employees_hired", text: "Will employees be hired?" },
    ];
  }

  if (["professional services contractor", "construction contractor", "it contractor", "staffing contractor", "facilities contractor", "security contractor"].some(k => bt.includes(k))) {
    return [
      { id: "clients_visit", text: "Will clients visit the office?" },
      { id: "employees_hired", text: "Will employees be hired?" },
      { id: "physical_location", text: "Will the business operate from a physical location?" },
    ];
  }

  if (["nonprofit organization", "religious organization", "community organization", "foundation", "charity"].some(k => bt.includes(k))) {
    return [
      { id: "clients_visit", text: "Will clients or members visit?" },
      { id: "employees_hired", text: "Will employees be hired?" },
      { id: "physical_location", text: "Will the business operate from a physical location?" },
    ];
  }

  // Default / universal for Other or unmatched
  return [
    { id: "employees_hired", text: "Will employees be hired?" },
    { id: "physical_location", text: "Will the business operate from a physical location?" },
    { id: "customers_visit", text: "Will customers visit the location?" },
    { id: "professional_licenses_required", text: "Will professional licenses be required?" },
  ];
}

// ---------------------------------------------------------------------------
// Conditional question filtering
//
// The KB list returned by getQuestionsForBusinessType() is the full catalogue
// for that business type. Several of those questions only make sense once you
// know the operating location_type — e.g. there's no point asking
// "Will customers visit the location?" or "Will inventory be stored?" when
// the user has already declared the business as Online Only.
//
// The filter is conservative: it skips questions whose answer is implied by
// the location choice. Anything ambiguous (e.g. employees_hired) is kept.
// ---------------------------------------------------------------------------
const PHYSICAL_PRESENCE_QUESTIONS = new Set<string>([
  "customers_visit",
  "customers_consume_on_site",
  "patients_visit",
  "clients_visit",
  "physical_office",
  "outdoor_seating",
  "live_entertainment",
  "food_prepared_on_site",
  "products_manufactured_on_site",
  "food_truck_or_mobile",
  "employees_work_on_site",
  "inventory_stored",
  "products_stored",
]);

const HOME_BASED_NOT_APPLICABLE = new Set<string>([
  "food_truck_or_mobile",
  "outdoor_seating",
  "live_entertainment",
  "patients_visit",
]);

interface DiscoveryQuestionOption { value: string; label: string }
interface DiscoveryQuestion {
  id: string;
  text: string;
  /** Shown via the same spr-question-context block used for municipality-flag
   * follow-ups — why SmartPR is asking, in the user's own project terms. */
  whyWeAsk?: string;
  /** Multi-value questions (2-3 options) reuse the existing spr-answer-row /
   * spr-answer-row-three button grid. Omitted = plain Yes/No. */
  options?: DiscoveryQuestionOption[];
}

export function filterQuestionsByContext(
  questions: DiscoveryQuestion[],
  locationType: string | undefined
): DiscoveryQuestion[] {
  const loc = (locationType || "").trim();
  if (loc === "Online Only") {
    return questions.filter((q) => !PHYSICAL_PRESENCE_QUESTIONS.has(q.id));
  }
  if (loc === "Home-Based Business") {
    return questions.filter((q) => !HOME_BASED_NOT_APPLICABLE.has(q.id));
  }
  return questions;
}

const LOCATION_TYPES_BY_BUSINESS_TYPE: Record<string, string[]> = {
  "Restaurant": ["Restaurant Location", "Retail Storefront", "Mixed Use Property", "Tourism Facility", "Commercial Office"],
  "Fast Food Restaurant": ["Restaurant Location", "Retail Storefront", "Mixed Use Property"],
  "Bakery": ["Restaurant Location", "Retail Storefront", "Commercial Kitchen", "Industrial Facility"],
  "Cafe": ["Restaurant Location", "Retail Storefront", "Mixed Use Property"],
  "Coffee Shop": ["Restaurant Location", "Retail Storefront", "Mixed Use Property"],
  "Bar": ["Restaurant Location", "Retail Storefront", "Entertainment Venue", "Tourism Facility"],
  "Nightclub": ["Entertainment Venue", "Retail Storefront", "Tourism Facility"],
  "Food Truck": ["Food Truck", "Mobile Business", "Commercial Kitchen"],
  "Catering Business": ["Commercial Kitchen", "Commercial Office", "Home-Based Business", "Industrial Facility"],
  "Commercial Kitchen": ["Commercial Kitchen", "Industrial Facility"],
  "Ice Cream Shop": ["Retail Storefront", "Restaurant Location"],
  "Juice Bar": ["Retail Storefront", "Restaurant Location"],
  "Convenience Store with Food": ["Retail Storefront"],
  "Grocery Store": ["Retail Storefront", "Commercial Facility"],
  "Supermarket": ["Retail Storefront", "Commercial Facility"],
  "Liquor Store": ["Retail Storefront", "Commercial Facility"],
  "Medical Office": ["Healthcare Facility", "Professional Office", "Commercial Office"],
  "Dental Office": ["Healthcare Facility", "Professional Office"],
  "Pharmacy": ["Healthcare Facility", "Retail Storefront"],
  "Laboratory": ["Healthcare Facility", "Industrial Facility"],
  "Mental Health Practice": ["Professional Office", "Commercial Office", "Healthcare Facility", "Shared Workspace"],
  "Psychologist Office": ["Professional Office", "Commercial Office", "Healthcare Facility", "Shared Workspace"],
  "Physical Therapy Clinic": ["Healthcare Facility", "Professional Office"],
  "Veterinary Clinic": ["Healthcare Facility", "Commercial Facility"],
  "Home Health Agency": ["Commercial Office", "Professional Office"],
  "Urgent Care Center": ["Healthcare Facility"],
  "Diagnostic Imaging Center": ["Healthcare Facility"],
  "Medical Spa": ["Healthcare Facility", "Commercial Office"],
  "Assisted Living Facility": ["Healthcare Facility"],
  "Elder Care Facility": ["Healthcare Facility"],
  "Attorney Office": ["Professional Office", "Commercial Office", "Shared Workspace", "Home-Based Business"],
  "CPA Firm": ["Professional Office", "Commercial Office", "Shared Workspace", "Home-Based Business"],
  "Tax Preparation Firm": ["Professional Office", "Commercial Office", "Shared Workspace", "Home-Based Business"],
  "Consulting Firm": ["Professional Office", "Commercial Office", "Shared Workspace", "Home-Based Business", "Online Only"],
  "Marketing Agency": ["Professional Office", "Commercial Office", "Shared Workspace", "Home-Based Business", "Online Only"],
  "Engineering Firm": ["Professional Office", "Commercial Office", "Shared Workspace", "Home-Based Business"],
  "Architecture Firm": ["Professional Office", "Commercial Office", "Shared Workspace", "Home-Based Business"],
  "Insurance Agency": ["Professional Office", "Commercial Office", "Shared Workspace"],
  "Real Estate Brokerage": ["Professional Office", "Commercial Office", "Shared Workspace", "Home-Based Business"],
  "Property Management Company": ["Professional Office", "Commercial Office"],
  "Staffing Agency": ["Professional Office", "Commercial Office"],
  "Bookkeeping Service": ["Professional Office", "Commercial Office", "Shared Workspace", "Home-Based Business"],
  "Business Consulting Firm": ["Professional Office", "Commercial Office", "Shared Workspace", "Home-Based Business", "Online Only"],
  "Notary Services": ["Professional Office", "Commercial Office", "Home-Based Business"],
  "Translation Services": ["Home-Based Business", "Shared Workspace", "Online Only", "Professional Office"],
  "Clothing Store": ["Retail Storefront"],
  "Jewelry Store": ["Retail Storefront"],
  "Electronics Store": ["Retail Storefront"],
  "Furniture Store": ["Retail Storefront", "Warehouse"],
  "Hardware Store": ["Retail Storefront", "Warehouse"],
  "Sporting Goods Store": ["Retail Storefront"],
  "Pet Store": ["Retail Storefront"],
  "Gift Shop": ["Retail Storefront"],
  "Convenience Store": ["Retail Storefront"],
  "E-Commerce Business": ["Online Only", "Home-Based Business", "Warehouse", "Commercial Office"],
  "Cannabis Dispensary": ["Retail Storefront", "Healthcare Facility"],
  "Cosmetics Store": ["Retail Storefront"],
  "Pharmacy Retail": ["Retail Storefront"],
  "Home Goods Store": ["Retail Storefront"],
  "General Contractor": ["Commercial Office", "Warehouse", "Industrial Facility", "Home-Based Business"],
  "Electrical Contractor": ["Commercial Office", "Warehouse", "Home-Based Business"],
  "Plumbing Contractor": ["Commercial Office", "Warehouse", "Home-Based Business"],
  "HVAC Contractor": ["Commercial Office", "Warehouse", "Home-Based Business"],
  "Roofing Contractor": ["Commercial Office", "Warehouse", "Home-Based Business"],
  "Concrete Contractor": ["Commercial Office", "Warehouse", "Industrial Facility"],
  "Landscaping Company": ["Commercial Office", "Warehouse", "Home-Based Business"],
  "Surveying Company": ["Professional Office", "Commercial Office", "Home-Based Business"],
  "Engineering Contractor": ["Commercial Office", "Professional Office"],
  "Construction Management Firm": ["Professional Office", "Commercial Office"],
  "Specialty Trade Contractor": ["Commercial Office", "Warehouse", "Home-Based Business"],
  "Hotel": ["Tourism Facility"],
  "Resort": ["Tourism Facility"],
  "Guest House": ["Tourism Facility", "Mixed Use Property"],
  "Airbnb": ["Home-Based Business", "Tourism Facility", "Mixed Use Property"],
  "Short-Term Rental": ["Home-Based Business", "Tourism Facility", "Mixed Use Property"],
  "Vacation Rental Manager": ["Commercial Office", "Professional Office"],
  "Tour Operator": ["Commercial Office", "Tourism Facility"],
  "Excursion Company": ["Tourism Facility", "Commercial Office"],
  "Car Rental Business": ["Commercial Office", "Tourism Facility", "Commercial Facility"],
  "Water Sports Company": ["Tourism Facility"],
  "Marina": ["Tourism Facility"],
  "Travel Agency": ["Commercial Office", "Home-Based Business", "Online Only"],
  "Beauty Salon": ["Retail Storefront", "Commercial Office", "Mixed Use Property"],
  "Barbershop": ["Retail Storefront", "Commercial Office", "Mixed Use Property"],
  "Nail Salon": ["Retail Storefront", "Commercial Office"],
  "Spa": ["Commercial Office", "Retail Storefront"],
  "Massage Therapy": ["Professional Office", "Commercial Office"],
  "Tattoo Shop": ["Retail Storefront", "Commercial Office"],
  "Cosmetic Clinic": ["Healthcare Facility", "Commercial Office"],
  "Esthetics Studio": ["Commercial Office", "Retail Storefront"],
  "Makeup Studio": ["Commercial Office", "Retail Storefront", "Home-Based Business"],
  "Hair Removal Studio": ["Commercial Office", "Healthcare Facility"],
  "Food Manufacturing": ["Industrial Facility"],
  "Pharmaceutical Manufacturing": ["Industrial Facility"],
  "Medical Device Manufacturing": ["Industrial Facility"],
  "Textile Manufacturing": ["Industrial Facility"],
  "Furniture Manufacturing": ["Industrial Facility"],
  "Beverage Manufacturing": ["Industrial Facility"],
  "Consumer Products Manufacturing": ["Industrial Facility"],
  "Chemical Manufacturing": ["Industrial Facility"],
  "Industrial Manufacturing": ["Industrial Facility"],
  "Trucking Company": ["Warehouse", "Industrial Facility", "Commercial Office"],
  "Courier Service": ["Commercial Office", "Warehouse"],
  "Moving Company": ["Warehouse", "Commercial Office"],
  "Taxi Service": ["Commercial Office"],
  "Rideshare Fleet": ["Commercial Office"],
  "Logistics Company": ["Warehouse", "Industrial Facility", "Commercial Office"],
  "Warehouse Operator": ["Warehouse", "Industrial Facility"],
  "Maritime Transportation": ["Tourism Facility", "Industrial Facility"],
  "Delivery Service": ["Commercial Office", "Warehouse"],
  "Freight Forwarding": ["Warehouse", "Commercial Office"],
  "Private School": ["Educational Facility"],
  "Daycare": ["Educational Facility", "Mixed Use Property"],
  "Tutoring Center": ["Educational Facility", "Commercial Office"],
  "Vocational School": ["Educational Facility"],
  "Training Company": ["Educational Facility", "Commercial Office", "Online Only"],
  "Educational Services Company": ["Commercial Office", "Online Only"],
  "After-School Program": ["Educational Facility"],
  "Childcare Center": ["Educational Facility"],
  "Software Company": ["Online Only", "Home-Based Business", "Shared Workspace", "Commercial Office"],
  "SaaS Company": ["Online Only", "Home-Based Business", "Shared Workspace", "Commercial Office"],
  "IT Consulting Firm": ["Professional Office", "Shared Workspace", "Home-Based Business"],
  "Cybersecurity Firm": ["Professional Office", "Shared Workspace", "Home-Based Business"],
  "Managed Services Provider": ["Professional Office", "Commercial Office"],
  "Data Analytics Firm": ["Professional Office", "Shared Workspace", "Home-Based Business"],
  "AI Startup": ["Online Only", "Home-Based Business", "Shared Workspace", "Commercial Office"],
  "Technology Services Company": ["Professional Office", "Commercial Office"],
  "Web Development Agency": ["Home-Based Business", "Shared Workspace", "Commercial Office"],
  "Mortgage Broker": ["Professional Office", "Commercial Office"],
  "Financial Advisor": ["Professional Office", "Commercial Office"],
  "Accounting Firm": ["Professional Office", "Commercial Office"],
  "Tax Services": ["Professional Office", "Commercial Office", "Home-Based Business"],
  "Investment Firm": ["Professional Office", "Commercial Office"],
  "Credit Services": ["Professional Office", "Commercial Office"],
  "Bookkeeping Firm": ["Professional Office", "Commercial Office", "Home-Based Business"],
  "Payroll Services": ["Professional Office", "Commercial Office", "Home-Based Business"],
  "Real Estate Investment Company": ["Professional Office", "Commercial Office"],
  "Short-Term Rental Operator": ["Home-Based Business", "Tourism Facility", "Mixed Use Property"],
  "Developer": ["Professional Office", "Commercial Office"],
  "Real Estate Consulting": ["Professional Office", "Commercial Office"],
  "Leasing Office": ["Professional Office", "Commercial Office"],
  "Auto Repair Shop": ["Industrial Facility", "Commercial Facility"],
  "Body Shop": ["Industrial Facility"],
  "Car Dealership": ["Commercial Facility"],
  "Motorcycle Repair": ["Industrial Facility"],
  "Auto Parts Store": ["Retail Storefront"],
  "Vehicle Rental": ["Commercial Facility"],
  "Car Wash": ["Commercial Facility"],
  "Tire Shop": ["Commercial Facility"],
  "Farm": ["Agricultural Property"],
  "Livestock Operation": ["Agricultural Property"],
  "Aquaculture": ["Agricultural Property"],
  "Food Production": ["Agricultural Property", "Industrial Facility"],
  "Agricultural Services": ["Agricultural Property"],
  "Nursery / Plant Business": ["Agricultural Property", "Retail Storefront"],
  "Gym / Fitness Studio": ["Commercial Facility", "Retail Storefront"],
  "Dance Studio": ["Commercial Facility"],
  "Music Venue": ["Entertainment Venue"],
  "Event Venue": ["Entertainment Venue"],
  "Theater": ["Entertainment Venue"],
  "Art Gallery": ["Retail Storefront", "Commercial Facility"],
  "Sports Facility": ["Commercial Facility"],
  "Recreation Facility": ["Commercial Facility"],
  "Entertainment Venue": ["Entertainment Venue"],
  "Solar Installer": ["Commercial Office", "Warehouse"],
  "Energy Consulting": ["Professional Office", "Home-Based Business"],
  "Utility Contractor": ["Commercial Office", "Warehouse"],
  "Battery Storage Installer": ["Commercial Office", "Warehouse"],
  "Electrical Services": ["Commercial Office", "Warehouse"],
  "Renewable Energy Company": ["Commercial Office", "Warehouse"],
  "Wholesale Food Distributor": ["Warehouse", "Industrial Facility"],
  "Wholesale Goods Distributor": ["Warehouse", "Industrial Facility"],
  "Import / Export Business": ["Warehouse", "Commercial Office"],
  "Warehouse Distributor": ["Warehouse"],
  "Beverage Distributor": ["Warehouse", "Industrial Facility"],
  "Professional Services Contractor": ["Professional Office", "Commercial Office"],
  "Construction Contractor": ["Commercial Office", "Warehouse"],
  "IT Contractor": ["Professional Office", "Home-Based Business"],
  "Staffing Contractor": ["Professional Office", "Commercial Office"],
  "Facilities Contractor": ["Commercial Office", "Warehouse"],
  "Security Contractor": ["Commercial Office", "Warehouse"],
  "Nonprofit Organization": ["Commercial Office", "Shared Workspace"],
  "Religious Organization": ["Religious Facility"],
  "Community Organization": ["Commercial Office", "Shared Workspace"],
  "Foundation": ["Commercial Office", "Shared Workspace"],
  "Charity": ["Commercial Office", "Shared Workspace"],
  "Other Business Type": ["Home-Based Business", "Commercial Office", "Retail Storefront", "Online Only"]
};


const LOCATION_TYPES = [
  "Home-Based Business",
  "Commercial Office",
  "Retail Storefront",
  "Industrial Facility",
  "Restaurant / Food Service Location",
  "Mobile Business",
  "Online / Remote Only",
  "Shared Workspace / Coworking",
  "Warehouse",
  "Mixed Use Property"
];

// Geographic subdivisions come from the active jurisdiction's knowledge base.
// No hardcoded town/county lists live in the UI anymore.
// Municipality options are derived inside the component (via kbReady) so a
// published snapshot can change them without a rebuild.

// ====================================================================
// GEO FLAG LOOKUP
// Base rules apply to all subdivisions; geo flags (e.g. coastal/tourism/
// historic/metro/island for Puerto Rico) drive conditional notices that
// combine with industry, business-type, and trigger rules. Flags are KB data,
// so a new jurisdiction defines its own subdivisions and flags — no code edit.
// ====================================================================
function municipalityFlagSet(name: string): Set<string> {
  const m = KB.municipalities.find(
    (x) => x.name.toLowerCase() === (name || '').toLowerCase()
  );
  return new Set<string>(m ? (m.flags as string[]) : []);
}

function municipalityFlags(name: string) {
  const f = municipalityFlagSet(name);
  return {
    coastal: f.has('coastal'),
    tourism: f.has('tourism'),
    historic: f.has('historic'),
    metro: f.has('metro'),
    island: f.has('island'),
  };
}

// Conditional municipality notices (English canonical; translated at display).
function computeMunicipalityNotices(profile: BusinessProfile): string[] {
  const name = profile.municipality;
  if (!name) return [];
  const flags = municipalityFlags(name);
  const bt = (profile.business_type || '').toLowerCase();
  const isShortTerm = profile.short_term_rental === true;
  const hasPhysical = profile.location_type !== 'Online Only';
  const notices: string[] = [];

  const coastalTrigger = /marina|water sport|tourism|short-term|short term|rental|excursion/.test(bt) || isShortTerm;
  if (flags.coastal && coastalTrigger) {
    notices.push('Additional coastal or environmental review may apply.');
  }

  const tourismTrigger = /hotel|airbnb|guest house|short-term|short term|rental|resort|tour operator/.test(bt) ||
    isShortTerm || profile.industry === 'Accommodation & Tourism';
  if (flags.tourism && tourismTrigger) {
    notices.push('Tourism registration and additional tourism-related requirements may apply.');
  }

  if (flags.historic && hasPhysical) {
    notices.push('Historic district restrictions may apply depending on business location.');
  }

  if (flags.island) {
    notices.push('Additional transportation and logistics requirements may apply for island municipalities.');
  }

  return notices;
}

/**
 * Every fact the intake knows — stated, answered, or deterministically derived.
 *
 * Pure function of (profile, answers): change a source value and every dependent
 * fact is recomputed from scratch, so derived state can never go stale.
 */
function resolveFactsFor(
  profile: Partial<BusinessProfile>,
  answers: Record<string, unknown>
): ResolutionResult {
  return resolveIntakeFacts(
    { profile: profile as Record<string, unknown>, answers },
    { kb: KB, allowedIndustries: INDUSTRIES }
  );
}

// Core compute logic - matches the approved rules engine design + seed data
// Updated to use the new Step 1 fields (location_type, food_prepared_or_sold, alcohol_sold, professional_licenses_required, etc.)
function normalizeEntityFormationRequirements(
  entityType: EntityType,
  existing: Requirement[]
): Requirement[] {
  const canonical = { business: { entityType } } as CanonicalApplicationData;
  const withoutWrongFormation = exclusiveFormationRequirements<Requirement>(canonical, existing);
  const augments = entityTypeRequirements<Requirement>(
    canonical,
    withoutWrongFormation,
    (d) =>
      ({
        document_id: d.document_id,
        code: d.code,
        name: d.name,
        reason: d.reason,
        agency: 'Department of State',
        category: 'formation',
        mandatory: true,
        status: 'pending',
        applicability: 'required',
        kind: 'government_application',
        stage: 'entity_formation',
        triggerFacts: [`entityType:${entityType}`],
        acceptsOfficialUpload: true,
      }) as Requirement
  );
  return exclusiveFormationRequirements(canonical, [...withoutWrongFormation, ...augments]);
}

function computeRequirements(
  profile: BusinessProfile,
  answers: Record<string, any>,
  potentialDecisions: Record<string, PotentialDecision> = {}
): Requirement[] {
  const entityType = entityTypeFromLegacyStructure(profile.business_structure);
  const fromKb = computeRequirementsFromKB(
    profile as any,
    answers,
    resolveFactsFor(profile, answers).questionValues,
    { entityType, potentialDecisions }
  ) as Requirement[];

  return normalizeEntityFormationRequirements(entityType, fromKb);
}

// Advisory historical insights shape (from /api/graph/similar).
interface AdvisoryInsights {
  enabled: boolean;
  similarCount: number;
  potentiallyOverlooked: { document: string; agency: string; pct: number }[];
  commonValidationFailures: { document_type: string; failures: number }[];
}


// Compose the reasoning from structured parts so it localizes correctly
// (the stored ext.reasoning is English-only for analytics consistency).
function localizedReasoning(ext: ExtractionResult, docType: string, language: any): string {
  const found = ext.fields_found.map(f => L(f.label, language));
  const missing = ext.fields_missing.map(f => L(f.label, language));
  const parts: string[] = [];
  parts.push(`${L('Classified as', language)} "${docType}" ${L('with', language)} ${ext.classification_confidence}% ${L('confidence', language)}.`);
  if (found.length) parts.push(`${L('Found', language)} ${found.length} ${L('fields', language)}: ${found.join(', ')}.`);
  if (missing.length) parts.push(`${L('Missing required', language)}: ${missing.join(', ')}.`);
  if (ext.expiration_status === 'Valid') parts.push(L('Expiration is valid.', language));
  else if (ext.expiration_status === 'Expired') parts.push(L('Expiration has passed.', language));
  parts.push(
    ext.validation_result === 'PASS' ? L('All required fields are present and valid.', language)
    : ext.validation_result === 'FAIL' ? L('Required fields are missing — this document cannot be validated yet.', language)
    : L('Present but needs review before it can be accepted.', language)
  );
  return parts.join(' ');
}

// Extraction-first results panel for an uploaded document. Replaces generic
// "needs review / missing information" messages with concrete Fields Found /
// Fields Missing / Validation Result / Confidence / Reasoning.
function ExtractionPanel({ ext, docType, language }: { ext: ExtractionResult; docType: string; language: any }) {
  const vr = ext.validation_result;
  const vrColor = vr === 'PASS' ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
    : vr === 'FAIL' ? 'bg-red-100 text-red-800 border-red-200'
    : 'bg-amber-100 text-amber-800 border-amber-200';
  const vrLabel = vr === 'PASS' ? L('Pass', language) : vr === 'FAIL' ? L('Fail', language) : L('Needs Review', language);
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-[#f4f1ea]/70 p-3 text-xs">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="font-semibold text-[#161616]">{L('Classified as', language)}:</span>
        <span className="text-[#161616]">{docType}</span>
        <span className={`rounded-full border px-2 py-0.5 font-semibold ${vrColor}`}>{L('Validation Result', language)}: {vrLabel}</span>
        <span className="rounded-full border border-slate-300 px-2 py-0.5 text-[#161616]/80">{L('Confidence Score', language)}: {ext.classification_confidence}%</span>
      </div>

      {ext.fields_found.length > 0 && (
        <div className="mb-1.5">
          <div className="font-semibold text-emerald-700 mb-1">{L('Fields Found', language)}:</div>
          <div className="flex flex-col gap-0.5">
            {ext.fields_found.map((f, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-[#161616]/60 min-w-[140px]">{L(f.label, language)}</span>
                <span className="text-[#161616] font-medium break-all">{f.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {ext.fields_missing.length > 0 && (
        <div className="mb-1.5">
          <div className="font-semibold text-red-700 mb-1">{L('Fields Missing', language)}:</div>
          <div className="flex flex-wrap gap-1.5">
            {ext.fields_missing.map((f, i) => (
              <span key={i} className="rounded-full bg-red-50 border border-red-200 text-red-700 px-2 py-0.5">{L(f.label, language)}</span>
            ))}
          </div>
        </div>
      )}

      <div>
        <span className="font-semibold text-[#161616]">{L('Reasoning', language)}:</span>{' '}
        <span className="text-[#161616]/80">{localizedReasoning(ext, docType, language)}</span>
      </div>
    </div>
  );
}

export default function SmartPRIntake() {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [profile, setProfile] = useState<BusinessProfile>({
    name: '',
    business_stage: 'new',
    municipality: '',
    industry: '',
    business_type: '',
    location_type: '',
    business_structure: '',
    number_of_employees: null,
    number_of_vehicles: null,
    number_of_rental_units: null,
    customers_visit: null,
    food_prepared_or_sold: null,
    alcohol_sold: null,
    professional_licenses_required: null,
    healthcare_services: null,
    hazardous_materials: null,
    employees_hired: null,
    physical_location: null,
    products_manufactured: null,
    vehicles_used: null,
    commercial_signage: null,
    outdoor_seating: null,
    live_entertainment: null,
    short_term_rental: null,
    medical_waste: null,
    import_export: null,
  });
  const [discoveryAnswers, setDiscoveryAnswers] = useState<Record<string, any>>({});
  const discoveryAnswersRef = useRef(discoveryAnswers);
  discoveryAnswersRef.current = discoveryAnswers;
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [uploadedDocs, setUploadedDocs] = useState<any[]>([]);
  const [sampleFormDrafts, setSampleFormDrafts] = useState<Record<string, SampleFormData>>({});
  const [preparedSampleApplications, setPreparedSampleApplications] = useState<Record<string, PreparedSampleApplication>>({});
  const [activeSampleFormCode, setActiveSampleFormCode] = useState<string | null>(null);
  // 'edit' shows the raw editable fields; 'preview' renders the actual PDF that
  // "Add PDF to deliverables" will save — nothing commits until seen from there.
  const [sampleFormMode, setSampleFormMode] = useState<'edit' | 'preview'>('edit');
  const [sampleFormErrors, setSampleFormErrors] = useState<string[]>([]);
  const [sampleFormNotice, setSampleFormNotice] = useState<string | null>(null);
  // On-page preview for generated PDFs on the Deliverables page (readiness
  // report, prepared application worksheets) — shown before any download.
  const [docPreview, setDocPreview] = useState<{ title: string; filename: string; blob: Blob; kind?: 'report' | 'submission' } | null>(null);
  const docPreviewUrl = useMemo(() => (docPreview ? URL.createObjectURL(docPreview.blob) : null), [docPreview]);
  useEffect(() => {
    return () => {
      if (docPreviewUrl) URL.revokeObjectURL(docPreviewUrl);
    };
  }, [docPreviewUrl]);
  // Schema-driven government-form engine state (CORPREG01–CORPREG06).
  const [govFormDrafts, setGovFormDrafts] = useState<Record<string, GovFormData>>({});
  const [preparedGovApplications, setPreparedGovApplications] = useState<Record<string, GeneratedApplication>>({});
  const [activeGovForm, setActiveGovForm] = useState<{ formId: string; requirementCode: string; mode: 'edit' | 'view' } | null>(null);
  // Multi-form package picker (today: the EPA NPDES Form 1 + Form 2C package).
  // Holds the requirement code; the per-form rows resolve live at render time.
  const [activeGovPackage, setActiveGovPackage] = useState<{ requirementCode: string } | null>(null);
  const [canonicalOverride, setCanonicalOverride] = useState<CanonicalApplicationData | null>(null);
  const [readinessScore, setReadinessScore] = useState<number | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [businessId, setBusinessId] = useState<string | null>(null);
  // Correlation id tying every capture event for this scenario together.
  const submissionIdRef = useRef<string>('');
  // The business this assessment belongs to (when signed in + /?business=<id>).
  const businessIdRef = useRef<string | null>(null);
  // The regulatory matter this workflow belongs to. Older links without a
  // matter remain valid; new portfolio entry points always provide one.
  const matterIdRef = useRef<string | null>(null);
  const formationStartAttemptedRef = useRef(false);
  // Signed-in user (null when anonymous, undefined while loading).
  const [me, setMe] = useState<{
    id: string;
    email: string | null;
    name: string | null;
    business_name?: string | null;
    isAdmin?: boolean;
  } | null | undefined>(undefined);
  const guestRestoredRef = useRef(false);
  // Internal autosave state drives the matter status; persistence never
  // requires a user-facing save or retry action.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saveResetTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (saveResetTimerRef.current !== null) window.clearTimeout(saveResetTimerRef.current);
  }, []);
  // Advisory historical recommendations (never mandatory; rules stay authoritative).
  const [advisory, setAdvisory] = useState<AdvisoryInsights | null>(null);
  // User decisions on flag-derived "Potentially Required" items.
  const [potentialDecisions, setPotentialDecisions] = useState<Record<string, PotentialDecision>>({});
  // Program-specific facts are collected adaptively only when a published
  // incentive criterion says they could materially change eligibility.
  const [incentiveFacts, setIncentiveFacts] = useState<Record<string, ProjectFactValue>>({});
  const [incentiveAssessmentHistory, setIncentiveAssessmentHistory] = useState<IncentiveAssessment[]>([]);
  // Incentives the user has chosen to act on — the whole matched result is
  // kept (not just the id) so the workflow panel and Requirements dashboard
  // entry stay accurate to what was actually shown when they clicked.
  const [pursuedIncentives, setPursuedIncentives] = useState<IncentiveEligibilityResult[]>([]);
  // The result currently open in the workflow drawer — set by "Review" (not
  // yet pursued) or by pursuing; independent of pursuedIncentives so a
  // not-yet-pursued result can still be reviewed in full.
  const [activeIncentiveResult, setActiveIncentiveResult] = useState<IncentiveEligibilityResult | null>(null);

  const sampleFormsStorageKey = useMemo(() => {
    const business = (profile.name || 'business').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const municipality = (profile.municipality || 'pr').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return `smartpr-sample-forms-${business}-${municipality}`;
  }, [profile.name, profile.municipality]);

  useEffect(() => {
    if (!profile.name || !profile.municipality) return;
    try {
      const saved = localStorage.getItem(sampleFormsStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      setSampleFormDrafts((current) => Object.keys(current).length ? current : (parsed.drafts || {}));
      setPreparedSampleApplications((current) => Object.keys(current).length ? current : (parsed.prepared || {}));
    } catch { /* browser storage is best-effort */ }
  }, [sampleFormsStorageKey, profile.name, profile.municipality]);

  // Government-form engine persistence (structured data is the durable source —
  // previews regenerate from it; we never store a Blob URL as the only record).
  const govFormsStorageKey = useMemo(() => `${sampleFormsStorageKey}-gov`, [sampleFormsStorageKey]);
  useEffect(() => {
    if (!profile.name || !profile.municipality) return;
    try {
      const saved = localStorage.getItem(govFormsStorageKey);
      if (!saved) return;
      const parsed = JSON.parse(saved);
      setGovFormDrafts((current) => Object.keys(current).length ? current : (parsed.drafts || {}));
      setPreparedGovApplications((current) => Object.keys(current).length ? current : (parsed.prepared || {}));
      if (parsed.canonical) setCanonicalOverride((current) => current ?? parsed.canonical);
    } catch { /* best-effort */ }
  }, [govFormsStorageKey, profile.name, profile.municipality]);
  useEffect(() => {
    if (!profile.name || !profile.municipality) return;
    if (!Object.keys(govFormDrafts).length && !Object.keys(preparedGovApplications).length) return;
    try {
      localStorage.setItem(govFormsStorageKey, JSON.stringify({ drafts: govFormDrafts, prepared: preparedGovApplications, canonical: canonicalOverride }));
    } catch { /* best-effort */ }
  }, [govFormsStorageKey, govFormDrafts, preparedGovApplications, canonicalOverride, profile.name, profile.municipality]);

  // ==========================================================================
  // Intake fact model.
  //
  // Everything SmartPR knows right now: what the user stated, what they have
  // answered, and every fact those make logically certain. Recomputed from the
  // profile + answers on every change, so a derived fact can never survive the
  // source it came from (edit "10 employees" down to 0 and Q_EMPLOYEES_HIRED
  // re-evaluates with it).
  //
  // It produces FACTS ONLY. Requirements continue to come from the rules
  // engine, which consumes these facts through buildEngineInput().
  // ==========================================================================
  const intakeFacts = React.useMemo(
    () => resolveFactsFor(profile, discoveryAnswers),
    [profile, discoveryAnswers]
  );

  // Fill profile fields the resolver knows but the user has not set — notably
  // the industry implied by the chosen business type. Only ever fills a blank.
  useEffect(() => {
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(intakeFacts.profileValues)) {
      const fact = intakeFacts.facts[`profile:${key}`];
      if (!fact || fact.origin !== 'derived') continue;
      if (profile[key as keyof BusinessProfile]) continue;
      patch[key] = value;
    }
    if (Object.keys(patch).length > 0) setProfile((p) => ({ ...p, ...patch }));
  }, [intakeFacts, profile]);

  // Fetch advisory historical insights once requirements exist (best-effort).
  // Load the signed-in user (if any) + capture ?business=<id> so this
  // assessment gets linked to a business on save.
  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(d => setMe(d.user || null)).catch(() => setMe(null));
    const params = new URLSearchParams(window.location.search);
    const bizId = params.get('business');
    const matterId = params.get('matter');
    if (bizId) {
      businessIdRef.current = bizId;
      setBusinessId(bizId);
    }
    if (matterId) matterIdRef.current = matterId;
  }, []);

  // The authenticated portfolio's “File a New Business” action lands directly
  // in this existing intake. Create only the persistent container records here;
  // the existing intake/rules/document state machine remains unchanged.
  useEffect(() => {
    if (!me || formationStartAttemptedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('entry') !== 'new-business' || params.get('business')) return;
    formationStartAttemptedRef.current = true;
    // This page is a single long-lived component reused across client-side
    // navigations (e.g. from an existing business straight into "New
    // Business" without a full page reload) — so a fresh entry must clear
    // out whatever the previous business left behind. Otherwise the intake
    // step and the SmartPR Live panel keep showing that business's answers,
    // rule-engine results, and identified agencies as if they applied here.
    setProfile((current) => ({ ...current, name: '', business_stage: 'new', municipality: '', industry: '', business_type: '', location_type: '', business_structure: 'llc',
      number_of_employees: null, number_of_vehicles: null, number_of_rental_units: null, customers_visit: null, food_prepared_or_sold: null,
      alcohol_sold: null, professional_licenses_required: null, healthcare_services: null, hazardous_materials: null, employees_hired: null,
      physical_location: null, products_manufactured: null, vehicles_used: null, commercial_signage: null, outdoor_seating: null,
      live_entertainment: null, short_term_rental: null, medical_waste: null, import_export: null }));
    setDiscoveryAnswers({});
    setRequirements([]);
    setPotentialDecisions({});
    setIncentiveFacts({});
    setIncentiveAssessmentHistory([]);
    setFindings([]);
    setReadinessScore(null);
    setCanonicalOverride(null);
    setUploadedDocs([]);
    setSampleFormDrafts({});
    setPreparedSampleApplications({});
    setGovFormDrafts({});
    setPreparedGovApplications({});
    setCurrentQuestionIndex(0);
    setAiPrefilledKeys([]);
    setCurrentStep(1);
    // Clear the previous business's identity too — otherwise the matter
    // created below is correct, but anything that saves before it resolves
    // (or reads businessIdRef in the meantime) could still target the old
    // business's record instead of the new one.
    businessIdRef.current = null;
    matterIdRef.current = null;
    setBusinessId(null);
    void (async () => {
      try {
        const response = await fetch('/api/matters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            create_business: true,
            legal_name: me.business_name || undefined,
            matter_type: 'NEW_BUSINESS_FORMATION',
            title: 'New business formation',
          }),
        });
        if (!response.ok) return;
        const created = await response.json();
        businessIdRef.current = created.business_id;
        matterIdRef.current = created.matter_id;
        setBusinessId(created.business_id);
        if (me.business_name) {
          setProfile((current) => current.name ? current : { ...current, name: me.business_name || '' });
        }
        params.set('business', created.business_id);
        params.set('matter', created.matter_id);
        window.history.replaceState(null, '', `/?${params.toString()}`);
      } catch {
        // Intake remains usable and matter creation will be attempted again on
        // the next fresh entry; guest progress continues saving on-device.
      }
    })();
  }, [me]);

  // Load the published knowledge-base snapshot (admin-controlled rules); the
  // bundled static KB is the fallback, so failures are harmless.
  const [kbReady, setKbReady] = useState(false);
  useEffect(() => {
    initKbFromServer().finally(() => setKbReady(true));
  }, []);
  const municipalityOptions = useMemo(() => KB.municipalities.map((m) => m.name), [kbReady]);

  // Resume a prior submission from History (?resume=<submissionId>): restore
  // the core profile and jump back to the requirements step.
  useEffect(() => {
    const resumeId = new URLSearchParams(window.location.search).get('resume');
    if (!resumeId) return;
    submissionIdRef.current = resumeId;

    // Prefer a full workflow snapshot when signed in (exact mid-flow state).
    (async () => {
      try {
        const snapRes = await fetch(`/api/snapshots/${resumeId}`);
        if (snapRes.ok) {
          const snap = await snapRes.json();
          const st = snap.state || {};
          if (st.profile) setProfile(p => ({ ...p, ...st.profile }));
          if (st.discoveryAnswers) setDiscoveryAnswers(st.discoveryAnswers);
          if (Array.isArray(st.requirements) && st.requirements.length) setRequirements(st.requirements);
          if (st.potentialDecisions) setPotentialDecisions(st.potentialDecisions);
          if (st.incentiveFacts) setIncentiveFacts(st.incentiveFacts);
          if (Array.isArray(st.incentiveAssessmentHistory)) setIncentiveAssessmentHistory(st.incentiveAssessmentHistory);
          if (Array.isArray(st.pursuedIncentives)) setPursuedIncentives(st.pursuedIncentives);
          if (st.sampleFormDrafts) setSampleFormDrafts(st.sampleFormDrafts);
          if (st.preparedSampleApplications) setPreparedSampleApplications(st.preparedSampleApplications);
          // Government-form engine state (canonical profile + drafts + prepared
          // applications) persists in the same Supabase-backed snapshot.
          if (st.govFormDrafts) setGovFormDrafts(st.govFormDrafts);
          if (st.preparedGovApplications) setPreparedGovApplications(st.preparedGovApplications);
          if (st.canonicalApplication) setCanonicalOverride(st.canonicalApplication);
          if (typeof st.readinessScore === 'number') setReadinessScore(st.readinessScore);
          if (typeof st.currentStep === 'number') setCurrentStep(st.currentStep);
          if (snap.business_id) {
            businessIdRef.current = snap.business_id;
            setBusinessId(snap.business_id);
          }
          if (snap.matter_id) matterIdRef.current = snap.matter_id;
          return;
        }
      } catch { /* fall through */ }

      // Fallback: summary-based resume (anonymous + history-row resume).
      const d = await fetch(`/api/history/${resumeId}`).then(r => r.json()).catch(() => null);
      const su = d?.summary;
      if (!su) return;
      const restored = {
        name: su.business_name || '',
        municipality: su.municipality || '',
        industry: su.industry || '',
        business_type: su.business_type || '',
        business_structure: su.business_structure || '',
        location_type: su.location_type || '',
      };
      setProfile(prev => ({ ...prev, ...restored }));
      const computed = computeRequirements({ ...(profile as any), ...restored }, {}, potentialDecisions);
      setRequirements(computed);
      if (su.business_id) {
        businessIdRef.current = su.business_id;
        setBusinessId(su.business_id);
      }
      setCurrentStep(3);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!requirements.length || !profile.business_type) { setAdvisory(null); return; }
    let alive = true;
    fetch('/api/graph/similar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        municipality: profile.municipality || null,
        industry: profile.industry || null,
        business_type: profile.business_type,
        location_type: profile.location_type || null,
        currentDocuments: requirements.map(r => r.name),
      }),
    })
      .then(r => r.json())
      .then(d => { if (alive) setAdvisory(d); })
      .catch(() => { if (alive) setAdvisory(null); });
    return () => { alive = false; };
  }, [requirements, profile.business_type, profile.municipality]);

  // Single-service architecture: discovery/requirements are computed entirely
  // client-side, and LLM document analysis runs server-side in this same
  // Next.js app at /api/analyze-document. No separate backend service or
  // NEXT_PUBLIC_BACKEND_URL is required.
  const [language, setLanguageRaw] = useState<'en' | 'es'>('en'); // Bilingual toggle
  const setLanguage = (l: 'en' | 'es') => {
    setLanguageRaw(l);
    try { localStorage.setItem('smartpr-lang', l); } catch {}
    window.dispatchEvent(new CustomEvent('smartpr-lang-change', { detail: l }));
  };

  useEffect(() => {
    try { const s = localStorage.getItem('smartpr-lang'); if (s === 'es' || s === 'en') setLanguageRaw(s); } catch {}
    const handler = (e: Event) => {
      const l = (e as CustomEvent<string>).detail;
      if (l === 'en' || l === 'es') setLanguageRaw(l as 'en' | 'es');
    };
    window.addEventListener('smartpr-lang-change', handler);
    return () => window.removeEventListener('smartpr-lang-change', handler);
  }, []);

  const [questionList, setQuestionList] = useState<DiscoveryQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  // Discovery questions already answered by the natural-language interpreter.
  // These are skipped in the guided flow so AI reduces intake work without
  // removing the questions it could not determine.
  const [aiPrefilledKeys, setAiPrefilledKeys] = useState<string[]>([]);

  // Workspace / final deliverables
  const [showWorkspaceModal, setShowWorkspaceModal] = useState(false);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);

  // Real file upload support for Step 2 / checklist uploads (opens local picker, sends to LLM)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingReqCode, setPendingReqCode] = useState<string | null>(null);

  // === Guided UX Refactor (adapted for current Validador + i18n base) ===
  // Addresses the 7 workflow problems while respecting the new design system.
  const PROCESS_STAGES = [
    'Uploading…', 'Extracting text…', 'Classifying document…', 'Validating required fields…', 'Updating readiness score…'
  ] as const;

  const [processingStates, setProcessingStates] = useState<Record<string, { stageIndex: number; fileName?: string }>>({});
  const [reviewingCode, setReviewingCode] = useState<string | null>(null);
  const [highlightCode, setHighlightCode] = useState<string | null>(null);

  // Transient upload notification (toast) shown after a document is analyzed by the LLM.
  const [uploadNotice, setUploadNotice] = useState<
    { kind: 'success' | 'warning' | 'error'; title: string; detail?: string } | null
  >(null);
  useEffect(() => {
    if (!uploadNotice) return;
    const id = setTimeout(() => setUploadNotice(null), 6000);
    return () => clearTimeout(id);
  }, [uploadNotice]);

  useEffect(() => {
    if (me === undefined || guestRestoredRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('resume')) return;
    const restaurant = readRestaurantHandoff(params, KB.municipalities.map(m => m.name));
    if (restaurant && !params.get('business')) {
      guestRestoredRef.current = true;
      setProfile(prev => ({ ...prev, ...restaurant.profile }));
      setDiscoveryAnswers({ restaurant_premises_stage: restaurant.context.premises, restaurant_renovation_plan: restaurant.context.renovation });
      setRequirements([]);
      setPotentialDecisions({});
      setCurrentStep(1);
      setLanguage(restaurant.language);
      trackAcquisition('intake_opened', params.get('source') || 'direct', restaurant.language);
      return;
    }
    const clinic = readClinicHandoff(params, KB.municipalities.map(m => m.name));
    if (clinic && !params.get('business')) {
      guestRestoredRef.current = true;
      setProfile(prev => ({ ...prev, ...clinic.profile }));
      setDiscoveryAnswers({ clinic_premises_stage: clinic.context.premises, clinic_renovation_plan: clinic.context.renovation, clinic_lab_pharmacy: clinic.context.labPharmacy, clinic_kind: clinic.context.clinic_kind });
      setRequirements([]);
      setPotentialDecisions({});
      setCurrentStep(1);
      setLanguage(clinic.language);
      trackAcquisition('intake_opened', params.get('source') || 'direct', clinic.language);
      return;
    }
    const draft = loadGuestDraft();
    if (!draft) return;
    guestRestoredRef.current = true;
    if (draft.profile) setProfile((prev) => ({ ...prev, ...(draft.profile as Partial<BusinessProfile>) }));
    if (draft.discoveryAnswers) setDiscoveryAnswers(draft.discoveryAnswers);
    if (draft.potentialDecisions) setPotentialDecisions(draft.potentialDecisions as Record<string, PotentialDecision>);
    if (Array.isArray(draft.requirements)) setRequirements(draft.requirements as Requirement[]);
    if (draft.incentiveFacts) setIncentiveFacts(draft.incentiveFacts as Record<string, ProjectFactValue>);
    if (Array.isArray(draft.incentiveAssessmentHistory)) setIncentiveAssessmentHistory(draft.incentiveAssessmentHistory as IncentiveAssessment[]);
    if (Array.isArray(draft.pursuedIncentives)) setPursuedIncentives(draft.pursuedIncentives as IncentiveEligibilityResult[]);
    if (draft.currentStep) setCurrentStep(draft.currentStep as Step);
    if (draft.language === 'es' || draft.language === 'en') setLanguage(draft.language);
  }, [me]);

  useEffect(() => {
    if (me) {
      clearGuestDraft();
      return;
    }
    if (me === undefined) return;
    const timer = window.setTimeout(() => {
      saveGuestDraft({
        profile: profile as unknown as Record<string, unknown>,
        discoveryAnswers,
        potentialDecisions,
        requirements,
        incentiveFacts,
        incentiveAssessmentHistory,
        pursuedIncentives,
        currentStep,
        language,
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [me, profile, discoveryAnswers, potentialDecisions, requirements, incentiveFacts, incentiveAssessmentHistory, pursuedIncentives, currentStep, language]);

  // Hidden debug mode for the rules engine (enable with ?debug=1 in the URL).
  const [debugMode, setDebugMode] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      setDebugMode(params.get('debug') === '1' || params.has('debug'));
    }
  }, []);

  const t = (key: string): string => {
    const dict: Record<string, { en: string; es: string }> = {
      title: { en: "Tell Us About Your Business", es: "Cuéntanos sobre tu Negocio" },
      subtitle: { en: "Answer a few questions and we'll determine which Puerto Rico licenses, permits, certifications, and documents you need.", es: "Responde algunas preguntas y determinaremos qué licencias, permisos, certificaciones y documentos de Puerto Rico necesitas." },
      businessName: { en: "Business Name", es: "Nombre del Negocio" },
      municipality: { en: "Municipality", es: "Municipio" },
      industry: { en: "Industry", es: "Industria" },
      businessType: { en: "Business Type", es: "Tipo de Negocio" },
      locationType: { en: "Business Location Type", es: "Tipo de Ubicación del Negocio" },
      businessStructure: { en: "Business Structure", es: "Estructura del Negocio" },
      numEmployees: { en: "Number of Employees", es: "Número de Empleados" },
      next: { en: "Next →", es: "Siguiente →" },
      q_customers: { en: "Will customers visit your location?", es: "¿Los clientes visitarán su ubicación?" },
      q_food: { en: "Will food be prepared or sold?", es: "¿Se preparará o venderá comida?" },
      q_alcohol: { en: "Will alcohol be sold?", es: "¿Se venderá alcohol?" },
      q_professional: { en: "Will professional licenses be required?", es: "¿Se requerirán licencias profesionales?" },
      q_healthcare: { en: "Will healthcare services be provided?", es: "¿Se proporcionarán servicios de atención médica?" },
      q_hazardous: { en: "Will hazardous materials be stored?", es: "¿Se almacenarán materiales peligrosos?" },
      q_employees: { en: "Will employees be hired?", es: "¿Se contratarán empleados?" },
      q_physical: { en: "Will the business operate from a physical location?", es: "¿Operará el negocio desde una ubicación física?" },
      q_manufactured: { en: "Will products be manufactured?", es: "¿Se fabricarán productos?" },
      q_vehicles: { en: "Will vehicles be used for business operations?", es: "¿Se utilizarán vehículos para operaciones comerciales?" },
      q_signage: { en: "Will the business have commercial signage?", es: "¿Tendrá el negocio letreros comerciales?" },
      q_outdoor: { en: "Will there be outdoor seating?", es: "¿Habrá asientos al aire libre?" },
      q_entertainment: { en: "Will there be live entertainment?", es: "¿Habrá entretenimiento en vivo?" },
      q_tourism: { en: "Will this be a short-term rental or tourism activity?", es: "¿Será un alquiler a corto plazo o actividad turística?" },
      q_medicalWaste: { en: "Will medical waste be generated?", es: "¿Se generarán residuos médicos?" },
      q_importExport: { en: "Will import/export activity occur?", es: "¿Ocurrirá actividad de importación/exportación?" },
      yes: { en: "Yes", es: "Sí" },
      no: { en: "No", es: "No" },
      selectIndustry: { en: "Select Industry", es: "Seleccionar Industria" },
      selectBusinessType: { en: "Select Business Type", es: "Seleccionar Tipo de Negocio" },
      selectLocationType: { en: "Select Location Type", es: "Seleccionar Tipo de Ubicación" },
      selectMunicipality: { en: "Select Municipality", es: "Seleccionar Municipio" },
    };
    return dict[key]?.[language] || key;
  };

  // Translate requirement name/reason, handling the dynamic Patente Municipal
  // strings (which embed the municipality and so can't be matched verbatim).
  const trReqName = (req: { code: string; name: string }) => {
    if (req.code === 'patente_municipal') return `Patente Municipal (${profile.municipality})`;
    return L(req.name, language);
  };
  const trReqReason = (req: { code: string; reason: string }) => {
    if (language === 'es') {
      if (req.code === 'patente_municipal')
        return `Impuesto/licencia municipal requerido en el municipio de ${profile.municipality}. Usualmente requiere primero el Permiso Único.`;
      if (req.code === 'municipal_registration')
        return `El registro con el gobierno municipal de ${profile.municipality} es requerido para operar dentro del municipio.`;
      if (req.code === 'municipal_tax_compliance')
        return `Se requiere prueba de cumplimiento de impuestos municipales; las tasas varían por municipio (${profile.municipality}).`;
      // Generic engine-generated reason shapes (rulesEngine.ts) — these embed
      // dynamic values (municipality name, business type, question text) so
      // they can never be exact-matched in the L() dictionary; translate the
      // surrounding template here instead.
      const municipalityMatch = req.reason.match(/^Municipality selected \((.+)\)$/);
      if (municipalityMatch) return `Municipio seleccionado (${municipalityMatch[1]})`;

      const flagMatch = req.reason.match(/^Municipality Flag = (.+?)(?: \+ Business Type = (.+))?$/);
      if (flagMatch) {
        const [, flag, businessType] = flagMatch;
        return `Bandera de Municipio = ${flag}${businessType ? ` + Tipo de Negocio = ${businessType}` : ''}`;
      }

      const businessTypeMatch = req.reason.match(/^Business Type = (.+)$/);
      if (businessTypeMatch) return `Tipo de Negocio = ${businessTypeMatch[1]}`;

      const questionMatch = req.reason.match(/^Question: (.+) \| Answer: Yes$/);
      if (questionMatch) return `Pregunta: ${questionMatch[1]} | Respuesta: Sí`;
    }
    return L(req.reason, language);
  };

  // Dynamic follow-up questions / flags based on the new Step 1 fields
  const getFollowUpQuestions = (ind?: string) => {
    const industry = ind || profile.industry;
    const q: Record<string, any> = {
      has_food_service: profile.food_prepared_or_sold === true,
      alcohol_sales: profile.alcohol_sold === true,
      provides_healthcare: profile.healthcare_services === true || profile.industry === 'Healthcare' || profile.professional_licenses_required === true,
      customers_visit: profile.customers_visit,
      professional_licenses: profile.professional_licenses_required,
      location_type: profile.location_type,
      business_type: profile.business_type,
      hazardous_materials: profile.hazardous_materials,
      employees_hired: profile.employees_hired,
      physical_location: profile.physical_location,
      products_manufactured: profile.products_manufactured,
      vehicles_used: profile.vehicles_used,
      commercial_signage: profile.commercial_signage,
      outdoor_seating: profile.outdoor_seating,
      live_entertainment: profile.live_entertainment,
      short_term_rental: profile.short_term_rental,
      medical_waste: profile.medical_waste,
      import_export: profile.import_export,
    };
    return q;
  };

  // Dynamic question flow based on Business Type AND Location Type. We filter
  // out questions whose answer is implied by the location (e.g. nothing about
  // customers visiting "the location" when there is no physical location).
  useEffect(() => {
    if (profile.business_type) {
      // Pre-answered questions STAY in the list so progress totals stay honest
      // and they can be shown as completed; the flow just advances past them.
      // Rebuilding this list when the KB finishes loading must not restart the
      // wizard and ask the same manually answered questions a second time.
      const list = filterQuestionsByContext(
        getQuestionsForBusinessType(profile.business_type),
        profile.location_type
      );
      setQuestionList(list);
      const firstUnanswered = list.findIndex(
        (question) => discoveryAnswersRef.current[question.id] === undefined
      );
      setCurrentQuestionIndex(firstUnanswered >= 0 ? firstUnanswered : list.length);
    } else {
      setQuestionList([]);
      setCurrentQuestionIndex(0);
    }
  }, [profile.business_type, profile.location_type, kbReady]);

  // ==========================================================================
  // Question suppression.
  //
  // Before a discovery question is shown, ask whether its answer is already
  // known — because the user stated it, because the interpreter extracted it,
  // or because the relationship resolver derived it with certainty. A known
  // answer is never asked again, anywhere in the intake.
  //
  // Manual answers remain part of the guided-question total, but forward
  // navigation skips them. Back explicitly removes the prior answer before
  // reopening that question, so recorded answers are never asked twice.
  // ==========================================================================
  const isQuestionPreAnswered = React.useCallback(
    (wizardKey: string): boolean => {
      if (aiPrefilledKeys.includes(wizardKey)) return true;
      if (discoveryAnswers[wizardKey] !== undefined) return false;
      const questionId = questionIdForAnswerKey(wizardKey);
      return questionId !== null && intakeFacts.resolvedQuestionIds.has(questionId);
    },
    [aiPrefilledKeys, discoveryAnswers, intakeFacts]
  );

  /** First eligible, unanswered question at or after `start`. */
  const nextUnansweredQuestion = React.useCallback(
    (start: number): number => {
      for (let i = Math.max(0, start); i < questionList.length; i++) {
        const questionId = questionList[i].id;
        if (!isQuestionPreAnswered(questionId) && discoveryAnswers[questionId] === undefined) return i;
      }
      return questionList.length;
    },
    [questionList, isQuestionPreAnswered, discoveryAnswers]
  );

  // The stable guided set excludes answers SmartPR already knew, but retains
  // questions answered by the user so totals do not shrink while progressing.
  const activeQuestionIndex = nextUnansweredQuestion(currentQuestionIndex);
  const guidedQuestions = questionList.filter((q) => !isQuestionPreAnswered(q.id));
  const guidedQuestionsAnswered = guidedQuestions
    .filter((q) => discoveryAnswers[q.id] !== undefined).length;
  const activeGuidedQuestionNumber = activeQuestionIndex < questionList.length
    ? guidedQuestions.findIndex((q) => q.id === questionList[activeQuestionIndex].id) + 1
    : guidedQuestions.length;

  const handleQuestionAnswer = (value: boolean | string) => {
    const q = questionList[activeQuestionIndex];
    if (!q) return;
    // Every existing `updates.x = yes` branch below is id-gated and keeps
    // working unchanged: select-type answers are strings, so `yes` is simply
    // false for them and none of those ids match a select question anyway.
    const yes = value === true;

    const updates: Partial<BusinessProfile> = {};
    const extraAnswers: Record<string, unknown> = {};
    if (q.id === "str_hoa_condo") extraAnswers.hoa_condo = value === "yes";

    if (q.id === "food_prepared_on_site") updates.food_prepared_or_sold = yes;
    if (q.id === "customers_consume_on_site" || q.id === "patients_visit" || q.id === "clients_visit" || q.id === "customers_visit") updates.customers_visit = yes;
    if (q.id === "alcohol_sold") updates.alcohol_sold = yes;
    if (q.id === "outdoor_seating") updates.outdoor_seating = yes;
    if (q.id === "live_entertainment") updates.live_entertainment = yes;
    if (q.id === "employees_work_on_site" || q.id === "employees_hired") updates.employees_hired = yes;
    if (q.id === "physical_office" || q.id === "physical_location") updates.physical_location = yes;
    if (q.id === "licensed_professionals" || q.id === "professional_licenses_required") updates.professional_licenses_required = yes;
    if (q.id === "medical_waste") updates.medical_waste = yes;
    if (q.id === "controlled_substances" || q.id === "hazardous_materials") updates.hazardous_materials = yes;
    if (q.id === "diagnostic_testing" || q.id === "healthcare_professionals" || q.id === "healthcare_services") updates.healthcare_services = yes;
    if (q.id === "services_online") updates.physical_location = !yes;
    if (q.id === "inventory_stored") updates.physical_location = yes;
    if (q.id === "hardware_sold") updates.products_manufactured = yes;
    if (q.id === "food_delivered") updates.food_prepared_or_sold = yes;
    if (q.id === "food_truck_or_mobile") {
      if (yes) setProfile(p => ({ ...p, location_type: "Food Truck" }));
    }
    if (q.id === "guests_stay_overnight" || q.id === "physical_location") updates.physical_location = yes;
    if (q.id === "food_served") updates.food_prepared_or_sold = yes;
    if (q.id === "alcohol_served") updates.alcohol_sold = yes;
    if (q.id === "water_activities") updates.physical_location = yes;
    if (q.id === "customers_receive_services") updates.customers_visit = yes;
    if (q.id === "needles_or_invasive") updates.hazardous_materials = yes;
    if (q.id === "biohazard_waste") updates.medical_waste = yes;
    if (q.id === "products_manufactured_on_site") updates.products_manufactured = yes;
    if (q.id === "commercial_vehicles" || q.id === "vehicles_repaired") updates.vehicles_used = yes;
    if (q.id === "goods_stored") updates.physical_location = yes;
    if (q.id === "children_present" || q.id === "classes_on_site") updates.physical_location = yes;
    if (q.id === "food_served" || q.id === "food_products_sold") updates.food_prepared_or_sold = yes;
    if (q.id === "chemicals_stored" || q.id === "hazardous_fluids" || q.id === "hazardous_materials_stored" || q.id === "hazardous_materials_transported") updates.hazardous_materials = yes;
    if (q.id === "properties_managed") updates.physical_location = yes;

    if (Object.keys(updates).length > 0) {
      setProfile(prev => ({ ...prev, ...updates }));
    }

    setDiscoveryAnswers(prev => ({ ...prev, [q.id]: value, ...extraAnswers }));
    // Advance past the question just answered. Recorded and derived answers
    // are skipped by `nextUnansweredQuestion` on the next render.
    setCurrentQuestionIndex(activeQuestionIndex + 1);
  };

  /**
   * Apply a validated natural-language interpretation to the EXISTING intake.
   *
   * This only writes profile fields and discovery answers — exactly what the
   * user would have entered by hand. No requirement is created here: the
   * existing rules engine runs later over these same values.
   */
  const applyInterpretedIntake = (patch: IntakePatch) => {
    const numericFields = ['number_of_employees', 'number_of_vehicles', 'number_of_rental_units'];
    const profilePatch: Partial<BusinessProfile> = {};
    for (const [key, value] of Object.entries(patch.profile)) {
      if (numericFields.includes(key)) {
        (profilePatch as Record<string, unknown>)[key] = typeof value === 'number' ? value : null;
      } else {
        (profilePatch as Record<string, unknown>)[key] = value;
      }
    }
    // Mirror booleans onto the profile the same way handleQuestionAnswer does,
    // since question filtering and follow-up context read the profile.
    Object.assign(profilePatch, mirrorAnswersToProfile(patch.answers));

    setProfile((prev) => {
      const next = { ...prev, ...profilePatch };
      // Changing the industry normally clears business_type; keep the
      // interpreted type when the interpreter supplied one.
      if (typeof patch.profile.business_type === 'string') next.business_type = patch.profile.business_type;
      return next;
    });

    if (Object.keys(patch.answers).length > 0) {
      setDiscoveryAnswers((prev) => ({ ...prev, ...patch.answers }));
      setAiPrefilledKeys((prev) => Array.from(new Set([...prev, ...Object.keys(patch.answers)])));
    }
    if (patch.profile.municipality) setPotentialDecisions({});
  };

  const handlePotentialAnswer = (definition: PotentialDef, decision: PotentialDecision) => {
    setPotentialDecisions((previous) => ({
      ...previous,
      [definition.flag]: decision,
    }));
  };

  /**
   * Changing industry invalidates everything downstream of it: the business
   * type, the guided questions and their answers, potential-item decisions,
   * and any requirements already computed. Reset all of it so the intake can
   * never sit in a half-answered state with a dead "See my requirements"
   * button. Industry-independent facts (name, municipality, structure) stay.
   */
  const handleIndustryChange = (nextIndustry: string) => {
    setProfile((current) => ({ ...current,
      industry: nextIndustry,
      business_type: '',
      customers_visit: null, food_prepared_or_sold: null,
      alcohol_sold: null, professional_licenses_required: null, healthcare_services: null, hazardous_materials: null, employees_hired: null,
      physical_location: null, products_manufactured: null, vehicles_used: null, commercial_signage: null, outdoor_seating: null,
      live_entertainment: null, short_term_rental: null, medical_waste: null, import_export: null,
    }));
    setDiscoveryAnswers({});
    setPotentialDecisions({});
    setRequirements([]);
    setFindings([]);
    setReadinessScore(null);
    setCanonicalOverride(null);
    setCurrentQuestionIndex(0);
    setAiPrefilledKeys([]);
  };

  const progress = Math.round(((currentStep - 1) / 8) * 100);

// Quick loaders for demo readiness - instantly shows different requirements per business type
const loadExample = (example: Partial<BusinessProfile>) => {
  const newProfile = { ...profile, ...example };
  setProfile(newProfile);
  const newAnswers = { ...getFollowUpQuestions(newProfile.industry) };
  setDiscoveryAnswers(newAnswers);
  const computed = computeRequirements(newProfile, newAnswers, potentialDecisions);
  setRequirements(computed);
  setReadinessScore(null);
  setFindings([]);
  setUploadedDocs([]);
  setCurrentStep(3); // Go straight to the checklist so user sees the exact requirements
};

  // Step 1: Save profile + compute discovery requirements (client-side)
  const handleStartDiscovery = async () => {
    setIsLoading(true);
    const answers = {
      ...getFollowUpQuestions(),
      customers_visit: profile.customers_visit,
      food_prepared_or_sold: profile.food_prepared_or_sold,
      alcohol_sold: profile.alcohol_sold,
      professional_licenses_required: profile.professional_licenses_required,
      healthcare_services: profile.healthcare_services,
      hazardous_materials: profile.hazardous_materials,
      employees_hired: profile.employees_hired,
      physical_location: profile.physical_location,
      products_manufactured: profile.products_manufactured,
      vehicles_used: profile.vehicles_used,
      commercial_signage: profile.commercial_signage,
      outdoor_seating: profile.outdoor_seating,
      live_entertainment: profile.live_entertainment,
      short_term_rental: profile.short_term_rental,
      medical_waste: profile.medical_waste,
      import_export: profile.import_export,
      location_type: profile.location_type,
      business_type: profile.business_type,
      business_structure: profile.business_structure,
      number_of_employees: profile.number_of_employees,
      // Keep the per-question answers recorded by the guided flow. These IDs
      // are what allow a restored guest draft to remain complete instead of
      // asking the same questions again after a refresh.
      ...discoveryAnswers,
    };

    // Discovery + requirements are computed entirely client-side.
    setBusinessId('local-' + Date.now());
    setDiscoveryAnswers(answers);
    const baseRequirements = computeRequirements(profile, answers, potentialDecisions);
    const merged = mergeConfirmedPotentialRequirements(
      baseRequirements,
      potentialItemsForProfile(profile, baseRequirements),
      potentialDecisions
    ) as Requirement[];
    const computed = merged.map((item) => {
      if (!item.code.startsWith('potential_')) return item;
      const flag = item.code.replace('potential_', '');
      const meta = classifyPotentialItem(item.name, flag, potentialDecisions[flag]);
      return {
        ...item,
        applicability: meta.applicability,
        kind: meta.kind,
        stage: meta.stage,
        triggerFacts: [`municipality_flag:${flag}`],
        acceptsOfficialUpload: meta.acceptsOfficialUpload,
        mandatory: meta.applicability === 'required',
      };
    }).filter((item) => {
      if (!item.code.startsWith('potential_')) return true;
      const flag = item.code.replace('potential_', '');
      return !baseRequirements.some((req) => req.triggerFacts?.includes(`municipality_flag:${flag}`));
    });
    setRequirements(computed);

    // --- Knowledge-graph capture (observational, fire-and-forget) ---
    captureScenario(profile, answers, computed);

    setCurrentStep(3);
    setIsLoading(false);
  };

  // Build and emit a "submission" capture event from the current scenario.
  // Never throws — capture is best-effort and never affects the user flow.
  const captureScenario = (
    p: BusinessProfile,
    answers: Record<string, any>,
    computed: Requirement[]
  ) => {
    try {
      // Reuse the existing submission id when one's already in flight so
      // repeated saves (e.g. each potential-decision click) update the SAME
      // submission row instead of minting a new one every time. Resume sets
      // submissionIdRef from the URL; first capture mints a fresh id.
      const submissionId = submissionIdRef.current || newSubmissionId();
      submissionIdRef.current = submissionId;
      const engineInput = buildEngineInput(p as any, answers, resolveFactsFor(p, answers).questionValues);
      const qText = new Map(KB.questions.map((q) => [q.id, q.question]));
      // buildEngineInput expands the profile into EVERY canonical Q_* question,
      // defaulting the ones the user never engaged with to `false`. Capturing
      // those would make a submission's history list every question in the KB.
      // Only persist affirmative answers — the Yes responses that actually
      // drove requirements — so "Questions Answered" reflects real input.
      const isAnswered = (v: unknown) => {
        if (v === true) return true;
        if (typeof v === 'string') {
          const s = v.trim();
          return s !== '' && !/^(false|no)$/i.test(s);
        }
        return false;
      };
      const capturedAnswers: CapturedAnswer[] = Object.entries(engineInput.answers)
        .filter(([, v]) => isAnswered(v))
        .map(([qid, v]) => ({ question_id: qid, question: qText.get(qid) || qid, answer: v as any }));
      const capturedReqs: CapturedRequirement[] = computed.map((r) => ({
        document_id: r.document_id,
        document: r.name,
        agency: r.agency,
        reason: r.reason,
        source_rule: r.source_rule,
        mandatory: r.mandatory,
      }));
      captureEvent({
        kind: 'submission',
        submission_id: submissionId,
        municipality: p.municipality || null,
        industry: p.industry || null,
        business_type: p.business_type || null,
        business_structure: p.business_structure || null,
        location_type: p.location_type || null,
        business_name: p.name || null,
        business_id: businessIdRef.current || null,
        matter_id: matterIdRef.current || null,
        claim_email: null,
        answers: capturedAnswers,
        requirements: capturedReqs,
      });
    } catch {
      /* observational only */
    }
  };

  // Re-emit the current submission and store a workflow snapshot if signed in
  // so resume restores exact state.
  const saveProgress = async (): Promise<boolean> => {
    setSaveState('saving');
    try {
      captureScenario(profile, discoveryAnswers, requirements);
      if (me) {
        const writes: Promise<Response>[] = [fetch(`/api/snapshots/${submissionIdRef.current}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_id: businessIdRef.current,
            matter_id: matterIdRef.current,
            state: {
              profile, discoveryAnswers,
              requirements, potentialDecisions,
              incentiveFacts,
              incentiveAssessmentHistory,
              pursuedIncentives,
              sampleFormDrafts, preparedSampleApplications,
              govFormDrafts, preparedGovApplications,
              canonicalApplication: canonicalOverride,
              currentStep, readinessScore,
            },
          }),
        })];
        const businessPatch = {
          legal_name: profile.name || undefined,
          business_structure: profile.business_structure || undefined,
          business_type: profile.business_type || undefined,
          industry: profile.industry || undefined,
          municipality: profile.municipality || undefined,
        };
        // A brand-new intake has no business fields yet. Sending an empty PATCH
        // returns 400 and used to mark an otherwise successful snapshot save as
        // failed.
        if (businessIdRef.current && Object.values(businessPatch).some(Boolean)) {
          writes.push(fetch(`/api/businesses/${businessIdRef.current}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(businessPatch),
          }));
        }
        const responses = await Promise.all(writes);
        if (responses.some((response) => !response.ok)) throw new Error('Could not persist filing progress.');
      }
      setSaveState('saved');
      if (saveResetTimerRef.current !== null) window.clearTimeout(saveResetTimerRef.current);
      saveResetTimerRef.current = window.setTimeout(() => setSaveState('idle'), 3500);
      return true;
    } catch {
      setSaveState('error');
      return false;
    }
  };

  // A filing is a persistent Matter, not a temporary wizard. Debounce writes
  // while the signed-in user types. Failed writes retry automatically with
  // capped exponential backoff; saving never depends on a manual button.
  useEffect(() => {
    if (!me || !businessId || !matterIdRef.current) return;
    let cancelled = false;
    let retryTimer: number | null = null;
    let attempts = 0;

    const persist = async () => {
      const saved = await saveProgress();
      if (saved || cancelled) return;
      const delay = Math.min(30_000, 1_500 * (2 ** attempts));
      attempts += 1;
      retryTimer = window.setTimeout(() => { void persist(); }, delay);
    };

    const debounceTimer = window.setTimeout(() => { void persist(); }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(debounceTimer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
    // saveProgress intentionally remains outside the dependency list: the
    // filing state below is the source of truth for when an autosave is due.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    me, businessId, profile, discoveryAnswers, requirements, potentialDecisions, incentiveFacts, incentiveAssessmentHistory, pursuedIncentives,
    sampleFormDrafts, preparedSampleApplications, govFormDrafts,
    preparedGovApplications, canonicalOverride, currentStep, readinessScore,
  ]);

  // Load / recompute requirements (powered by the design-accurate compute function)
  const loadRequirements = async () => {
    setIsLoading(true);
    const computed = computeRequirements(profile, discoveryAnswers, potentialDecisions);
    setRequirements(computed);
    setCurrentStep(3);
    setIsLoading(false);
  };

  // When business_type changes, also ensure location is valid (already handled in onChange)
  // The LOCATION_TYPES_BY_BUSINESS_TYPE drives the dynamic options for Field 5.

  // Legacy / internal - see processRealFileUpload for current upload logic
  const handleMockUpload = async (reqCode: string) => {
    const docName = `${reqCode.replace(/_/g, ' ')}.pdf`;

    // Simulated document text for the AI (in real use, this would come from OCR / file text). Tailored to the requirement.
    const simulatedContent = `This is a ${reqCode.replace(/_/g, ' ')} for ${profile.name || "the business"} located in ${profile.municipality}. Issued recently. Contains business name, dates, official stamps, license/permit numbers, and agency details.`;

    let analysis: any = null;
    let extracted: Record<string, string | null> = {
      business_name: profile.name || "ABC Restaurant LLC",
      entity_name: profile.name || "ABC Restaurant LLC",
      issue_date: null,
      expiration_date: null,
    };

    // Legacy mock path (no longer used in the main upload flow — real LLM path is always preferred)
    analysis = {
      document_type: reqCode.includes('merchant') ? 'Merchant Registration Certificate' :
                     reqCode.includes('permiso') ? 'Permiso Único' :
                     reqCode.includes('health') ? 'Health Permit' :
                     reqCode.includes('fire') ? 'Fire Certification' :
                     reqCode.includes('lease') ? 'Lease Agreement' : 'Unknown',
      confidence: 0.85,
      extracted,
      validation_checks: [
        { check: "Business Name Match", result: "pass", details: "Name matches profile" },
        { check: "Required Fields Present", result: "pass", details: "Key fields found" },
        { check: "Expiration Date", result: "warning", details: "No verified date is available in this legacy simulation." }
      ],
      overall_status: "Needs Review",
      notes: "Legacy simulation has no verified issue or expiration date. Use a real upload for compliance status."
    };

    const newDoc = {
      id: Date.now(),
      requirement_code: reqCode,
      name: docName,
      extracted,
      ai_analysis: analysis
    };
    const newUploaded = [...uploadedDocs, newDoc];
    setUploadedDocs(newUploaded);

    // Update requirement status based on analysis
    const overall = analysis?.overall_status || 'Needs Review';
    let newStatus = 'uploaded';
    if (overall === 'Complete') newStatus = 'passed';
    else if (overall === 'Needs Review' || overall === 'Missing Information') newStatus = 'warning';
    else if (overall === 'Mismatch' || overall === 'Expired') newStatus = 'warning';

    const updatedReqs = requirements.map(r =>
      r.code === reqCode ? { ...r, status: newStatus as any } : r
    );
    setRequirements(updatedReqs);

    // === DETAILED READINESS SCORE per the SmartPR Document Validation Engine spec ===
    // Weight = 100 / total mandatory required documents
    // Stages: 0 (uploaded only), 25% (identified), 50% (fields extracted), 100% (verified)
    // Penalties applied for issues
    const mandatoryReqs = updatedReqs.filter(r => r.mandatory);
    // Per-document weights from the published snapshot (equal weights when
    // none are set — identical to the legacy 100/totalMandatory formula).
    const weightFor = readinessWeightFor(mandatoryReqs);

    let score = 0;
    let penalties = 0;

    mandatoryReqs.forEach(req => {
      const weight = weightFor(req);
      const doc = newUploaded.find(d => d.requirement_code === req.code);
      if (!doc || !doc.ai_analysis) {
        return; // 0 for not yet verified
      }
      const a = doc.ai_analysis;
      const checks = a.validation_checks || [];

      let stage = 0;
      const hasId = a.document_type && a.document_type !== 'Unknown';
      const hasExtract = a.extracted && Object.values(a.extracted).some((v: any) => v);
      const isVerified = (a.overall_status === 'Complete' || a.overall_status === 'Verified') &&
                         checks.every((c: any) => c.result === 'pass' || !c.check.includes('Match') && !c.check.includes('Expired'));

      if (isVerified) stage = 1.0;
      else if (hasExtract) stage = 0.5;
      else if (hasId) stage = 0.25;

      let contrib = stage * weight;

      // Penalties (from spec)
      const nameMismatch = checks.some((c: any) => c.check.includes('Name') && c.result !== 'pass');
      const addrMismatch = checks.some((c: any) => c.check.includes('Address') && c.result !== 'pass');
      const expired = checks.some((c: any) => c.check.includes('Expired') && c.result !== 'pass') ||
                      (a.extracted?.expiration_date && new Date(a.extracted.expiration_date) < new Date());
      const missingKey = checks.some((c: any) => (c.check.includes('Permit') || c.check.includes('Number') || c.check.includes('License')) && c.result !== 'pass');

      if (expired) penalties += weight;
      if (nameMismatch) penalties += 0.5 * weight;
      if (addrMismatch) penalties += 0.25 * weight;
      if (missingKey) penalties += 0.25 * weight;

      score += contrib;
    });

    score = Math.max(0, Math.min(100, Math.round(score - penalties)));
    setReadinessScore(score);

    // Add specific finding/message for this validation (UI will show in findings or as alert)
    const newFindings: Finding[] = [...findings];
    if (analysis) {
      const status = analysis.overall_status;
      let sev: 'critical' | 'warning' | 'informational' = 'informational';
      let title = `${docName} validated`;
      let desc = analysis.notes || `Document identified as ${analysis.document_type}. Confidence ${Math.round((analysis.confidence||0)*100)}%.`;
      let action = 'Document added to package.';

      if (status === 'Complete') {
        sev = 'informational';
        title = `${analysis.document_type} successfully verified`;
        action = 'Readiness score updated.';
      } else if (status === 'Needs Review' || status === 'Missing Information') {
        sev = 'warning';
        title = `${analysis.document_type} needs review`;
        action = 'Review extracted fields or re-upload clearer version.';
      } else if (status === 'Mismatch' || status === 'Expired') {
        sev = 'critical';
        title = `${analysis.document_type} has issues`;
        action = 'Address mismatches or expiration before submission.';
      }

      newFindings.push({
        severity: sev,
        title,
        description: desc,
        recommended_action: action
      });
    }
    setFindings(newFindings);
  };

  // === Real local file upload + LLM document identification (uses .env key + AI model via backend) ===
  const readAsPlainText = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve(`[Binary or unreadable content from ${file.name}]`);
      reader.readAsText(file);
    });
  };

  // Extract real text from a PDF using pdf.js so the LLM receives clean,
  // readable content (e.g. the EIN/permit numbers) instead of raw binary bytes.
  const extractPdfText = async (file: File): Promise<string> => {
    const pdfjs: any = await import('pdfjs-dist');
    // Point pdf.js at its bundled worker (Turbopack/webpack resolve this URL).
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();

    const buffer = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buffer }).promise;
    const parts: string[] = [];
    const maxPages = Math.min(doc.numPages, 15); // cap for performance
    for (let i = 1; i <= maxPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((it: any) => (typeof it.str === 'string' ? it.str : ''))
        .join(' ');
      parts.push(pageText);
    }
    return parts.join('\n').trim();
  };

  // Returns the best available text for LLM analysis, choosing the right
  // extractor based on file type. PDFs go through pdf.js; everything else is
  // read as plain text.
  const readFileAsText = async (file: File): Promise<string> => {
    const isPdf =
      file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) {
      try {
        const text = await extractPdfText(file);
        if (text && text.length > 0) return text;
        // Scanned/image-only PDF with no embedded text layer.
        return `[No selectable text found in PDF "${file.name}" — it may be a scanned image.]`;
      } catch (e) {
        console.warn('PDF text extraction failed, falling back to raw read', e);
        return readAsPlainText(file);
      }
    }
    return readAsPlainText(file);
  };

  const triggerFileUpload = (reqCode: string) => {
    setPendingReqCode(reqCode);
    // If using backend but no proper businessId yet, the process will attempt to create one
    fileInputRef.current?.click();
  };

  const processRealFileUpload = async (file: File, reqCode: string) => {
    setIsLoading(true);
    const filename = file.name;

    // Read both text (for LLM analysis) and binary blob (for ZIP packaging of original documents)
    const [textContent, arrayBuffer] = await Promise.all([
      readFileAsText(file),
      file.arrayBuffer()
    ]);
    let content = textContent;
    if (content.length > 7500) content = content.slice(0, 7500);
    const fileBlob = new Blob([arrayBuffer], { type: file.type || 'application/pdf' });

    let analysis: any = null;
    let llmRan = false;        // true only when the server-side AI call returned a result
    let llmError: string | null = null;
    let extracted: any = {
      business_name: profile.name || null,
      entity_name: profile.name || null,
    };

    // Real LLM analysis runs server-side in this same Next.js app
    // (route handler at /api/analyze-document). No separate backend or
    // NEXT_PUBLIC_BACKEND_URL needed. If the server key isn't configured or
    // the call fails, we fall back to client-side filename/text classification.
    try {
      const res = await fetch(`/api/analyze-document`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          content,
          requirement_code: reqCode,   // unique, targeted prompt per document type
          lang: language,              // so AI notes/findings come back in the selected language
          business_context: {
            name: profile.name || null,
            municipality: profile.municipality || null,
            industry: profile.industry || null,
            location_type: profile.location_type || null,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        analysis = data.analysis;
        llmRan = true;
        if (analysis?.extracted) {
          extracted = { ...extracted, ...analysis.extracted };
        }
      } else {
        const err = await res.json().catch(() => ({}));
        llmError = err?.error || `Analysis service returned ${res.status}`;
        console.warn('LLM analyze returned non-ok status', res.status, err);
      }
    } catch (e) {
      llmError = 'Could not reach the document analysis service';
      console.warn('LLM document analysis failed, falling back to filename-based classification', e);
    }

    if (!analysis) {
      // Client fallback (still uses the actual filename + any extracted text from file for better ID than pure mock)
      const lower = (filename + ' ' + content).toLowerCase();
      let docType = 'Unknown';
      if (/(inc|llc|corporation|articles|organization|formacion)/.test(lower)) docType = 'Certificate of Incorporation';
      else if (/ein|irs|employer identification/.test(lower)) docType = 'IRS EIN Letter';
      else if (/merchant|registro de comerciante|hacienda/.test(lower)) docType = 'Merchant Registration Certificate';
      else if (/permiso|ogpe|single business/.test(lower)) docType = 'Permiso Único';
      else if (/patente|municipal/.test(lower)) docType = 'Patente Municipal';
      else if (/lease|arrendamiento/.test(lower)) docType = 'Lease Agreement';
      else if (/deed|escritura|property/.test(lower)) docType = 'Property Deed';
      else if (/health|salud|sanitary/.test(lower)) docType = 'Health Permit';
      else if (/fire|bombero|seguridad/.test(lower)) docType = 'Fire Certification';
      else if (/cfpm|food protection|servsafe|prometric/.test(lower)) docType = 'CFPM Certificate';
      else if (/professional|license|licencia|colegio/.test(lower)) docType = 'Professional License';
      else if (/contractor|constructor/.test(lower)) docType = 'Contractor License';
      else if (/insurance|seguro/.test(lower)) docType = 'Insurance Certificate';
      else if (/alcohol|licor|bebidas/.test(lower)) docType = 'Alcohol Permit';

      const fbExtraction = buildExtraction(docType, extracted, 0.65, { businessName: profile.name || null });
      analysis = {
        document_type: docType,
        confidence: 0.65,
        extracted,
        extraction: fbExtraction,
        validation_checks: [],
        overall_status:
          fbExtraction.validation_result === 'PASS' ? 'Complete'
          : fbExtraction.validation_result === 'FAIL' ? 'Missing Information'
          : 'Needs Review',
        notes: fbExtraction.reasoning,
      };
    }

    // Ensure an extraction object always exists (older responses / safety).
    if (analysis && !analysis.extraction) {
      analysis.extraction = buildExtraction(
        analysis.document_type || 'Unknown',
        analysis.extracted || extracted,
        typeof analysis.confidence === 'number' ? analysis.confidence : 0.5,
        { businessName: profile.name || null }
      );
    }

    const newDoc = {
      id: Date.now(),
      requirement_code: reqCode,
      name: filename,
      extracted,
      ai_analysis: analysis,
      fileBlob,                 // original uploaded file for ZIP packaging
      originalName: filename
    };
    const newUploaded = [...uploadedDocs, newDoc];
    setUploadedDocs(newUploaded);

    // Update requirement status + detailed score + findings (same logic as before for consistency)
    const overall = analysis?.overall_status || 'Needs Review';
    let newStatus: 'pending' | 'uploaded' | 'passed' | 'warning' = 'uploaded';
    if (overall === 'Complete' || overall === 'Verified') newStatus = 'passed';
    else if (overall === 'Needs Review' || overall === 'Missing Information') newStatus = 'warning';
    else if (overall === 'Mismatch' || overall === 'Expired') newStatus = 'warning';

    const updatedReqs = requirements.map(r =>
      r.code === reqCode ? { ...r, status: newStatus } : r
    );
    setRequirements(updatedReqs);

    if (newStatus === 'warning') {
      autoFocusFailed(reqCode);
    }

    // Score calculation (weight 100/total_mandatory, stages, penalties) - from verified only
    const mandatoryReqs = updatedReqs.filter(r => r.mandatory);
    // Per-document weights from the published snapshot (equal weights when
    // none are set — identical to the legacy 100/totalMandatory formula).
    const weightFor = readinessWeightFor(mandatoryReqs);

    let score = 0;
    let penalties = 0;

    mandatoryReqs.forEach(req => {
      const weight = weightFor(req);
      const doc = newUploaded.find(d => d.requirement_code === req.code);
      if (!doc || !doc.ai_analysis) return;
      const a = doc.ai_analysis;
      // Extraction-first scoring: the readiness contribution is driven by the
      // structured extraction result (fields found vs. required), not by
      // generic statuses.
      const ext: ExtractionResult | undefined = a.extraction;
      let stage = 0;
      if (ext) {
        if (ext.validation_result === 'PASS') stage = 1.0;
        else if (ext.validation_result === 'NEEDS_REVIEW') stage = 0.6;
        else stage = ext.fields_found.length > 0 ? 0.3 : 0; // FAIL: partial credit for any extraction
      } else {
        const hasId = a.document_type && a.document_type !== 'Unknown';
        const hasExtract = a.extracted && Object.values(a.extracted).some((v: any) => v);
        stage = hasExtract ? 0.5 : hasId ? 0.25 : 0;
      }

      score += stage * weight;

      // Penalties for concrete extracted problems.
      if (ext?.expiration_status === 'Expired') penalties += weight;
      if (ext && ext.fields_missing.length > 0) penalties += 0.25 * weight;
    });

    score = Math.max(0, Math.min(100, Math.round(score - penalties)));
    setReadinessScore(score);

    // --- Knowledge-graph capture: document validation + readiness ---
    try {
      const ext: ExtractionResult | undefined = analysis?.extraction;
      const validationResult: 'PASS' | 'NEEDS_REVIEW' | 'FAIL' =
        ext?.validation_result || (newStatus === 'passed' ? 'PASS' : 'NEEDS_REVIEW');
      captureEvent({
        kind: 'validation',
        submission_id: submissionIdRef.current,
        business_type: profile.business_type || null,
        document_type: analysis?.document_type || reqCode,
        requirement_id: requirements.find((requirement) => requirement.code === reqCode)?.document_id || reqCode,
        original_filename: filename,
        mime_type: file.type || null,
        size_bytes: file.size,
        validation_result: validationResult,
        pass_fail: validationResult === 'PASS',
        confidence: ext ? ext.classification_confidence : Math.round((analysis?.confidence || 0) * 100),
        expiration_status: ext?.expiration_status || 'Unknown',
        extracted_fields: analysis?.extracted || undefined,
        fields_found: ext?.fields_found.map(f => f.label),
        fields_missing: ext?.fields_missing.map(f => f.label),
      });

      const missingDocuments = updatedReqs
        .filter((r) => r.mandatory && r.status !== 'passed')
        .map((r) => r.name);
      const readinessStatus =
        score >= 90 ? 'Ready For Submission' : score >= 70 ? 'Nearly Ready' : score >= 40 ? 'In Progress' : 'Getting Started';
      captureEvent({
        kind: 'readiness',
        submission_id: submissionIdRef.current,
        business_type: profile.business_type || null,
        score,
        status: readinessStatus,
        missing_documents: missingDocuments,
      });
    } catch {
      /* observational only */
    }

    // Findings from this analysis
    const newFindings: Finding[] = [...findings];
    const status = analysis.overall_status;
    let sev: 'critical' | 'warning' | 'informational' = 'informational';
    let title = `${filename} ${L('processed', language)}`;
    let desc = analysis.notes || `${L('Identified as', language)} ${analysis.document_type}. ${L('Confidence', language)} ${Math.round((analysis.confidence || 0) * 100)}%.`;
    let action = L('Document added and analyzed.', language);

    if (status === 'Complete' || status === 'Verified') {
      sev = 'informational';
      title = `${analysis.document_type} — ${L('verified', language)}`;
      action = L('Readiness score updated.', language);
    } else if (status === 'Needs Review' || status === 'Missing Information') {
      sev = 'warning';
      title = `${analysis.document_type} — ${L('needs review', language)}`;
      action = L('Review fields or re-upload.', language);
    } else if (status === 'Mismatch' || status === 'Expired') {
      sev = 'critical';
      title = `${analysis.document_type} — ${L('has issues', language)}`;
      action = L('Address before submission.', language);
    }

    newFindings.push({ severity: sev, title, description: desc, recommended_action: action });
    setFindings(newFindings);

    // Visible toast so the user immediately sees the LLM result for this upload.
    const reqObj = requirements.find(r => r.code === reqCode);
    const reqLabel = reqObj ? trReqName(reqObj) : (analysis.document_type || filename);
    if (!llmRan) {
      setUploadNotice({
        kind: 'error',
        title: L('Could not analyze with AI', language),
        detail: llmError
          ? `${llmError}. ${L('Add XAI_API_KEY in your environment to enable AI analysis.', language)}`
          : L('AI analysis unavailable. Using basic classification.', language),
      });
    } else {
      // Specific, extraction-first toast: counts of fields found/missing.
      const ext: ExtractionResult | undefined = analysis?.extraction;
      const found = ext?.fields_found.length ?? 0;
      const missing = ext?.fields_missing.length ?? 0;
      const vr = ext?.validation_result;
      const detail = `${found} ${L('fields found', language)}${missing ? `, ${missing} ${L('required missing', language)}` : ''} · ${analysis.document_type}`;
      if (vr === 'PASS') {
        setUploadNotice({ kind: 'success', title: `✓ ${reqLabel} — ${L('Pass', language)}`, detail });
      } else if (vr === 'FAIL') {
        setUploadNotice({ kind: 'warning', title: `${reqLabel} — ${L('Fields Missing', language)}`, detail });
      } else {
        setUploadNotice({ kind: 'warning', title: `${reqLabel} — ${L('Needs Review', language)}`, detail });
      }
    }

    setIsLoading(false);
  };

  const onFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const code = pendingReqCode;
    setPendingReqCode(null);
    if (e.target) e.target.value = ''; // allow re-select same file later
    if (file && code) {
      await processRealFileUpload(file, code);
    } else if (code) {
      setProcessingStates(prev => { const n = { ...prev }; delete n[code]; return n; });
    }
  };

  // Start the visible 5-stage pipeline (fixes "uploads feel dead")
  const startProcessingPipeline = (reqCode: string, fileName: string) => {
    setProcessingStates(prev => ({ ...prev, [reqCode]: { stageIndex: 0, fileName } }));
    let current = 0;
    const advance = () => {
      current += 1;
      if (current < PROCESS_STAGES.length) {
        setProcessingStates(prev => {
          if (!prev[reqCode]) return prev;
          return { ...prev, [reqCode]: { ...prev[reqCode], stageIndex: current } };
        });
        setTimeout(advance, 380);
      } else {
        setTimeout(() => {
          setProcessingStates(prev => { const n = { ...prev }; delete n[reqCode]; return n; });
        }, 550);
      }
    };
    setTimeout(advance, 320);
  };

  // Enhanced trigger that also starts the visual pipeline
  const triggerFileUploadWithPipeline = (reqCode: string) => {
    const doc = uploadedDocs.find(d => d.requirement_code === reqCode);
    const name = doc?.name || `${reqCode}.pdf`;
    startProcessingPipeline(reqCode, name);
    triggerFileUpload(reqCode);
  };

  // Resolve a warning item
  const resolveAndMarkComplete = (reqCode: string) => {
    setRequirements(prev => prev.map(r => r.code === reqCode ? { ...r, status: 'passed' as const } : r));
    setFindings(prev => prev.filter(f => !f.title.toLowerCase().includes(reqCode.replace(/_/g, ' '))));
    setReviewingCode(null);
    if (readinessScore != null) setReadinessScore(Math.min(100, readinessScore + 10));
  };

  // Auto focus + open review for newly failed documents
  const autoFocusFailed = (reqCode: string) => {
    setTimeout(() => {
      const el = document.getElementById(`req-row-${reqCode}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setHighlightCode(reqCode);
        setReviewingCode(reqCode);
        setTimeout(() => setHighlightCode(null), 2200);
      }
    }, 600);
  };

  // Step 6-7: Run validation (calls backend mock or local logic)
  const runValidation = async () => {
    setIsLoading(true);
    try {
      let score = 68;
      let newFindings: Finding[] = [];

      {
        // Client-side Validation Engine (readiness score + findings).
        const missing = requirements.filter(r => r.mandatory && r.status === 'pending').length;
        score = Math.max(40, 95 - (missing * 12));

        newFindings = [];
        if (missing > 0) {
          newFindings.push({
            severity: 'critical',
            title: `${missing} ${L('Critical Items Missing', language)}`,
            description: L('Required documents or permits have not been uploaded or validated.', language),
            recommended_action: L('Upload the missing items shown in the checklist.', language)
          });
        }
        // Expiration findings must come from uploaded evidence. Industry alone
        // is never evidence of a due date or an approaching expiration.
        for (const doc of uploadedDocs) {
          if (doc.ai_analysis?.extraction?.expiration_status !== 'Expired') continue;
          newFindings.push({
            severity: 'critical',
            title: `${doc.name} — ${L('expired', language)}`,
            description: L('The expiration date extracted from this document has passed.', language),
            recommended_action: L('Renew and upload current agency-issued evidence.', language),
          });
        }
        newFindings.push({
          severity: 'informational',
          title: L('Municipal recommendation recommended', language),
          description: L('Some municipalities require a local planning letter.', language),
          recommended_action: L('Contact your municipal Oficina de Planificación.', language)
        });
      }

      setReadinessScore(score);
      setFindings(newFindings);
      setCurrentStep(7);
    } finally {
      setIsLoading(false);
    }
  };

  // Step 9: "Generate Package" now leads to the final SUBMISSION DELIVERABLES screen
  const generatePackage = async () => {
    setCurrentStep(9);
  };

  // --- Helper: ordered submission document names ---
  const getSubmissionFileName = (code: string, index: number): string => {
    const map: Record<string, string> = {
      certificate_of_incorporation: 'Entity_Formation',
      ein_letter: 'EIN_Letter',
      merchant_registration: 'Merchant_Registration',
      permiso_unico: 'Permiso_Unico',
      patente_municipal: 'Patente_Municipal',
      lease_or_property_docs: 'Lease_or_Property_Docs',
      floor_plan: 'Floor_Plan',
      health_permit: 'Health_Permit',
      fire_certification: 'Fire_Certification',
      cfpm_certificate: 'CFPM_Certificate',
      professional_license: 'Professional_License',
      contractor_license: 'Contractor_License',
      insurance_certificate: 'Insurance_Certificate',
      alcohol_permit: 'Alcohol_Permit',
      home_declaration: 'Home_Business_Declaration',
      residential_proof: 'Residential_Address_Proof',
    };
    const base = map[code] || code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\s+/g, '_');
    return `${String(index).padStart(2, '0')}_${base}.pdf`;
  };

  const submissionPriorityOrder = [
    'certificate_of_incorporation', 'ein_letter', 'merchant_registration', 'permiso_unico',
    'patente_municipal', 'lease_or_property_docs', 'floor_plan', 'health_permit',
    'fire_certification', 'cfpm_certificate', 'professional_license', 'contractor_license',
    'insurance_certificate', 'alcohol_permit', 'home_declaration', 'residential_proof'
  ];

  // --- 1. Professional PDF Readiness Report (jsPDF) ---
  const generateReadinessReportPDF = async (): Promise<Blob> => {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const PAGE_W = 210;
    const PAGE_H = 297;
    const MARGIN = 18;
    const CONTENT_W = PAGE_W - MARGIN * 2; // 174mm
    const navy: [number, number, number] = [10, 37, 64];
    const teal: [number, number, number] = [13, 148, 136];
    const slate: [number, number, number] = [71, 85, 105];

    // jsPDF's built-in fonts are WinAnsi (Latin-1) only. Unsupported glyphs
    // (✓ ⬜ • → emoji) trigger broken per-character spacing, so map them to safe
    // ASCII and strip anything outside Latin-1 (accents like ó/í are kept).
    const san = (s: any): string =>
      (s ?? '')
        .toString()
        .replace(/[✓✔]/g, '[x]')
        .replace(/[⬜☐▢]/g, '[ ]')
        .replace(/[→➔]/g, '->')
        .replace(/[•·]/g, '-')
        .replace(/[‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/[^\x00-\xFF]/g, '')
        .trim();

    let y = 0;
    const lineH = 5.2;
    const tr = (s: string) => L(s, language); // localize PDF text to selected language

    const ensureSpace = (needed: number) => {
      if (y + needed > PAGE_H - 16) {
        doc.addPage();
        y = MARGIN;
      }
    };

    // Wrapped paragraph writer with consistent spacing + auto page breaks.
    const writeText = (
      text: string,
      x: number,
      opts: { size?: number; color?: [number, number, number]; gap?: number; bold?: boolean } = {}
    ) => {
      const { size = 10, color = navy, gap = 1.5, bold = false } = opts;
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      const maxW = CONTENT_W - (x - MARGIN);
      const lines = doc.splitTextToSize(san(text), maxW);
      lines.forEach((ln: string) => {
        ensureSpace(lineH);
        doc.text(ln, x, y);
        y += lineH;
      });
      y += gap;
    };

    // Section heading with a thin underline rule (government-document feel).
    const sectionHeading = (label: string) => {
      y += 2;
      ensureSpace(12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(navy[0], navy[1], navy[2]);
      doc.text(san(label), MARGIN, y);
      y += 2.5;
      doc.setDrawColor(203, 213, 225);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, y, PAGE_W - MARGIN, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
    };

    // ---- Header band ----
    doc.setFillColor(navy[0], navy[1], navy[2]);
    doc.rect(0, 0, PAGE_W, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text('SMARTPR', MARGIN, 13);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(san(tr('PUERTO RICO BUSINESS LICENSING READINESS')), MARGIN + 34, 13);

    // ---- Title ----
    y = 32;
    doc.setTextColor(navy[0], navy[1], navy[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(san(tr('Submission Readiness Report')), MARGIN, y);
    y += 9;

    // ---- Business meta ----
    const metaRows: [string, string][] = [
      [tr('Business Name'), profile.name || 'N/A'],
      [tr('Municipality'), profile.municipality || 'N/A'],
      [tr('Industry'), profile.industry || 'N/A'],
      [tr('Business Type'), profile.business_type || 'N/A'],
    ];
    doc.setFontSize(10);
    metaRows.forEach(([k, v]) => {
      ensureSpace(lineH);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(slate[0], slate[1], slate[2]);
      doc.text(`${san(k)}:`, MARGIN, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(navy[0], navy[1], navy[2]);
      doc.text(san(v), MARGIN + 38, y);
      y += lineH + 0.6;
    });
    y += 3;

    // ---- Status banner ----
    const completed = requirements.filter(
      r => r.mandatory && (r.status === 'passed' || r.status === 'uploaded')
    ).length;
    const total = requirements.filter(r => r.mandatory).length;
    const ready = total > 0 && completed === total;
    const statusText = ready ? tr('READY FOR SUBMISSION') : tr('NEEDS REVIEW');
    const band: [number, number, number] = ready ? teal : [217, 119, 6];
    ensureSpace(13);
    doc.setFillColor(band[0], band[1], band[2]);
    doc.rect(MARGIN, y, CONTENT_W, 11, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(
      san(`${statusText}   |   ${tr('Readiness')} ${readinessScore ?? 'N/A'}%   |   ${completed} ${tr('of')} ${total} ${tr('required documents validated')}`),
      MARGIN + 4,
      y + 7.2
    );
    y += 17;
    doc.setFont('helvetica', 'normal');

    // ---- Required documents ----
    sectionHeading(tr('REQUIRED DOCUMENTS'));
    requirements.slice(0, 12).forEach(r => {
      const done = r.status === 'passed' || r.status === 'uploaded';
      writeText(`${done ? '[x]' : '[ ]'}  ${trReqName(r)}  (${L(r.agency, language)})`, MARGIN + 2, { gap: 0.6 });
    });
    if (requirements.length > 12) {
      writeText(`${tr('... and')} ${requirements.length - 12} ${tr('more')}`, MARGIN + 2, { gap: 0.6, color: slate });
    }

    // ---- Uploaded documents ----
    sectionHeading(tr('UPLOADED & VALIDATED DOCUMENTS'));
    if (uploadedDocs.length === 0) {
      writeText(tr('No documents uploaded yet.'), MARGIN + 2, { color: slate });
    } else {
      uploadedDocs.slice(0, 12).forEach((d, i) => {
        const a = d.ai_analysis;
        const st = a?.overall_status || 'Unknown';
        writeText(`${i + 1}.  ${d.name} — ${a?.document_type || 'Document'}  (${L(st, language)})`, MARGIN + 2, {
          gap: 0.6,
        });
      });
    }

    const preparedApplications = Object.values(preparedSampleApplications);
    sectionHeading(tr('PREPARED APPLICATION WORKSHEETS'));
    if (preparedApplications.length === 0) {
      writeText(tr('No application worksheets prepared yet.'), MARGIN + 2, { color: slate });
    } else {
      preparedApplications.forEach((application, index) => {
        writeText(`${index + 1}.  ${application.title} — ${tr('Draft; official agency output still required')}`, MARGIN + 2, { gap: 0.6 });
      });
    }

    // ---- Missing / pending ----
    const missing = requirements.filter(r => r.mandatory && r.status === 'pending');
    sectionHeading(tr('MISSING / PENDING DOCUMENTS'));
    if (missing.length === 0) {
      writeText(tr('None — all mandatory items validated.'), MARGIN + 2, { color: teal });
    } else {
      missing.forEach(m => writeText(`-  ${trReqName(m)}`, MARGIN + 2, { gap: 0.6 }));
    }

    // ---- Municipal notices ----
    const munNotices = computeMunicipalityNotices(profile);
    if (munNotices.length > 0) {
      sectionHeading(tr('MUNICIPAL NOTICES'));
      munNotices.forEach(n => writeText(`-  ${tr(n)}`, MARGIN + 2, { gap: 0.6 }));
    }

    // ---- Findings ----
    sectionHeading(tr('FINDINGS & RECOMMENDATIONS'));
    if (findings.length === 0) {
      writeText(tr('No findings recorded.'), MARGIN + 2, { color: slate });
    } else {
      findings.slice(0, 8).forEach(f => {
        writeText(`[${f.severity.toUpperCase()}]  ${L(f.title, language)}`, MARGIN + 2, { gap: 0.4, bold: true });
        if (f.description) writeText(L(f.description, language), MARGIN + 6, { gap: 0.4, color: slate });
        if (f.recommended_action)
          writeText(`-> ${L(f.recommended_action, language)}`, MARGIN + 6, { gap: 1.2, color: slate });
      });
    }

    // ---- Next steps ----
    sectionHeading(tr('RECOMMENDED NEXT STEPS'));
    [
      tr('1. Review any items marked Needs Review or Warning.'),
      tr('2. Address expiring documents or mismatches before submission.'),
      tr('3. Share the Submission Package ZIP with your attorney, accountant, or permit expediter.'),
      tr('4. Use the SmartPR Workspace to track updates and re-validate as needed.'),
    ].forEach(s => writeText(s, MARGIN + 2, { gap: 0.6 }));

    // ---- Disclaimer ----
    y += 3;
    ensureSpace(30);
    doc.setFillColor(254, 226, 226);
    doc.setDrawColor(252, 165, 165);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN, y, CONTENT_W, 26, 'FD');
    const discStartY = y;
    y += 6;
    doc.setTextColor(153, 27, 30);
    doc.setFontSize(8.5);
    const disclaimer = tr(
      'SmartPR determines READINESS for submission to Puerto Rico government agencies. It does NOT approve, grant, or issue any license or permit. All approvals are made exclusively by the Government of Puerto Rico and its agencies. This package is for preparation and organization only. Platform scope: Prepare, Validate, Organize, Package.'
    );
    doc.splitTextToSize(san(disclaimer), CONTENT_W - 8).forEach((ln: string) => {
      doc.text(ln, MARGIN + 4, y);
      y += 4.2;
    });
    y = discStartY + 30;

    // ---- Footer on every page ----
    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(slate[0], slate[1], slate[2]);
      doc.text(
        san(`${tr('Generated')}: ${new Date().toLocaleString()}  |  SmartPR  |  ${tr('Powered by AI')}`),
        MARGIN,
        PAGE_H - 8
      );
      doc.text(san(`${tr('Page')} ${p} ${tr('of')} ${pages}`), PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' });
    }

    return doc.output('blob');
  };

  // --- 1. Download standalone professional PDF Report ---
  // Upload a generated deliverable to the user's library (no-op if anonymous).
  const archiveDeliverable = async (kind: 'report' | 'submission', filename: string, blob: Blob) => {
    if (!me) return;
    try {
      const fd = new FormData();
      fd.append('kind', kind);
      fd.append('file', new File([blob], filename, { type: blob.type || 'application/octet-stream' }));
      if (submissionIdRef.current) fd.append('submission_id', submissionIdRef.current);
      if (businessIdRef.current) fd.append('business_id', businessIdRef.current);
      await fetch('/api/deliverables', { method: 'POST', body: fd });
    } catch { /* observational */ }
  };

  const persistSampleForms = (
    drafts: Record<string, SampleFormData>,
    prepared: Record<string, PreparedSampleApplication>
  ) => {
    try {
      localStorage.setItem(sampleFormsStorageKey, JSON.stringify({ drafts, prepared }));
    } catch { /* browser storage is best-effort */ }
  };

  const openSampleApplication = (requirementCode: string) => {
    const definition = getSampleApplication(requirementCode);
    if (!definition) return;
    const nextData = prefillSampleApplication(
      definition,
      profile,
      sampleFormDrafts[requirementCode] || preparedSampleApplications[requirementCode]?.data || {}
    );
    setSampleFormDrafts((current) => ({ ...current, [requirementCode]: nextData }));
    setSampleFormErrors([]);
    setSampleFormNotice(null);
    setSampleFormMode('edit');
    setActiveSampleFormCode(requirementCode);
  };

  const updateSampleFormField = (key: string, value: SampleFormValue) => {
    if (!activeSampleFormCode) return;
    setSampleFormDrafts((current) => ({
      ...current,
      [activeSampleFormCode]: {
        ...(current[activeSampleFormCode] || {}),
        [key]: value,
      },
    }));
    setSampleFormErrors([]);
  };

  const saveSampleFormDraft = () => {
    if (!activeSampleFormCode) return;
    const nextDrafts = { ...sampleFormDrafts };
    persistSampleForms(nextDrafts, preparedSampleApplications);
    setSampleFormNotice('Draft saved on this device. It does not complete the requirement.');
  };

  // Validates, persists the draft, then switches to a preview of the actual
  // generated PDF. "Add PDF to deliverables" only becomes available from there.
  const reviewSampleForm = () => {
    if (!activeSampleFormCode) return;
    const definition = getSampleApplication(activeSampleFormCode);
    if (!definition) return;
    const data = sampleFormDrafts[activeSampleFormCode] || {};
    const missing = missingRequiredSampleFields(definition, data);
    if (missing.length > 0) {
      setSampleFormErrors(missing);
      setSampleFormNotice(null);
      return;
    }
    setSampleFormErrors([]);
    setSampleFormNotice(null);
    persistSampleForms(sampleFormDrafts, preparedSampleApplications);
    setSampleFormMode('preview');
  };

  // Regenerates the literal PDF (the same generator used for download and the
  // submission ZIP) whenever the preview is open, so it is never stale or an
  // approximation of what "Add PDF to deliverables" is about to save.
  const sampleFormPreviewUrl = useMemo(() => {
    if (sampleFormMode !== 'preview' || !activeSampleFormCode) return null;
    const definition = getSampleApplication(activeSampleFormCode);
    if (!definition) return null;
    const blob = generateSampleApplicationPdf(definition, sampleFormDrafts[activeSampleFormCode] || {});
    return URL.createObjectURL(blob);
  }, [sampleFormMode, activeSampleFormCode, sampleFormDrafts]);

  useEffect(() => {
    return () => {
      if (sampleFormPreviewUrl) URL.revokeObjectURL(sampleFormPreviewUrl);
    };
  }, [sampleFormPreviewUrl]);

  const addSampleFormToDeliverables = () => {
    if (!activeSampleFormCode) return;
    const definition = getSampleApplication(activeSampleFormCode);
    if (!definition) return;
    const data = sampleFormDrafts[activeSampleFormCode] || {};
    const missing = missingRequiredSampleFields(definition, data);
    if (missing.length > 0) {
      setSampleFormErrors(missing);
      setSampleFormNotice(null);
      return;
    }

    const prepared: PreparedSampleApplication = {
      requirementCode: activeSampleFormCode,
      title: definition.title,
      filename: definition.filename,
      preparedAt: new Date().toISOString(),
      data,
    };
    const nextPrepared = { ...preparedSampleApplications, [activeSampleFormCode]: prepared };
    setPreparedSampleApplications(nextPrepared);
    persistSampleForms(sampleFormDrafts, nextPrepared);
    setSampleFormNotice('Application worksheet added to deliverables. Upload the agency-issued document separately after approval.');
    setSampleFormErrors([]);
  };

  // Renders the exact PDF in an on-page preview before it can be downloaded —
  // clicking "PDF" no longer fires a silent, easy-to-miss browser download.
  const previewPreparedSampleApplication = (prepared: PreparedSampleApplication) => {
    const definition = getSampleApplication(prepared.requirementCode);
    if (!definition) return;
    const blob = generateSampleApplicationPdf(definition, prepared.data);
    setDocPreview({ title: prepared.title, filename: prepared.filename, blob });
  };

  const previewReadinessReport = async () => {
    try {
      setIsLoading(true);
      const pdfBlob = await generateReadinessReportPDF();
      const filename = `SmartPR-Readiness-Report-${(profile.name || 'Business').replace(/\s+/g, '-')}.pdf`;
      setDocPreview({ title: L('Readiness Report', language), filename, blob: pdfBlob, kind: 'report' });
    } finally {
      setIsLoading(false);
    }
  };

  // --- 2. Download full Submission Package ZIP (renamed docs + PDF) ---
  const downloadSubmissionPackage = async () => {
    try {
      setIsLoading(true);
      const zip = new JSZip();

      // Add the professional PDF report
      const pdfBlob = await generateReadinessReportPDF();
      zip.file('00_SmartPR_Readiness_Report.pdf', pdfBlob);

      // Add user-prepared sample application worksheets. These are clearly
      // labeled drafts and never substitute for agency-issued evidence.
      for (const prepared of Object.values(preparedSampleApplications)) {
        const definition = getSampleApplication(prepared.requirementCode);
        if (!definition) continue;
        zip.file(`Prepared_Applications/${prepared.filename}`, generateSampleApplicationPdf(definition, prepared.data));
      }

      // Add government-form PDFs (CORPREG01–06). Regenerated fresh here, never
      // a cached Blob URL. Where SmartPR holds the actual agency file with a
      // verified mapping, this is the real PDF populated server-side — never
      // the SmartPR-drafted preparation summary standing in for it.
      const worksheetSubstitutions: string[] = [];
      for (const app of Object.values(preparedGovApplications)) {
        const definition = getDefinition(app.formId);
        if (!definition) continue;
        const safeTitle = `${app.officialFormNumber}_${definition.variantKey}`.replace(/[^a-z0-9_]+/gi, '_');
        const template = getTemplate(definition.officialFormNumber);
        const official = Boolean(template && isOfficialArtifact(template));
        let blob: Blob | null = null;
        if (official) {
          // One retry: a single hiccup should not cost the applicant the real
          // agency PDF, which is the whole point of the package.
          for (let attempt = 0; attempt < 2 && !blob; attempt++) {
            try {
              const res = await fetch(`/api/forms/artifacts/${definition.officialFormNumber}/populate`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ profile: canonicalApplication }),
              });
              if (res.ok) blob = await res.blob();
            } catch {
              // Retry, then fall through to the clearly-named worksheet below.
            }
          }
        }
        if (blob) {
          zip.file(`Prepared_Applications/${safeTitle}.pdf`, blob);
          continue;
        }
        // Population failed for a form SmartPR does hold. The worksheet still
        // goes in so the applicant's work is not lost, but under a name that
        // cannot be mistaken for the agency's form — and it is reported below,
        // because silently swapping the document is how someone ends up filing
        // a SmartPR summary at the Department of State.
        const suffix = official ? '_PREPARATION_WORKSHEET_NOT_THE_OFFICIAL_FORM' : '';
        if (official) worksheetSubstitutions.push(app.officialFormNumber);
        zip.file(
          `Prepared_Applications/${safeTitle}${suffix}.pdf`,
          generatePreparationPdf(definition, app.data as GovFormData, canonicalApplication, language)
        );
      }

      // Collect validated docs that have real file blobs, sorted by submission priority
      const validatedWithFiles = uploadedDocs
        .filter(d => d.fileBlob)
        .map(d => {
          const req = requirements.find(r => r.code === d.requirement_code);
          const priority = submissionPriorityOrder.indexOf(d.requirement_code);
          return { ...d, priority: priority === -1 ? 999 : priority, reqStatus: req?.status };
        })
        .filter(d => d.reqStatus === 'passed' || d.reqStatus === 'uploaded' || d.reqStatus === 'warning')
        .sort((a, b) => a.priority - b.priority);

      let idx = 1;
      for (const d of validatedWithFiles) {
        const niceName = getSubmissionFileName(d.requirement_code, idx++);
        zip.file(niceName, d.fileBlob as Blob);
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const filename = `SmartPR-Submission-Package-${(profile.name || 'Business').replace(/\s+/g, '-')}.zip`;
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      void archiveDeliverable('submission', filename, zipBlob);
      if (worksheetSubstitutions.length > 0) {
        setSampleFormNotice(
          `${worksheetSubstitutions.join(', ')}: the official agency PDF could not be produced, so the package contains a SmartPR preparation worksheet instead. Reopen the form and download the official PDF before filing.`
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  // --- 3. Open / create SmartPR Workspace (persistent link + localStorage snapshot) ---
  // Build a compact, self-contained workspace payload. Because the app runs as
  // a single service with no database, the approved-deliverables snapshot is
  // encoded into the link itself (URL hash) so it is a real, shareable page.
  const buildWorkspacePayload = () => {
    const completedM = requirements.filter(
      r => r.mandatory && (r.status === 'passed' || r.status === 'uploaded')
    ).length;
    const totalM = requirements.filter(r => r.mandatory).length;
    return {
      v: 1,
      lang: language,
      name: profile.name || 'Business',
      municipality: profile.municipality || '',
      industry: profile.industry || '',
      businessType: profile.business_type || '',
      score: readinessScore,
      completed: completedM,
      total: totalM,
      // Only the deliverables the LLM actually approved/processed.
      approved: uploadedDocs.map(d => ({
        name: d.originalName || d.name,
        type: d.ai_analysis?.document_type || 'Document',
        status: d.ai_analysis?.overall_status || 'Uploaded',
        req: d.requirement_code,
      })),
      preparedApplications: Object.values(preparedSampleApplications).map((application) => ({
        title: application.title,
        filename: application.filename,
        preparedAt: application.preparedAt,
        status: 'Draft — official agency output still required',
      })),
      requirements: requirements.map(r => ({
        name: r.name,
        agency: r.agency,
        status: r.status,
        mandatory: r.mandatory,
      })),
      findings: findings.slice(0, 10),
      notices: computeMunicipalityNotices(profile),
      generatedAt: new Date().toISOString(),
    };
  };

  // Unicode-safe base64 encoder for the URL hash.
  const encodePayload = (obj: any): string => {
    const json = JSON.stringify(obj);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };

  const openSmartPRWorkspace = () => {
    const wsId = (businessId || `ws-${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '');
    setActiveWorkspaceId(wsId);

    const payload = buildWorkspacePayload();

    // Keep a local copy for this browser (re-validation / continuity).
    try {
      localStorage.setItem(`smartpr-workspace-${wsId}`, JSON.stringify(payload));
    } catch {
      console.warn('Could not persist workspace to localStorage (storage quota).');
    }

    // The data travels in the hash fragment, so the link renders the approved
    // deliverables anywhere it is opened — no backend lookup required.
    const encoded = encodePayload(payload);
    const wsUrl = `/workspace/${wsId}#d=${encoded}`;
    const fullUrl = (typeof window !== 'undefined' ? window.location.origin : '') + wsUrl;

    navigator.clipboard?.writeText(fullUrl).catch(() => {});

    // Open the real, unique workspace page in a new tab.
    if (typeof window !== 'undefined') {
      window.open(wsUrl, '_blank', 'noopener,noreferrer');
    }
    setShowWorkspaceModal(true);
  };

  const municipalNotices = computeMunicipalityNotices(profile);
  const completedMandatory = requirements.filter(r => r.mandatory && (r.status === 'uploaded' || r.status === 'passed')).length;
  const totalMandatory = requirements.filter(r => r.mandatory).length;
  const checklistProgress = totalMandatory > 0 ? Math.round((completedMandatory / totalMandatory) * 100) : 0;

  // Municipality-driven conditional questions are answered during intake.
  // Compare them with the deterministic rules output so we never ask about a
  // document that is already required for the selected business profile.
  const potentialItems = potentialItemsForProfile(
    profile,
    computeRequirements(profile, discoveryAnswers, potentialDecisions)
  );

  // Render one requirement row (shared by Mandatory + Recommended sections).
  // Pick a contextual document icon based on the requirement name/agency.
  const docIconFor = (name: string): React.ReactNode => {
    const n = name.toLowerCase();
    const cls = 'w-5 h-5';
    if (/(incorpor|corporat|registr.* state|estado|articles|charter)/.test(n)) return <Building2 className={cls} />;
    if (/merchant|comerciante/.test(n)) return <Store className={cls} />;
    if (/(ein|irs|tax|hacienda|contribu|iva|sales)/.test(n)) return <ReceiptText className={cls} />;
    if (/(permiso|permit|use|uso|zoning|ocup)/.test(n)) return <Landmark className={cls} />;
    if (/(coast|environment|ambient|water|agua|dredge)/.test(n)) return <Waves className={cls} />;
    if (/(insur|seguro|cfse|workers|comp)/.test(n)) return <ShieldCheck className={cls} />;
    if (/(affidavit|declar|certificat|certif|compliance|cumplim)/.test(n)) return <ScrollText className={cls} />;
    return <FileText className={cls} />;
  };


  // =========================================================================
  // VALIDADOR UI LAYER
  // Everything below is presentation only — business logic, API contracts,
  // rules-engine calls, document analysis, capture, and deliverable
  // generation above are unchanged.
  // =========================================================================

  // Requirements list filter (All / To Do / To Fill Out / Completed).
  const [reqFilter, setReqFilter] = useState<'all' | 'needs_action' | 'in_progress' | 'completed'>('all');
  const [otherReqExpanded, setOtherReqExpanded] = useState(false);

  // Live rules-engine output while the user is still in intake, so the
  // intelligence panel and progress stats update as they answer.
  const liveReqs = React.useMemo(() => {
    try {
      return computeRequirements(profile, discoveryAnswers, potentialDecisions);
    } catch {
      return [] as Requirement[];
    }
  }, [profile, discoveryAnswers, potentialDecisions]);

  const liveConfirmedPotentialItems = potentialItems.filter(
    (item) => potentialDecisions[item.flag] === 'applies'
  );

  const liveAgencies = Array.from(new Set([
    ...liveReqs.filter((requirement) => requirement.applicability !== 'not_applicable' && requirement.applicability !== 'conditional').map((requirement) => requirement.agency),
    ...liveConfirmedPotentialItems.map((item) => item.agency),
  ].filter(Boolean)));

  // Intake completion: 5 core profile fields + business and municipality
  // questions. All answers are collected before the checklist is generated.
  const intakeFieldsDone = [profile.name, profile.municipality, profile.industry, profile.business_type, profile.location_type].filter(Boolean).length;
  const answeredPotentialCount = potentialItems.filter((item) => potentialDecisions[item.flag]).length;
  // Totals count only questions SmartPR still needs. A question it can already
  // answer is not work the user has to do, so it must not inflate the progress
  // denominator either.
  const intakeQuestionTotal = guidedQuestions.length + potentialItems.length;
  const intakeTotal = 5 + intakeQuestionTotal;
  const intakeDone = intakeFieldsDone + guidedQuestionsAnswered + answeredPotentialCount;
  const intakePct = Math.round((intakeDone / Math.max(1, intakeTotal)) * 100);
  const baseProfileReady = Boolean(profile.name && profile.municipality && profile.industry && profile.business_type && profile.location_type);
  const intakeDisplayTotal = Math.max(7, intakeTotal);
  const intakeDisplayDone = intakeDone + (
    baseProfileReady && intakeDone === intakeTotal
      ? Math.max(0, intakeDisplayTotal - intakeTotal)
      : 0
  );

  const missingCount = requirements.filter(r => r.mandatory && r.status === 'pending').length;
  const reviewCount = requirements.filter(r => r.mandatory && r.status === 'warning').length;

  // Current view derives from the preserved step state machine so snapshots
  // and ?resume= links keep working. Historical document-step snapshots (7)
  // now resume in the consolidated requirements workspace.
  const view: FilingStage = currentStep === 1
    ? 'intake'
    : currentStep === 9
      ? 'deliverables'
      : 'requirements';
  const goTo = (nextView: FilingStage) => {
    if (nextView === 'intake') setCurrentStep(1);
    else if (nextView === 'requirements') setCurrentStep(3);
    else setCurrentStep(9);
  };

  // Switching stages swaps the whole main panel in place; without this the
  // browser keeps whatever scroll position the previous stage was at, so
  // intake -> requirements can land the user mid-page instead of at the top.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [view]);

  const ringScore = readinessScore !== null ? readinessScore : checklistProgress;

  // Canonical application profile — the shared business information entered once
  // during core intake, reused across every applicable government form. In-form
  // edits are captured in `canonicalOverride` (write-back); otherwise it is
  // derived from the SmartPR business profile.
  const canonicalApplication: CanonicalApplicationData = useMemo(() => {
    const base = buildCanonicalFromIntake({
      legalName: profile.name || '',
      business_structure: profile.business_structure,
      municipality: profile.municipality,
      employeeCount: profile.number_of_employees,
      formationStatus: profile.business_structure === 'foreign_corporation' ? 'formed_outside_puerto_rico' : undefined,
      forProfitStatus: profile.business_structure === 'nonprofit_nonstock_corporation' ? 'nonprofit' : undefined,
    });
    if (canonicalOverride) {
      // The override is authoritative for everything the user has entered
      // (Core Application Details + in-form write-back). Entity type always
      // follows the intake dropdown so routing stays consistent; formation
      // status follows the dropdown only for a foreign corporation.
      const entityType = base.business.entityType;
      const formationStatus = entityType === 'foreign_corporation' ? 'formed_outside_puerto_rico' : canonicalOverride.business.formationStatus;
      return {
        ...canonicalOverride,
        business: {
          ...canonicalOverride.business,
          entityType,
          formationStatus,
          legalName: canonicalOverride.business.legalName || base.business.legalName,
        },
      };
    }
    return base;
  }, [profile.name, profile.business_structure, profile.municipality, profile.number_of_employees, canonicalOverride]);

  // Older snapshots may predate entity-specific formation requirements, and a
  // user can also change the entity type after requirements were computed.
  // Repair only those deterministic formation rows, leaving the rest of the
  // rules-engine result untouched.
  useEffect(() => {
    if (!profile.business_structure || requirements.length === 0) return;
    const entityType = entityTypeFromLegacyStructure(profile.business_structure);
    setRequirements((current) => {
      const normalized = normalizeEntityFormationRequirements(entityType, current);
      const unchanged =
        normalized.length === current.length &&
        normalized.every((requirement, index) => requirement === current[index]);
      return unchanged ? current : normalized;
    });
  }, [profile.business_structure, requirements.length]);

  // Requirement ids currently present (from the rules engine output) plus any
  // deterministic entity-type formation requirements.
  const presentRequirementIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of requirements) if (r.document_id) ids.add(r.document_id);
    for (const aug of entityTypeRequirements<MinimalRequirement>(canonicalApplication, requirements, (d) => ({ document_id: d.document_id }))) {
      if (aug.document_id) ids.add(aug.document_id);
    }
    return ids;
  }, [requirements, canonicalApplication]);

  // Resolve the single applicable government-form entry for a requirement.
  const govFormEntryForReq = (req: Requirement) => {
    if (!req.document_id) return null;
    const entry = selectFormForRequirement(req.document_id, canonicalApplication, presentRequirementIds);
    if (!entry) return null;
    const template = getTemplate(entry.officialFormNumber);
    // Customer-facing builders must be backed by the agency's real PDF. Never
    // substitute a SmartPR-drawn worksheet for a missing government artifact.
    return template && isOfficialArtifact(template) ? entry : null;
  };

  // Resolve EVERY displayable government-form entry for a requirement — the
  // full package for multi-form requirements (EPA NPDES Form 1 + Form 2C),
  // a single entry otherwise. Same official-artifact gate as the singular
  // helper above.
  const govFormEntriesForReq = (req: Requirement): RegistryEntry[] => {
    if (!req.document_id) return [];
    const entries: RegistryEntry[] = [];
    for (const entry of selectEntriesForRequirement(req.document_id, canonicalApplication, presentRequirementIds)) {
      const template = getTemplate(entry.officialFormNumber);
      if (template && isOfficialArtifact(template)) entries.push(entry);
    }
    return entries;
  };

  const openGovForm = (formId: string, requirementCode: string, mode: 'edit' | 'view') => {
    setActiveGovForm({ formId, requirementCode, mode });
  };

  // Deep link from a business-profile requirement row
  // (?resume=<submissionId>&govForm=<registryEntryId>&req=<requirementCode>).
  // Once the resumed requirements load, re-verify the requirement still routes
  // to that official form on this client, then open it directly.
  const govFormDeepLinkOpenedRef = useRef(false);
  useEffect(() => {
    if (govFormDeepLinkOpenedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const formId = params.get("govForm");
    const reqCode = params.get("req");
    if (!formId || !reqCode || !requirements.length) return;
    const req = requirements.find((r) => r.code === reqCode);
    if (!req) return;
    const entry = govFormEntryForReq(req);
    if (!entry || entry.id !== formId) return;
    govFormDeepLinkOpenedRef.current = true;
    openGovForm(entry.id, req.code, "edit");
  }, [requirements]);

  // Derive the single primary action for a requirement card. Priority order
  // (never show two competing actions at once): completed > a SmartPR-guided
  // government form still in progress > a known external government step >
  // a plain document upload. `acceptsOfficialUpload === false` or a
  // conditional/review-condition requirement gets no action — those need the
  // user's answer, not a button, before SmartPR can say what's next.
  const computeReqCard = (req: Requirement) => {
    const doc = uploadedDocs.find(d => d.requirement_code === req.code);
    const analysis = doc?.ai_analysis;
    const ext: ExtractionResult | undefined = analysis?.extraction;
    let state: 'pending' | 'done' | 'review' = 'pending';
    if (ext) {
      state = ext.validation_result === 'PASS' ? 'done' : 'review';
    } else if (req.status === 'uploaded' || req.status === 'passed') {
      state = 'done';
    } else if (req.status === 'warning') {
      state = 'review';
    }
    const name = trReqName(req);
    const isConditional = req.applicability === 'conditional';
    const isReviewCondition = req.kind === 'review_condition';
    const canUpload = req.acceptsOfficialUpload !== false;

    // Two ways SmartPR can prepare a requirement for the user, in priority
    // order: (1) an official, code-backed government PDF it can prefill —
    // opens inside the SmartPR form experience; (2) failing that, SmartPR's
    // own preparation worksheet for well-known requirements (Certificate of
    // Incorporation, Merchant Registration, Permiso Único). Either way the
    // user never has to leave SmartPR to prepare the requirement — only an
    // agency's own review/issuance is outside SmartPR's control.
    const govEntry = govFormEntryForReq(req);
    // Multi-form package (today only the EPA NPDES Form 1 + Form 2C pair).
    // The card renders the whole package — never just the first form.
    const govEntries = govFormEntriesForReq(req);
    const isFormPackage = govEntries.length > 1;
    const prepared = govEntry ? preparedGovApplications[govEntry.id] : undefined;
    const hasDraft = govEntry ? !!govFormDrafts[govEntry.id] : false;
    const fState = govEntry ? requirementFormState(prepared) : null;
    const formActions = govEntry ? (fState === 'no_record' && hasDraft ? ['edit_form'] : actionsForFormState(fState!)) : [];

    const sampleDef = !govEntry ? getSampleApplication(req.code) : null;
    const sampleDraft = sampleDef ? sampleFormDrafts[req.code] : undefined;
    const samplePrepared = sampleDef ? preparedSampleApplications[req.code] : undefined;

    let action: RequirementAction;
    let secondary: RequirementSecondaryAction | undefined;
    let bucket: 'completed' | 'in_progress' | 'needs_action' | 'none';

    const secondaryUpload = (): RequirementSecondaryAction | undefined => {
      if (!canUpload) return undefined;
      const sc = secondaryUploadCopy(name, !!doc);
      return { prompt: L(sc.prompt, language), label: L(sc.label, language), onClick: () => triggerFileUploadWithPipeline(req.code) };
    };

    if (state === 'done') {
      action = { kind: 'completed', label: L('Completed', language) };
      bucket = 'completed';
    } else if (isConditional || isReviewCondition) {
      action = { kind: 'none', label: '' };
      bucket = 'none';
    } else if (isFormPackage) {
      // The NPDES application is filed as a package: the picker lists both
      // EPA forms with their own per-form progress.
      action = { kind: 'form', label: L(primaryStartLabelFor(name), language), onClick: () => setActiveGovPackage({ requirementCode: req.code }) };
      secondary = secondaryUpload();
      bucket = 'needs_action';
    } else if (govEntry && formActions.includes('start_form')) {
      action = { kind: 'form', label: L(primaryStartLabelFor(name), language), onClick: () => openGovForm(govEntry.id, req.code, 'edit') };
      secondary = secondaryUpload();
      bucket = 'needs_action';
    } else if (govEntry && formActions.includes('edit_form')) {
      action = { kind: 'form', label: L('Continue application', language), onClick: () => openGovForm(govEntry.id, req.code, 'edit') };
      secondary = secondaryUpload();
      bucket = 'in_progress';
    } else if (govEntry && formActions.includes('review_updates')) {
      action = { kind: 'form', label: L('Review updates', language), onClick: () => openGovForm(govEntry.id, req.code, 'edit') };
      secondary = secondaryUpload();
      bucket = 'in_progress';
    } else if (govEntry && (formActions.includes('view_submission') || formActions.includes('view_form'))) {
      action = { kind: 'waiting', label: L('Waiting for confirmation', language) };
      secondary = secondaryUpload();
      bucket = 'in_progress';
    } else if (sampleDef && samplePrepared) {
      action = { kind: 'form', label: L('Review submission', language), onClick: () => openSampleApplication(req.code) };
      secondary = secondaryUpload();
      bucket = 'in_progress';
    } else if (sampleDef && sampleDraft) {
      action = { kind: 'form', label: L('Continue application', language), onClick: () => openSampleApplication(req.code) };
      secondary = secondaryUpload();
      bucket = 'in_progress';
    } else if (sampleDef) {
      action = { kind: 'form', label: L(primaryStartLabelFor(name), language), onClick: () => openSampleApplication(req.code) };
      secondary = secondaryUpload();
      bucket = 'needs_action';
    } else if (!canUpload) {
      action = { kind: 'none', label: '' };
      bucket = 'none';
    } else {
      const uc = uploadOnlyCopy(name, !!doc);
      action = { kind: 'upload', label: L(uc.label, language), helper: uc.helper ? L(uc.helper, language) : undefined, onClick: () => triggerFileUploadWithPipeline(req.code) };
      bucket = 'needs_action';
    }

    const badge: RequirementBadge | null =
      state === 'done' ? null
      : isConditional ? { label: L('Needs verification', language), tone: 'gray' }
      : isReviewCondition ? { label: L('Review condition', language), tone: 'gray' }
      : req.mandatory ? { label: L('Required', language), tone: 'amber' }
      : { label: L('Optional', language), tone: 'gray' };

    const issuedDocumentGuidance = language === 'es'
      ? (ISSUED_DOCUMENT_GUIDANCE_ES[req.code] ?? ISSUED_DOCUMENT_GUIDANCE[req.code])
      : ISSUED_DOCUMENT_GUIDANCE[req.code];
    // A concise, user-facing explanation only — never the raw rule-engine
    // breakdown (factor weights, "Question = Answer" pairs, or unrelated
    // municipality context). That backend reasoning stays backend-only.
    //
    // Guidance resolves cited document-node concepts against the same engine
    // input and confirmed facts; unsupported rationale fails closed. Inside the
    // SAME "Why do I need this?" disclosure — no new panel/modal/drawer.
    const guidance = buildRequirementGuidance(
      { document_id: req.document_id, code: req.code, name, agency: req.agency, reason: trReqReason(req), applicability: req.applicability, triggerFacts: req.triggerFacts },
      { language, municipality: profile.municipality, businessTypeName: profile.business_type, discoveryAnswers,
        profile: profile as unknown as Record<string, unknown>, entityType: entityTypeFromLegacyStructure(profile.business_structure), occupancyType: canonicalApplication.property.occupancyType, kb: KB,
        engineInput: buildEngineInput({ ...profile, number_of_employees: profile.number_of_employees ?? undefined }, discoveryAnswers, resolveFactsFor(profile, discoveryAnswers).questionValues) }
    );
    const why = (
      <div className="rq-guidance">
        <div className="rq-guidance-block">
          <div className="rq-guidance-label">{L('Why you need this', language)}</div>
          <div>{guidance.whyThisApplies}</div>
        </div>
        <div className="rq-guidance-block">
          <div className="rq-guidance-label">{L('What this is', language)}</div>
          <div>{guidance.whatThisIs}</div>
        </div>
        <div className="rq-guidance-block">
          <div className="rq-guidance-label">{L("What you'll do", language)}</div>
          <div>{guidance.whatYouNeedToDo}</div>
        </div>
        <div className="rq-guidance-block">
          <div className="rq-guidance-label">{L('Then what?', language)}</div>
          <div>{guidance.whatHappensNext}</div>
        </div>
        {guidance.triggeredBy.length > 0 && (
          <div className="rq-guidance-triggers">
            {L('SmartPR identified this because:', language)}{' '}
            {guidance.triggeredBy.map((tag) => (
              <span key={tag} className="tag guidance">{tag}</span>
            ))}
          </div>
        )}
        <div className="rq-guidance-source">
          {guidance.sourceReferences.map((src, i) => (
            <span key={i}>{i > 0 ? ' · ' : ''}{src.agency} · {src.citation}</span>
          ))}
          {guidance.lastVerified && <span> · {L('Verified', language)} {guidance.lastVerified}</span>}
        </div>
        {issuedDocumentGuidance && (
          <div className="issued-document-guidance" style={{ marginTop: 8 }}>
            <Info className="i" style={{ width: 13, height: 13 }} />
            <span>{issuedDocumentGuidance}</span>
          </div>
        )}
      </div>
    );

    const extra = (
      <>
        {prepared && (
          <span className="tag" style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
            {fState === 'submitted' ? L('Marked as submitted', language) : L('Application prepared', language)}
          </span>
        )}
        {samplePrepared && (
          <span className="tag" style={{ background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0' }}>
            {L('Application worksheet prepared', language)}
          </span>
        )}
        {ext && analysis && (
          <ExtractionPanel ext={ext} docType={analysis.document_type} language={language} />
        )}
        {processingStates[req.code] && (
          <div style={{ marginTop: 8, padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 8, fontSize: 12 }}>
            {PROCESS_STAGES.map((lab, i) => {
              const p = processingStates[req.code]!;
              const done = i < p.stageIndex;
              const active = i === p.stageIndex;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, color: done ? 'var(--accent)' : active ? 'var(--brand-2)' : 'var(--muted)' }}>
                  {done ? '✓' : active ? <RefreshCw className="i" style={{ animation: 'spin 1s linear infinite' }} /> : '○'} {lab}
                </div>
              );
            })}
          </div>
        )}
        {(state === 'review' || reviewingCode === req.code) && analysis && (
          <div style={{ marginTop: 8, padding: 10, background: 'var(--warn-soft)', border: '1px solid var(--warn)', borderRadius: 8, fontSize: 13 }}>
            <div style={{ fontWeight: 600, color: 'var(--warn)' }}>AI Findings</div>
            <div style={{ marginTop: 4 }}>{analysis.notes || 'Required fields incomplete or mismatched per validation.'}</div>
            <button onClick={() => resolveAndMarkComplete(req.code)} style={{ marginTop: 6, fontSize: 12, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--warn)', background: 'white' }}>
              Resolve &amp; mark complete
            </button>
          </div>
        )}
      </>
    );
    const hasExtra = !!(prepared || samplePrepared || (ext && analysis) || processingStates[req.code] || ((state === 'review' || reviewingCode === req.code) && analysis));

    return {
      req, bucket, state,
      name,
      icon: docIconFor(name),
      iconTone: iconToneFor(name),
      agency: req.agency ? L(req.agency, language) : null,
      description: trReqReason(req),
      badge,
      why,
      action,
      secondary,
      extra: hasExtra ? extra : undefined,
      contextLabel: req.incentiveLabel ?? null,
    };
  };

  const reqCards = useMemo(
    () => requirements
      .filter(r => r.applicability !== 'not_applicable')
      .map(computeReqCard),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [requirements, uploadedDocs, processingStates, reviewingCode, preparedGovApplications, govFormDrafts, sampleFormDrafts, preparedSampleApplications, language, profile.municipality]
  );
  const tabNeedsActionCount = reqCards.filter(c => c.bucket === 'needs_action').length;
  const tabInProgressCount = reqCards.filter(c => c.bucket === 'in_progress').length;
  const tabCompletedCount = reqCards.filter(c => c.bucket === 'completed').length;

  const tabFilteredCards = reqCards.filter(c =>
    reqFilter === 'all' ? true
    : reqFilter === 'needs_action' ? c.bucket === 'needs_action'
    : reqFilter === 'in_progress' ? c.bucket === 'in_progress'
    : c.bucket === 'completed'
  );
  // Critical path: mandatory, not yet started, and not blocked on the user
  // answering a question first — the requirements standing between the user
  // and being ready to submit. Everything else in the current tab collapses
  // under "Other requirements" so the critical path dominates the page.
  const isCriticalPath = (c: (typeof reqCards)[number]) =>
    c.req.mandatory && c.bucket !== 'completed' && c.bucket !== 'none' && c.state === 'pending';
  const criticalPathCards = tabFilteredCards.filter(isCriticalPath);
  const otherCards = tabFilteredCards.filter(c => !isCriticalPath(c));

  // Contradictions only the user can settle. Clashes SmartPR resolved itself
  // (a derivation losing to a user answer) are deliberately not shown.
  const intakeConflicts = intakeFacts.conflicts.filter((c) => c.requiresUser);

  // Questions the interpreter answered, in the order they appear in the flow.
  const answeredFromDescription = questionList
    .filter((q) => aiPrefilledKeys.includes(q.id) && discoveryAnswers[q.id] !== undefined)
    .map((q) => ({ id: q.id, text: q.text, value: discoveryAnswers[q.id] as boolean | string }));

  /** Let the user correct something the interpreter got wrong. */
  const reopenAnsweredQuestion = (questionId: string) => {
    setAiPrefilledKeys((prev) => prev.filter((id) => id !== questionId));
    setDiscoveryAnswers((prev) => {
      const next = { ...prev };
      delete next[questionId];
      return next;
    });
    const index = questionList.findIndex((q) => q.id === questionId);
    if (index >= 0) setCurrentQuestionIndex(index);
  };

  const currentQuestion = activeQuestionIndex < questionList.length
    ? questionList[activeQuestionIndex]
    : null;
  const currentPotentialQuestion = !baseProfileReady || currentQuestion
    ? null
    : potentialItems.find((item) => !potentialDecisions[item.flag]) ?? null;
  const currentPotentialQuestionIndex = currentPotentialQuestion
    ? potentialItems.findIndex((item) => item.flag === currentPotentialQuestion.flag)
    : -1;
  const intakeQuestionsComplete = activeQuestionIndex >= questionList.length
    && answeredPotentialCount === potentialItems.length;
  const canGoBackInIntake = guidedQuestionsAnswered > 0 || answeredPotentialCount > 0;
  /** Last guided question before `start` that has a recorded manual answer. */
  const previousAnsweredQuestion = (start: number): number => {
    for (let i = Math.min(start, questionList.length) - 1; i >= 0; i--) {
      const questionId = questionList[i].id;
      if (!isQuestionPreAnswered(questionId) && discoveryAnswers[questionId] !== undefined) return i;
    }
    return -1;
  };
  const reopenManualQuestion = (index: number) => {
    const questionId = questionList[index]?.id;
    if (!questionId) return;
    setDiscoveryAnswers((previous) => {
      const next = { ...previous };
      delete next[questionId];
      return next;
    });
    setCurrentQuestionIndex(index);
  };
  const handleIntakeBack = () => {
    if (activeQuestionIndex < questionList.length) {
      const previous = previousAnsweredQuestion(activeQuestionIndex);
      if (previous >= 0) reopenManualQuestion(previous);
      return;
    }

    const lastAnsweredPotential = [...potentialItems]
      .reverse()
      .find((item) => potentialDecisions[item.flag]);
    if (lastAnsweredPotential) {
      setPotentialDecisions((previous) => {
        const next = { ...previous };
        delete next[lastAnsweredPotential.flag];
        return next;
      });
      return;
    }

    const lastAnswered = previousAnsweredQuestion(questionList.length);
    if (lastAnswered >= 0) reopenManualQuestion(lastAnswered);
  };

  const zipReadyDocs = uploadedDocs.filter(d => d.fileBlob);
  const verifiedIncentiveEvidenceTypeIds = useMemo(
    () => uploadedDocs.flatMap((document) =>
      typeof document.evidence_type_id === 'string' ? [document.evidence_type_id] : []
    ),
    [uploadedDocs]
  );
  const recordIncentiveAssessment = React.useCallback((assessment: IncentiveAssessment) => {
    setIncentiveAssessmentHistory((current) => {
      const previous = current.at(-1);
      if (previous?.catalogVersion === assessment.catalogVersion) {
        return [...current.slice(0, -1), assessment];
      }
      return [...current, assessment].slice(-10);
    });
  }, []);
  // Opens the workflow drawer for a result the user hasn't necessarily
  // chosen to pursue yet — "Review" from the sidebar or the full list.
  const handleReviewIncentive = React.useCallback((result: IncentiveEligibilityResult) => {
    setActiveIncentiveResult(result);
  }, []);
  // Actually committing to an incentive: marks it pursued, keeps the
  // workflow drawer open on it, and — the whole point — adds any document
  // that incentive's application needs and SmartPR doesn't already track
  // as a requirement, clearly labeled with the incentive that added it.
  const handlePursueIncentive = React.useCallback((result: IncentiveEligibilityResult) => {
    setPursuedIncentives((current) => {
      const existing = current.findIndex((item) => item.programId === result.programId);
      if (existing === -1) return [...current, result];
      const next = [...current];
      next[existing] = result; // keep the latest matched facts/status
      return next;
    });
    setActiveIncentiveResult(result);
    const known = new Set(requirements.map((r) => r.document_id).filter(Boolean));
    const newDocs = result.requiredSupportingEvidence.filter((doc) => !known.has(doc.id));
    setRequirements((current) => {
      const knownNow = new Set(current.map((r) => r.document_id).filter(Boolean));
      const additions: Requirement[] = result.requiredSupportingEvidence
        .filter((doc) => !knownNow.has(doc.id))
        .map((doc) => {
          const kbDoc = KB.documents.find((d) => d.id === doc.id);
          return {
            code: `incentive_${result.programId}_${doc.id}`.toLowerCase(),
            name: kbDoc?.name || doc.name,
            mandatory: false,
            status: 'pending' as const,
            agency: kbDoc?.agency || result.administeringAgency.name,
            reason: `Needed to apply for ${result.programName}.`,
            document_id: doc.id,
            category: kbDoc?.category || 'Incentive',
            applicability: 'required' as const,
            incentiveLabel: `${L('Added for', language)} ${result.programName}`,
          };
        });
      return additions.length ? [...current, ...additions] : current;
    });
    // Visible confirmation: the pursue action is otherwise only a subtle
    // footer badge swap inside the workflow panel.
    setUploadNotice({
      kind: 'success',
      title: language === 'es' ? `«${result.programName}» añadido` : `“${result.programName}” added`,
      detail: newDocs.length > 0
        ? (language === 'es'
            ? `Lo estás persiguiendo — ${newDocs.length} documento(s) de respaldo añadidos a tus requisitos.`
            : `You're now pursuing it — ${newDocs.length} supporting document(s) added to your requirements.`)
        : (language === 'es' ? 'Lo estás persiguiendo.' : `You're now pursuing it.`),
    });
  }, [language, requirements]);
  const handleRemovePursuedIncentive = React.useCallback((programId: string) => {
    setPursuedIncentives((current) => current.filter((item) => item.programId !== programId));
  }, []);
  const preparedSampleList = Object.values(preparedSampleApplications);
  const preparedGovList = Object.values(preparedGovApplications);
  const packageAssetCount = zipReadyDocs.length + preparedSampleList.length + preparedGovList.length;
  const activeSampleDefinition = activeSampleFormCode ? getSampleApplication(activeSampleFormCode) : null;
  const activeSampleData = activeSampleFormCode ? (sampleFormDrafts[activeSampleFormCode] || {}) : {};
  const deliverablesReady = totalMandatory > 0 && completedMandatory === totalMandatory;

  const intelligenceSignals: NonNullable<SmartPRLiveData['signals']> = [
    profile.business_type
      ? { label: language === 'es' ? `Tipo de negocio: ${profile.business_type}` : `Business type: ${profile.business_type}`, state: 'confirmed' }
      : { label: language === 'es' ? 'Se necesita el tipo de negocio' : 'Business type needed', state: 'needs-info' },
    profile.municipality
      ? { label: language === 'es' ? `Municipio: ${profile.municipality}` : `Municipality: ${profile.municipality}`, state: 'confirmed' }
      : { label: language === 'es' ? 'Se necesita el municipio' : 'Municipality needed', state: 'needs-info' },
    profile.location_type
      ? { label: language === 'es' ? `Ubicación: ${profile.location_type}` : `Location: ${profile.location_type}`, state: 'confirmed' as const }
      : { label: language === 'es' ? 'Se necesita el tipo de ubicación' : 'Physical location needed', state: 'needs-info' as const },
  ];
  if (profile.business_structure) {
    intelligenceSignals.push({
      label: language === 'es' ? `Entidad: ${profile.business_structure}` : `Entity: ${profile.business_structure}`,
      state: 'confirmed',
    });
  }
  if (profile.outdoor_seating === true || discoveryAnswers.outdoor_seating === true || discoveryAnswers.Q_OUTDOOR_SEATING === true) {
    intelligenceSignals.push({ label: language === 'es' ? 'Asientos al aire libre' : 'Outdoor seating', state: 'confirmed' });
  } else if (profile.outdoor_seating === false || discoveryAnswers.outdoor_seating === false) {
    intelligenceSignals.push({ label: language === 'es' ? 'Asientos al aire libre: no' : 'Outdoor seating: no', state: 'not-applicable' });
  }
  if (profile.alcohol_sold === true || discoveryAnswers.alcohol_sold === true || discoveryAnswers.Q_ALCOHOL_SOLD === true) {
    intelligenceSignals.push({ label: language === 'es' ? 'Venta de alcohol' : 'Alcohol sales', state: 'confirmed' });
  } else if (profile.alcohol_sold === false || discoveryAnswers.alcohol_sold === false) {
    intelligenceSignals.push({ label: language === 'es' ? 'Alcohol: no' : 'Alcohol: no', state: 'not-applicable' });
  }
  const liveRequired = liveReqs.filter((r) => r.applicability === 'required').length;
  const liveConditional = liveReqs.filter((r) => r.applicability === 'conditional').length;
  const liveFacts = intelligenceSignals.filter((s) => s.state === 'confirmed').length;
  const notApplicableDecision = potentialItems.find((item) => potentialDecisions[item.flag] === 'not_applies');
  if (notApplicableDecision) {
    intelligenceSignals.push({
      label: language === 'es' ? `${notApplicableDecision.document}: no aplica` : `${notApplicableDecision.document}: not applicable`,
      state: 'not-applicable',
    });
  }

  const nextIntakeAction = !profile.name
    ? (language === 'es' ? 'Ingresa el nombre legal o de trabajo del negocio.' : 'Enter the business name so this filing has a clear identity.')
    : !profile.municipality
      ? (language === 'es' ? 'Indica el municipio donde operará el negocio.' : 'Tell us which municipality the business will operate in.')
      : !profile.industry
        ? (language === 'es' ? 'Selecciona la industria del negocio.' : 'Select the business industry.')
        : !profile.business_type
          ? (language === 'es' ? 'Selecciona el tipo de negocio específico.' : 'Select the specific business type.')
          : !profile.location_type
            ? (language === 'es' ? 'Describe el tipo de ubicación física.' : 'Tell us what type of physical location the business will use.')
            : currentQuestion
              ? L(currentQuestion.text, language)
              : currentPotentialQuestion
                ? L(currentPotentialQuestion.followUp, language)
                : (language === 'es' ? 'Revisa el perfil y genera los requisitos.' : 'Review the profile, then generate the requirements.');

  const whyAsking = !profile.municipality
    ? (language === 'es' ? 'El municipio puede afectar licencias y permisos locales.' : 'Your municipality can affect local licensing and permitting requirements.')
    : !profile.location_type
      ? (language === 'es' ? 'La ubicación física puede activar permisos de uso, salud o seguridad.' : 'A physical location can trigger use, health, or safety permits.')
      : currentQuestion?.id.includes('alcohol') || currentPotentialQuestion?.flag.includes('alcohol')
        ? (language === 'es' ? 'La venta de alcohol puede activar licencias y requisitos de agencias adicionales.' : 'Selling alcohol can trigger additional licenses and agency requirements.')
        : currentPotentialQuestion
          ? L(currentPotentialQuestion.why, language)
          : (language === 'es' ? 'Cada respuesta reduce la incertidumbre antes de aplicar las reglas regulatorias.' : 'Each answer reduces uncertainty before the deterministic regulatory rules are applied.');

  const requirementsAgencies = Array.from(new Set(requirements.map((requirement) => requirement.agency).filter(Boolean)));
  const processingDocumentCount = Object.keys(processingStates).length;
  const criticalBlockers = findings.filter((finding) => finding.severity === 'critical').length;
  const remainingMandatory = Math.max(0, totalMandatory - completedMandatory);
  const stageIntelligence: SmartPRLiveData = view === 'intake' ? {
    statusText: intakeDone === 0
      ? (language === 'es' ? 'Creando tu perfil de cumplimiento…' : 'Building your compliance profile…')
      : intakeQuestionsComplete
        ? (language === 'es' ? 'Perfil inicial listo para evaluar.' : 'Initial profile ready for rules evaluation.')
        : (language === 'es' ? 'Aprendiendo sobre tu negocio…' : 'Learning about your business…'),
    progress: intakeDone > 0 ? intakePct : null,
    progressLabel: language === 'es' ? 'Contexto del negocio' : 'Business context',
    readiness: null,
    metrics: [
      { value: liveFacts, label: language === 'es' ? 'Hechos confirmados' : 'Facts understood', emphasis: true },
      { value: liveRequired, label: language === 'es' ? 'Requisitos por reglas' : 'Determined by rules', emphasis: liveRequired > 0 },
      { value: liveConditional, label: language === 'es' ? 'Por verificar' : 'Need verification' },
      { value: Math.max(0, intakeQuestionTotal - guidedQuestionsAnswered - answeredPotentialCount), label: language === 'es' ? 'Hechos pendientes' : 'Facts still needed' },
    ],
    agencies: liveAgencies,
    signals: intelligenceSignals,
    potentialRequirements: potentialItems
      .filter((item) => !potentialDecisions[item.flag])
      .map((item) => language === 'es' ? L(item.document, language) : item.document),
    nextAction: nextIntakeAction,
    whyAsking,
  } : view === 'requirements' ? {
    statusText: processingDocumentCount > 0
      ? (language === 'es' ? 'SmartPR está analizando evidencia…' : 'SmartPR is analyzing evidence…')
      : (language === 'es'
          ? 'Revisando requisitos y evidencia en un solo lugar.'
          : 'Reviewing requirements and evidence in one place.'),
    readiness: readinessScore,
    progress: readinessScore == null ? checklistProgress : null,
    progressLabel: language === 'es' ? 'Cobertura de requisitos y evidencia' : 'Requirements and evidence coverage',
    metrics: [
      { value: totalMandatory, label: language === 'es' ? 'Requeridos' : 'Required', emphasis: true },
      { value: uploadedDocs.length, label: language === 'es' ? 'Documentos cargados' : 'Documents uploaded', emphasis: uploadedDocs.length > 0 },
      { value: missingCount, label: language === 'es' ? 'Evidencia faltante' : 'Missing evidence' },
      { value: reviewCount + processingDocumentCount, label: language === 'es' ? 'Necesitan atención' : 'Need attention' },
    ],
    agencies: requirementsAgencies,
    signals: intelligenceSignals,
    nextAction: requirements.length === 0
      ? (language === 'es' ? 'Genera los requisitos desde el perfil del negocio.' : 'Generate requirements from the business profile.')
      : missingCount > 0
        ? (language === 'es' ? 'Carga evidencia oficial para el próximo requisito faltante.' : 'Upload official evidence for the next missing requirement.')
        : reviewCount > 0
          ? (language === 'es' ? 'Revisa los documentos marcados para atención.' : 'Review the documents marked as needing attention.')
          : (language === 'es' ? 'Ejecuta la validación final y revisa los entregables.' : 'Run final validation and review the deliverables.'),
  } : {
    statusText: deliverablesReady
      ? (language === 'es' ? 'El paquete está listo para revisión final.' : 'The package is ready for final review.')
      : (language === 'es' ? 'Preparando tus materiales de radicación.' : 'Preparing your filing materials.'),
    readiness: readinessScore,
    progress: readinessScore == null ? checklistProgress : null,
    progressLabel: language === 'es' ? 'Preparación del paquete' : 'Package readiness',
    metrics: [
      { value: completedMandatory, label: language === 'es' ? 'Requisitos satisfechos' : 'Requirements satisfied', emphasis: true },
      { value: remainingMandatory, label: language === 'es' ? 'Restantes' : 'Remaining' },
      { value: criticalBlockers, label: language === 'es' ? 'Bloqueos críticos' : 'Critical blockers' },
      { value: packageAssetCount, label: language === 'es' ? 'Archivos preparados' : 'Prepared files' },
    ],
    agencies: requirementsAgencies,
    signals: intelligenceSignals,
    nextAction: deliverablesReady
      ? (language === 'es' ? 'Revisa los materiales antes de radicar con las agencias.' : 'Review the prepared materials before filing with the agencies.')
      : (language === 'es' ? 'Regresa a requisitos y completa la evidencia faltante.' : 'Return to requirements and complete the missing evidence.'),
  };

  const availableStages: FilingStage[] = requirements.length > 0
    ? ['intake', 'requirements', 'deliverables']
    : ['intake'];
  const matterStatus = saveState === 'saved'
    ? (language === 'es' ? 'Guardado' : 'Saved')
    : currentStep === 1
      ? (language === 'es' ? 'Borrador' : 'Draft')
      : (language === 'es' ? 'En progreso' : 'In Progress');

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* Upload result toast (LLM document analysis feedback) */}
      {uploadNotice && (
        <div className="submit-toast show" role="status" style={{ maxWidth: 480 }}>
          <div className="check" style={{ background: uploadNotice.kind === 'success' ? 'var(--accent)' : uploadNotice.kind === 'warning' ? 'var(--warn)' : 'var(--danger)' }}>
            {uploadNotice.kind === 'success'
              ? <CheckCircle style={{ width: 12, height: 12, color: 'white' }} />
              : <AlertTriangle style={{ width: 12, height: 12, color: 'white' }} />}
          </div>
          <span>
            <b>{uploadNotice.title}</b>
            {uploadNotice.detail && <span style={{ opacity: 0.75, display: 'block', fontSize: 12 }}>{uploadNotice.detail}</span>}
          </span>
          <button onClick={() => setUploadNotice(null)} aria-label="Dismiss"
            style={{ background: 'transparent', border: 0, color: 'rgba(255,255,255,0.6)', cursor: 'pointer', marginLeft: 6 }}>✕</button>
        </div>
      )}

      <FilingWorkflowShell
        businessName={profile.name}
        businessId={businessId}
        municipality={profile.municipality}
        matterTitle={language === 'es' ? 'Formación de negocio nuevo' : 'New Business Formation'}
        matterStatus={matterStatus}
        stage={view}
        availableStages={availableStages}
        language={language}
        onLanguageChange={setLanguage}
        onStageChange={goTo}
        intelligence={stageIntelligence}
        sidebar={view === 'requirements' ? null : undefined}
        stickyHeader={view !== 'requirements'}
        stepperRight={view === 'requirements' ? (
          <ReadinessControl
            language={language}
            pct={ringScore}
            total={reqCards.length}
            completed={tabCompletedCount}
            needsAction={tabNeedsActionCount}
            inProgress={tabInProgressCount}
          />
        ) : undefined}
      >

      {/* ====================== INTAKE ====================== */}
      {view === 'intake' && (
          <section className="spr-intake-panel">
            <div className="spr-intake-scroll">
              <div className="spr-kicker">
                <span>{L('Business profile', language)}</span>
                <span aria-hidden="true">·</span>
                <span>{L('Discovery', language)}</span>
              </div>
              <h1>{language === 'en' ? 'Tell us about your business' : t('title')}</h1>
              {!me && (
                <p className="spr-guest-note">
                  {language === 'es'
                    ? 'Puede completar esta evaluación ahora. Crear una cuenta guarda el trabajo en la nube, permite varios negocios y reanudar en otro dispositivo.'
                    : 'You can complete this assessment now. Creating an account is required for cloud storage, multiple businesses, and resuming on another device.'}
                </p>
              )}
              <p className="spr-subtitle">
                {language === 'en'
                  ? 'Answer a few questions and we determine every Puerto Rico license, permit, certification and document you need.'
                  : t('subtitle')}
              </p>

              <div className="spr-form">
                {/* Optional shortcut: describe the business in plain language and
                    SmartPR fills in the fields it can confidently determine. The
                    guided fields below remain the source of truth. */}
                <NaturalLanguageIntake
                  kb={KB}
                  lang={language}
                  allowedIndustries={INDUSTRIES}
                  allowedLocationTypes={LOCATION_TYPES}
                  onApply={applyInterpretedIntake}
                />

                <div className="spr-field full">
                  <label htmlFor="spr-business-name">{t('businessName')}</label>
                  <input
                    id="spr-business-name"
                    placeholder={L('Your business name', language)}
                    value={profile.name}
                    onChange={e => setProfile({ ...profile, name: e.target.value })}
                    required
                  />
                </div>

                <div className="spr-field">
                  <label htmlFor="spr-municipality">{t('municipality')}</label>
                  <select
                    id="spr-municipality"
                    value={profile.municipality}
                    onChange={e => {
                      setProfile({ ...profile, municipality: e.target.value });
                      setPotentialDecisions({});
                    }}
                  >
                    <option value="">{t('selectMunicipality')}</option>
                    {municipalityOptions.map((m: string) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="spr-field">
                  <label htmlFor="spr-industry">{t('industry')}</label>
                  <select
                    id="spr-industry"
                    value={profile.industry}
                    onChange={e => handleIndustryChange(e.target.value)}
                  >
                    <option value="">{t('selectIndustry')}</option>
                    {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>

                <div className="spr-field">
                  <label htmlFor="spr-business-type">{t('businessType')}</label>
                  <select
                    id="spr-business-type"
                    key={profile.industry || 'none'}
                    value={profile.business_type}
                    onChange={e => {
                      const newBt = e.target.value;
                      const allowed = LOCATION_TYPES_BY_BUSINESS_TYPE[newBt] || LOCATION_TYPES;
                      const newLoc = allowed.includes(profile.location_type || '') ? profile.location_type : '';
                      setProfile({ ...profile, business_type: newBt, location_type: newLoc });
                    }}
                  >
                    <option value="">{t('selectBusinessType')}</option>
                    {(BUSINESS_TYPES[profile.industry] || [profile.industry || 'Other']).map(bt => (
                      <option key={bt} value={bt}>{bt}</option>
                    ))}
                  </select>
                </div>
                <div className="spr-field">
                  <label htmlFor="spr-location-type">{t('locationType')}</label>
                  <select id="spr-location-type" value={profile.location_type} onChange={e => setProfile({ ...profile, location_type: e.target.value })}>
                    <option value="">{t('selectLocationType')}</option>
                    {(LOCATION_TYPES_BY_BUSINESS_TYPE[profile.business_type] || LOCATION_TYPES).map(lt => (
                      <option key={lt} value={lt}>{lt}</option>
                    ))}
                  </select>
                </div>

                <div className="spr-field spr-field-static">
                  <label htmlFor="spr-structure">{t('businessStructure')}</label>
                  <select id="spr-structure" value={profile.business_structure} onChange={e => setProfile({ ...profile, business_structure: e.target.value })}>
                    <option value="">{L('Select entity type', language)}</option>
                    <option value="corporation">{L('Stock corporation', language)}</option>
                    <option value="nonprofit_nonstock_corporation">{L('Nonprofit non-stock corporation', language)}</option>
                    <option value="close_corporation">{L('Close / intimate corporation', language)}</option>
                    <option value="professional_corporation">{L('Professional corporation', language)}</option>
                    <option value="foreign_corporation">{L('Foreign corporation seeking authorization in Puerto Rico', language)}</option>
                    <option value="limited_liability_partnership">{L('Limited liability partnership', language)}</option>
                    <option value="llc">{L('Limited liability company (LLC)', language)}</option>
                    <option value="sole_proprietorship">{L('Sole proprietorship', language)}</option>
                    <option value="partnership">{L('Partnership', language)}</option>
                    <option value="other">{L('Other / not sure', language)}</option>
                  </select>
                </div>
                <div className="spr-field">
                  <label htmlFor="spr-employees">{t('numEmployees')}</label>
                  <input
                    id="spr-employees"
                    type="number"
                    min="0"
                    max="10000"
                    placeholder="0"
                    // Empty (not 0) when unset, otherwise a typed "10" lands
                    // after the rendered zero and reads as "010".
                    value={profile.number_of_employees ?? ''}
                    onChange={e => {
                      const raw = e.target.value;
                      if (raw === '') {
                        setProfile({ ...profile, number_of_employees: null });
                        return;
                      }
                      const parsed = parseInt(raw, 10);
                      if (Number.isNaN(parsed)) return;
                      setProfile({ ...profile, number_of_employees: Math.min(10000, Math.max(0, parsed)) });
                    }}
                  />
                </div>
              </div>

              {/* Questions already answered from the description — shown as
                  completed so the user can see what was understood (and change
                  it) instead of silently losing them. */}
              {answeredFromDescription.length > 0 && (
                <div className="spr-answered">
                  <div className="spr-kicker">
                    {L('Answered from your description', language)} · {answeredFromDescription.length}
                  </div>
                  <ul className="spr-answered-list">
                    {answeredFromDescription.map((item) => (
                      <li key={item.id}>
                        <CheckCircle className="i" style={{ width: 14, height: 14 }} />
                        <span className="spr-answered-text">{L(item.text, language)}</span>
                        <span className="spr-answered-value">
                          {item.value === true ? t('yes') : item.value === false ? t('no') : String(item.value)}
                        </span>
                        <button
                          type="button"
                          className="spr-answered-change"
                          onClick={() => reopenAnsweredQuestion(item.id)}
                        >
                          {L('Change', language)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Two things the user told us cannot both be true. SmartPR never
                  picks a winner between explicit answers — it says what clashes
                  and lets them correct it. */}
              {intakeConflicts.length > 0 && (
                <div className="spr-conflicts">
                  <div className="spr-kicker">
                    {L('Please check these answers', language)} · {intakeConflicts.length}
                  </div>
                  <ul className="spr-conflicts-list">
                    {intakeConflicts.map((conflict) => (
                      <li key={conflict.id}>
                        <AlertTriangle className="i" style={{ width: 14, height: 14 }} />
                        <span className="spr-answered-text">{L(conflict.message, language)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {currentQuestion && (
                <IntakeQuestion
                  language={language}
                  questionNumber={activeGuidedQuestionNumber}
                  questionTotal={intakeQuestionTotal}
                  title={L(currentQuestion.text, language)}
                  contextTitle={currentQuestion.whyWeAsk ? L("Why we ask", language) : undefined}
                  contextBody={currentQuestion.whyWeAsk ? L(currentQuestion.whyWeAsk, language) : undefined}
                  options={currentQuestion.options?.map((option) => ({ value: option.value, label: L(option.label, language) }))}
                  onAnswer={(value) => handleQuestionAnswer(value)}
                />
              )}

              {currentPotentialQuestion && (
                <IntakeQuestion
                  language={language}
                  questionNumber={guidedQuestions.length + currentPotentialQuestionIndex + 1}
                  questionTotal={intakeQuestionTotal}
                  title={L(currentPotentialQuestion.followUp, language)}
                  contextTitle={L(currentPotentialQuestion.document, language)}
                  contextBody={L(currentPotentialQuestion.why, language)}
                  onAnswer={(value) => handlePotentialAnswer(currentPotentialQuestion, value === true ? "applies" : "not_applies")}
                  onNotSure={() => handlePotentialAnswer(currentPotentialQuestion, "not_sure")}
                />
              )}
            </div>

            {baseProfileReady && intakeQuestionsComplete && (
              <div style={{ margin: '4px 0 8px', borderTop: '1px solid var(--border, #e2e8f0)', paddingTop: 12 }}>
                <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 8px' }}>{L('Core Application Details', language)}</h3>
                <CoreApplicationDetails
                  canonical={canonicalApplication}
                  lang={language}
                  onChange={(next) => setCanonicalOverride(next)}
                />
              </div>
            )}

            <div className="spr-form-footer">
              <span>{intakeDisplayDone}/{intakeDisplayTotal} {L('completed', language)}</span>
              <div className="spr-form-actions">
                {canGoBackInIntake && (
                  <button className="spr-back" onClick={handleIntakeBack}>{L('Back', language)}</button>
                )}
                <button
                  className="spr-primary"
                  onClick={handleStartDiscovery}
                  disabled={!baseProfileReady || !intakeQuestionsComplete || isLoading}
                >
                  {L('See my requirements', language)}
                  {isLoading ? <RefreshCw className="i spr-spin" /> : <ArrowRight className="i" />}
                </button>
              </div>
            </div>
          </section>

      )}

      {/* ====================== REQUIREMENTS ====================== */}
      {view === 'requirements' && (
        <main className="shell">
          <button className="section-back" onClick={() => goTo('intake')}>
            ← {L('Back to intake', language)}
          </button>

          {/* Page head — Step 2 of 3 */}
          <div className="rq-page-head">
            <h1>{L('Requirements', language)}</h1>
            <p>{L('Step 2 of 3 — SmartPR shows you what you need and what to do next.', language)}</p>
          </div>

          {activeIncentiveResult && (
            <IncentiveWorkflowPanel
              result={activeIncentiveResult}
              language={language}
              knownRequirements={requirements}
              pursued={pursuedIncentives.some((item) => item.programId === activeIncentiveResult.programId)}
              onPursue={handlePursueIncentive}
              onRemove={(programId) => { handleRemovePursuedIncentive(programId); setActiveIncentiveResult(null); }}
              onClose={() => setActiveIncentiveResult(null)}
            />
          )}

          <div className="spr-requirements-layout">
          <div className="spr-requirements-main">
          {/* Filter tabs */}
          <div className="rq-tabs" role="tablist">
            <button role="tab" aria-selected={reqFilter === 'all'} className={`rq-tab ${reqFilter === 'all' ? 'active' : ''}`} onClick={() => setReqFilter('all')}>
              {L('All', language)} <span className="rq-tab-count">{reqCards.length}</span>
            </button>
            <button role="tab" aria-selected={reqFilter === 'needs_action'} className={`rq-tab ${reqFilter === 'needs_action' ? 'active' : ''}`} onClick={() => setReqFilter('needs_action')}>
              {L('Needs Action', language)} <span className="rq-tab-count">{tabNeedsActionCount}</span>
            </button>
            <button role="tab" aria-selected={reqFilter === 'in_progress'} className={`rq-tab ${reqFilter === 'in_progress' ? 'active' : ''}`} onClick={() => setReqFilter('in_progress')}>
              {L('In Progress', language)} <span className="rq-tab-count">{tabInProgressCount}</span>
            </button>
            <button role="tab" aria-selected={reqFilter === 'completed'} className={`rq-tab ${reqFilter === 'completed' ? 'active' : ''}`} onClick={() => setReqFilter('completed')}>
              {L('Completed', language)} <span className="rq-tab-count">{tabCompletedCount}</span>
            </button>
          </div>

          {requirements.length === 0 && (
            <div style={{ padding: 24 }}>
              <button className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center' }} onClick={loadRequirements}>
                {L('Compute Requirements from Rules Engine', language)} <ArrowRight className="i" style={{ width: 14, height: 14 }} />
              </button>
            </div>
          )}

          {/* Prominent Attention banner — surfaces AI findings at the top */}
          {(() => {
            const reviewItems = requirements.filter(r => r.mandatory && r.status === 'warning');
            if (reviewItems.length === 0) return null;
            return (
              <div style={{ margin: '16px 0', padding: 14, background: 'var(--warn-soft)', border: '1px solid var(--warn)', borderRadius: 'var(--radius)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <AlertTriangle className="i-lg" style={{ color: 'var(--warn)', marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, color: 'var(--warn)' }}>⚠ Attention Required</div>
                  <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>
                    {reviewItems.slice(0, 3).map((r, i) => (
                      <div key={i}>• {trReqName(r)} — review findings in the card below</div>
                    ))}
                  </div>
                  <button onClick={() => {
                    const f = reviewItems[0];
                    setOtherReqExpanded(true);
                    setReviewingCode(f.code);
                    requestAnimationFrame(() => {
                      document.getElementById(`req-row-${f.code}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    });
                  }} style={{ marginTop: 8, fontSize: 13, padding: '4px 12px', borderRadius: 8, background: 'var(--warn)', color: 'white', border: 'none', cursor: 'pointer' }}>
                    {L('Review now', language)}
                  </button>
                </div>
              </div>
            );
          })()}

          {/* Critical path — the page's main focus. Full real estate, no
              per-item explanatory copy, always shown for the active tab. */}
          {criticalPathCards.length > 0 && (
            <>
              <div className="rq-critical-head">
                <Star size={13} /> {L('CRITICAL PATH — HANDLE THESE NEXT', language)}
                <span className="rq-critical-count">{criticalPathCards.length}</span>
              </div>
              <p className="rq-critical-sub">{L('These requirements are blocking your ability to move forward.', language)}</p>
            </>
          )}

          <div className="rq-list">
            {criticalPathCards.map((c, i) => (
              <RequirementCard
                key={c.req.code}
                id={`req-row-${c.req.code}`}
                index={i + 1}
                icon={c.icon}
                iconTone={c.iconTone}
                name={c.name}
                agency={c.agency}
                description={c.description}
                badge={c.badge}
                whyLabel={L('Why do I need this?', language)}
                why={c.why}
                action={c.action}
                secondary={c.secondary}
                extra={c.extra}
                contextLabel={c.contextLabel}
              />
            ))}
          </div>

          {otherCards.length > 0 && (
            <>
              <button
                type="button"
                className={`rq-other-toggle ${otherReqExpanded ? 'expanded' : ''}`}
                onClick={() => setOtherReqExpanded((value) => !value)}
                aria-expanded={otherReqExpanded}
              >
                {L('OTHER REQUIREMENTS', language)} ({otherCards.length}) <ChevronDown size={15} />
              </button>
              {otherReqExpanded && (
                <div className="rq-list">
                  {otherCards.map((c, i) => (
                    <RequirementCard
                      key={c.req.code}
                      id={`req-row-${c.req.code}`}
                      index={criticalPathCards.length + i + 1}
                      icon={c.icon}
                      iconTone={c.iconTone}
                      name={c.name}
                      agency={c.agency}
                      description={c.description}
                      badge={c.badge}
                      whyLabel={L('Why do I need this?', language)}
                      why={c.why}
                      action={c.action}
                      secondary={c.secondary}
                      extra={c.extra}
                      contextLabel={c.contextLabel}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Recommendation panel — advisory historical insights (never mandatory) */}
          {advisory && advisory.enabled && advisory.similarCount > 0 &&
            (advisory.potentiallyOverlooked.length > 0 || advisory.commonValidationFailures.length > 0) && (
            <div className="rq-recommendations">
              <Sparkles size={16} className="rq-recommendations-icon" />
              <div>
                <strong>{L('Recommendations', language)}</strong>
                <p>{L('Based on', language)} {advisory.similarCount} {L('similar businesses processed before. Suggestions only — these never change what the rules require.', language)}</p>
              </div>
            </div>
          )}

          {/* Municipal notices */}
          {municipalNotices.length > 0 && (
            <div style={{ marginTop: 16 }}>
              {municipalNotices.map((n, i) => (
                <div key={i} className="reco">
                  <div className="reco-ic zone"><Landmark className="i" /></div>
                  <div className="reco-text"><b>{L('Municipal Notices', language)} — {profile.municipality}</b><small>{L(n, language)}</small></div>
                </div>
              ))}
            </div>
          )}

          {/* Findings (validation results) */}
          {findings.length > 0 && (
            <div className="req-section" style={{ marginTop: 16 }}>
              <div className="req-head">
                <div className="left"><h2 style={{ fontSize: 20 }}>{L('Findings', language)}</h2></div>
              </div>
              <div style={{ padding: '16px 20px' }}>
                {findings.map((f, i) => (
                  <div key={i} className="reco">
                    <div className={`reco-ic ${f.severity === 'critical' ? 'fire' : f.severity === 'warning' ? 'tax' : 'zone'}`}>
                      <AlertTriangle className="i" />
                    </div>
                    <div className="reco-text">
                      <b>{L(f.title, language)}</b>
                      <small>{L(f.description, language)} → {L(f.recommended_action, language)}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="helpbar">
            <div className="help-ic"><Info className="i-lg i" /></div>
            <div className="help-text">
              <b>{L('Focus on the missing items first.', language)}</b>
              <small>{L('They move your readiness score the most and unblock everything downstream.', language)}</small>
            </div>
            <div className="help-cta" style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={() => goTo('deliverables')}>
                {L('Continue to deliverables', language)} <ArrowRight className="i" style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>
          </div>

          <div className="spr-requirements-sidebar">
            <IncentivesSidebar
              profile={profile}
              facts={incentiveFacts}
              language={language}
              initialAssessment={incentiveAssessmentHistory.at(-1) ?? null}
              pursuedIncentives={pursuedIncentives}
              onAssessmentChange={recordIncentiveAssessment}
              onFactChange={(key, value) => setIncentiveFacts((current) => ({ ...current, [key]: value }))}
              onReview={handleReviewIncentive}
              onRemovePursued={handleRemovePursuedIncentive}
            />
          </div>
          </div>

          <SmartPRChatbot
            profile={profile}
            requirements={requirements}
            language={language}
          />
        </main>
      )}

      {/* ====================== DELIVERABLES ====================== */}
      {view === 'deliverables' && (
        <main className="shell">
          <button className="section-back" onClick={() => goTo('requirements')}>
            ← {L('Back to requirements', language)}
          </button>

          <div className="section-head">
            <div>
              <h2>{L('SUBMISSION DELIVERABLES', language)}</h2>
              <p>{L('All validated materials are ready. This platform prepares you for submission — it does not file with government.', language)}</p>
            </div>
            <span className={`pkg-status-pill ${deliverablesReady && (readinessScore || 0) >= 70 ? 'ready' : 'missing'}`} style={{ marginLeft: 0 }}>
              {deliverablesReady && (readinessScore || 0) >= 70 ? L('READY FOR SUBMISSION', language) : L('IN PROGRESS — REVIEW REQUIRED', language)}
            </span>
          </div>

          {/* Business summary banner */}
          <div className="req-banner" style={{ marginBottom: 20 }}>
            <div className="mini-ring" style={{ ['--p' as string]: readinessScore ?? 0 }}>
              <div className="num">{readinessScore ?? '—'}{readinessScore !== null ? '%' : ''}</div>
            </div>
            <div className="headline">
              <div className="eyebrow">{L('Readiness Score', language)}</div>
              <h1>{profile.name || '—'}</h1>
              <p>{completedMandatory} {L('of', language)} {totalMandatory} {L('Required Documents Validated', language)}{findings.filter(f => f.severity === 'critical').length === 0 && missingCount === 0 ? ` · ${L('No Critical Issues Found', language)}` : missingCount > 0 ? ` · ${missingCount} ${L('still missing', language)}` : ''}</p>
            </div>
            <div className="banner-stat">
              <div className="lab">{t('municipality')}</div>
              <div className="val" style={{ fontSize: 15 }}>{profile.municipality || '—'}</div>
            </div>
            <div className="banner-stat">
              <div className="lab">{t('businessType')}</div>
              <div className="val" style={{ fontSize: 15 }}>{profile.business_type || '—'}</div>
            </div>
            <div className="banner-stat">
              <div className="lab">{L('Documents', language)}</div>
              <div className="val">{uploadedDocs.length + preparedSampleList.length}</div>
            </div>
          </div>

          <div className="packages">
            {/* 1. PDF Readiness Report */}
            <div className="pkg indigo">
              <div className="pkg-head">
                <div className="pkg-ic"><FileText className="i-lg i" /></div>
                <div>
                  <div className="pkg-title">{L('Readiness Report (PDF)', language)}</div>
                  <div className="pkg-sub">{L('Human-readable summary for your records, attorney, or consultant.', language)}</div>
                </div>
                <span className="pkg-status-pill ready">{L('Ready', language)}</span>
              </div>
              <div className="pkg-list">
                <div className="pkg-item ok"><span className="ic"><CheckCircle className="i" style={{ width: 13, height: 13 }} /></span>{L('Business profile & readiness score', language)}</div>
                <div className="pkg-item ok"><span className="ic"><CheckCircle className="i" style={{ width: 13, height: 13 }} /></span>{L('Required, uploaded & missing documents', language)}</div>
                <div className="pkg-item ok"><span className="ic"><CheckCircle className="i" style={{ width: 13, height: 13 }} /></span>{L('Findings & recommended next steps', language)}</div>
              </div>
              <div className="pkg-foot">
                <span className="pkg-sub">{language === 'es' ? 'Español' : 'English'} · PDF</span>
                <button className="btn btn-primary" style={{ padding: '8px 14px', fontSize: 13 }} onClick={previewReadinessReport} disabled={isLoading}>
                  <Eye className="i" style={{ width: 14, height: 14 }} /> {L('Preview PDF Report', language)}
                </button>
              </div>
            </div>

            {/* 2. Prepared sample applications */}
            <div className="pkg purple">
              <div className="pkg-head">
                <div className="pkg-ic"><FileText className="i-lg i" /></div>
                <div>
                  <div className="pkg-title">{L('Prepared Application Worksheets', language)}</div>
                  <div className="pkg-sub">{L('Fillable preparation drafts. Official agency-issued documents are still required.', language)}</div>
                </div>
                <span className={`pkg-status-pill ${preparedSampleList.length + preparedGovList.length > 0 ? 'ready' : 'missing'}`}>
                  {preparedSampleList.length + preparedGovList.length > 0 ? `${preparedSampleList.length + preparedGovList.length} ${L('Prepared', language)}` : L('None prepared', language)}
                </span>
              </div>
              <div className="pkg-list">
                {preparedSampleList.length + preparedGovList.length === 0 ? (
                  <div className="pkg-item missing">
                    <span className="ic"><AlertTriangle className="i" style={{ width: 13, height: 13 }} /></span>
                    {L('Return to the checklist and choose Prepare application.', language)}
                  </div>
                ) : preparedSampleList.map((application) => (
                  <div key={application.requirementCode} className="pkg-item ok prepared-application-item">
                    <span className="ic"><CheckCircle className="i" style={{ width: 13, height: 13 }} /></span>
                    <span>{application.title}<small>{L('Draft — official output still required', language)}</small></span>
                    <button className="btn btn-secondary" onClick={() => previewPreparedSampleApplication(application)}>
                      <Eye className="i" style={{ width: 13, height: 13 }} /> {L('PDF', language)}
                    </button>
                  </div>
                ))}
                {/* Schema-driven government applications (CORPREG01–CORPREG06). */}
                {Object.values(preparedGovApplications).map((app) => (
                  <div key={app.id} className="pkg-item ok prepared-application-item">
                    <span className="ic"><CheckCircle className="i" style={{ width: 13, height: 13 }} /></span>
                    <span>{app.officialFormNumber} — {app.title}
                      <small>{app.status === 'needs_refresh'
                        ? L('Needs refresh — shared data changed', language)
                        : app.status === 'submitted'
                          ? L('Marked as submitted — official evidence still required', language)
                          : L('Application prepared — official evidence still required', language)}</small>
                    </span>
                    <button className="btn btn-secondary" onClick={() => openGovForm(app.formId, app.requirementId, 'view')}>
                      <FileText className="i" style={{ width: 13, height: 13 }} /> {L('View', language)}
                    </button>
                  </div>
                ))}
              </div>
              <div className="pkg-foot">
                <span className="pkg-sub">{L('Included in the Submission Package ZIP', language)}</span>
                <button className="btn btn-secondary" onClick={() => goTo('requirements')}>{L('Prepare another', language)}</button>
              </div>
            </div>

            {/* 3. Submission Package ZIP */}
            <div className="pkg green">
              <div className="pkg-head">
                <div className="pkg-ic"><Archive className="i-lg i" /></div>
                <div>
                  <div className="pkg-title">{L('Submission Package (ZIP)', language)}</div>
                  <div className="pkg-sub">{L('Report + validated documents, renamed and sorted in submission order.', language)}</div>
                </div>
                <span className={`pkg-status-pill ${packageAssetCount > 0 ? 'ready' : 'missing'}`}>
                  {packageAssetCount > 0 ? L('Ready', language) : L('Waiting', language)}
                </span>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12.5, color: 'var(--muted)' }}>
                  <span>{L('Package readiness', language)}</span>
                  <b style={{ color: 'var(--ink)', fontWeight: 650 }}>{checklistProgress}%</b>
                </div>
                <div className="pkg-bar"><span style={{ width: `${checklistProgress}%` }} /></div>
              </div>
              <div className="pkg-list">
                {preparedSampleList.slice(0, 3).map((application) => (
                  <div key={application.requirementCode} className="pkg-item ok">
                    <span className="ic"><CheckCircle className="i" style={{ width: 13, height: 13 }} /></span>
                    {application.title}
                  </div>
                ))}
                {zipReadyDocs.slice(0, 4).map((d, i) => (
                  <div key={i} className="pkg-item ok">
                    <span className="ic"><CheckCircle className="i" style={{ width: 13, height: 13 }} /></span>
                    {d.ai_analysis?.document_type || d.name}
                  </div>
                ))}
                {requirements.filter(r => r.mandatory && r.status === 'pending').slice(0, Math.max(0, 4 - zipReadyDocs.length) + 2).map(r => (
                  <div key={r.code} className="pkg-item missing">
                    <span className="ic"><AlertTriangle className="i" style={{ width: 13, height: 13 }} /></span>
                    {trReqName(r)}
                    <span className="miss-label">{L('Missing', language)}</span>
                  </div>
                ))}
              </div>
              <div className="pkg-foot">
                <span className="pkg-sub">{packageAssetCount} {L('files', language)}</span>
                <button className="btn btn-primary" style={{ padding: '8px 14px', fontSize: 13 }} onClick={downloadSubmissionPackage} disabled={isLoading || packageAssetCount === 0}>
                  <Download className="i" style={{ width: 14, height: 14 }} /> {L('Download ZIP Package', language)}
                </button>
              </div>
            </div>

            {/* 4. Workspace */}
            <div className="pkg purple">
              <div className="pkg-head">
                <div className="pkg-ic"><Building2 className="i-lg i" /></div>
                <div>
                  <div className="pkg-title">{L('Workspace', language)}</div>
                  <div className="pkg-sub">{L('Permanent, shareable link to your readiness workspace.', language)}</div>
                </div>
                <span className="pkg-status-pill draft">{L('Shareable', language)}</span>
              </div>
              <div className="pkg-list">
                <div className="pkg-item ok"><span className="ic"><CheckCircle className="i" style={{ width: 13, height: 13 }} /></span>{L('Profile & questionnaire responses', language)}</div>
                <div className="pkg-item ok"><span className="ic"><CheckCircle className="i" style={{ width: 13, height: 13 }} /></span>{L('Requirements & validation results', language)}</div>
                <div className="pkg-item ok"><span className="ic"><CheckCircle className="i" style={{ width: 13, height: 13 }} /></span>{L('Renders anywhere without a login', language)}</div>
              </div>
              <div className="pkg-foot">
                <span className="pkg-sub" style={{ fontFamily: 'monospace', fontSize: 11 }}>{activeWorkspaceId ? `/workspace/${activeWorkspaceId}` : '/workspace/…'}</span>
                <button className="btn btn-accent" style={{ padding: '8px 14px', fontSize: 13 }} onClick={openSmartPRWorkspace}>
                  {L('Open Workspace', language)} <ExternalLink className="i" style={{ width: 14, height: 14 }} />
                </button>
              </div>
            </div>
          </div>

          {/* Official disclaimer */}
          <div className="disclaimer">
            <b>{L('IMPORTANT DISCLAIMER — READ CAREFULLY', language)}</b>
            <ul>
              <li>{L('Do NOT submit this package or any SmartPR output to government agencies as an official filing.', language)}</li>
              <li>{L('Do NOT claim that SmartPR approves, grants, or issues any license or permit.', language)}</li>
              <li>{L('Do NOT file permits or applications using these materials as the sole source.', language)}</li>
              <li>{L('SmartPR is a', language)} <strong>{L('readiness and compliance preparation platform', language)}</strong>, {L('not a government filing system.', language)}</li>
              <li>{L('All final approvals are made exclusively by the Government of Puerto Rico and its agencies.', language)}</li>
            </ul>
          </div>

          <div className="helpbar">
            <div className="help-ic"><RefreshCw className="i-lg i" /></div>
            <div className="help-text">
              <b>{L('Need to make changes?', language)}</b>
              <small>{L('Go back to requirements to upload more evidence, or edit the business profile.', language)}</small>
            </div>
            <div className="help-cta" style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary" onClick={() => goTo('requirements')}>← {L('Back to requirements', language)}</button>
              <button className="btn btn-secondary" onClick={() => goTo('intake')}>{L('Edit business profile', language)}</button>
            </div>
          </div>
        </main>
      )}
      </FilingWorkflowShell>

      {/* Multi-form package picker (today: the EPA NPDES Form 1 + Form 2C
          package). Lists every form in the package with its own progress so
          the requirement never silently routes to just one form. */}
      {activeGovPackage && (() => {
        const pkgReq = requirements.find((r) => r.code === activeGovPackage.requirementCode);
        const pkgEntries = pkgReq ? govFormEntriesForReq(pkgReq) : [];
        if (!pkgReq || pkgEntries.length === 0) return null;
        const close = () => setActiveGovPackage(null);
        return (
          <div role="dialog" aria-modal="true" data-requirement={pkgReq.code} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", zIndex: 1000, display: "flex", alignItems: "flex-start", justifyContent: "center", overflowY: "auto", padding: "24px 12px" }} onClick={close}>
            <div style={{ background: "var(--surface, white)", borderRadius: 12, maxWidth: 640, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={(e) => e.stopPropagation()}>
              <div style={{ padding: "16px 20px", borderBottom: "1px solid #e2e8f0" }}>
                <h2 style={{ fontSize: 18, margin: "0 0 6px" }}>{L("EPA NPDES permit package", language)}</h2>
                <p style={{ fontSize: 13, color: "#475569", margin: 0 }}>
                  {L("The NPDES application is two EPA forms filed together. Complete both, then print, hand-sign, and submit the package to EPA Region 2.", language)}
                </p>
              </div>
              <div style={{ padding: "12px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
                {pkgEntries.map((pkgEntry) => {
                  const pkgDef = getDefinition(pkgEntry.id);
                  const prepared = preparedGovApplications[pkgEntry.id];
                  const hasDraft = !!govFormDrafts[pkgEntry.id];
                  const pkgState = requirementFormState(prepared);
                  const pkgActions = pkgState === "no_record" && hasDraft ? ["edit_form"] : actionsForFormState(pkgState);
                  const open = (mode: "edit" | "view") => {
                    close();
                    openGovForm(pkgEntry.id, pkgReq.code, mode);
                  };
                  let btnLabel: string;
                  let btnMode: "edit" | "view";
                  if (pkgActions.includes("start_form")) { btnLabel = L("Start form", language); btnMode = "edit"; }
                  else if (pkgActions.includes("review_updates")) { btnLabel = L("Review updates", language); btnMode = "edit"; }
                  else if (pkgActions.includes("edit_form")) { btnLabel = L("Continue application", language); btnMode = "edit"; }
                  else { btnLabel = L("View form", language); btnMode = "view"; }
                  const statusLabel =
                    pkgState === "no_record" ? (hasDraft ? L("Draft in progress", language) : L("Not started", language))
                    : pkgState === "draft" ? L("Draft in progress", language)
                    : pkgState === "prepared" ? L("Ready to print and sign", language)
                    : pkgState === "submitted" ? L("Submitted", language)
                    : pkgState === "approved" ? L("Approved", language)
                    : L("Needs review", language);
                  return (
                    <div key={pkgEntry.id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{pkgDef ? localize(pkgDef.title, language) : pkgEntry.officialFormNumber}</div>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{statusLabel}</div>
                      </div>
                      <button type="button" className="btn btn-primary" onClick={() => open(btnMode)}>{btnLabel}</button>
                    </div>
                  );
                })}
              </div>
              <div style={{ padding: "12px 20px 16px", display: "flex", justifyContent: "flex-end" }}>
                <button type="button" className="btn btn-secondary" onClick={close}>{L("Close", language)}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {activeGovForm && getDefinition(activeGovForm.formId) && (
        <GovernmentFormModal
          definition={getDefinition(activeGovForm.formId)!}
          requirementCode={activeGovForm.requirementCode}
          canonical={canonicalApplication}
          lang={language}
          initialData={preparedGovApplications[activeGovForm.formId]?.data as GovFormData ?? govFormDrafts[activeGovForm.formId]}
          initialMode={activeGovForm.mode}
          existingApplicationId={preparedGovApplications[activeGovForm.formId]?.id}
          applicationStatus={preparedGovApplications[activeGovForm.formId]?.status}
          onClose={() => setActiveGovForm(null)}
          onSaveDraft={(formId, data) => {
            setGovFormDrafts((cur) => ({ ...cur, [formId]: data }));
            setSampleFormNotice(L('Draft saved.', language));
            setActiveGovForm(null);
          }}
          onCanonicalChange={(updated, changedKeys) => {
            setCanonicalOverride(updated);
            // Mark previously prepared forms that used the changed values as
            // needing a refresh — never silently overwrite them.
            setPreparedGovApplications((cur) => {
              const next = { ...cur };
              for (const [fid, app] of Object.entries(next)) {
                const def = getDefinition(fid);
                if (!def) continue;
                const usesChanged = def.sections.some((s) => s.fields.some((f) => f.canonicalKey && changedKeys.includes(f.canonicalKey)));
                if (usesChanged && app.id !== preparedGovApplications[activeGovForm.formId]?.id) {
                  next[fid] = { ...app, status: 'needs_refresh' };
                }
              }
              return next;
            });
          }}
          onComplete={(app, data) => {
            setPreparedGovApplications((cur) => ({ ...cur, [app.formId]: app }));
            setGovFormDrafts((cur) => ({ ...cur, [app.formId]: data }));
            // The modal stays open on its "Application Ready" step, which shows
            // the government filing fee and the link to the agency portal.
            setSampleFormNotice(L('Application prepared and added to deliverables.', language));
          }}
          onMarkSubmitted={(formId) => {
            // The applicant's own statement that they filed with the agency.
            // It records a submission — it does NOT satisfy the requirement,
            // which still waits on the official government document.
            setPreparedGovApplications((cur) => {
              const app = cur[formId];
              if (!app) return cur;
              return { ...cur, [formId]: { ...app, status: 'submitted', submittedAt: new Date().toISOString() } };
            });
            setSampleFormNotice(L('Marked as submitted. Upload the official document once the agency issues it.', language));
          }}
        />
      )}

      {activeSampleDefinition && activeSampleFormCode && (
        <div className="sample-form-overlay" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setActiveSampleFormCode(null);
        }}>
          <section className="sample-form-modal" role="dialog" aria-modal="true" aria-labelledby="sample-form-title">
            <div className="sample-form-head">
              <div>
                <div className="spr-kicker">{L('Preparation worksheet', language)} · {activeSampleDefinition.agency}</div>
                <h2 id="sample-form-title">{activeSampleDefinition.title}</h2>
                <p>{activeSampleDefinition.description}</p>
              </div>
              <button className="sample-form-close" onClick={() => setActiveSampleFormCode(null)} aria-label={L('Close form', language)}>×</button>
            </div>

            <div className="sample-form-warning">
              <AlertTriangle className="i" style={{ width: 17, height: 17 }} />
              <span>
                <strong>{L('This is a sample preparation worksheet, not an official filing.', language)}</strong>
                {L('The requirement remains incomplete until you upload:', language)} {activeSampleDefinition.officialOutput}.
              </span>
            </div>

            {sampleFormMode === 'edit' ? (
              <div className="sample-form-body">
                {activeSampleDefinition.sections.map((section) => (
                  <fieldset key={section.title} className="sample-form-section">
                    <legend>{section.title}</legend>
                    <div className="sample-form-grid">
                      {section.fields.map((field) => {
                        const value = activeSampleData[field.key] ?? (field.type === 'checkbox' ? false : '');
                        const hasError = sampleFormErrors.includes(field.label);
                        return (
                          <label key={field.key} className={`sample-form-field ${field.type === 'textarea' ? 'wide' : ''} ${hasError ? 'error' : ''}`}>
                            <span>{field.label}{field.required && <b aria-hidden="true"> *</b>}</span>
                            {field.type === 'textarea' ? (
                              <textarea
                                value={String(value)}
                                placeholder={field.placeholder}
                                onChange={(event) => updateSampleFormField(field.key, event.target.value)}
                              />
                            ) : field.type === 'select' ? (
                              <select value={String(value)} onChange={(event) => updateSampleFormField(field.key, event.target.value)}>
                                <option value="">{L('Select an option', language)}</option>
                                {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                              </select>
                            ) : field.type === 'checkbox' ? (
                              <input
                                type="checkbox"
                                checked={Boolean(value)}
                                onChange={(event) => updateSampleFormField(field.key, event.target.checked)}
                              />
                            ) : (
                              <input
                                type={field.type}
                                value={String(value)}
                                placeholder={field.placeholder}
                                onChange={(event) => updateSampleFormField(field.key, event.target.value)}
                              />
                            )}
                            {field.help && <small>{field.help}</small>}
                            {hasError && <small className="field-error">{L('Required field', language)}</small>}
                          </label>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
            ) : (
              <div className="sample-form-body">
                <p style={{ fontSize: 12.5, color: 'var(--muted)', margin: '0 0 10px' }}>
                  {L('This is the exact PDF that will be added to your deliverables — nothing is saved until you confirm below.', language)}
                </p>
                {sampleFormPreviewUrl ? (
                  <iframe
                    src={sampleFormPreviewUrl}
                    title={L('Document preview', language)}
                    style={{ width: '100%', height: '55vh', border: '1px solid var(--border, #e2e8f0)', borderRadius: 8, background: 'white' }}
                  />
                ) : (
                  <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{L('Generating preview…', language)}</div>
                )}
              </div>
            )}

            <div className="sample-form-foot">
              <div className="sample-form-feedback" role="status">
                {sampleFormErrors.length > 0 && `${sampleFormErrors.length} ${L('required fields are missing.', language)}`}
                {sampleFormNotice}
              </div>
              <div className="sample-form-actions">
                {sampleFormMode === 'edit' ? (
                  <>
                    <button className="btn btn-secondary" onClick={saveSampleFormDraft}>{L('Save draft', language)}</button>
                    <button className="btn btn-primary" onClick={reviewSampleForm}>
                      <Eye className="i" style={{ width: 14, height: 14 }} /> {L('Review document', language)}
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-secondary" onClick={() => setSampleFormMode('edit')}>{L('Back to edit', language)}</button>
                    <button className="btn btn-primary" onClick={addSampleFormToDeliverables}>
                      <Archive className="i" style={{ width: 14, height: 14 }} /> {L('Add PDF to deliverables', language)}
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* On-page PDF preview for the Deliverables page (readiness report,
          prepared application worksheets) — shown before any download. */}
      {docPreview && (
        <div className="sample-form-overlay" role="presentation" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setDocPreview(null);
        }}>
          <section className="sample-form-modal" role="dialog" aria-modal="true" aria-labelledby="doc-preview-title">
            <div className="sample-form-head">
              <div>
                <div className="spr-kicker">{L('Document preview', language)}</div>
                <h2 id="doc-preview-title">{docPreview.title}</h2>
              </div>
              <button className="sample-form-close" onClick={() => setDocPreview(null)} aria-label={L('Close preview', language)}>×</button>
            </div>
            <div className="sample-form-body">
              {docPreviewUrl ? (
                <iframe
                  src={docPreviewUrl}
                  title={docPreview.title}
                  style={{ width: '100%', height: '65vh', border: '1px solid var(--border, #e2e8f0)', borderRadius: 8, background: 'white' }}
                />
              ) : (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>{L('Generating preview…', language)}</div>
              )}
            </div>
            <div className="sample-form-foot">
              <div className="sample-form-actions">
                <button className="btn btn-secondary" onClick={() => setDocPreview(null)}>{L('Close', language)}</button>
                {docPreviewUrl && (
                  <a
                    className="btn btn-primary"
                    href={docPreviewUrl}
                    download={docPreview.filename}
                    onClick={() => {
                      if (docPreview.kind === 'report') void archiveDeliverable('report', docPreview.filename, docPreview.blob);
                    }}
                  >
                    <Download className="i" style={{ width: 14, height: 14 }} /> {L('Download PDF', language)}
                  </a>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Hidden file input: powers the Upload buttons (LLM document workflow) */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        style={{ display: 'none' }}
        accept=".pdf,.txt,.doc,.docx,.png,.jpg,.jpeg,.md"
        onChange={onFileInputChange}
      />

      {/* Workspace Modal */}
      {showWorkspaceModal && activeWorkspaceId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', padding: 16 }}>
          <div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-lg)', maxWidth: 520, width: '100%', padding: 32 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>{ACTIVE_JURISDICTION.meta.productName}</div>
                <div style={{ fontSize: 22, fontWeight: 600 }}>{L('Workspace', language)}</div>
              </div>
              <button onClick={() => setShowWorkspaceModal(false)} style={{ background: 'transparent', border: 0, color: 'var(--muted)', cursor: 'pointer', fontSize: 15 }}>✕</button>
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-tint)', padding: '8px 12px', borderRadius: 8, marginBottom: 16, wordBreak: 'break-all' }}>
              {typeof window !== 'undefined' ? window.location.origin : ''}/workspace/{activeWorkspaceId}
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 16 }}>
              {L('Your readiness workspace opened in a new tab. This is a shareable, self-contained link showing your AI-approved deliverables, requirements checklist, and findings. The link has also been copied to your clipboard.', language)}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="btn btn-secondary"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => {
                  const url = `/workspace/${activeWorkspaceId}#d=${encodePayload(buildWorkspacePayload())}`;
                  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
                }}
              >
                {L('Open Workspace Again', language)}
              </button>
              <button className="btn btn-primary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setShowWorkspaceModal(false)}>
                {L('Close', language)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden rules-engine debug panel (enable with ?debug=1) */}
      {debugMode && (() => {
        const dbg = runRulesEngineForProfile(profile as any, discoveryAnswers, intakeFacts.questionValues).debug;
        return (
          <div style={{ position: 'fixed', bottom: 0, right: 0, zIndex: 400, width: 440, maxWidth: '100%', maxHeight: '60vh', overflow: 'auto', background: 'var(--navy)', color: 'white', fontSize: 11, fontFamily: 'monospace', boxShadow: 'var(--shadow-lg)', borderLeft: '1px solid rgba(255,255,255,0.2)', borderTop: '1px solid rgba(255,255,255,0.2)' }}>
            <div style={{ padding: '8px 12px', fontWeight: 700, borderBottom: '1px solid rgba(255,255,255,0.2)', display: 'flex', justifyContent: 'space-between' }}>
              <span>{ACTIVE_JURISDICTION.meta.productName} Rules Engine — Debug</span>
              <span style={{ opacity: 0.6 }}>?debug=1</span>
            </div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div><span style={{ opacity: 0.6 }}>Municipality Selected:</span> {dbg.municipalitySelected || '—'}</div>
              <div><span style={{ opacity: 0.6 }}>Municipality Flags:</span> {dbg.municipalityFlags.join(', ') || '—'}</div>
              <div><span style={{ opacity: 0.6 }}>Business Type:</span> {dbg.businessType || '—'} {dbg.businessTypeId ? `(${dbg.businessTypeId})` : ''}</div>
              <div>
                <div style={{ opacity: 0.6 }}>Questions Triggered ({dbg.questionsTriggered.length}):</div>
                {dbg.questionsTriggered.map((q, i) => (
                  <div key={i} style={{ paddingLeft: 8 }}>• {q.question_id} = {String(q.answer)}</div>
                ))}
              </div>
              <div>
                <div style={{ opacity: 0.6 }}>Rules Matched ({dbg.rulesMatched.length}):</div>
                {dbg.rulesMatched.map((r, i) => (
                  <div key={i} style={{ paddingLeft: 8 }}>• {r.rule_id} [{r.rule_type}] → {r.document_id} — {r.reason}</div>
                ))}
              </div>
              <div>
                <div style={{ opacity: 0.6 }}>Documents Generated ({dbg.documentsGenerated.length}):</div>
                <div style={{ paddingLeft: 8 }}>{dbg.documentsGenerated.join(', ') || '—'}</div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
