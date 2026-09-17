/**
 * SmartPR Remote MCP server core (Phase 2).
 *
 * Adapter over the existing Phase 1 voice services — no second auth system,
 * no second RBAC, no second entitlement system, no raw database access.
 *
 * Transport: Streamable HTTP (JSON-RPC 2.0 over POST). Stateless: no
 * MCP session ids, single JSON responses. Only `initialize`,
 * `notifications/initialized`, `ping`, `tools/list`, and `tools/call`
 * are supported.
 *
 * Authentication: every `tools/call` must carry the Phase 1 voice session
 * token. xAI sets the configured `authorization` value in the HTTP
 * Authorization header; we accept both `Bearer <token>` and the raw token
 * because xAI's docs do not specify a scheme. `initialize` and `tools/list`
 * require no auth — they expose no account data, which also keeps anonymous
 * callers working (account tools then return AUTH_REQUIRED, never a
 * transport failure).
 *
 * The model supplies only resource identifiers (businessId). userId,
 * workspaceId, role, plan, email, and authorization scope are always derived
 * server-side from the validated voice session. Extra arguments are stripped
 * before dispatch — they can never override identity.
 */

import {
  listAccessibleBusinesses,
  requireBusinessAccess,
  resolveVoiceContext,
  VoiceAuthError,
  type Db,
  type VoiceContext,
} from "./context";
import { SESSION_TOKEN_PREFIX } from "./session";
import {
  toolEmailMySummary,
  toolGetAccountContext,
  toolGetBusinessSummary,
  toolGetDeadlines,
  toolGetEvidenceStatus,
  toolGetMissingItems,
  toolGetReadiness,
  toolGetRequirements,
  toolListMyBusinesses,
} from "./tools";

/* ------------------------------------------------------------------ */
/* Token extraction                                                    */
/* ------------------------------------------------------------------ */

/**
 * Extract the voice session token from an Authorization header.
 * Accepts `Bearer <token>` (any casing) or the raw token, since xAI's
 * Remote MCP docs only say the configured value "will be set in the
 * Authorization header" without naming a scheme.
 */
export function extractMcpToken(
  authorizationHeader: string | null | undefined
): string | null {
  if (!authorizationHeader) return null;
  const trimmed = authorizationHeader.trim();
  if (!trimmed) return null;
  const bearer = /^(?:Bearer)\s+(.+)$/i.exec(trimmed);
  const token = (bearer?.[1] ?? trimmed).trim();
  if (!token || !token.startsWith(SESSION_TOKEN_PREFIX)) return null;
  return token;
}

/* ------------------------------------------------------------------ */
/* Tool registry                                                       */
/* ------------------------------------------------------------------ */

export interface McpToolDef {
  name: string;
  description: string;
  /** Declared argument names — anything else in the call is stripped. */
  args: Array<"businessId">;
  inputSchema: Record<string, unknown>;
  needsBusiness: boolean;
}

const BUSINESS_ID_PROP = {
  businessId: {
    type: "string",
    description:
      "SmartPR business id. Omit when the caller has exactly one accessible business.",
  },
};

function businessTool(
  name: string,
  description: string
): McpToolDef {
  return {
    name,
    description,
    args: ["businessId"],
    needsBusiness: true,
    inputSchema: {
      type: "object",
      properties: BUSINESS_ID_PROP,
      additionalProperties: false,
    },
  };
}

const NO_ARGS_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "get_account_context",
    description:
      "Returns the authenticated caller's SmartPR account context: verified email, workspace role, and subscription plan.",
    args: [],
    needsBusiness: false,
    inputSchema: NO_ARGS_SCHEMA,
  },
  {
    name: "list_my_businesses",
    description: "Lists the SmartPR businesses the authenticated caller may access.",
    args: [],
    needsBusiness: false,
    inputSchema: NO_ARGS_SCHEMA,
  },
  businessTool(
    "get_business_summary",
    "Returns a compact profile and compliance counts for one of the caller's authorized businesses."
  ),
  businessTool(
    "get_requirements",
    "Returns the authoritative SmartPR requirements for an authorized business, produced by the deterministic regulatory engine."
  ),
  businessTool(
    "get_missing_items",
    "Returns incomplete or unresolved SmartPR requirements for an authenticated caller's authorized business."
  ),
  businessTool(
    "get_readiness",
    "Returns overall and per-matter readiness scores for an authorized business."
  ),
  businessTool(
    "get_deadlines",
    "Returns upcoming and overdue compliance deadlines for an authorized business."
  ),
  businessTool(
    "get_evidence_status",
    "Returns evidence locker coverage and document review status for an authorized business."
  ),
  {
    name: "email_my_summary",
    description:
      "Emails the caller's SmartPR summary to the verified account email on file. Never accepts a recipient address.",
    args: ["businessId"],
    needsBusiness: false,
    inputSchema: {
      type: "object",
      properties: BUSINESS_ID_PROP,
      additionalProperties: false,
    },
  },
];

