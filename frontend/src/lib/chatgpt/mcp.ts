// SmartPR ChatGPT MCP server (MCP Apps) — stateless JSON-RPC 2.0 over
// Streamable HTTP, mirroring the voice MCP pattern (lib/voice/mcp.ts).
//
// Curated tools only: assess_scenario, refine_scenario, create_portal_handoff.
// No account data, no DB, no writes. Anonymous free-preview triage; the full
// (paid) assessment is never returned here.

import { assessScenario, normalizeScenario, CHATGPT_SERVER_VERSION, type NormalizedScenario, type ScenarioInput } from "./assessment";
import { createHandoffToken, HandoffError, type HandoffIntent } from "./handoff";
import { WIDGET_URI, WIDGET_URI_ALIASES, WIDGET_MIME, widgetHtml } from "./widget";
import { siteDetailsFor, type SiteLookups } from "./siteLookup";

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_NAME = "smartpr-chatgpt";

const INSTRUCTIONS =
  "SmartPR gives preliminary Puerto Rico business permit/registration requirements from SmartPR's deterministic rules engine — never answer requirements from model knowledge. " +
  "Call assess_scenario with the facts the user stated (leave unknowns out; never guess). Ask the returned clarifying questions, then call refine_scenario with the previous scenario plus answers. " +
  "The widget shows a draggable map pin (an approximate downtown pin when only the municipality is known); dropping or dragging it sets the exact site and municipality. When scenario.site is present, ALWAYS pass site {latitude, longitude} (or the full prior scenario including site) on every later assess_scenario/refine_scenario call — never replace a pin with municipality text alone. " +
  "Use create_portal_handoff only when the user wants to continue, unlock the full assessment, or use their SmartPR plan. Results are a free preview, not legal advice.";

const scenarioProps = {
  business_type: { type: "string", description: "Business activity as the user described it, e.g. 'furniture manufacturing', 'restaurant'." },
  activity_description: { type: "string", description: "Short free-text description of what the business will do." },
  municipality: { type: "string", description: "Puerto Rico municipality, e.g. 'Guaynabo'. Omit if not stated." },
  business_status: { type: "string", enum: ["new", "existing", "unknown"], description: "Whether the business is already registered. Use 'unknown' unless the user said." },
  square_feet: { type: "number", description: "Premises size in square feet, if stated." },
  employees: { type: "integer", description: "Number of employees, if stated." },
  renovation: { type: "string", enum: ["none", "interior", "structural", "unknown"], description: "Renovation scope, if stated." },
  site: {
    type: ["object", "null"],
    description: "Exact site as WGS84 coordinates — only when the user gave coordinates or pinned the site on the map; never geocode or guess. SmartPR resolves the municipality/barrio from the point. null clears the pin.",
    properties: { latitude: { type: "number" }, longitude: { type: "number" } },
    required: ["latitude", "longitude"],
    additionalProperties: false,
  },
};
const answersProp = { type: "object", description: "Clarifying answers keyed by clarifying_questions[].id (e.g. {\"business_status\":\"new\",\"Q_IMPORT_EXPORT\":\"no\"}).", additionalProperties: { type: ["string", "boolean"] } };

const resultSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["complete", "partial", "unsupported"] },
    scenario: {
      type: "object",
      description: "Normalized scenario. When site is set, keep latitude/longitude on every later tool call.",
      properties: {
        site: {
          type: ["object", "null"],
          properties: {
            latitude: { type: "number" }, longitude: { type: "number" },
            municipality: { type: "string" }, barrio: { type: ["string", "null"] },
            fips: { type: "string" }, near_boundary: { type: "boolean" },
            boundary_distance_m: { type: "number" }, designations: { type: "array", items: { type: "string" } },
            source: { type: "string" },
          },
        },
      },
    }, assumptions: { type: "array" }, unresolved_facts: { type: "array" },
    clarifying_questions: { type: "array" }, requirements: { type: "array" }, gated: { type: "object" },
    counts: { type: "object" }, coverage_limits: { type: "array" }, versions: { type: "object" }, message: { type: "string" },
    map_focus: { type: "object", description: "Where the widget map should open (lat/lng/zoom).", properties: { latitude: { type: "number" }, longitude: { type: "number" }, zoom: { type: "number" } } },
    approximate_site: { type: ["object", "null"], description: "Display-only starting pin (downtown of the stated municipality) when no exact site is pinned. Not a site — never pass it as scenario.site." },
    site_details: { type: ["object", "null"], description: "For scenario.site: street/address and official-map chips (zoning, FEMA flood, landslide, coastal). A chip with value null was not available — say 'see the full report', never guess." },
    dropped_answers: { type: "array" }, tier: { type: "string" },
  },
  required: ["status", "scenario", "requirements", "versions", "map_focus"],
};

const uiMeta = (invoking: string, invoked: string) => ({
  ui: { resourceUri: WIDGET_URI },
  "openai/outputTemplate": WIDGET_URI,
  "openai/widgetAccessible": true,
  "openai/toolInvocation/invoking": invoking,
  "openai/toolInvocation/invoked": invoked,
});

