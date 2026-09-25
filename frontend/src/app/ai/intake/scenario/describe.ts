/**
 * Human-readable views of a scenario.
 *
 * "We understood" only ever shows facts the user stated (or that are on file
 * in the Passport). Inferences and vague facts go to "Needs confirmation" —
 * an uncertain conclusion is never dressed up as a confirmed chip.
 */
import { changeOfUseStatus, isConfirmed, type ScenarioContext, type ScenarioFact } from "./types";
import { displayOfUse, familiesOf } from "./uses";

export interface ScenarioChip {
  key: string;
  label: string;
}

export interface ScenarioSummary {
  understood: ScenarioChip[];
  needsConfirmation: ScenarioChip[];
}

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function describeScenario(ctx: ScenarioContext, opts: { includePassport?: boolean } = {}): ScenarioSummary {
  const understood: ScenarioChip[] = [];
  const needs: ScenarioChip[] = [];
  const put = (key: string, f: ScenarioFact<unknown> | undefined, label: string | null) => {
    if (!f || !label) return;
    if (f.source === "existing_passport" && !opts.includePassport) return;
    (isConfirmed(f) ? understood : needs).push({ key, label });
  };
  const b = ctx.business;
  const p = ctx.property;
  const pr = ctx.project;
  const o = ctx.operations;

  if (b.status?.source !== "existing_passport") {
    put("business.status", b.status, b.status?.value === "existing" ? "Existing business" : b.status?.value === "new" ? (isConfirmed(b.status) ? "New business being formed" : "Possibly a new business") : null);
  }
  put("property.municipality", p.municipality, p.municipality?.value ?? null);
  if (p.address) put("property.address", p.address, p.address.value);
  if (p.parcel) put("property.parcel", p.parcel, `Parcel ${p.parcel.value}`);

  // "Existing warehouse/office facility": the use and "existing" combine into
  // one fact about the property; each half keeps its own certainty.
  const use = p.existingUse ? displayOfUse(p.existingUse.value).toLowerCase().replace(/ \/ /g, "/") : null;
  const land = !!p.existingUse && familiesOf(p.existingUse.value).includes("vacant");
  if (land) {
    put("property.existingUse", p.existingUse, title(use!));
  } else if (p.existingBuilding?.value && p.existingUse && isConfirmed(p.existingBuilding) && isConfirmed(p.existingUse)) {
    understood.push({ key: "property.existing", label: `Existing ${use} facility` });
  } else {
    put("property.existingUse", p.existingUse, use ? `${title(use)} facility` : null);
    put("property.existingBuilding", p.existingBuilding, p.existingBuilding?.value ? "Existing building" : null);
  }
  put("property.squareFeet", p.squareFeet, p.squareFeet ? `${p.squareFeet.value.toLocaleString("en-US")} sq ft` : null);
  put("property.ownershipStatus", p.ownershipStatus, p.ownershipStatus ? `${title(p.ownershipStatus.value)} property` : null);
  put("property.authorizedUse", p.authorizedUse, p.authorizedUse ? `Authorized use: ${displayOfUse(p.authorizedUse.value)}` : null);

  if (pr.renovation?.value) {
    const interior = pr.demolition?.value === "interior" || pr.exteriorWork?.value === false || /\binterior\b/i.test(pr.renovation.evidenceText);
    put("project.renovation", pr.renovation, interior ? "Interior renovation" : "Renovation");
  }
  if (pr.type?.value.includes("new_construction")) put("project.type", pr.type, "New construction");
  const demo = pr.demolition?.value;
  put("project.demolition", pr.demolition, demo === "none" ? "No demolition" : demo ? `${title(demo)} demolition` : null);
  const yesNo = (key: string, f: ScenarioFact<boolean> | undefined, yes: string, no: string) => put(key, f, f ? (f.value ? yes : no) : null);
  yesNo("project.electricalWork", pr.electricalWork, "Electrical work", "No electrical work");
  yesNo("project.plumbingWork", pr.plumbingWork, "Plumbing work", "No plumbing work");
  yesNo("project.mechanicalWork", pr.mechanicalWork, "Mechanical / HVAC work", "No mechanical work");
  yesNo("project.officeBuildout", pr.officeBuildout, "Office build-out", "No office build-out");
  yesNo("project.layoutChanges", pr.layoutChanges, "Layout changes", "No layout changes");
  yesNo("project.structuralWork", pr.structuralWork, "Structural work", "No structural work");
  yesNo("project.exteriorWork", pr.exteriorWork, "Exterior work", "No exterior work");
  yesNo("project.footprintChange", pr.footprintChange, "Footprint changes", "Footprint unchanged");
  yesNo("project.siteCirculationChanges", pr.siteCirculationChanges, "Parking / access changes", "No site changes");

  // Proposed use: vague → needs confirmation, never a confirmed chip.
  if (p.proposedUse) {
    if (p.proposedUseSpecificity?.value === "insufficient") {
      needs.push({ key: "property.proposedUse", label: "Proposed commercial activity not yet specified" });
    } else {
      put("property.proposedUse", p.proposedUse, `Proposed use: ${displayOfUse(p.proposedUse.value)}`);
    }
  }
  if (o.activity && o.activity.source === "inferred" && /Business Passport/.test(o.activity.evidenceText)) {
    needs.push({ key: "operations.activity", label: `Same activity as your Passport: ${o.activity.value}` });
  }
  const change = changeOfUseStatus(ctx);
  if (change === "confirmed") {
    understood.push({
      key: "project.possibleChangeOfUse",
      label: p.existingUse && p.proposedUse ? `Change of use: ${displayOfUse(p.existingUse.value)} → ${displayOfUse(p.proposedUse.value)}` : "Change of use",
    });
  } else if (change === "possible") {
    needs.push({ key: "project.possibleChangeOfUse", label: "Possible change of use" });
  } else if (change === "none") {
    understood.push({ key: "project.possibleChangeOfUse", label: "Same use — no change of use" });
  }

  put("operations.employees", o.employees, o.employees ? `${o.employees.value} employees` : null);
  yesNo("operations.generator", o.generator, "Generator", "No generator");
  yesNo("operations.fuelStorage", o.fuelStorage, "Fuel storage", "No fuel storage");
  yesNo("operations.emissionsEquipment", o.emissionsEquipment, "Emissions equipment", "No emissions equipment");
  yesNo("operations.hazardousMaterials", o.hazardousMaterials, "Hazardous materials", "No hazardous materials");
  yesNo("operations.wastewaterDischarge", o.wastewaterDischarge, "Wastewater discharge", "No wastewater discharge");
  yesNo("operations.foodService", o.foodService, "Food service", "No food service");

  return { understood, needsConfirmation: needs };
}