export const MCP_TOOL_MAP = new Map(MCP_TOOLS.map((t) => [t.name, t]));

/**
 * Strip every argument the tool did not declare. Identity override attempts
 * (userId, workspaceId, role, plan, email, to, recipient, …) are dropped
 * here, before dispatch, and never reach the service layer.
 */
export function sanitizeArgs(
  tool: McpToolDef,
  rawArgs: unknown
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!rawArgs || typeof rawArgs !== "object") return out;
  const record = rawArgs as Record<string, unknown>;
  for (const name of tool.args) {
    const value = record[name];
    if (typeof value === "string" && value.trim()) out[name] = value.trim();
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Business selection                                                  */
/* ------------------------------------------------------------------ */

export interface BusinessOption {
  id: string;
  name: string;
}

export class McpSelectionRequired extends Error {
  options: BusinessOption[];
  constructor(options: BusinessOption[]) {
    super("The caller must choose which business they mean.");
    this.name = "McpSelectionRequired";
    this.options = options;
  }
}

/**
 * Resolve the target business for a tool call.
 *
 * - Explicit businessId → verified with the existing RBAC check (the
 *   model's remembered selection is never trusted as authorization).
 * - Omitted → the caller's single accessible business is used; zero
 *   businesses is an error; several require explicit selection.
 */
export async function resolveMcpBusiness(
  db: Db,
  ctx: VoiceContext,
  businessId: string | undefined
): Promise<string> {
  if (businessId) {
    const business = await requireBusinessAccess(db, ctx, businessId);
    return business.id;
  }
  const businesses = await listAccessibleBusinesses(db, ctx);
  if (businesses.length === 0) {
    throw new VoiceAuthError("no_businesses", "No businesses found on this account.", 404);
  }
  if (businesses.length > 1) {
    throw new McpSelectionRequired(
      businesses.map((b) => ({ id: b.id, name: b.name }))
    );
  }
  return businesses[0].id;
}

/* ------------------------------------------------------------------ */
/* Safe error contract                                                 */
/* ------------------------------------------------------------------ */

export type DenialKind =
  | "auth"
  | "forbidden"
  | "plan"
  | "selection"
  | "validation"
  | "not_found"
  | "delivery"
  | "internal";

export interface McpFailure {
  success: false;
  code:
    | "AUTH_REQUIRED"
    | "FORBIDDEN"
    | "PLAN_NOT_ENTITLED"
    | "BUSINESS_SELECTION_REQUIRED"
    | "NOT_FOUND"
    | "NO_BUSINESSES"
    | "NO_VERIFIED_EMAIL"
    | "VALIDATION_ERROR"
    | "DELIVERY_FAILED"
    | "SERVICE_UNAVAILABLE"
    | "INTERNAL_ERROR";
  message: string;
  options?: BusinessOption[];
  available_alternative?: string;
}

export function mapMcpError(err: unknown): { failure: McpFailure; denialKind: DenialKind } {
  if (err instanceof McpSelectionRequired) {
    return {
      denialKind: "selection",
      failure: {
        success: false,
        code: "BUSINESS_SELECTION_REQUIRED",
        message: "Which business do you mean? There is more than one on this account.",
        options: err.options,
      },
    };
  }
  if (err instanceof VoiceAuthError) {
    switch (err.code) {
      case "missing_token":
      case "invalid_token":
      case "session_revoked":
      case "session_expired":
        return {
          denialKind: "auth",
          failure: {
            success: false,
            code: "AUTH_REQUIRED",
            message: "Your phone session is no longer authenticated.",
          },
        };
      case "forbidden":
        return {
          denialKind: "forbidden",
          failure: {
            success: false,
            code: "FORBIDDEN",
            message: "You do not have access to that business.",
          },
        };
      case "plan_not_entitled":
        return {
          denialKind: "plan",
          failure: {
            success: false,
            code: "PLAN_NOT_ENTITLED",
            message: err.message || "This plan does not include that capability.",
            available_alternative: "email_my_summary",
          },
        };
      case "not_found":
      case "no_businesses":
        return {
          denialKind: "not_found",
          failure: {
            success: false,
            code: err.code === "no_businesses" ? "NO_BUSINESSES" : "NOT_FOUND",
            message: err.message,
          },
        };
      case "no_verified_email":
        return {
          denialKind: "validation",
          failure: { success: false, code: "NO_VERIFIED_EMAIL", message: err.message },
        };
      case "bad_request":
        return {
          denialKind: "validation",
          failure: { success: false, code: "VALIDATION_ERROR", message: "The request was invalid." },
        };
      case "delivery_failed":
        return {
          denialKind: "delivery",
          failure: { success: false, code: "DELIVERY_FAILED", message: err.message },
        };
      case "no_database":
        return {
          denialKind: "internal",
          failure: {
            success: false,
            code: "SERVICE_UNAVAILABLE",
            message: "SmartPR is temporarily unavailable. Please try again shortly.",
          },
        };
      default:
        return {
          denialKind: "internal",
          failure: {
            success: false,
            code: "INTERNAL_ERROR",
            message: "Something went wrong processing that request.",
          },
        };
    }
  }
  // Never leak stack traces, SQL errors, or internals to the model.
  console.error("[mcp] tool failed:", (err as Error)?.message || err);
  return {
    denialKind: "internal",
    failure: {
      success: false,
      code: "INTERNAL_ERROR",
      message: "Something went wrong processing that request.",
    },
  };
}

/* ------------------------------------------------------------------ */
/* Observability                                                       */
/* ------------------------------------------------------------------ */

export interface ToolCallRecord {
  toolName: string;
  sessionId: string | null;
  userId: string | null;
  businessId: string | null;
  success: boolean;
  errorCode: string | null;
  denialKind: DenialKind | null;
  latencyMs: number;
  emailSent: boolean;
}

/**
 * Persist one row per MCP tool call. Never records tokens, PINs, or raw
 * arguments — only the business id, outcome, and timing.
 * Best-effort: observability must never break a tool call (e.g. when the
 * Phase 2 migration has not been applied yet).
 */
export async function logToolCall(db: Db, record: ToolCallRecord): Promise<void> {
  try {
    await db.query(
      `INSERT INTO voice_tool_calls
         (tool_name, session_id, user_id, business_id, success, error_code,
          denial_kind, latency_ms, email_sent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        record.toolName,
        record.sessionId,
        record.userId,
        record.businessId,
        record.success,
        record.errorCode,
        record.denialKind,
        record.latencyMs,
        record.emailSent,
      ]
    );
  } catch (err) {
    console.error("[mcp] tool-call observability write failed:", (err as Error)?.message || err);
  }
}

/* ------------------------------------------------------------------ */
/* Tool dispatch                                                       */
/* ------------------------------------------------------------------ */

export interface McpDispatchResult {
  ok: boolean;
  /** Safe-contract payload serialized into the MCP content block. */
  payload: { success: true; data: unknown } | McpFailure;
}

async function runTool(
  db: Db,
  ctx: VoiceContext,
  tool: McpToolDef,
  args: Record<string, string>
): Promise<unknown> {
  const businessId = tool.needsBusiness
    ? await resolveMcpBusiness(db, ctx, args.businessId)
    : undefined;
  switch (tool.name) {
    case "get_account_context":
      return toolGetAccountContext(db, ctx);
    case "list_my_businesses":
      return toolListMyBusinesses(db, ctx);
    case "get_business_summary":
      return toolGetBusinessSummary(db, ctx, businessId as string);
    case "get_requirements":
      return toolGetRequirements(db, ctx, businessId as string);
    case "get_missing_items":
      return toolGetMissingItems(db, ctx, businessId as string);
    case "get_readiness":
      return toolGetReadiness(db, ctx, businessId as string);
    case "get_deadlines":
      return toolGetDeadlines(db, ctx, businessId as string);
    case "get_evidence_status":
      return toolGetEvidenceStatus(db, ctx, businessId as string);
    case "email_my_summary": {
      // Optional businessId: an explicit id is access-checked; omitted
      // means the whole account (Phase 1 behavior). Unlike needsBusiness
      // tools, ambiguity across businesses is allowed here.
      const target = args.businessId
        ? (await requireBusinessAccess(db, ctx, args.businessId)).id
        : null;
      return toolEmailMySummary(db, ctx, target);
    }
    default:
      throw new VoiceAuthError("unknown_tool", `Unknown tool: ${tool.name}`, 400);
  }
}

/**
 * Authenticate, authorize, dispatch, and observe one MCP tool call.
 * Returns the safe-contract payload for the MCP content block.
 */
export async function executeMcpTool(
  db: Db,
  authorizationHeader: string | null | undefined,
  toolName: string,
  rawArgs: unknown
): Promise<McpDispatchResult> {
  const started = Date.now();
  const tool = MCP_TOOL_MAP.get(toolName);
  let ctx: VoiceContext | null = null;
  let businessId: string | null = null;

  const finish = async (
    ok: boolean,
    payload: McpDispatchResult["payload"],
    denialKind: DenialKind | null,
    emailSent: boolean
  ): Promise<McpDispatchResult> => {
    await logToolCall(db, {
      toolName,
      sessionId: ctx?.sessionId ?? null,
      userId: ctx?.userId ?? null,
      businessId,
      success: ok,
      errorCode: ok ? null : (payload as McpFailure).code,
      denialKind,
      latencyMs: Date.now() - started,
      emailSent,
    });
    return { ok, payload };
  };

  if (!tool) {
    return finish(
      false,
      { success: false, code: "VALIDATION_ERROR", message: `Unknown tool: ${toolName}.` },
      "validation",
      false
    );
  }

  try {
    const token = extractMcpToken(authorizationHeader);
    if (!token) {
      throw new VoiceAuthError("missing_token", "A voice session token is required.", 401);
    }
    ctx = await resolveVoiceContext(`Bearer ${token}`, db);
    const args = sanitizeArgs(tool, rawArgs);
    if (args.businessId) businessId = args.businessId;
    const data = await runTool(db, ctx, tool, args);
    return finish(true, { success: true, data }, null, tool.name === "email_my_summary");
  } catch (err) {
    const { failure, denialKind } = mapMcpError(err);
    return finish(false, failure, denialKind, false);
  }
}

/* ------------------------------------------------------------------ */
/* JSON-RPC / Streamable HTTP                                          */
/* ------------------------------------------------------------------ */

export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const MCP_PROTOCOL_LATEST = "2025-06-18";
export const MCP_SERVER_NAME = "smartpr-voice";
export const MCP_SERVER_VERSION = "2.0.0";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface McpHttpResult {
  status: number;
  /** null → notification: respond 202 with an empty body. */
  body: unknown | null;
}

function rpcError(id: string | number | null | undefined, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toolContentBlock(result: McpDispatchResult) {
  return {
    content: [{ type: "text", text: JSON.stringify(result.payload) }],
    isError: !result.ok,
  };
}

/**
 * Handle one Streamable HTTP POST body. Stateless: every request is
 * independent; no MCP session ids are issued.
 */
export async function handleMcpRequest(
  db: Db,
  body: unknown,
  authorizationHeader: string | null | undefined
): Promise<McpHttpResult> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { status: 400, body: rpcError(null, -32600, "Invalid Request: expected a JSON-RPC object.") };
  }
  const req = body as JsonRpcRequest;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return { status: 400, body: rpcError(req.id, -32600, "Invalid Request.") };
  }
  const params = (req.params ?? {}) as Record<string, unknown>;

  switch (req.method) {
    case "initialize": {
      const requested = (params as { protocolVersion?: unknown }).protocolVersion;
      const protocolVersion =
        typeof requested === "string" && MCP_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : MCP_PROTOCOL_LATEST;
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: req.id ?? null,
          result: {
            protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
          },
        },
      };
    }
    case "notifications/initialized":
      return { status: 202, body: null };
    case "ping":
      return { status: 200, body: { jsonrpc: "2.0", id: req.id ?? null, result: {} } };
    case "tools/list":
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: req.id ?? null,
          result: {
            tools: MCP_TOOLS.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        },
      };
    case "tools/call": {
      const name = params.name;
      if (typeof name !== "string" || !name) {
        return { status: 200, body: rpcError(req.id, -32602, "Invalid params: tool name is required.") };
      }
      const result = await executeMcpTool(db, authorizationHeader, name, params.arguments);
      return {
        status: 200,
        body: { jsonrpc: "2.0", id: req.id ?? null, result: toolContentBlock(result) },
      };
    }
    default:
      return { status: 200, body: rpcError(req.id, -32601, `Method not found: ${req.method}`) };
  }
}