export const TOOLS = [
  {
    name: "assess_scenario",
    title: "Assess Puerto Rico business requirements",
    description: "Use when someone describes a business or project in Puerto Rico and asks what permits, licenses or registrations they need. Returns a preliminary, rules-engine-based requirements preview with clarifying questions.",
    inputSchema: { type: "object", properties: scenarioProps, additionalProperties: false },
    outputSchema: resultSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    _meta: uiMeta("Checking SmartPR requirements…", "Preliminary requirements ready"),
  },
  {
    name: "refine_scenario",
    title: "Refine the requirements assessment",
    description: "Use after assess_scenario when the user answers clarifying questions or changes a fact. Pass the previous result's scenario unchanged plus new answers; prior answers are preserved.",
    inputSchema: {
      type: "object",
      properties: { scenario: { type: "object", description: "The `scenario` object from the previous assess/refine result." }, answers: answersProp, ...scenarioProps },
      required: ["scenario"],
      additionalProperties: false,
    },
    outputSchema: resultSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    _meta: uiMeta("Updating assessment…", "Assessment updated"),
  },
  {
    name: "create_portal_handoff",
    title: "Continue in SmartPR",
    description: "Use only when the user asks to continue, save, unlock the full assessment, or use their SmartPR plan. Returns a short-lived link to SmartPR where they review the scenario before anything is saved.",
    inputSchema: {
      type: "object",
      properties: {
        scenario: { type: "object", description: "The `scenario` object from the latest assess/refine result (keep site and answers)." },
        intent: { type: "string", enum: ["continue", "unlock", "use_plan"] },
        answers: { ...answersProp, description: "Optional clarifying answers not yet applied with refine_scenario; merged into the scenario." },
        site: scenarioProps.site,
      },
      required: ["scenario"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: false },
    _meta: { "openai/widgetAccessible": true, "openai/toolInvocation/invoking": "Preparing SmartPR link…", "openai/toolInvocation/invoked": "SmartPR link ready" },
  },
];

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
export interface McpResult { status: number; body: unknown | null }

const ok = (id: Rpc["id"], result: unknown): McpResult => ({ status: 200, body: { jsonrpc: "2.0", id: id ?? null, result } });
const err = (id: Rpc["id"], code: number, message: string, status = 200): McpResult => ({ status, body: { jsonrpc: "2.0", id: id ?? null, error: { code, message } } });
const toolError = (text: string) => ({ isError: true, content: [{ type: "text", text }] });

function asScenario(v: unknown): Partial<NormalizedScenario> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Partial<NormalizedScenario>) : null;
}

export interface ChatgptMcpOptions {
  siteUrl: string;
  /** Street + official-map lookups for a pinned site (route passes the real ones; tests inject fakes; omitted → none). */
  siteLookups?: SiteLookups | null;
}

export async function callTool(name: string, args: Record<string, unknown>, opts: ChatgptMcpOptions) {
  if (name === "assess_scenario" || name === "refine_scenario") {
    const prior = name === "refine_scenario" ? asScenario(args.scenario) : null;
    if (name === "refine_scenario" && !prior) return toolError("refine_scenario needs the previous result's `scenario` object.");
    const { scenario, dropped } = normalizeScenario(args as ScenarioInput, prior);
    const result = assessScenario(scenario, dropped);
    if (scenario.site && opts.siteLookups) {
      result.site_details = await siteDetailsFor(scenario.site.latitude, scenario.site.longitude, opts.siteLookups);
    } else result.site_details = null;
    const sd = result.site_details;
    const top = result.requirements.slice(0, 5).map((r) => `- ${r.name} (${r.agency}) — ${r.applicability}`).join("\n");
    const qs = result.clarifying_questions.map((q) => `- [${q.id}] ${q.question}`).join("\n");
    const siteLine = scenario.site
      ? `\nSite (map pin): ${sd?.street ? `${sd.street}, ` : ""}${scenario.site.barrio ? `${scenario.site.barrio}, ` : ""}${scenario.site.municipality} (${scenario.site.latitude}, ${scenario.site.longitude})${scenario.site.near_boundary ? " — near a municipal boundary, confirm" : ""}` +
        (sd ? (sd.pending ? "\nSite chips (zoning, flood, landslide, coastal) are still loading." : `\nSite chips: ${sd.chips.map((c) => `${c.label}: ${c.value ?? "see full report"}`).join("; ")}`) : "")
      : result.approximate_site ? `\nMap shows an approximate pin in downtown ${result.approximate_site.municipality}; the user can drag it to the exact site.` : "";
    return {
      structuredContent: result,
      content: [{ type: "text", text: `${result.message}${siteLine}${dropped.includes("site") ? "\nThe pin is outside Puerto Rico and was ignored." : ""}\n${top}${qs ? `\nClarifying questions:\n${qs}` : ""}\n(Free preview from SmartPR's rules engine — not legal advice.)` }],
    };
  }
  if (name === "create_portal_handoff") {
    const prior = asScenario(args.scenario);
    if (!prior) return toolError("create_portal_handoff needs the latest `scenario` object.");
    // Re-validate the untrusted scenario; merge answers / pin the widget had
    // not yet applied so the portal always gets the CURRENT scenario.
    const extra: ScenarioInput = {};
    if (args.answers && typeof args.answers === "object" && !Array.isArray(args.answers)) extra.answers = args.answers;
    if (args.site !== undefined) extra.site = args.site;
    const { scenario } = normalizeScenario(extra, prior);
    const intent: HandoffIntent = args.intent === "unlock" || args.intent === "use_plan" ? args.intent : "continue";
    try {
      const { token, expires_at } = createHandoffToken(scenario, intent);
      const url = `${opts.siteUrl.replace(/\/$/, "")}/chatgpt/handoff?t=${encodeURIComponent(token)}`;
      return {
        structuredContent: { url, expires_at, intent, saves_nothing_until_confirmed: true, carried: { site: !!scenario.site, answers: Object.keys(scenario.answers).length, business_status: scenario.business_status, renovation: scenario.renovation } },
        content: [{ type: "text", text: `Open SmartPR to review this scenario before anything is saved (link expires ${expires_at}): ${url}` }],
      };
    } catch (e) {
      if (e instanceof HandoffError && e.code === "not_configured") return toolError("SmartPR handoff is not configured on this server.");
      return toolError("Could not create a SmartPR link. Try again.");
    }
  }
  return null;
}