/** Compact "Facts understood" lines for the SmartPR Live panel. */
export function liveFactLines(ctx: ScenarioContext): string[] {
  const lines: string[] = [];
  const p = ctx.property;
  const b = ctx.business;
  if (b.name?.value) lines.push(`Business: ${b.name.value}`);
  if (p.municipality && isConfirmed(p.municipality)) lines.push(`Municipality: ${p.municipality.value}`);
  if (p.existingUse && isConfirmed(p.existingUse)) {
    const onLand = familiesOf(p.existingUse.value).includes("vacant");
    lines.push(`${onLand ? "Property" : p.existingBuilding?.value && isConfirmed(p.existingBuilding) ? "Existing facility" : "Facility"}: ${displayOfUse(p.existingUse.value).toLowerCase()}`);
  }
  if (p.squareFeet) lines.push(`Size: ${p.squareFeet.value.toLocaleString("en-US")} sq ft`);
  if (p.ownershipStatus && isConfirmed(p.ownershipStatus)) lines.push(`Property relationship: ${p.ownershipStatus.value}`);
  if (ctx.project.renovation?.value && isConfirmed(ctx.project.renovation)) lines.push("Renovation planned");
  if (p.proposedUse && p.proposedUseSpecificity?.value === "specific" && isConfirmed(p.proposedUse)) lines.push(`Proposed use: ${displayOfUse(p.proposedUse.value).toLowerCase()}`);
  const change = changeOfUseStatus(ctx);
  if (change === "confirmed") lines.push("Change of use: yes");
  if (change === "none") lines.push("Change of use: no");
  return lines;
}

/** Short project title: "Guaynabo warehouse/office renovation". */
export function scenarioTitle(ctx: ScenarioContext): string | null {
  const p = ctx.property;
  const pr = ctx.project;
  const parts: string[] = [];
  if (p.municipality) parts.push(p.municipality.value);
  if (p.existingUse) parts.push(displayOfUse(p.existingUse.value).toLowerCase().replace(/ \/ /g, "/"));
  else if (p.proposedUse && p.proposedUseSpecificity?.value === "specific") parts.push(displayOfUse(p.proposedUse.value).toLowerCase());
  const change = changeOfUseStatus(ctx);
  if (change === "confirmed" && p.proposedUse) parts.push(`conversion to ${displayOfUse(p.proposedUse.value).toLowerCase()}`);
  else if (pr.type?.value.includes("new_construction")) parts.push("new construction");
  else if (pr.renovation?.value) parts.push("renovation");
  else if (p.ownershipStatus?.value === "leased") parts.push("lease");
  if (parts.length < 2) return null;
  const t = parts.join(" ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
