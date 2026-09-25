/**
 * Deterministic semantic reading of a project/business description.
 *
 * This is the baseline the model's reading is checked against, and the
 * fallback when the model is unavailable. It reads RELATIONSHIPS, not nouns:
 *
 *   "leased an existing 12,000-square-foot warehouse and office facility"
 *     → property.ownershipStatus = leased (the verb relates the subject to
 *       the property), property.existingUse = warehouse_and_office (the
 *       object of the verb), property.existingBuilding = true ("existing"
 *       modifies that object), property.squareFeet = 12000
 *   "for a new commercial operation"
 *     → property.proposedUse = commercial_operation, specificity insufficient.
 *       It says nothing about whether the BUSINESS is new.
 *   "converting an existing warehouse into a daycare"
 *     → existingUse warehouse, proposedUse daycare, change of use confirmed.
 *
 * A word only counts in the role the sentence gives it: "warehouse" after
 * "into" is a proposed use, after "leased" an existing one. A negated mention
 * ("no structural work") is an explicit false. Anything not stated stays
 * absent (unknown) — nothing is defaulted.
 */
import municipalitiesJson from "../../../../kb/municipalities.json";
import {
  emptyScenario,
  type FactSource,
  type ScenarioContext,
  type ScenarioFact,
} from "./types";
import { matchUse, matchUses, usesDiffer, type UseTerm } from "./uses";

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

interface Hit {
  index: number;
  text: string;
  groups: (string | undefined)[];
}

function find(text: string, re: RegExp, from = 0): Hit | null {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const g = new RegExp(re.source, flags);
  g.lastIndex = from;
  const m = g.exec(text);
  return m ? { index: m.index, text: m[0], groups: m.slice(1) } : null;
}

function findAll(text: string, re: RegExp): Hit[] {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const g = new RegExp(re.source, flags);
  const out: Hit[] = [];
  let m: RegExpExecArray | null;
  while ((m = g.exec(text))) {
    out.push({ index: m.index, text: m[0], groups: m.slice(1) });
    if (m[0].length === 0) g.lastIndex++;
  }
  return out;
}

/** The clause (sentence) containing `index`, verbatim, capped for display. */
export function clauseAt(text: string, index: number, max = 180): string {
  let start = index;
  while (start > 0 && !/[.;!?\n]/.test(text[start - 1])) start--;
  let end = index;
  while (end < text.length && !/[.;!?\n]/.test(text[end])) end++;
  let clause = text.slice(start, end).trim();
  if (clause.length > max) {
    const rel = index - start;
    const from = Math.max(0, Math.min(clause.length - max, rel - Math.floor(max / 3)));
    clause = clause.slice(from, from + max).trim();
  }
  return clause;
}

