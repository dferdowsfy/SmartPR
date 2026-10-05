import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmedPotentialRequirements,
  mergeConfirmedPotentialRequirements,
  type PotentialDef,
} from "./potentialRequirements.ts";

const definitions: PotentialDef[] = [
  {
    flag: "coastal",
    flagLabel: "Coastal Municipality",
    document: "Coastal / Environmental Zone Review",
    agency: "DRNA",
    why: "A coastal review may be required.",
    followUp: "Will the business operate near the coast?",
  },
  {
    flag: "tourism",
    flagLabel: "Tourism Municipality",
    document: "Tourism Registration",
    agency: "Tourism Company",
    why: "Tourism businesses may need to register.",
    followUp: "Will the business primarily serve visitors?",
  },
];

test("only Applies creates required checklist items", () => {
  const requirements = confirmedPotentialRequirements(definitions, {
    coastal: "applies",
    tourism: "not_sure",
  });

  assert.equal(requirements.length, 1);
  assert.equal(requirements[0].code, "potential_coastal");
  assert.equal(requirements[0].mandatory, true);
  assert.equal(requirements[0].status, "pending");
});

test("Does Not Apply and Not Sure do not change required fields", () => {
  const requirements = confirmedPotentialRequirements(definitions, {
    coastal: "not_applies",
    tourism: "not_sure",
  });

  assert.deepEqual(requirements, []);
});

test("confirmed items are merged once into the computed checklist", () => {
  const base = [{ code: "ein", name: "IRS EIN Confirmation Letter" }];
  const merged = mergeConfirmedPotentialRequirements(base, definitions, {
    coastal: "applies",
    tourism: "applies",
  });

  assert.deepEqual(merged.map((requirement) => requirement.code), [
    "ein",
    "potential_coastal",
    "potential_tourism",
  ]);
});

test("REG-LIVE-COASTAL-SOURCE-001: advisory citations are carried onto the requirement (plumbing)", () => {
  const defs: PotentialDef[] = [
    {
      flag: "coastal",
      flagLabel: "Coastal Municipality",
      document: "Coastal / Environmental Zone Review",
      agency: "DRNA",
      why: "A coastal review may be required.",
      followUp: "Will the business operate near the coast?",
      citation: "Coastal Zone Management Act § 307(c)(3)(A), 16 U.S.C. § 1456(c)(3)(A)",
      citation_url: "https://www.ecfr.gov/current/title-15/subtitle-B/chapter-IX/subchapter-B/part-930/subpart-D/section-930.57",
    },
  ];
  const requirements = confirmedPotentialRequirements(defs, { coastal: "applies" });
  assert.equal(requirements.length, 1);
  assert.equal(
    requirements[0].citation,
    "Coastal Zone Management Act § 307(c)(3)(A), 16 U.S.C. § 1456(c)(3)(A)"
  );
  assert.equal(
    requirements[0].citation_url,
    "https://www.ecfr.gov/current/title-15/subtitle-B/chapter-IX/subchapter-B/part-930/subpart-D/section-930.57"
  );
});

test("REG-LIVE-COASTAL-SOURCE-001: PR coastal flag advisory carries an authoritative citation (data)", async () => {
  const { ACTIVE_JURISDICTION } = await import("./jurisdictions/index.ts");
  const coastal = ACTIVE_JURISDICTION.flagAdvisories.byFlag["coastal"];
  assert.ok(coastal, "PR pack must define a coastal flag advisory");
  assert.ok(
    (coastal.citation ?? "").length > 20,
    "coastal advisory must carry a substantive citation for the card SOURCE row"
  );
  assert.ok(
    /16 U\.S\.C\.|L\.P\.R\.A\.|Ley/i.test(coastal.citation ?? ""),
    "coastal citation must reference an actual statute"
  );
  // The citation is verbatim from the KB's DOC_CZM_COASTAL_REVIEW (regulation confidence).
  const requirements = confirmedPotentialRequirements([coastal], { coastal: "applies" });
  assert.equal(requirements[0].citation, coastal.citation);
});
