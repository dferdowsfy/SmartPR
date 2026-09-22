# Florida Regulatory Knowledge Graph — Plan

Status: **planning draft** · Author: Claude Code session · Date: 2026-09-22
Companion data: [`pr-to-fl-document-crosswalk.csv`](./pr-to-fl-document-crosswalk.csv) (all 80 PR documents → FL concept / candidate / authority / level / confidence)

> Every Florida legal claim in this plan and in the crosswalk is a **candidate**
> until it's checked against a primary source (F.S., F.A.C., agency page,
> local code). Rows marked `verify` in the crosswalk are known to be uncertain.
> The PR repo's discipline carries over unchanged: nothing ships as `verified`
> without a citation, and nobody makes up a renewal cadence.

---

## 1. Summary

The PR knowledge graph was built in a way that ports well. The engine, the
graph machinery, the scenario harness and most of the intake vocabulary don't
depend on the jurisdiction. The main difference is Florida's **geography**.
PR has 78 municipalities in one flat list, and every rule hangs off "the
municipality". Florida has a **stack**: state → county → city (or
unincorporated county) → special districts → parcel-level overlays such as
flood zone, the Coastal Construction Control Line (CCCL), historic districts
and Areas of Critical State Concern. One business can owe the same kind of
obligation at two levels, for example a county **and** a city Local Business
Tax Receipt. The state can also preempt local rules, as it does for mobile food
vehicles, firearms and parts of vacation-rental regulation.

Recommended approach:

1. **Add a jurisdiction-neutral concept layer.** Obligations like "sanitary
   license" and "local business tax" are authored once, as concepts. Each
   jurisdiction pack says which of its documents *implement* each concept. The
   business-type and question rules that make up most of the rule base get
   authored once and shared.
2. **Replace "municipality" with a resolved jurisdiction stack.** The engine
   input gains a `ResolvedLocation`: county, city or unincorporated, special
   districts, overlays. PR becomes the trivial case, a two-level stack.
3. **Re-express PR through the concept layer first, with zero golden drift.**
   This is the de-risking step. If all 25 validated PR goldens stay
   byte-identical, the refactor is proven before any Florida data exists.
4. **Build Florida coverage in tiers.** First the state layer, which drives most
   of the requirement volume. Next a 67-county authority matrix. Then deep
   coverage of the top cities and overlays. Everything else defaults honestly to
   `requirements_only`, the pattern `forms/artifacts/municipalities.ts` already
   uses.

### Reuse at a glance

| Layer | PR today | Reuse for FL | Notes |
|---|---|---|---|
| Rules engine (`rulesEngine.ts`) | ~900 lines, data-driven | **~95%** | 3 small extensions (§5.3) |
| Graph machinery (`rk/*`: proposals, batches, snapshots, audit, impact) | full workflow | **~100%** | add a `jurisdiction` column (§5.4) |
| Intake questions (`kb/questions.json`) | 90 | **89 verbatim**, 1 re-worded | `Q_ENTITY_FOREIGN_CORP` names "Puerto Rico"; add ~8 FL questions |
| Business types | 142 | **142** | descriptions say "operating in Puerto Rico" → templated |
| Industries | 20 | **20** | |
| Documents | 80 | 10 federal + 7 generic reused as-is; 39 1:1 FL equivalents; 16 split into several FL docs; 5 merged; 3 PR-only | see crosswalk; plus ~25 FL-only new docs (§6.3) |
| Rules | 362 | 272 `business_type` + `question_trigger` rules → **concept rules** (authored once); 76 `municipality_flag` → re-derived as FL overlays; 16 rules target PR-only docs and are dropped | rules keep their triggers; the jurisdiction pack picks the target document |
| Guidance model (`guidance/model.ts`) | EN/ES, source-linked | **100% model**, 0% content | new `guidance/fl.ts` |
| Renewals (`extensions.renewals`) | 25 PR cadences | model reused, content rebuilt | e.g. LBTR expires Sept 30 (s. 205.053), annual report Jan 1–May 1 |
| Golden scenario harness (`qa/*`) | 25 scenarios | **25 twins** + ~12 FL-only | §8 |
| Municipality adapters (`forms/artifacts/municipalities.ts`) | PR municipalities | **pattern 100%**, becomes "locality adapters" | |
| Federal forms (SS-4, EPA Form 1/2C, CBP 301) | mapped | **100%** | |
| PR agency forms (Sunbiz-equivalents, Hacienda, municipal PA01–04) | mapped | 0% | FL needs DR-1, DR-405, Sunbiz filings, etc. |
| Incentives (`incentives/prCatalog.ts`, Act 60) | 26 programs | engine 100%, catalog 0% | FL catalog is a separate workstream |
| Monitoring sources / crawler | 18 PR sources | crawler 100%, sources 0% | FL statutes, F.A.C., Sunbiz, DOR, DBPR, FDACS, FDEP, municode |

