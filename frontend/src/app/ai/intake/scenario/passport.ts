/**
 * Existing business: the Business Passport is already-known fact.
 *
 * When the user links an existing business, its identity and registration
 * (name, entity type, EIN, industry, business address, contact) come from the
 * Passport — the intake never asks for them again. The new description is
 * read as a PROJECT of that business: a project location different from the
 * Passport address is a new location, not a correction to the Passport.
 */
import { cloneScenario, type ScenarioContext, type ScenarioFact } from "./types";
import { matchUse } from "./uses";

/** What the intake needs from a linked business (from /api/businesses/:id). */
export interface PassportSnapshot {
  businessId: string;
  name?: string | null;
  entityType?: string | null;
  businessType?: string | null;
  industry?: string | null;
  municipality?: string | null;
  address?: string | null;
  hasEin?: boolean;
  hasMerchantRegistration?: boolean;
  hasContact?: boolean;
  formationStatus?: string | null;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Build a snapshot from the /api/businesses/:id payload ({ business, passport? }). */
export function passportSnapshotFromApi(businessId: string, data: unknown): PassportSnapshot | null {
  const d = (data ?? {}) as Row;
  const b = (d.business ?? null) as Row | null;
  if (!b) return null;
  const pj = (b.passport_json && typeof b.passport_json === "object" ? b.passport_json : {}) as Row;
  const pb = (pj.business ?? {}) as Row;
  const contact = (pj.contact ?? {}) as Row;
  const canonical = ((d.passport as Row | undefined)?.canonical ?? {}) as Row;
  return {
    businessId,
    name: str(b.legal_name) ?? str(b.name),
    entityType: str(pb.entityType) ?? str(b.business_structure),
    businessType: str(b.business_type),
    industry: str(b.industry) ?? str(pb.industry),
    municipality: str(b.municipality),
    address: str(b.physical_address),
    hasEin: !!str(pb.ein),
    hasMerchantRegistration: !!str(pb.merchantRegistrationNumber) || !!str(b.entity_number),
    hasContact: !!(str(contact.email) || str(contact.phone)),
    formationStatus: str(canonical.formationStatus) ?? str(pb.formationStatus),
  };
}

const onFile = <T>(value: T, what: string): ScenarioFact<T> => ({
  value,
  source: "existing_passport",
  confidence: 1,
  evidenceText: `Business Passport: ${what}`,
});

/**
 * Merge the Passport into the scenario. Passport identity facts win over
 * anything read from the description (the description is about the project).
 * The project's location is NOT copied from the Passport address — where this
 * project is stays whatever the description says (or unknown).
 */
export function mergePassportIntoScenario(ctx: ScenarioContext, snap: PassportSnapshot | null): ScenarioContext {
  if (!snap) return ctx;
  const out = cloneScenario(ctx);
  out.business.status = onFile("existing", "linked existing business");
  out.business.entityId = onFile(snap.businessId, "business id");
  if (snap.name) out.business.name = onFile(snap.name, "legal name");
  if (snap.entityType) out.business.entityType = onFile(snap.entityType, "entity type");
  if (snap.industry) out.business.industry = onFile(snap.industry, "industry");
  // "…renovate it for manufacturing" by a business whose Passport says
  // Furniture Manufacturing: the broad activity is most likely the business's
  // own. Carried over as an inference (needs confirmation), never a fact.
  const act = out.operations.activity;
  const bt = snap.businessType?.toLowerCase();
  if (act && bt && act.source !== "existing_passport" && act.value.toLowerCase() !== bt) {
    const a = matchUse(act.value.replace(/_/g, " "));
    const b = matchUse(bt);
    if (a && b && !a.generic && a.family === b.family && bt.includes(act.value.replace(/_/g, " ").toLowerCase())) {
      out.operations.activity = {
        value: bt,
        source: "inferred",
        confidence: 0.8,
        evidenceText: `${act.evidenceText} — Business Passport: ${snap.businessType}`,
      };
    }
  }
  return out;
}

export interface PassportKnownItem {
  key: string;
  label: string;
  value: string;
}

/** "Already known from your Business Passport" — shown collapsed. */
export function passportKnownItems(snap: PassportSnapshot | null): PassportKnownItem[] {
  if (!snap) return [];
  const out: PassportKnownItem[] = [];
  if (snap.name) out.push({ key: "name", label: "Business name", value: snap.name });
  if (snap.entityType) out.push({ key: "business_structure", label: "Entity type", value: snap.entityType.replace(/_/g, " ") });
  if (snap.hasEin) out.push({ key: "ein", label: "EIN", value: "On file" });
  if (snap.hasMerchantRegistration) out.push({ key: "registration", label: "Registration", value: "On file" });
  if (snap.industry) out.push({ key: "industry", label: "Industry", value: snap.industry });
  if (snap.businessType) out.push({ key: "business_type", label: "Business type", value: snap.businessType });
  if (snap.municipality || snap.address) {
    out.push({ key: "business_address", label: "Business address", value: [snap.address, snap.municipality].filter(Boolean).join(", ") });
  }
  if (snap.hasContact) out.push({ key: "contact", label: "Contact information", value: "On file" });
  return out;
}

/**
 * Generic intake fields the Passport already answers — hidden for an
 * existing business. Keys are intake profile field names.
 */
export function identityFieldsKnown(snap: PassportSnapshot | null): Set<string> {
  const known = new Set<string>();
  if (!snap) return known;
  if (snap.name) known.add("name");
  if (snap.entityType) known.add("business_structure");
  if (snap.industry) known.add("industry");
  if (snap.businessType) known.add("business_type");
  if (snap.municipality) known.add("municipality");
  return known;
}

export interface PassportDelta {
  kind: "new_location" | "activity_differs";
  message: string;
}

/**
 * What this project changes relative to the Passport (never silently
 * overwriting it): a different location, or an activity that differs from
 * the business's recorded industry.
 */
export function passportDeltas(ctx: ScenarioContext, snap: PassportSnapshot | null): PassportDelta[] {
  if (!snap) return [];
  const out: PassportDelta[] = [];
  const projectMuni = ctx.property.municipality?.value;
  if (projectMuni && snap.municipality && projectMuni.toLowerCase() !== snap.municipality.toLowerCase()) {
    out.push({
      kind: "new_location",
      message: `Project location: ${projectMuni} · Registered business location: ${snap.municipality}. Both are kept — the project does not change your Passport.`,
    });
  }
  const activity = ctx.operations.activity?.value;
  if (activity && snap.industry) {
    const a = activity.replace(/_/g, " ").toLowerCase();
    const ind = snap.industry.toLowerCase();
    if (!ind.includes(a.split(" ")[0]) && !a.includes(ind.split(/[\s&]/)[0])) {
      out.push({
        kind: "activity_differs",
        message: `This project's activity (${a}) differs from the Passport industry (${snap.industry}).`,
      });
    }
  }
  return out;
}

const NEW_PREMISES_RE =
  /\b(?:expand\w*\s+(?:in)?to|mov(?:e|es|ed|ing)\s+(?:in)?to|relocat\w*|new\s+(?:location|site|facility|premises|space|warehouse|plant|store|branch)|second\s+(?:location|site|facility|store)|additional\s+(?:location|site|facility)|open\w*\s+(?:a|an)\s+(?:new\s+)?(?:location|branch))\b/i;

/**
 * An existing business taking on premises it does not operate yet: the
 * project is in another municipality than the Passport's registered
 * location, or the description says so ("expanding into a leased
 * warehouse", "a new location"). Premises-bound permits are then new
 * filings, not renewals.
 */
export function isNewPremises(ctx: ScenarioContext | null, snap: PassportSnapshot | null): boolean {
  if (!ctx || !snap) return false;
  const project = ctx.property.municipality?.value;
  if (project && snap.municipality && project.toLowerCase() !== snap.municipality.toLowerCase()) return true;
  const said = [ctx.property.ownershipStatus, ctx.property.existingUse, ctx.property.existingBuilding, ctx.property.municipality]
    .map((f) => (f && f.source !== "inferred" ? f.evidenceText : ""))
    .join(" ");
  return NEW_PREMISES_RE.test(said);
}
