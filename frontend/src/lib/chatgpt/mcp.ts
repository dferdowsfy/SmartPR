// SmartPR ChatGPT MCP server (MCP Apps) — stateless JSON-RPC 2.0 over
// Streamable HTTP, mirroring the voice MCP pattern (lib/voice/mcp.ts).
//
// Curated tools only: assess_scenario, refine_scenario, create_portal_handoff.
// No account data, no DB, no writes. Anonymous free-preview triage; the full
// (paid) assessment is never returned here.

import { assessScenario, normalizeScenario, CHATGPT_SERVER_VERSION, type NormalizedScenario, type ScenarioInput } from "./assessment";
import { createHandoffToken, HandoffError, type HandoffIntent } from "./handoff";
import { WIDGET_URI, WIDGET_MIME, widgetHtml } from "./widget";

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const SERVER_NAME = "smartpr-chatgpt";

const INSTRUCTIONS =
  "SmartPR gives preliminary Puerto Rico business permit/registration requirements from SmartPR's deterministic rules engine — never answer requirements from model knowledge. " +
  "Call assess_scenario with the facts the user stated (leave unknowns out; never guess). Ask the returned clarifying questions, then call refine_scenario with the previous scenario plus answers. " +
  "Use create_portal_handoff only when the user wants to continue in SmartPR. Results are a free preview, not legal advice.";

const scenarioProps = {
  business_type: { type: "string", description: "Business activity as the user described it, e.g. 'furniture manufacturing', 'restaurant'." },
  activity_description: { type: "string", description: "Short free-text description of what the business will do." },
  municipality: { type: "string", description: "Puerto Rico municipality, e.g. 'Guaynabo'. Omit if not stated." },
  business_status: { type: "string", enum: ["new", "existing", "unknown"], description: "Whether the business is already registered. Use 'unknown' unless the user said." },
  square_feet: { type: "number", description: "Premises size in square feet, if stated." },
  employees: { type: "integer", description: "Number of employees, if stated." },
  renovation: { type: "string", enum: ["none", "interior", "structural", "unknown"], description: "Renovation scope, if stated." },
};
const answersProp = { type: "object", description: "Clarifying answers keyed by clarifying_questions[].id (e.g. {\"business_status\":\"new\",\"Q_IMPORT_EXPORT\":\"no\"}).", additionalProperties: { type: ["string", "boolean"] } };

const resultSchema = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["complete", "partial", "unsupported"] },
    scenario: { type: "object" }, assumptions: { type: "array" }, unresolved_facts: { type: "array" },
    clarifying_questions: { type: "array" }, requirements: { type: "array" }, gated: { type: "object" },
    counts: { type: "object" }, coverage_limits: { type: "array" }, versions: { type: "object" }, message: { type: "string" },
  },
  required: ["status", "scenario", "requirements", "versions"],
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
      properties: { scenario: { type: "object", description: "The `scenario` object from the latest assess/refine result." }, intent: { type: "string", enum: ["continue", "unlock", "use_plan"] } },
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

export function callTool(name: string, args: Record<string, unknown>, opts: { siteUrl: string }) {
  if (name === "assess_scenario" || name === "refine_scenario") {
    const prior = name === "refine_scenario" ? asScenario(args.scenario) : null;
    if (name === "refine_scenario" && !prior) return toolError("refine_scenario needs the previous result's `scenario` object.");
    const { scenario, dropped } = normalizeScenario(args as ScenarioInput, prior);
    const result = assessScenario(scenario, dropped);
    const top = result.requirements.slice(0, 5).map((r) => `- ${r.name} (${r.agency}) — ${r.applicability}`).join("\n");
    const qs = result.clarifying_questions.map((q) => `- [${q.id}] ${q.question}`).join("\n");
    return {
      structuredContent: result,
      content: [{ type: "text", text: `${result.message}\n${top}${qs ? `\nClarifying questions:\n${qs}` : ""}\n(Free preview from SmartPR's rules engine — not legal advice.)` }],
    };
  }
  if (name === "create_portal_handoff") {
    const prior = asScenario(args.scenario);
    if (!prior) return toolError("create_portal_handoff needs the latest `scenario` object.");
    const { scenario } = normalizeScenario({}, prior); // re-validate untrusted scenario
    const intent: HandoffIntent = args.intent === "unlock" || args.intent === "use_plan" ? args.intent : "continue";
    try {
      const { token, expires_at } = createHandoffToken(scenario, intent);
      const url = `${opts.siteUrl.replace(/\/$/, "")}/chatgpt/handoff?t=${encodeURIComponent(token)}`;
      return {
        structuredContent: { url, expires_at, intent, saves_nothing_until_confirmed: true },
        content: [{ type: "text", text: `Open SmartPR to review this scenario before anything is saved (link expires ${expires_at}): ${url}` }],
      };
    } catch (e) {
      if (e instanceof HandoffError && e.code === "not_configured") return toolError("SmartPR handoff is not configured on this server.");
      return toolError("Could not create a SmartPR link. Try again.");
    }
  }
  return null;
}

export function handleChatgptMcp(body: unknown, opts: { siteUrl: string }): McpResult {
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
      return ok(msg.id, { resources: [{ uri: WIDGET_URI, name: "smartpr-requirements", title: "SmartPR requirements preview", mimeType: WIDGET_MIME }] });
    case "resources/templates/list": return ok(msg.id, { resourceTemplates: [] });
    case "resources/read": {
      if (params.uri !== WIDGET_URI) return err(msg.id, -32602, "Unknown resource");
      return ok(msg.id, { contents: [{ uri: WIDGET_URI, mimeType: WIDGET_MIME, text: widgetHtml(), _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } }, "openai/widgetDescription": "SmartPR preliminary Puerto Rico requirements with refine controls.", "openai/widgetPrefersBorder": true } }] });
    }
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
      if (JSON.stringify(args).length > 20000) return err(msg.id, -32602, "Arguments too large");
      const result = callTool(name, args, opts);
      if (!result) return err(msg.id, -32602, `Unknown tool: ${name}`);
      return ok(msg.id, result);
    }
    default:
      if (isNotification || msg.method.startsWith("notifications/")) return { status: 202, body: null };
      return err(msg.id, -32601, "Method not found");
  }
}