const NEGATORS = /\b(?:no|not|without|won't|will not|wont|none|never|nor|excluding|excludes)\b/i;

/** Is the mention at `index` negated within its own clause? ("no structural or exterior work") */
function negatedAt(text: string, index: number): boolean {
  let start = index;
  while (start > 0 && !/[.;!?\n,]/.test(text[start - 1]) && index - start < 45) start--;
  const before = text.slice(start, index);
  if (!NEGATORS.test(before)) return false;
  // "no demolition, but electrical work" — a "but" after the negator resets it.
  const lastNeg = before.search(/\b(?:no|not|without|won't|will not|none|never|nor)\b(?![\s\S]*\b(?:no|not|without|won't|will not|none|never|nor)\b)/i);
  const afterNeg = before.slice(lastNeg);
  return !/\bbut\b|\bhowever\b/i.test(afterNeg);
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// ---------------------------------------------------------------------------
// Fact constructors
// ---------------------------------------------------------------------------

function fact<T>(value: T, source: FactSource, confidence: number, evidenceText: string): ScenarioFact<T> {
  return { value, source, confidence, evidenceText };
}

const said = <T>(value: T, text: string, hit: Hit, confidence = 0.95) =>
  fact(value, "explicit", confidence, clauseAt(text, hit.index));
const implied = <T>(value: T, text: string, hit: Hit, confidence = 0.75) =>
  fact(value, "inferred", confidence, clauseAt(text, hit.index));

// ---------------------------------------------------------------------------
// Business status
// ---------------------------------------------------------------------------

const ENTITY_WORDS = "llc|l\\.l\\.c\\.?|corporation|corp\\.?|company|entity|firm|partnership|nonprofit|non-profit|cooperative";

/**
 * A NEW business means a new legal entity or a business being started from
 * nothing. "A new commercial operation", "a new location", "a new operation"
 * are NOT new businesses — an existing company opens locations too.
 */
export const NEW_ENTITY_RE = new RegExp(
  [
    `\\b(?:creat|form|start|launch|incorporat|register|organiz|establish|set(?:ting)?\\s+up)\\w*\\s+(?:up\\s+)?(?:a|an|my|our|the)?\\s*(?:brand[\\s-])?new\\s+(?:${ENTITY_WORDS}|business)\\b`,
    `\\b(?:creat|form|incorporat|register|organiz|establish|set(?:ting)?\\s+up)\\w*\\s+(?:a|an|my|our)\\s+(?:${ENTITY_WORDS})\\b`,
    `\\b(?:start|launch|open)\\w*\\s+(?:a|an|my|our)\\s+(?:own\\s+)?(?:new\\s+)?business\\b`,
    `\\b(?:newly\\s+(?:formed|created|organized)|not\\s+yet\\s+(?:formed|registered|incorporated))\\s+(?:${ENTITY_WORDS}|business)\\b`,
    `\\ba\\s+new\\s+(?:llc|l\\.l\\.c\\.?|corporation|corp\\.?)\\b`,
  ].join("|"),
  "i"
);

export const EXISTING_BUSINESS_RE = new RegExp(
  [
    `\\b(?:our|my)\\s+(?:existing\\s+|current\\s+|established\\s+|family\\s+)?(?:company|business|firm|corporation|corp|llc|organization|store|restaurant|shop|clinic|practice|brand|group|bakery|operations)\\b`,
    `\\bexisting\\s+(?:[A-Za-z-]+\\s+){0,3}(?:company|business|firm|corporation|llc|entity|client\\s+company)\\b`,
    `\\b(?:is|are)\\s+expanding\\s+(?:into|to)\\b`,
    `\\bwe\\s+(?:already\\s+|currently\\s+)?(?:operate|run|own\\s+and\\s+operate)\\b`,
    `\\balready\\s+(?:operating|in\\s+business|established|registered|incorporated)\\b`,
    `\\b(?:relocat|expand|mov)\\w*\\s+(?:our|my)\\s+(?:business|company|operations?)\\b`,
    `\\b(?:our|my)\\s+(?:second|another|additional|new)\\s+(?:location|branch|site|store|facility)\\b`,
    `\\bin\\s+business\\s+(?:for|since)\\b`,
  ].join("|"),
  "i"
);

/**
 * "I want to open a restaurant" usually means a new business, but an existing
 * owner says the same about a second site — an inference, never a statement.
 * "Open a new location / branch / operation" never counts.
 */
export const OPEN_INTENT_RE =
  /\b(?:i|we)\s+(?:want|plan|am\s+planning|are\s+planning|intend|would\s+like|'d\s+like|hope|am\s+going|are\s+going)\s+to\s+(?:open|start|launch)\s+(?:a|an|my)\s+(?!(?:new\s+)?(?:location|branch|site|facility|operation|commercial\s+operation)\b|second\b|another\b|additional\b)/i;

function readBusinessStatus(text: string, ctx: ScenarioContext): void {
  const neu = find(text, NEW_ENTITY_RE);
  const old = find(text, EXISTING_BUSINESS_RE);
  const open = find(text, OPEN_INTENT_RE);
  // An existing owner forming a new entity for this project: the entity that
  // will operate is new, so "new" governs formation requirements.
  if (neu) ctx.business.status = said("new", text, neu, 0.93);
  else if (old) ctx.business.status = said("existing", text, old, 0.92);
  else if (open) ctx.business.status = implied("new", text, open, 0.72);
}

// ---------------------------------------------------------------------------
// Business identity: legal name, entity type, industry
// ---------------------------------------------------------------------------

const ENTITY_SUFFIXES: [RegExp, string][] = [
  [/^(?:llc|l\.l\.c\.?)$/i, "llc"],
  [/^(?:inc\.?|incorporated|corp\.?|corporation)$/i, "corporation"],
  [/^(?:llp|l\.l\.p\.?)$/i, "limited_liability_partnership"],
  [/^(?:csp|psc|p\.s\.c\.?)$/i, "professional_corporation"],
];
const entityTypeOf = (suffix: string) => ENTITY_SUFFIXES.find(([re]) => re.test(suffix))?.[1] ?? null;
const NAME_STOP = /^(?:the|a|an|our|my|this|that|puerto|rico)$/i;
// "Caribe Precision Manufacturing, LLC": capitalized words ending in an entity suffix.
const LEGAL_NAME =
  /\b((?:[A-Z][A-Za-z0-9&'.-]*\s+){0,6}[A-Z][A-Za-z0-9&'.-]*),?\s+(LLC|L\.L\.C\.?|Inc\.?|Corp\.?|Corporation|LLP|CSP|PSC)(?![A-Za-z])/;

function readBusinessIdentity(text: string, ctx: ScenarioContext): void {
  const m = LEGAL_NAME.exec(text);
  if (m) {
    const words = m[1].trim().split(/\s+/);
    while (words.length && NAME_STOP.test(words[0])) words.shift();
    if (words.length) {
      const suffix = m[2].replace(/\.$/, "");
      const hit: Hit = { index: m.index, text: m[0], groups: [] };
      ctx.business.name = said(`${words.join(" ")} ${suffix.toUpperCase() === "L.L.C" ? "LLC" : suffix}`, text, hit, 0.94);
      const type = entityTypeOf(suffix);
      if (type) ctx.business.entityType = said(type, text, hit, 0.93);
    }
  }
  if (!ctx.business.entityType) {
    const isA = find(text, /\b(?:is|as)\s+an?\s+(llc|l\.l\.c\.?|corporation|corp\.?|partnership|nonprofit)\b/i);
    const type = isA?.groups[0] ? entityTypeOf(isA.groups[0]) ?? (/partnership/i.test(isA.groups[0]) ? "partnership" : /nonprofit/i.test(isA.groups[0]) ? "nonprofit_nonstock_corporation" : null) : null;
    if (isA && type) ctx.business.entityType = said(type, text, isA, 0.92);
  }
  const industry = find(text, /\bin\s+the\s+([a-z][a-z &-]{2,40}?)\s+(?:industry|sector)\b/i);
  if (industry?.groups[0]) {
    const words = industry.groups[0].trim().replace(/\s+/g, " ");
    ctx.business.industry = said(words.replace(/\b\w/g, (c) => c.toUpperCase()), text, industry, 0.92);
  }
}

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

const MUNICIPALITIES: string[] = (municipalitiesJson as { name: string }[])
  .map((m) => m.name)
  .sort((a, b) => b.length - a.length);

function readMunicipality(text: string, ctx: ScenarioContext): void {
  const plain = stripAccents(text);
  let best: { name: string; hit: Hit; located: boolean } | null = null;
  for (const name of MUNICIPALITIES) {
    const re = new RegExp(`\\b${stripAccents(name).replace(/\s+/g, "\\s+")}\\b`, "i");
    const hit = find(plain, re);
    if (!hit) continue;
    const located = /\b(?:in|at|en|near|located\s+in|based\s+in|de)\s+$/i.test(plain.slice(Math.max(0, hit.index - 14), hit.index));
    if (!best || (located && !best.located) || (located === best.located && hit.index < best.hit.index)) {
      best = { name, hit, located };
    }
  }
  if (best) ctx.property.municipality = said(best.name, text, best.hit, best.located ? 0.95 : 0.88);
}

function readAddress(text: string, ctx: ScenarioContext): void {
  const addr = find(
    text,
    /\b\d{1,5}\s+(?:calle|c\/|ave(?:nue|nida)?\.?|carr(?:etera)?\.?|road|rd\.?|street|st\.?|blvd\.?|boulevard|km\.?)\s+[^,.;\n]{2,60}/i
  );
  if (addr) ctx.property.address = fact(addr.text.trim(), "explicit", 0.9, clauseAt(text, addr.index));
  const parcel = find(text, /\b(?:parcel|catastro|cadastral(?:\s+number)?|lot)\s*(?:number|no\.?|#)?\s*[:#]?\s*(\d[\d-]{4,})/i);
  if (parcel?.groups[0]) ctx.property.parcel = fact(parcel.groups[0], "explicit", 0.92, clauseAt(text, parcel.index));
}

// ---------------------------------------------------------------------------
// Property: the object of a property verb
// ---------------------------------------------------------------------------

const PROPERTY_VERB =
  /\b(?:leas(?:e|ed|es|ing)|rent(?:ed|ing)?|subleas\w*|bought|purchas\w*|acquir\w*|own(?:s|ed)?|renovat\w*|remodel\w*|rehabilitat\w*|convert\w*|occup(?:y|ies|ied|ying)|took\s+over|taking\s+over|moving\s+into|move\s+into|found|expand\w*)\b/gi;

/** Where the object phrase of a property verb ends. */
const OBJECT_STOP =
  /\s+(?:in|into|for|to|at|on|near|which|that|where|located|but|because|so|and\s+(?:plan|want|will|intend|are|is|we|they)|,\s*(?:and\s+)?(?:we|they|the\s+client|including|which|where))\b|,(?!\d)|[;!?\n]|\.(?!\d)/i;

const BUILDING_WORD = /\b(?:facility|building|space|property|premises|site|unit|warehouse|offices?|store|restaurant|plant|factory|daycare|school|clinic|house|home|structure|bay)\b/i;

function readProperty(text: string, ctx: ScenarioContext): void {
  for (const verb of findAll(text, PROPERTY_VERB)) {
    const rest = text.slice(verb.index + verb.text.length);
    const stop = rest.search(OBJECT_STOP);
    const object = (stop >= 0 ? rest.slice(0, stop) : rest).slice(0, 120);
    if (!object.trim()) continue;
    // "renovate it" / "convert it" — the object is a pronoun; nothing new here.
    const uses = matchUses(object).filter((u) => !u.generic);
    const isBuilding = BUILDING_WORD.test(object);
    if (!uses.length && !isBuilding) continue;

    if (uses.length && !ctx.property.existingUse) {
      const label = uses.slice(0, 2).map((u) => u.label).join("_and_");
      ctx.property.existingUse = said(label, text, verb, 0.93);
    }
    // A vacant lot has no building on it.
    if (uses.some((u) => u.family === "vacant")) {
      ctx.property.existingBuilding = said(false, text, verb, 0.95);
      continue;
    }
    if (!ctx.property.existingBuilding) {
      const existingWord = find(object, /\b(?:existing|vacant|former|current|old|empty)\b/i);
      if (existingWord) {
        ctx.property.existingBuilding = fact(true, "explicit", 0.95, clauseAt(text, verb.index));
      } else if (!/\b(?:build|construct)\w*\b/i.test(verb.text)) {
        // Leasing, buying, renovating or converting a building means the
        // building already exists — a safe inference, still not a statement.
        ctx.property.existingBuilding = fact(true, "inferred", 0.82, clauseAt(text, verb.index));
      }
    }
  }
}

function readSize(text: string, ctx: ScenarioContext): void {
  const sq = find(
    text,
    /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?\s*[-\s]?(?:square[\s-]*(?:foot|feet|ft)|sq\.?\s*ft\.?|sf\b|ft2|pies\s+cuadrados)/i
  );
  if (!sq?.groups[0]) return;
  let n = Number(sq.groups[0].replace(/,/g, ""));
  if (sq.groups[1]) n *= 1000;
  if (Number.isFinite(n) && n > 0) ctx.property.squareFeet = said(n, text, sq, 0.96);
}

/** Leasing OUT ("for lease to tenants", "rent it out") says what the owner will do, not the tenure. */
const LEASE_OUT = /\bfor\s+(?:lease|rent)\b|\b(?:leas|rent)\w*\s+(?:it|them|the\s+\w+|space|units?|suites?)?\s*(?:out\s+)?to\s+(?:tenants?|others|third[\s-]part\w*|businesses)\b|\brent\w*\s+(?:it|them)\s+out\b/gi;

function readOwnership(text: string, ctx: ScenarioContext): void {
  const tenureText = text.replace(LEASE_OUT, (m) => " ".repeat(m.length));
  const lease = find(tenureText, /\b(?:leas(?:e|ed|es|ing)|rent(?:ed|ing|s)?|subleas\w*|as\s+(?:a\s+)?tenants?)\b/i);
  const own = find(
    text,
    /\b(?:we|i|they|the\s+client|the\s+company|client)\s+(?:own|owns|purchased|bought|acquired)\b|\b(?:purchased|bought|acquired)\s+(?:an?|the)\s+\w+|\bowners?\s+of\s+the\s+(?:property|building)\b/i
  );
  if (lease && !negatedAt(text, lease.index)) ctx.property.ownershipStatus = said("leased", text, { ...lease, text: text.slice(lease.index, lease.index + lease.text.length) }, 0.94);
  else if (own && !negatedAt(text, own.index)) ctx.property.ownershipStatus = said("owned", text, own, 0.93);
}

// ---------------------------------------------------------------------------
// Proposed use and change of use
// ---------------------------------------------------------------------------

const CONVERT_INTO = /\b(?:convert\w*|turn\w*|transform\w*|repurpos\w*|chang\w*)\b[^.;!?]*?\binto\s+(?:an?\s+|the\s+)?([^,.;!?\n]+)/i;
const CONTINUE_SAME =
  /\b(?:continu\w*\s+(?:to\s+use|using|to\s+operate|operating)\s+(?:it|the\s+(?:property|building|space|facility|site))?\s*as\s+(?:an?\s+)?([^,.;!?\n]+)|(?:keep|remain|stay)\w*\s+(?:it\s+)?(?:as\s+)?(?:an?\s+)?([a-z]+)\b|\bsame\s+use\b|\bno\s+change\s+(?:of|in|to)\s+(?:the\s+)?(?:use|occupancy)\b|\buse\s+(?:will\s+)?(?:not|won't)\s+change\b)/i;
const FOR_USE =
  /\b(?:for|to\s+(?:operate|run|open|house|host|use\s+it\s+as|use\s+as)|will\s+be\s+used\s+(?:as|for)|used\s+as)\s+(?:an?\s+|our\s+|the\s+|its\s+)?([a-z][a-z\s/&-]{2,50}?)(?=[,.;!?\n]|\s+(?:in|at|with|including|which|where|and\s+(?:plan|will|want|we))\b|$)/gi;
const CHANGE_OF_USE_STATED = /\bchang\w*\s+(?:of|the|in)\s+(?:the\s+)?(?:use|occupancy)\b|\bchang\w*\s+the\s+(?:property's\s+|building's\s+)?(?:use|occupancy)\b/i;
const USE_MODIFIED = /\b(?:modif\w*|alter\w*|adjust\w*)\s+(?:to\s+|of\s+|in\s+)?(?:the\s+)?(?:existing\s+|current\s+)?(?:use|occupancy)\b/i;

function setProposed(ctx: ScenarioContext, use: UseTerm, source: FactSource, confidence: number, evidence: string, phrase?: string): void {
  ctx.property.proposedUse = fact(use.label, source, confidence, evidence);
  ctx.property.proposedUseSpecificity = fact(use.generic ? "insufficient" : "specific", source, confidence, evidence) as ScenarioFact<"specific" | "insufficient">;
  // The use label is the occupancy class; the activity keeps the user's own
  // qualifier ("furniture manufacturing"), so the graph never asks for the
  // exact activity the description already gave.
  const words = activityPhrase(phrase, use);
  if (!use.generic && words) {
    ctx.operations.activity = fact(words, source, confidence, evidence);
    ctx.business.proposedActivity = fact(words, source, confidence, evidence);
  }
}

/** "a new furniture manufacturing" → "furniture manufacturing"; null when it adds nothing to the use term. */
function activityPhrase(phrase: string | undefined, use: UseTerm): string | null {
  if (!phrase) return null;
  const cleaned = phrase
    .toLowerCase()
    .replace(/\b(?:an?|the|our|its|their|new|small|light|proposed)\b/g, " ")
    .replace(/[^a-z0-9\s&/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = new RegExp(`\\b(?:${use.pattern})\\b`, "i").exec(cleaned);
  if (!m) return null;
  const qualified = cleaned.slice(0, m.index + m[0].length).trim();
  const n = qualified.split(" ").length;
  return n >= 2 && n <= 4 ? qualified : null;
}

function readProposedUse(text: string, ctx: ScenarioContext): void {
  const existing = ctx.property.existingUse?.value;

  // 1. "converting X into Y" — the strongest statement of a new use.
  const conv = find(text, CONVERT_INTO);
  if (conv?.groups[0]) {
    const use = matchUse(conv.groups[0]);
    if (use) {
      setProposed(ctx, use, "explicit", 0.95, clauseAt(text, conv.index), conv.groups[0]);
      if (!use.generic) {
        const differ = existing ? usesDiffer(existing, use.label) : true;
        ctx.project.possibleChangeOfUse = fact(differ !== false, "explicit", 0.93, clauseAt(text, conv.index));
      }
      return;
    }
  }

  // 2. "continue using it as a warehouse" / "no change of use".
  const same = find(text, CONTINUE_SAME);
  if (same && !/\bnot\s+continu/i.test(text.slice(Math.max(0, same.index - 8), same.index + 12))) {
    const named = same.groups[0] ?? same.groups[1];
    const use = named ? matchUse(named) : null;
    if (use && !use.generic) setProposed(ctx, use, "explicit", 0.94, clauseAt(text, same.index));
    else if (existing) {
      const ex = matchUse(existing.replace(/_and_/g, " "));
      if (ex) setProposed(ctx, { ...ex, label: existing }, "explicit", 0.9, clauseAt(text, same.index));
    }
    ctx.project.possibleChangeOfUse = said(false, text, same, 0.94);
    return;
  }

  // 3. "for manufacturing", "to operate a warehouse", "for a new commercial operation".
  for (const hit of findAll(text, FOR_USE)) {
    const phrase = hit.groups[0] ?? "";
    const use = matchUse(phrase);
    if (!use) continue;
    // "leased a warehouse for …" — the object of the lease is not the proposed use.
    setProposed(ctx, use, "explicit", use.generic ? 0.9 : 0.93, clauseAt(text, hit.index), phrase);
    if (!use.generic) {
      // "used for furniture manufacturing, warehousing, and administrative
      // offices": a mixed use — every listed use, in order.
      const list = text.slice(hit.index).split(/[.;!?]/)[0];
      const all = matchUses(list).filter((u) => !u.generic).slice(0, 3);
      if (all.length > 1 && all[0].label === use.label) {
        ctx.property.proposedUse = fact(all.map((u) => u.label).join("_and_"), "explicit", 0.93, clauseAt(text, hit.index));
      }
      break;
    }
  }
}

function readChangeOfUse(text: string, ctx: ScenarioContext): void {
  if (ctx.project.possibleChangeOfUse) return;
  const stated = find(text, CHANGE_OF_USE_STATED);
  if (stated) {
    ctx.project.possibleChangeOfUse = negatedAt(text, stated.index)
      ? said(false, text, stated, 0.92)
      : said(true, text, stated, 0.9);
    return;
  }
  // "modifications to the existing use": the use may change, but that is
  // not confirmed until we know the activity and the authorized use.
  const modified = find(text, USE_MODIFIED);
  if (modified) {
    ctx.project.possibleChangeOfUse = implied(true, text, modified, 0.72);
    return;
  }
  // Existing vs. proposed use alone does NOT establish a change of use: what
  // matters is the use the property is AUTHORIZED for, which the graph asks.
}

// ---------------------------------------------------------------------------
// Project scope
// ---------------------------------------------------------------------------

function flag(text: string, re: RegExp): ScenarioFact<boolean> | undefined {
  const hit = find(text, re);
  if (!hit) return undefined;
  return negatedAt(text, hit.index) ? said(false, text, hit, 0.93) : said(true, text, hit, 0.94);
}

function readProjectScope(text: string, ctx: ScenarioContext): void {
  const types: string[] = [];
  const reno = find(
    text,
    /\b(?:renovat\w*|remodel\w*|rehabilitat\w*|build[\s-]?outs?|fit[\s-]?outs?|alterations?|interior\s+(?:work|improvements?)|tenant\s+improvements?|convert\w*|conversion|refurbish\w*)\b/i
  );
  if (reno && !negatedAt(text, reno.index)) {
    ctx.project.renovation = said(true, text, reno, 0.95);
    types.push("renovation");
  }
  const build = find(text, /\bnew\s+construction\b|\b(?:build|construct)\w*\s+(?:a\s+)?new\s+(?:building|facility|structure|warehouse|plant)|\bground[\s-]up\b/i);
  if (build && !negatedAt(text, build.index)) types.push("new_construction");
  const expand = find(text, /\bexpan\w*\s+(?:the\s+|our\s+)?(?:building|facility|warehouse|footprint|structure)\b|\b(?:building\s+)?addition\s+to\s+the\s+(?:building|structure)\b/i);
  if (expand && !negatedAt(text, expand.index)) {
    types.push("expansion");
    ctx.project.footprintChange = said(true, text, expand, 0.9);
  }

  const interior = find(text, /\binterior\s+demo(?:lition)?\b|\bdemolish\w*\s+(?:the\s+)?interior\b|\bgut\w*\s+the\s+interior\b|\bselective\s+demolition\b/i);
  const full = find(text, /\b(?:demolish\w*|tear\w*\s+down|raz\w*)\s+(?:the\s+)?(?:entire\s+|whole\s+|existing\s+)?(?:building|structure|warehouse|facility)\b/i);
  const partial = find(text, /\bpartial\s+demolition\b/i);
  const noDemo = find(text, /\bno\s+demolition\b|\bwithout\s+(?:any\s+)?demolition\b/i);
  if (noDemo) ctx.project.demolition = said("none", text, noDemo, 0.94);
  else if (full) ctx.project.demolition = said("full", text, full, 0.93);
  else if (partial) ctx.project.demolition = said("partial", text, partial, 0.93);
  else if (interior) ctx.project.demolition = said("interior", text, interior, 0.95);
  if (ctx.project.demolition && ctx.project.demolition.value !== "none") types.push("demolition");

  ctx.project.electricalWork = flag(text, /\belectrical\b/i);
  ctx.project.plumbingWork = flag(text, /\bplumbing\b/i);
  ctx.project.mechanicalWork = flag(text, /\b(?:mechanical|hvac|air[\s-]conditioning)\b/i);
  ctx.project.structuralWork = flag(text, /\bstructural\b/i);
  ctx.project.exteriorWork = flag(text, /\b(?:exterior|fa[cç]ade|roof(?:ing)?)\b/i);
  ctx.project.layoutChanges = flag(text, /\blayout\b|\bpartitions?\b|\bnew\s+walls\b|\breconfigur\w*|\bfloor\s+plan\b|\b(?:office\s+)?build[\s-]?outs?\b/i);
  ctx.project.officeBuildout = flag(text, /\boffice\s+build[\s-]?outs?\b|\bbuild[\s-]?out\s+(?:of\s+)?(?:the\s+|new\s+)?offices?\b/i);
  ctx.project.siteCirculationChanges = flag(text, /\b(?:parking|loading\s+(?:dock|zone|area)s?|driveway|site\s+circulation|access\s+road|curb\s+cut)\b/i);
  if (!ctx.project.footprintChange) ctx.project.footprintChange = flag(text, /\bfootprint\b/i);

  if (ctx.project.possibleChangeOfUse?.value === true && ctx.project.possibleChangeOfUse.source === "explicit") {
    types.push("change_of_use");
  }
  if (types.length) {
    const evidence = reno ? clauseAt(text, reno.index) : ctx.project.demolition?.evidenceText ?? "";
    ctx.project.type = fact([...new Set(types)], "explicit", 0.92, evidence);
  }
  for (const key of Object.keys(ctx.project) as (keyof ScenarioContext["project"])[]) {
    if (ctx.project[key] === undefined) delete ctx.project[key];
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function readOperations(text: string, ctx: ScenarioContext): void {
  const proposed = ctx.property.proposedUse;
  if (proposed && ctx.property.proposedUseSpecificity?.value === "specific" && !ctx.operations.activity) {
    ctx.operations.activity = { ...proposed };
    ctx.business.proposedActivity = { ...proposed };
  }
  const staff = find(text, /\b(\d{1,5})\s+(?:full[\s-]time\s+|part[\s-]time\s+)?(?:employees|workers|staff(?:\s+members)?|people)\b/i);
  if (staff?.groups[0]) ctx.operations.employees = said(Number(staff.groups[0]), text, staff, 0.95);
  const set = (key: keyof ScenarioContext["operations"], re: RegExp) => {
    const f = flag(text, re);
    if (f) (ctx.operations as Record<string, ScenarioFact<unknown>>)[key] = f;
  };
  set("generator", /\b(?:emergency\s+)?generators?\b/i);
  set("fuel_storage" as never, /\bfuel\s+(?:storage|tanks?)\b|\bdiesel\s+tanks?\b|\bunderground\s+storage\s+tanks?\b/i);
  set("hazardousMaterials", /\bhazardous\s+(?:materials?|substances?|chemicals?|waste)\b|\bchemicals?\b/i);
  set("emissionsEquipment", /\b(?:air\s+)?emissions?\b|\bboilers?\b|\b(?:paint|spray)\s+booths?\b|\bincinerat\w*|\bsmoke\s*stacks?\b/i);
  set("wastewaterDischarge", /\bwaste\s?water\b|\bindustrial\s+discharge\b|\bdischarg\w*\s+(?:to|into)\b|\bgrease\s+traps?\b/i);
  set("foodService", /\bfood\s+service\b|\b(?:serve|prepare|cook)\w*\s+food\b/i);
  set("publicAccess", /\bopen\s+to\s+the\s+public\b|\bcustomers?\s+(?:will\s+)?(?:visit|come\s+in)\b|\bwalk[\s-]in\s+customers?\b/i);
  const fuel = (ctx.operations as Record<string, unknown>)["fuel_storage"];
  if (fuel) {
    ctx.operations.fuelStorage = fuel as ScenarioFact<boolean>;
    delete (ctx.operations as Record<string, unknown>)["fuel_storage"];
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Read a description into a ScenarioContext. Pure and deterministic. */
export function interpretScenario(description: string): ScenarioContext {
  const text = (description ?? "").replace(/\s+/g, " ").trim();
  const ctx = emptyScenario();
  if (!text) return ctx;
  readBusinessStatus(text, ctx);
  readBusinessIdentity(text, ctx);
  readMunicipality(text, ctx);
  readAddress(text, ctx);
  readProperty(text, ctx);
  const existingBuilding = find(text, /\b(?:the|an?)\s+existing\s+(?:building|facility|structure)\b|\bcurrently\s+(?:configured|built\s+out|used)\s+as\b/i);
  if (existingBuilding && ctx.property.existingBuilding?.value !== false) ctx.property.existingBuilding = said(true, text, existingBuilding, 0.94);
  readSize(text, ctx);
  readOwnership(text, ctx);
  readProposedUse(text, ctx);
  readChangeOfUse(text, ctx);
  readProjectScope(text, ctx);
  readOperations(text, ctx);
  return ctx;
}