In rule terms: of the 362 PR rules, **296 target documents that have a Florida
equivalent or split** (153 + 143), **34 target federal documents**, **12 target
generic evidence**, 4 target merged docs, and only **16 target PR-only
documents**. The trigger half of each rule (business type X, answer Y) carries
over. The target half gets re-pointed through the concept.

---

## 2. How the PR graph works today (the parts that matter)

- **`JurisdictionPack`** (`jurisdictions/types.ts`) already isolates PR data:
  `kb`, `docMappings`, `flagAdvisories`, `documentIntelligence`,
  `intakeCompat`. It's selected at **build time** by `NEXT_PUBLIC_JURISDICTION`.
  The README already names Florida as the next pack.
- **KB tables** (`frontend/src/kb/*.json`): municipalities (78, with flags
  `coastal/tourism/metro/historic/industrial_port/airport_host/island/capital`),
  business types, questions, documents, rules. There are also graph-extension
  tables: agencies, inspections, project/intake facts, derivations,
  contradictions, incentives.
- **Rule types**: `business_type` (202), `municipality_flag` (76),
  `question_trigger` (70), `municipality` (8, which are really "universal
  baseline" rules), `project_fact` (6). Each rule targets exactly **one
  document id**. That coupling is why Florida can't reuse the rules unchanged:
  `RULE_0046` says "restaurant → `DOC_HEALTH_PERMIT`", and in Florida that
  resolves to DBPR *or* FDACS depending on on-premises consumption.
- **rk graph** (`rk/*`, `data/rk_schema.sql`): versioned nodes, edges derived
  from node data, change proposals → publication batches → one compiled
  `rk_kb_snapshots` row. The snapshot is **globally single-active**, and
  `rk_regulatory_sources.jurisdiction` defaults to `'PR'`. Both are
  single-jurisdiction assumptions.
- **Quality apparatus**: provenance gates, `verification: heuristic|verified`,
  citations with confidence, change logs, validated goldens, rule-coverage
  test, continuous QA agent (`docs/continuous-regulatory-qa.md`). All of it is
  reusable and is the main reason a second jurisdiction is feasible.

### Remaining PR coupling in code (to clean up in Phase 0)

From `grep` over `app/` + `lib/` (excluding tests and the PR pack itself):
`i18n.ts` (43 hits), `sampleApplicationForms.ts` (66),
`lib/agency-runs/filingTypes.ts` (39), `SmartPRIntake.tsx` (26),
`forms/artifacts/catalog.ts` / `formDataPopulation.ts` / `applicability.ts`,
`requirementApplicability.ts` (regexes on "patente|permiso|san juan"),
`rk/registry.ts` (jurisdiction select options hardcoded to
`Federal/Puerto Rico/Municipal/Other`), `rk/seed-data.ts` and `rk/ingest.ts`
("Puerto Rico" fallbacks), and `clinics/ClinicChecker.tsx` +
`restaurants/RestaurantChecker.tsx` + `admin/knowledgeGraph.ts`, which import
`kb/*.json` directly and bypass the pack.

---

## 3. Florida jurisdiction model

### 3.1 Levels

| Level | Count | Examples | What typically lives here |
|---|---|---|---|
| Federal | 1 | IRS, EPA, FDA, CBP, TSA, ATF, SAM | reused from PR as-is |
| State | 1 | Sunbiz, DOR, DBPR, FDACS, DOH, DCF, DFS, FDEP, FLHSMV, FDOT | entity formation, sales and reemployment tax, most activity licenses, workers' comp, environmental |
| County | 67 | Miami-Dade, Orange, Hillsborough, Duval (consolidated with Jacksonville) | county BTR, TDT, property appraiser (TPP return), zoning/building/fire **for unincorporated areas**, some county-level licensing (e.g. local child-care licensing agencies) |
| Municipality | ~411 incorporated cities, towns and villages (verify count) | Miami, Tampa, Orlando, Key West | city BTR, zoning/Certificate of Use, building, fire, signs, sidewalk cafés, noise, local STR rules |
| Unincorporated area | 67 (one per county) | "Unincorporated Miami-Dade" | a real jurisdiction in practice; the county acts as the "city" |
| Special district | many (verify) | Central Florida Tourism Oversight District; independent fire districts; CDDs | building/fire authority in some districts; assessments |
| Overlay (parcel-level) | n/a | FEMA flood zone, CCCL, local historic district, Area of Critical State Concern (Florida Keys, Key West, Apalachicola Bay, Green Swamp, Big Cypress — verify list), CRA, port/airport district, water management district (5), electric-utility service territory | floodplain/CCCL/ERP permits, historic review, Keys building allocation, interconnection |

Florida-specific pitfalls the model has to handle:

- **A mailing city isn't a jurisdiction.** Many "Miami", "Orlando" and "Tampa"
  addresses sit in unincorporated county land. Census-designated places such as
  Kendall, Brandon and The Villages aren't cities. Resolve from coordinates
  against *incorporated-place* boundaries, and never trust the city typed by
  the user.
- **The same concept can apply at two levels at once.** County BTR plus city
  BTR (Ch. 205) is the canonical case, so requirement dedupe must key on
  `(document, jurisdiction)` and not on `document` alone.
- **Local authority is contracted.** Some cities use the county building
  department, and some fire authority belongs to independent fire districts.
  Who implements a concept is data, captured in the authority matrix (§6.2).
- **State preemption.** For example: s. 509.102 (mobile food vehicles),
  s. 790.33 (firearms), s. 509.032(7) (vacation rentals, with grandfathered
  local ordinances), s. 559.955 (home-based businesses). Preemption has to be a
  first-class edge so the engine can *suppress* a local requirement and explain
  why.
- **A county can override state licensing.** Child care is licensed by DCF,
  except in counties with a designated local licensing agency (s. 402.306).
- **Charter counties** can have county ordinances that prevail over municipal
  ones in defined areas, depending on the charter. Model this as a
  county-level attribute (`charter`, `ordinance_precedence`) that is source-linked.

### 3.2 ID conventions

```
Jurisdictions   FL                    (state)
                FL_CO_MIAMI_DADE      (county)
                FL_CITY_MIAMI         (municipality)
                FL_UNINC_MIAMI_DADE   (unincorporated area)
                FL_SD_CFTOD           (special district)
                FL_OV_CCCL, FL_OV_SFHA, FL_OV_ACSC_KEYS, FL_OV_HIST_MIAMI_BEACH_...  (overlays)
Concepts        CON_LOCAL_BUSINESS_TAX, CON_SANITARY_LICENSE, …   (shared, jurisdiction "CORE")
Documents       DOC_FL_LBTR_COUNTY, DOC_FL_DBPR_FOOD_SERVICE, …   (FL-specific)
                DOC_EIN, DOC_SAM_REGISTRATION, …                  (shared federal, unchanged ids)
Rules           CRULE_*  (concept rules, shared)   RULE_FL_*  (FL-only rules)
                RULE_*   (existing PR ids, untouched)
```

Keeping federal and generic document ids unchanged (`DOC_EIN`,
`DOC_LEASE_AGREEMENT`, …) means their guidance, form mappings (SS-4) and
evidence-locker behavior are shared automatically.

---

## 4. The concept layer (the reuse mechanism)

### 4.1 Idea

Split every rule into **trigger** and **target**:

```ts
// Authored ONCE — jurisdiction-neutral (lives in the shared "CORE" graph)
{ id: "CRULE_0046", rule_type: "business_type",
  business_type_id: "BT_RESTAURANT",
  requires_concept_id: "CON_SANITARY_LICENSE" }

// Per-pack implementation map
// PR (identity — reproduces today's RULE_0046 exactly)
{ concept_id: "CON_SANITARY_LICENSE", jurisdiction: "PR",
  document_id: "DOC_HEALTH_PERMIT", citation: "Ley 81-1912 …", verification: "verified" }

// FL (split by activity, gated by an answer)
{ concept_id: "CON_SANITARY_LICENSE", jurisdiction: "FL", level: "state",
  document_id: "DOC_FL_DBPR_FOOD_SERVICE",
  when: [{ question_id: "Q_ON_SITE_CONSUMPTION", expected_answer: "true" }],
  citation: "Ch. 509 F.S.", verification: "heuristic" }
{ concept_id: "CON_SANITARY_LICENSE", jurisdiction: "FL", level: "state",
  document_id: "DOC_FL_FDACS_FOOD_ESTABLISHMENT",
  when: [{ question_id: "Q_ON_SITE_CONSUMPTION", expected_answer: "false" }],
  citation: "Ch. 500 F.S.", verification: "heuristic" }
```

**`rk/compile.ts` expands concept rules × implementations into the flat
`KBRule[]` the engine already reads.** The engine never sees concepts, so its
runtime behavior stays simple and auditable. The compile step is also where
the old per-rule metadata (`compliance_mode`, `excluded_entity_types`,
`requires_business`, …) is merged. Trigger-side metadata lives on the concept
rule. Target-side metadata (citation, verification, compliance mode) lives on
the implementation.

### 4.2 Important constraint: shared triggers, re-verified applicability

A concept rule says a restaurant needs a sanitary license. That is almost
always true across US jurisdictions, but it's still a **legal claim per
jurisdiction**. So:

- A Florida implementation starts as `verification: "heuristic"` and becomes
  `verified` only when a Florida source is attached. The classifier already
  renders heuristic rules as "needs evaluation", never as confirmed.
- A jurisdiction can **opt out** of a concept rule, for example
  `{ concept_rule_id, jurisdiction: "FL", disposition: "not_applicable", source }`.
  Carrying a rule over is an explicit, reviewable decision.
- The 16 rules that target PR-only documents (`DOC_ISLAND_FERRY_MANIFEST`,
  `DOC_ASUME_CLEARANCE`, PR state withholding) have no FL implementation. The
  compile step reports them as "concept not implemented in FL", so nothing
  drops silently.

### 4.3 Concept inventory

The crosswalk yields **71 concepts** from the 80 PR documents. The ones with
the most rewiring (PR rules targeting them):

| Concept | PR doc | PR rules | FL resolution |
|---|---|---|---|
| `CON_SANITARY_LICENSE` | Health Permit | 35 | DBPR food service / FDACS food establishment / DOH, by activity |
| `CON_PROFESSIONAL_LICENSE` | Professional License | 33 | DBPR board / DOH MQA / Florida Bar, by profession |
| `CON_FIRE_INSPECTION` | Fire Cert | 30 | local fire authority from the authority matrix |
| `CON_OPERATING_AUTHORIZATION` | Permiso Único | 17 | **no FL equivalent as a single permit**: zoning use approval / Certificate of Use + fire + state license |
| `CON_CONTRACTOR_LICENSE` | Contractor License | 15 | CILB certified vs registered, ECLB, local specialty |
| `CON_BACKGROUND_SCREENING` | Background Check | 13 | Level 2 (Ch. 435) via the AHCA Clearinghouse |
| `CON_FOR_HIRE_TRANSPORT` | Transport Permit | 11 | local for-hire regulator + FMCSA; TNC preemption |
| `CON_LOCAL_BUSINESS_TAX` | Patente Municipal | 3 (baseline) | **county BTR + city BTR** |

---

## 5. Engine and graph changes

### 5.1 Location resolution (new module: `jurisdictions/fl/resolveLocation.ts`)

```ts
interface ResolvedLocation {
  state: "FL";
  countyId: string;                 // FL_CO_ORANGE
  municipalityId: string | null;    // null => unincorporated
  unincorporatedId: string | null;  // FL_UNINC_ORANGE when municipalityId is null
  specialDistrictIds: string[];     // FL_SD_CFTOD, fire districts …
  overlays: string[];               // FL_OV_SFHA_AE, FL_OV_CCCL_SEAWARD, FL_OV_ACSC_KEYS, FL_OV_WMD_SFWMD, FL_OV_UTIL_FPL …
  resolution: {
    method: "gis_point" | "place_boundary" | "user_selected";
    confidence: "high" | "medium" | "low";
    sourceVersions: Record<string, string>;
  };
}
```

- **MVP:** the U.S. Census Geocoder (geographies endpoint) returns county plus
  *incorporated place*, which is enough to decide city vs unincorporated. Filter
  out census-designated places. If the geocode fails, fall back to a
  user-picked county + city list, marked `user_selected` / `low`. Overlays that
  can't be resolved become **advisories**, never confirmed requirements: "Is
  this parcel seaward of the CCCL?"
- **Later:** FEMA NFHL (flood), FDEP CCCL GIS, WMD boundaries, local historic
  district layers for deep-tier cities, utility service territories. Each layer
  is a `regulatory_source` with a version, so a layer refresh flows through the
  existing proposal → batch → snapshot pipeline.
- Resolved location facts go through the **provenance gate** like any other
  fact (`scope: "business"|"property"`), so a stale address can't trigger
  requirements.

### 5.2 PR compatibility

PR's `municipalityName` input maps to a two-level stack
(`PR` → `MUN_BAYAMON`), and PR flags become attributes on the municipality
node. `KBMunicipality` stays as the PR-shaped view of a generic
`KBJurisdiction`.

### 5.3 Engine extensions (small, each behind tests)

1. **Jurisdiction-scoped baseline rules.** Generalize `rule_type: "municipality"`
   (really "universal baseline") into a `jurisdiction` rule with
   `jurisdiction_level` and an optional attribute gate:
   `requires_jurisdiction_attr: { level: "county", attr: "levies_btr", equals: true }`.
   Keep `"municipality"` as an alias so PR rules don't change.
2. **Overlay/attribute rules.** Generalize `municipality_flag` to match any
   attribute or overlay on any level of the stack. Widen the closed
   `Flag` union in `rulesEngine.ts`, which already lags the KB: it omits
   `industrial_port`, `airport_host` and `capital`.
3. **Conjunctive gates.** Add `requires_answers?: {question_id, expected_answer}[]`
   so an implementation can say "business type X **and** on-premises
   consumption". Today only `municipality_flag` + `business_type` can combine.
4. **Per-jurisdiction instances.** `GeneratedRequirement` gains
   `jurisdiction_id` + `authority_id`, and dedupe keys on
   `(document_id, jurisdiction_id)`. The county and city BTR then both render,
   labelled "Hillsborough County" and "City of Tampa".
5. **Preemption suppression.** A local implementation carrying
   `preempted_by: { source_id, scope }` is suppressed and recorded in
   `debug.rulesSuppressed` with the preempting statute, the same way negative
   facts are handled today.

### 5.4 rk graph and schema

- Add a `jurisdiction TEXT NOT NULL DEFAULT 'PR'` column to `rk_nodes`,
  `rk_change_proposals`, `rk_publication_batches` and `rk_kb_snapshots`. Also
  add `'CORE'` (concepts, questions, business types, industries) and `'US'`
  (federal docs and agencies), which every pack compile includes.
- Change `uq_rk_nodes_active` to `(jurisdiction, entity_id)` and
  `uq_rk_snapshot_active` to `(jurisdiction)` where active.
- New node types: `jurisdiction` (level, parent, attributes), `concept`,
  `overlay`, `concept_implementation`. New edges: `within` (hierarchy),
  `implements` (document → concept, scoped to a jurisdiction), `preempts`,
  `administered_in` (authority → jurisdiction).
- Keep the `municipality` node type readable for PR history.
- `rk/registry.ts` jurisdiction options come from the registry, not a literal
  list.
- `impact.ts` gains a new question: "which FL localities change if this concept
  rule changes?" The same diff machinery applies, run per jurisdiction snapshot.

### 5.5 Runtime selection

Today the jurisdiction is inlined at build time. **Recommendation:** make the
data layer per-jurisdiction now. Each business record carries `jurisdiction`,
and `/api/kb` serves the snapshot for that jurisdiction. Retrofitting this
later is expensive, while adding it now is cheap. Whether FL ships as its own
deployment or domain is a separate product decision and can still use the
build flag for branding. Professionals with clients in both PR and Florida need
the runtime path.

---

## 6. Florida data build

### 6.1 Tier 1: state layer (most of the requirement volume)

| Area | Authority | Main FL documents |
|---|---|---|
| Entity formation & upkeep | Dept of State / Sunbiz | Articles of Incorporation (Ch. 607), Articles of Organization (Ch. 605), foreign qualification, fictitious name (s. 865.09; **required**, 5-yr term), annual report (Jan 1–May 1) |
| State tax | DOR | Sales & use tax registration (DR-1, s. 212.18), reemployment tax (Ch. 443), transient rental tax, TPP return (DR-405, county-filed, s. 193.062), consumer's certificate of exemption |
| Workers' comp | DFS | coverage or exemption; thresholds by industry and head-count (Ch. 440) |
| Food & lodging | DBPR H&R | public food service, caterer, mobile food vehicle (s. 509.102), public lodging, vacation rental (dwelling/condo), food manager + food handler training |
| Food (non-restaurant) | FDACS | food establishment permit (Ch. 500) — retail, bakery, manufacturing |
| Alcohol & tobacco | DBPR ABT | license series (Ch. 561–565), retail tobacco permit (Ch. 569) |
| Professions & trades | DBPR / DOH MQA / Florida Bar | barbers/cosmetology (+ shop licenses), contractors (Ch. 489), health professions (Ch. 456) |
| Consumer-protection registrations | FDACS | motor vehicle repair shop, health studio, seller of travel, charitable solicitation (Ch. 496), petroleum inspection, pest control (verify each) |
| Child care / screening | DCF / AHCA | facility license (s. 402.305), Level 2 screening (Ch. 435) |
| Environmental | FDEP / WMDs | NPDES, MSGP, Title V/air GP, storage tanks, waste tires, ERP, CCCL, water use |
| Health facilities | DOH / AHCA | biomedical waste, body art, public pools, ALF/home health (AHCA) |
| Vehicles | FLHSMV | registration |

### 6.2 Tier 2: county authority matrix (67 rows)

One row per county, each cell source-linked, `null` meaning "not yet
captured" (never guessed):

`levies_county_btr`, `btr_portal`, `tdt_self_administered`, `tdt_rate_source`,
`childcare_local_licensing_agency`, `building_authority_unincorporated`,
`fire_authority_unincorporated`, `zoning_authority_unincorporated`,
`charter_county`, `ordinance_precedence_notes`, `alcohol_status (wet/dry/partial)`,
`local_air_program`, `storage_tank_program`, `wmd`, `local_for_hire_regulator`,
`consolidated_with` (Duval ⇄ Jacksonville).

This matrix is the Florida counterpart of `municipality_matrix.csv`. It is
the highest-leverage Florida asset because it covers every unincorporated
business in the state.

### 6.3 Tier 3: deep cities (≈25–30) and overlays

Per-city implementation rows (the existing `MunicipalImplementation` shape plus
`authority_id`): city BTR (levy, classification schedule, portal), zoning use
approval / Certificate of Use, building authority (own or county), fire
authority, sign permit, sidewalk café, noise, local STR registration (where
grandfathered), historic district review.

Suggested first metro: **South Florida (Miami-Dade, Broward, Palm Beach)**.
It has the largest business density, it's Spanish-dominant (the product is
already bilingual), and it's the hardest structurally (Miami-Dade's two-tier
government, Certificates of Use, many small cities), so it hardens the model
early. Then Tampa Bay, Orlando/Orange (including CFTOD), and Jacksonville
(consolidated).