/**
 * Widget CSP (v6). The widget is still self-contained (inline CSS/JS incl.
 * vendored Leaflet, inline-SVG municipio fallback, no fetch/XHR). The only
 * remote loads are basemap tile IMAGES from SmartPR's own tile proxy
 * (`<portal>/api/tiles/{z}/{x}/{y}.png` → Esri World Street Map / World
 * Imagery), so a single first-party origin is declared:
 *  - resource_domains / resourceDomains → img-src for the tiles (the field
 *    ChatGPT documents for images and reliably honors);
 *  - connect_domains / connectDomains → same origin, declared for
 *    completeness (the widget makes no fetch/XHR calls);
 *  - redirect_domains → openExternal targets (handoff links);
 *  - ui.domain / openai/widgetDomain → dedicated sandbox origin (required
 *    for submission).
 * If ChatGPT blocks the tiles anyway, the widget switches to the inline-SVG
 * municipio map after ~3 s — it never depends on the network to render.
 */
export function widgetResourceMeta(siteUrl: string) {
  const portal = new URL(siteUrl).origin;
  return {
    ui: { prefersBorder: true, domain: portal, csp: { connectDomains: [portal], resourceDomains: [portal] } },
    "openai/widgetDomain": portal,
    "openai/widgetCSP": { connect_domains: [portal], resource_domains: [portal], redirect_domains: [portal] },
    "openai/widgetDescription": "SmartPR preliminary Puerto Rico requirements with a draggable site map pin, site chips and refine controls.",
    "openai/widgetPrefersBorder": true,
  };
}

export async function handleChatgptMcp(body: unknown, opts: ChatgptMcpOptions): Promise<McpResult> {
  if (Array.isArray(body)) return err(null, -32600, "Batch requests are not supported.", 400);
  const msg = (body || {}) as Rpc;
  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return err(msg.id, -32600, "Invalid Request", 400);
  const isNotification = msg.id === undefined || msg.id === null;
  const params = (msg.params || {}) as Record<string, unknown>;
  switch (msg.method) {
    case "initialize": {
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[1],
        capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, title: "SmartPR", version: CHATGPT_SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping": return ok(msg.id, {});
    case "tools/list": return ok(msg.id, { tools: TOOLS });
    case "resources/list":
      return ok(msg.id, {
        resources: WIDGET_URI_ALIASES.map((uri) => ({
          uri,
          name: "smartpr-requirements",
          title: "SmartPR requirements preview",
          mimeType: WIDGET_MIME,
          _meta: widgetResourceMeta(opts.siteUrl),
          ...(uri === WIDGET_URI ? {} : { description: `Alias of ${WIDGET_URI} (ChatGPT cached template_pointer)` }),
        })),
      });
    case "resources/templates/list": return ok(msg.id, { resourceTemplates: [] });
    case "resources/read": {
      const uri = typeof params.uri === "string" ? params.uri : "";
      if (!(WIDGET_URI_ALIASES as readonly string[]).includes(uri)) return err(msg.id, -32602, "Unknown resource");
      // Echo the requested URI so a cached template_pointer=v1/v2/v3 still binds;
      // HTML + CSP meta are always the current widget.
      return ok(msg.id, { contents: [{ uri, mimeType: WIDGET_MIME, text: widgetHtml({ assetOrigin: new URL(opts.siteUrl).origin }), _meta: widgetResourceMeta(opts.siteUrl) }] });
    }
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
      if (JSON.stringify(args).length > 20000) return err(msg.id, -32602, "Arguments too large");
      const result = await callTool(name, args, opts);
      if (!result) return err(msg.id, -32602, `Unknown tool: ${name}`);
      return ok(msg.id, result);
    }
    default:
      if (isNotification || msg.method.startsWith("notifications/")) return { status: 202, body: null };
      return err(msg.id, -32601, "Method not found");
  }
}