**Tier 4 (long tail):** every other city resolves correctly through the county
matrix and state layer. City-level items render as `requirements_only` with an
advisory ("City of X may require a local business tax receipt, confirm with
the city"). This matches the existing rule that Bayamón-only sources are not
extrapolated to other municipalities.

### 6.4 New FL-only documents (not in PR)

County LBTR · City LBTR · Zoning use approval / Certificate of Use · DBPR food
service license · FDACS food establishment permit · DBPR vacation rental license
· County TDT registration/return · Food handler training · Retail tobacco
permit · Floodplain development permit / elevation certificate · CCCL permit ·
Environmental Resource Permit · Water use permit · Keys building allocation
(ACSC) · Owner-builder disclosure · Local vacation-rental registration · Motor
vehicle repair shop registration · Health studio registration · Seller of
travel registration · Charitable solicitation registration · Barbershop /
cosmetology salon license · Caterer license · Consumer's certificate of
exemption · Certificate of Status · FDOT outdoor advertising permit. That's about
25 documents, all `verify`.

### 6.5 New or changed questions

Keep all 90. Add these (names indicative):

- `Q_SEATING_CAPACITY`: DBPR vs FDACS routing; alcohol SFS qualification.
- `Q_FOOD_REVENUE_SHARE`: SFS alcohol license.
- `Q_STR_PROPERTY_CLASS` (single-family / condo / multi-unit): DBPR vacation
  rental class and condo HOA rules.
- `Q_CONSTRUCTION_INDUSTRY`: workers' comp threshold (1+ vs 4+).
- `Q_SEASONAL_AG_WORKERS`: ag workers' comp threshold.
- `Q_ON_SEWER`: pretreatment/grease vs septic.
- `Q_WATERFRONT_WORK` (seaward of CCCL, docks, seawalls): CCCL/ERP advisories
  when the overlay can't be resolved.
- `Q_POOL_SPA_PUBLIC`: DOH public pool permit.

Derived, never asked: county, city/unincorporated, overlays (from §5.1).
Re-word `Q_ENTITY_FOREIGN_CORP` to use `pack.meta.name`.

### 6.6 PR flags → FL overlays

| PR flag | FL treatment |
|---|---|
| `coastal` (43 municipalities) | **Parcel-level** `FL_OV_CCCL_SEAWARD` + `FL_OV_SFHA_*` (flood). Almost every FL county is coastal, so a municipality-level flag would be noise |
| `tourism` | county attribute `tdt_self_administered` + lodging/STR concepts (question-driven, not geography-driven) |
| `historic` | local historic district **polygons** in deep-tier cities (e.g. St. Augustine, Miami Beach, Key West, Ybor City — verify); advisory elsewhere |
| `metro` | drop. PR used it as a heuristic proxy; FL uses the real authority matrix |
| `capital` | drop |
| `island` | `FL_OV_ACSC_*` (Florida Keys / Key West) with its own documents (building allocation, Monroe County rules). The PR ferry rules don't carry over |
| `industrial_port` | port-district overlays (PortMiami, Port Everglades, JAXPORT, Port Tampa Bay, Port Canaveral, …) → port agreements; FDEP industrial rules stay question-driven |
| `airport_host` | customs-airport overlays (MIA, FLL, MCO, TPA, JAX, RSW, PBI, …): CBP/TSA docs reused as-is, concession docs per airport authority |
| *(new)* | `wet/dry` county, WMD region, electric-utility territory, charter county, special district, CRA |

---

## 7. Everything else that needs a Florida version

| Item | Action |
|---|---|
| `jurisdictions/fl/index.ts` | new pack: meta, geo labels (`County` / `City`), docMappings (fictitious name moves out of `recommended`), flagAdvisories → overlay advisories, documentIntelligence classes + extraction hints (BTR receipt, DBPR license, DR-1 certificate, Sunbiz filing) |
| `guidance/fl.ts` | new source-linked guidance concepts; start with the ~8 highest-volume docs, mirroring PR's first 8 |
| Renewals | FL cadences, each with a citation, e.g. LBTR annual, expiring Sept 30 (s. 205.053); annual report yearly (Jan 1–May 1); fictitious name every 5 years; DBPR/ABT licenses annual (verify); TPP return annual by April 1 |
| Forms | reuse federal; add DR-1, DR-405, Sunbiz formation filings, fictitious name. Florida filings are mostly online portals, so many implementations are `portal`, not `official_form` |
| Agency runs (`lib/agency-runs/filingTypes.ts`) | FL filing types; portal automation is separate scope |
| Monitoring sources/targets | FL statutes (leg.state.fl.us), F.A.C. (flrules.org), Sunbiz, DOR, DBPR, FDACS, FDEP, DCF, municode/American Legal for local codes, county tax collectors |
| Incentives | new FL catalog built from primary sources (FloridaCommerce programs, sales-tax exemptions, brownfields, federal Opportunity Zones). Each program's current status must be verified |
| QA agent doc | parametrize "experienced **Florida** regulatory reviewer"; FL scenario generator varies county vs city vs unincorporated |
| i18n / marketing | pack-sourced strings; brand decision (§10) |

---

## 8. Scenarios: same 25 goldens, Florida twins

Each PR golden (`qa/scenarioDefs.ts`) gets a twin with **the same profile and
answers**, and only the location changes. Locations are chosen so the suite
exercises every level of the stack. Twins start as `draft` goldens and flip to
`validated` after review, the same workflow PR uses.

| PR | Scenario | FL twin location | What it exercises |
|---|---|---|---|
| G01 | Restaurant + alcohol, 8 emp, LLC | City of Tampa (Hillsborough) | county + city BTR; DBPR food service; ABT license; local zoning sign-off |
| G02 | Restaurant, no alcohol, 3 emp | **Unincorporated** Orange County | county-only BTR/zoning/fire; workers' comp **not** required (non-construction < 4) |
| G03 | Bar, 5 emp | City of Miami (Miami-Dade) | Certificate of Use; quota/series license selection |
| G04 | Home bookkeeping, solo | City of Orlando | home occupation; s. 559.955 limits |
| G05 | Online IT consulting | Unincorporated Palm Beach County | minimal set; BTR still applies (verify) |
| G06 | Coastal STR, 1 unit | Destin (Okaloosa) | DBPR vacation rental; DOR + county TDT; local STR registration (verify) |
| G07 | Hotel, 25 emp, coastal | Miami Beach | public lodging; historic overlay; CCCL advisory; municipal resort tax (verify) |
| G08 | Clothing retail, 4 emp | Jacksonville (consolidated Duval) | consolidated government → one local BTR authority (verify) |
| G09 | E-commerce, solo | Gainesville (Alachua) | sales tax registration |
| G10 | Food truck, 2 emp | City of Tampa | DBPR MFDV; **preemption** of local licensing (s. 509.102) |
| G11 | Car wash, new site | Unincorporated Hillsborough | building permit; ERP; local environmental program (verify) |
| G12 | General contractor, 12 emp | Fort Lauderdale (Broward) | CILB certified vs registered; workers' comp 1+ construction |
| G13 | Barbershop, 3 emp | Hialeah (Miami-Dade) | barbershop license; workers' comp threshold |
| G14 | Medical office | Coral Gables | DOH MQA; biomedical waste |
| G15 | Daycare, 8 emp | West Palm Beach (Palm Beach) | **county local licensing agency** override of DCF (verify county list) |
| G16 | Auto repair | Tallahassee (Leon) | FDACS motor vehicle repair registration; hazwaste/used oil |
| G17 | Beverage manufacturing, 40 emp | Lakeland (Polk) | FDACS manufacturer permit; FDA; industrial stormwater |
| G18 | Farm, 2 emp | Unincorporated Polk | ag classification; ag workers' comp threshold |
| G19 | Law firm | St. Petersburg (Pinellas) | Florida Bar |
| G20 | Nonprofit, 5 emp | Sarasota | charitable solicitation; consumer's certificate of exemption |
| G21 | Convenience store + fuel | Ocala (Marion) | FDACS petroleum; FDEP storage tanks; beer/wine; tobacco permit |
| G22 | Bakery, 4 emp | St. Augustine (St. Johns) | DBPR-vs-FDACS routing on seating; historic district |
| G23 | Gym, 5 emp | Kissimmee (Osceola) | FDACS health studio registration |
| G24 | Tire recycling, port zone | Jacksonville near JAXPORT | FDEP waste-tire processor; port overlay |
| G25 | Catering, commercial kitchen | Fort Myers (Lee) | DBPR caterer license |

**FL-only scenarios** (new, no PR twin):

- F01/F02: the **same restaurant** inside a city vs in the unincorporated part
  of the same county. The pairwise diff must be exactly the local-layer
  documents.
- F03: Key West renovation (ACSC overlay).
- F04: beachfront renovation seaward of the CCCL (Walton or Flagler).
- F05: vacation rental in a condo (condo class + association approval).
- F06: bar in a dry county. The engine must say the license is unavailable
  there, not list it.
- F07: business in Lake Buena Vista (special district building/fire).
- F08: cottage-food home bakery (negative test: no permit under the threshold,
  verify s. 500.80).
- F09: registered contractor working outside their licensed locality.
- F10: address with a "Miami" mailing city that is in unincorporated
  Miami-Dade (resolver test).
- F11: a Spanish-language intake for any of the above.
- F12: an existing business renewal cycle (BTR expiring Sept 30).

The rule-coverage test (`qa/ruleCoverage.test.ts`) runs per pack. Every FL
implementation row must be hit by at least one scenario or be explicitly
waived.

---

## 9. Phasing

Sizes are relative (S/M/L/XL), not calendar commitments.

| Phase | Scope | Size | Exit criteria |
|---|---|---|---|
| **0. Decouple** | Remove the remaining PR coupling (§2 list); route the checkers and admin graph through the pack; pack-driven jurisdiction options; `Q_ENTITY_FOREIGN_CORP` wording | M | PR test suite green; no `kb/*.json` imports outside the pack |
| **1. Concept layer + multi-jurisdiction graph** | `concept`/`implementation` nodes; compile expansion; `jurisdiction` columns; per-jurisdiction snapshots; engine extensions 1–5 behind flags; PR re-expressed with an identity implementation map | L | **all 25 validated PR goldens byte-identical**; rk golden parity (`npm run rk:golden`) green |
| **2. FL geography + resolver** | 67 counties + incorporated municipalities + unincorporated areas imported from an authoritative list; Census-geocoder resolver; user-select fallback | M | F10 passes; every city maps to exactly one county |
| **3. FL state layer** | Tier 1 documents, implementations, renewals, guidance for top docs; FL pack skeleton registered | XL | the 25 twins produce a plausible draft; every carried-over concept rule has an FL disposition |
| **4. County matrix** | 67-row authority matrix, source-linked | L | all unincorporated scenarios resolve with named authorities |
| **5. Deep metro + overlays** | South Florida cities, then Tampa Bay / Orlando / Jacksonville; flood + CCCL + historic + ACSC + utility overlays | XL | F01–F09 validated |
| **6. Validate + launch** | Legal review of the goldens; FL QA-agent loop; forms (DR-1 etc.); FL incentive catalog; marketing/i18n | L | goldens validated; QA loop clean for N consecutive cycles |

Phases 2 and 3 can run in parallel once Phase 1 lands. The data work in phases
3–5 is the bulk of the effort.

---

## 10. Decisions needed

1. **Deployment model:** a separate FL deployment/brand, or one app with
   per-business jurisdiction? Recommendation: per-business jurisdiction in the
   data layer either way (§5.5). Branding can be separate.
2. **Brand name** for the FL product ("SmartPR" is PR-specific).
3. **First deep metro:** recommend South Florida (§6.3).
4. **Legal verifier:** who signs off Florida `verified` rules and goldens,
   the counterpart of the PR deep-research legal review batches.
5. **Geo data sources:** Census geocoder alone for the MVP, or budget for
   parcel-level GIS layers (flood, CCCL) from the start.

## 11. Risks

- **Local long tail.** Several hundred cities, each with its own code. Mitigate
  with tiering and an honest `requirements_only` default. Never extrapolate
  one city's rules to another.
- **Preemption churn.** Florida's legislature regularly preempts local
  regulation. Model preemption as sourced edges and add session-year monitoring
  of statutes.
- **Refactor regressions in PR.** Mitigated by the identity-map rule in Phase 1:
  no FL work merges until the PR goldens are byte-identical.
- **Address ambiguity.** Mailing city ≠ jurisdiction. Resolve from coordinates
  and show the resolved jurisdiction to the user for confirmation.
- **Over-carrying PR rules.** A PR rule that "obviously" applies can be wrong in
  Florida. Every carried rule starts `heuristic` until an FL source is attached.
