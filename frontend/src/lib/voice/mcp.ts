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
 * Authentication: `tools/call` must carry the Phase 1 voice session token,
 * except tools flagged `anonymous` (currently only get_general_requirements,
 * which touches zero account data). xAI sets the configured `authorization`
 * value in the HTTP Authorization header; we accept both `Bearer <token>`
 * and the raw token because xAI's docs do not specify a scheme.
 * `initialize` requires no auth. `tools/list` filters by auth: a
 * present-but-invalid authorization value (the pre-auth "anonymous" marker,
 * an expired token) sees only the anonymous tool; a missing header keeps
 * the historical full list because `tools/call` still enforces auth.
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
import {
  SESSION_TOKEN_PREFIX,
  SESSION_TTL_MINUTES,
  generateSessionToken,
  hashSessionToken,
  sessionExpiresAt,
} from "./session";
import {
  MAX_PIN_ATTEMPTS,
  LOCKOUT_MINUTES,
  isValidPinFormat,
  lockoutSecondsRemaining,
  normalizePinInput,
  pinIdentifier,
  verifyPin,
  hashPin,
} from "./pin";
import { logVoiceAudit } from "./audit";
import {
  toolAddNote,
  toolConfirmPendingAction,
  toolCancelPendingAction,
  toolCreateDraftProject,
  toolEmailDeliverable,
  toolEmailMySummary,
  toolGenerateDeliverable,
  toolGetAccountContext,
  toolGetBusinessSummary,
  toolGetDeadlines,
  toolGetEvidenceStatus,
  toolGetGeneralRequirements,
  toolGetMissingItems,
  toolGetReadiness,
  toolGetRequirements,
  toolListMyBusinesses,
  toolProposeProjectFactUpdate,
  toolSendSecureActionLink,
  toolSendSecureUploadLink,
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
/* Console-agent mode (xAI console Remote MCP)                         */
/* ------------------------------------------------------------------ */

/**
 * Optional shared secret for the xAI console agent's Remote MCP
 * configuration. xAI's `authorization` field is a single static value that
 * xAI sets in the HTTP Authorization header — it cannot carry a per-caller
 * voice session token. When this env var is set and the request header
 * matches it (raw or `Bearer <key>`), the request is treated as coming from
 * our console agent: tools/list exposes the full catalog (tools/call still
 * enforces per-call auth), and authenticated tools accept the voice session
 * token via the `session_token` argument instead of the header.
 *
 * The session token itself remains the credential: presenting a valid,
 * unexpired, unrevoked token authenticates the call regardless of channel.
 */
export function getConsoleMcpKey(): string | null {
  const key = process.env.XAI_CONSOLE_MCP_KEY;
  return key && key.trim() ? key.trim() : null;
}

export function isConsoleMcpRequest(
  authorizationHeader: string | null | undefined
): boolean {
  const key = getConsoleMcpKey();
  if (!key || !authorizationHeader) return false;
  const trimmed = authorizationHeader.trim();
  if (!trimmed) return false;
  const bearer = /^(?:Bearer)\s+(.+)$/i.exec(trimmed);
  return (bearer?.[1] ?? trimmed).trim() === key;
}

/**
 * Voice session token supplied as a tool argument (`session_token`) for
 * console-agent mode, where the Authorization header carries xAI's static
 * configured value instead of a per-caller token. Returns null unless the
 * value is a syntactically valid session token.
 */
export function extractArgToken(rawArgs: unknown): string | null {
  if (!rawArgs || typeof rawArgs !== "object") return null;
  const v = (rawArgs as Record<string, unknown>).session_token;
  if (typeof v !== "string") return null;
  const token = v.trim();
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
  args: Array<string>;
  inputSchema: Record<string, unknown>;
  needsBusiness: boolean;
  /**
   * Anonymous tools run without a voice session token (no account, no
   * persisted state). Only tools that touch zero account data may set this.
   */
  anonymous?: boolean;
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
    name: "get_general_requirements",
    description:
      "Deterministic Puerto Rico regulatory engine — no login needed. Returns permits, licenses, and registrations for a business type + municipality, labeled required / likely_required / conditional.",
    args: ["business_type", "municipality", "business_status", "answers"],
    needsBusiness: false,
    anonymous: true,
    inputSchema: {
      type: "object",
      properties: {
        business_type: {
          type: "string",
          description:
            "Business type, e.g. Restaurant, Bar, Food Truck, Retail Store. Matched against SmartPR's catalog; unknown types return candidates to clarify.",
        },
        municipality: {
          type: "string",
          description: "Puerto Rico municipality, e.g. San Juan, Ponce. Optional.",
        },
        business_status: {
          type: "string",
          enum: ["new", "existing"],
          description:
            "Use 'new' when the caller is opening a business (default), 'existing' for an already-operating business.",
        },
        answers: {
          type: "object",
          description:
            "Optional refinement: question_id -> answer (yes/no or option text) for follow-up questions from a previous call.",
          additionalProperties: true,
        },
      },
      required: ["business_type"],
      additionalProperties: false,
    },
  },
  {
    name: "verify_voice_pin",
    description:
      "Unlock the caller's SmartPR account tools with their 6-digit voice PIN. " +
      "The PIN alone identifies the account — NEVER ask for an email address. " +
      "Ask the caller to SAY the 6-digit PIN aloud, one digit at a time " +
      "(keypad tones are not delivered on this number). " +
      "Never repeat the digits back, and never read the returned session_token aloud. " +
      "Convert any spoken digit words to digits and pass the 6 digits in 'pin'. " +
      "On success the result contains a session_token: include it as the 'session_token' argument " +
      "in every subsequent account tool call (idle TTL renews on each tool use, " +
      "hard-capped at 120 minutes from PIN; re-PIN if expired). " +
      "Never claim the caller is verified from merely collecting the PIN — " +
      "only this tool's ok:true verifies them, and until then use only get_general_requirements.",
    args: ["pin"],
    needsBusiness: false,
    anonymous: true,
    inputSchema: {
      type: "object",
      properties: {
        pin: {
          type: "string",
          description:
            "The caller's 6-digit voice PIN, spoken aloud one digit at a time — convert any digit words to digits.",
        },
      },
      required: ["pin"],
      additionalProperties: false,
    },
  },
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
      "Emails a recap of THIS CALL to the verified account email. Pass call_summary: your 3-6 sentence recap of what the call was about (topics, actions, next steps). Never accepts a recipient address.",
    args: ["businessId", "call_summary"],
    needsBusiness: false,
    inputSchema: {
      type: "object",
      properties: {
        ...BUSINESS_ID_PROP,
        call_summary: {
          type: "string",
          description:
            "Your recap of this call: what was discussed, what you did, and any next steps. 3-6 sentences, written directly to the caller.",
        },
      },
      additionalProperties: false,
    },
  },
  // ------------------------------------------------------------------
  // Phase 3: authenticated action tools.
  // Confirmation protocol (MANDATORY for create/propose/note tools): the
  // tool returns a pending_action_id plus a deterministic
  // confirmation_summary. Read the confirmation_summary to the caller
  // verbatim, then wait for an explicit, unambiguous yes ("yes", "sí",
  // "correct", "go ahead"). Only then call confirm_pending_action with the
  // pendingActionId. Ambiguous answers ("maybe", "I think so", silence)
  // NEVER count as confirmation — ask once more or call
  // cancel_pending_action. You may not edit, improve, or extend the
  // proposal during confirmation; you may only confirm or cancel it.
  // ------------------------------------------------------------------
  {
    name: "create_draft_project",
    description:
      "Starts a draft SmartPR project for an authorized business. This only creates a PENDING proposal — nothing is saved until the caller explicitly confirms. Follow the confirmation protocol exactly.",
    args: ["businessId", "projectType", "description", "municipality"],
    needsBusiness: true,
    inputSchema: {
      type: "object",
      properties: {
        ...BUSINESS_ID_PROP,
        projectType: {
          type: "string",
          description:
            "Project type, e.g. NEW_BUSINESS_FORMATION, PERMISO_UNICO_RENEWAL, HEALTH_LICENSE_RENEWAL, ANNUAL_REPORT, PERMIT_MODIFICATION, OTHER.",
        },
        description: { type: "string", description: "Short project description." },
        municipality: { type: "string", description: "Municipality the project is in, if known." },
      },
      required: ["projectType"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_project_fact_update",
    description:
      "Proposes changing one voice-editable SmartPR fact (e.g. alcohol_sold, food_prepared_on_site, physical_address, renovation). Creates a PENDING proposal only — follow the confirmation protocol exactly.",
    args: ["businessId", "factKey", "factValue", "matterId"],
    needsBusiness: true,
    inputSchema: {
      type: "object",
      properties: {
        ...BUSINESS_ID_PROP,
        factKey: { type: "string", description: "The canonical fact key to change." },
        factValue: {
          description: "The new value (boolean, number, or short text).",
          type: ["boolean", "number", "string"],
        },
        matterId: { type: "string", description: "Project id; omit to use the business's latest open project." },
      },
      required: ["factKey", "factValue"],
      additionalProperties: false,
    },
  },
  {
    name: "confirm_pending_action",
    description:
      "Confirms a pending action after an explicit, unambiguous yes to its confirmation_summary. Call with ONLY the pendingActionId from a propose tool. Never invent or modify the proposal.",
    args: ["pendingActionId"],
    needsBusiness: false,
    inputSchema: {
      type: "object",
      properties: {
        pendingActionId: {
          type: "string",
          description: "Opaque id returned by a create/propose/note tool.",
        },
      },
      required: ["pendingActionId"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel_pending_action",
    description:
      "Cancels a pending action without executing it. Use when the caller declines, changes their mind, or the confirmation was ambiguous.",
    args: ["pendingActionId"],
    needsBusiness: false,
    inputSchema: {
      type: "object",
      properties: {
        pendingActionId: {
          type: "string",
          description: "Opaque id returned by a create/propose/note tool.",
        },
      },
      required: ["pendingActionId"],
      additionalProperties: false,
    },
  },
  {
    name: "send_secure_upload_link",
    description:
      "Sends a secure, expiring document-upload link to the caller's verified account email. Never sends to any other address. Optional obligationId targets a specific missing requirement.",
    args: ["businessId", "obligationId"],
    needsBusiness: true,
    inputSchema: {
      type: "object",
      properties: {
        ...BUSINESS_ID_PROP,
        obligationId: { type: "string", description: "Requirement id from get_missing_items, optional." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "generate_deliverable",
    description:
      "Generates a readiness_report or requirements_summary PDF for an authorized business. Requires a paid plan. Never claim a filing package exists if the tool reports missing data.",
    args: ["businessId", "deliverableType"],
    needsBusiness: true,
    inputSchema: {
      type: "object",
      properties: {
        ...BUSINESS_ID_PROP,
        deliverableType: {
          type: "string",
          enum: ["readiness_report", "requirements_summary"],
          description: "Which deliverable to generate.",
        },
      },
      required: ["deliverableType"],
      additionalProperties: false,
    },
  },
  {
    name: "email_deliverable",
    description:
      "Emails a secure download link for an existing deliverable to the caller's verified account email. Never accepts a recipient address; never invents a deliverable id.",
    args: ["businessId", "deliverableId"],
    needsBusiness: true,
    inputSchema: {
      type: "object",
      properties: {
        ...BUSINESS_ID_PROP,
        deliverableId: { type: "string", description: "Deliverable id from generate_deliverable." },
      },
      required: ["deliverableId"],
      additionalProperties: false,
    },
  },
  {
    name: "add_note",
    description:
      "Proposes saving an informational note (never changes requirements). Nothing is saved until the caller explicitly confirms — follow the confirmation protocol.",
    args: ["businessId", "noteText", "matterId"],
    needsBusiness: true,
    inputSchema: {
      type: "object",
      properties: {
        ...BUSINESS_ID_PROP,
        noteText: { type: "string", description: "The note text (max 2000 characters)." },
        matterId: { type: "string", description: "Project id to attach the note to, optional." },
      },
      required: ["noteText"],
      additionalProperties: false,
    },
  },
  {
    name: "send_secure_action_link",
    description:
      "For voice-prohibited actions: emails a secure authenticated link to the caller's verified account email. Use the exact action name, e.g. government_submission, electronic_signature, payment.",
    args: ["businessId", "actionType"],
    needsBusiness: true,
    inputSchema: {
      type: "object",
      properties: {
        ...BUSINESS_ID_PROP,
        actionType: { type: "string", description: "The sensitive action name." },
      },
      required: ["actionType"],
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
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!rawArgs || typeof rawArgs !== "object") return out;
  const record = rawArgs as Record<string, unknown>;
  for (const name of tool.args) {
    const value = record[name];
    if (typeof value === "string" && value.trim()) out[name] = value.trim();
    else if (typeof value === "boolean" || typeof value === "number") {
      // Declared scalar arguments (e.g. factValue) survive sanitization;
      // identity is never a declared argument, so nothing is overridable.
      out[name] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      // Declared map arguments (e.g. get_general_requirements' answers)
      // survive as objects; the tool validates/coerces each entry.
      out[name] = value;
    }
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
  args: Record<string, unknown>
): Promise<unknown> {
  const businessId = tool.needsBusiness
    ? await resolveMcpBusiness(db, ctx, typeof args.businessId === "string" ? args.businessId : undefined)
    : undefined;
  /** Read a declared string argument safely from sanitized args. */
  const strArg = (name: string): string | null => {
    const v = args[name];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
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
      const target = strArg("businessId")
        ? (await requireBusinessAccess(db, ctx, strArg("businessId") as string)).id
        : null;
      // Agent-written recap of what this call was about — the email body is
      // built from it. When omitted, the server falls back to a deterministic
      // recap of the session's tool-call activity (never an account dump).
      return toolEmailMySummary(db, ctx, target, strArg("call_summary"));
    }
    // ---- Phase 3: authenticated action tools ----
    case "create_draft_project":
      return toolCreateDraftProject(
        db,
        ctx,
        businessId as string,
        strArg("projectType") ?? "OTHER",
        strArg("description"),
        strArg("municipality")
      );
    case "propose_project_fact_update":
      return toolProposeProjectFactUpdate(
        db,
        ctx,
        businessId as string,
        strArg("factKey") ?? "",
        "factValue" in args ? args.factValue : null,
        strArg("matterId")
      );
    case "confirm_pending_action":
      return toolConfirmPendingAction(db, ctx, strArg("pendingActionId") ?? "");
    case "cancel_pending_action":
      return toolCancelPendingAction(db, ctx, strArg("pendingActionId") ?? "");
    case "send_secure_upload_link":
      return toolSendSecureUploadLink(db, ctx, businessId as string, strArg("obligationId"));
    case "generate_deliverable":
      return toolGenerateDeliverable(
        db,
        ctx,
        businessId as string,
        strArg("deliverableType") ?? ""
      );
    case "email_deliverable":
      return toolEmailDeliverable(
        db,
        ctx,
        businessId as string,
        strArg("deliverableId") ?? ""
      );
    case "add_note":
      return toolAddNote(
        db,
        ctx,
        businessId as string,
        strArg("noteText") ?? "",
        strArg("matterId")
      );
    case "send_secure_action_link":
      return toolSendSecureActionLink(
        db,
        ctx,
        businessId as string,
        strArg("actionType") ?? ""
      );
    case "get_general_requirements":
      // Stateless knowledge-graph lookup: valid with or without a session.
      return toolGetGeneralRequirements(db, args);
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
    // Voice session token from the Authorization header (gateway / Phase 1)
    // or from the `session_token` tool argument (console-agent mode, where
    // xAI's Authorization header carries a static configured value instead
    // of a per-caller token). The argument is stripped before dispatch so it
    // can never reach a tool implementation or be logged with arguments.
    const argsCopy =
      rawArgs && typeof rawArgs === "object"
        ? { ...(rawArgs as Record<string, unknown>) }
        : rawArgs;
    const token =
      extractMcpToken(authorizationHeader) ?? extractArgToken(argsCopy);
    if (
      argsCopy &&
      typeof argsCopy === "object" &&
      "session_token" in (argsCopy as Record<string, unknown>)
    ) {
      delete (argsCopy as Record<string, unknown>).session_token;
    }
    if (!token) {
      if (!tool.anonymous) {
        throw new VoiceAuthError("missing_token", "A voice session token is required.", 401);
      }
      // Anonymous tools: no voice context exists. Account-derived
      // observability fields stay null; raw args are never logged.
      const data = await runAnonymousTool(db, tool, sanitizeArgs(tool, argsCopy));
      return finish(true, { success: true, data }, null, false);
    }
    ctx = await resolveVoiceContext(`Bearer ${token}`, db);
    const args = sanitizeArgs(tool, argsCopy);
    if (typeof args.businessId === "string" && args.businessId) businessId = args.businessId;
    const data = await runTool(db, ctx, tool, args);
    return finish(true, { success: true, data }, null, tool.name === "email_my_summary");
  } catch (err) {
    const { failure, denialKind } = mapMcpError(err);
    if (
      err instanceof VoiceAuthError &&
      err.code === "missing_token" &&
      isConsoleMcpRequest(authorizationHeader) &&
      failure.code === "AUTH_REQUIRED"
    ) {
      // In console-agent mode the model holds no header session: an account
      // tool call without a session_token means verification never happened.
      // Say so explicitly so the agent calls verify_voice_pin instead of
      // role-playing an already-verified caller.
      failure.message =
        "The caller is not verified: no session token was provided. " +
        "Call verify_voice_pin with the caller's spoken 6-digit PIN, and only proceed to account tools when it returns ok:true.";
    }
    return finish(false, failure, denialKind, false);
  }
}

/**
 * Dispatch for tools that run without a voice session. Only tools flagged
 * `anonymous` (zero account data) may reach here — enforced by
 * executeMcpTool before this is called.
 */
async function runAnonymousTool(
  db: Db,
  tool: McpToolDef,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (tool.name) {
    case "get_general_requirements":
      return toolGetGeneralRequirements(db, args);
    case "verify_voice_pin":
      return toolVerifyVoicePin(db, args);
    default:
      throw new VoiceAuthError("forbidden", "This tool requires authentication.", 403);
  }
}

/* ------------------------------------------------------------------ */
/* verify_voice_pin — console-agent account unlock                      */
/* ------------------------------------------------------------------ */

interface VoiceAccessRow {
  user_id: string;
  phone_e164: string;
  pin_hash: string;
  enabled: boolean;
  failed_attempts: number;
  locked_until: string | null;
}

/**
 * Lazily-created dummy PIN envelope so unknown/disabled PINs cost the
 * same scrypt work as a real verification (no user-enumeration oracle).
 */
let dummyPinEnvelope: string | null = null;
async function dummyPinVerify(pin: string): Promise<void> {
  if (!dummyPinEnvelope) dummyPinEnvelope = await hashPin("000000");
  await verifyPin(pin, dummyPinEnvelope);
}

/**
 * Anonymous account-unlock tool for console-agent mode.
 *
 * PIN-only verification: the caller's 6-digit voice PIN is the account
 * identifier. voice_access.pin_uid (HMAC of the PIN, UNIQUE per account)
 * resolves the caller with one indexed lookup — the agent never asks for
 * an email address on a call. A short-lived voice session token is issued;
 * the agent passes it as `session_token` to subsequent account tools.
 *
 * Auth failures are returned as data (ok:false), not transport errors, so
 * the agent can respond conversationally. Unknown or disabled PINs get a
 * generic response with timing equalized by a dummy scrypt verification,
 * so the response does not reveal whether a PIN is enrolled.
 */
async function toolVerifyVoicePin(
  db: Db,
  args: Record<string, unknown>
): Promise<unknown> {
  // PIN-only verification: the 6-digit PIN is the account identifier.
  // The model may pass spoken/transcribed PINs ("one two three four five
  // six"), or PINs with separators ("123 456", "123-456"). Normalize to
  // digits before format validation; anything that is not 6 digits after
  // normalization is still rejected as invalid.
  const pin = normalizePinInput(typeof args.pin === "string" ? args.pin : "");
  const invalid = {
    ok: false,
    error: "invalid_credentials",
    message: "That PIN was not recognized. Please try again.",
  };
  // Fail fast on malformed input without touching any account row. Still
  // audited so silent client-side failures stay visible.
  if (!isValidPinFormat(pin)) {
    await logVoiceAudit(db, {
      action: "pin_failed",
      details: { reason: "malformed_input", via: "mcp_verify_voice_pin" },
    });
    return invalid;
  }

  // Resolve the account by the PIN's unique identifier. Fail closed when
  // the server pepper is not configured: without it PINs cannot be
  // matched to accounts.
  let uid: string;
  try {
    uid = pinIdentifier(pin);
  } catch {
    await logVoiceAudit(db, {
      action: "pin_failed",
      details: { reason: "server_misconfigured", via: "mcp_verify_voice_pin" },
    });
    return {
      ok: false,
      error: "temporarily_unavailable",
      message: "Verification is temporarily unavailable. Please try again later.",
    };
  }

  const { rows } = await db.query<VoiceAccessRow>(
    `SELECT user_id, phone_e164, pin_hash, enabled, failed_attempts, locked_until
       FROM voice_access WHERE pin_uid = $1 LIMIT 1`,
    [uid]
  );
  const access = rows[0];
  if (!access || !access.enabled) {
    await dummyPinVerify(pin);
    await logVoiceAudit(db, {
      action: "pin_failed",
      details: { reason: "not_enrolled_or_disabled", via: "mcp_verify_voice_pin" },
    });
    return invalid;
  }

  const retryAfter = lockoutSecondsRemaining(access.locked_until);
  if (retryAfter > 0) {
    await logVoiceAudit(db, {
      userId: access.user_id,
      phoneE164: access.phone_e164,
      action: "pin_locked",
      details: { retry_after_seconds: retryAfter, via: "mcp_verify_voice_pin" },
    });
    return {
      ok: false,
      error: "locked",
      retry_after_seconds: retryAfter,
      message:
        "Too many wrong PIN attempts. Voice access is locked for a few minutes — please try again later.",
    };
  }

  // Defense in depth: the pin_uid match already identifies the account, but
  // the scrypt envelope remains the authoritative PIN check. (A mismatch
  // here is unexpected — it would mean the stored identifier and hash
  // disagree — and is treated as a failed attempt.)
  const ok = await verifyPin(pin, access.pin_hash);
  if (!ok) {
    // Atomic increment: concurrent wrong PINs cannot lose updates or
    // bypass the lockout threshold.
    const updated = await db.query<{
      failed_attempts: number;
      locked_until: string | null;
    }>(
      `UPDATE voice_access
          SET failed_attempts = failed_attempts + 1,
              locked_until = CASE
                WHEN failed_attempts + 1 >= $2
                THEN now() + ($3 || ' minutes')::interval
                ELSE locked_until END,
              updated_at = now()
        WHERE user_id = $1
        RETURNING failed_attempts, locked_until`,
      [access.user_id, MAX_PIN_ATTEMPTS, String(LOCKOUT_MINUTES)]
    );
    const failedAttempts = updated.rows[0]?.failed_attempts ?? MAX_PIN_ATTEMPTS;
    const nowLocked = failedAttempts >= MAX_PIN_ATTEMPTS;
    await logVoiceAudit(db, {
      userId: access.user_id,
      phoneE164: access.phone_e164,
      action: nowLocked ? "pin_locked" : "pin_failed",
      details: {
        attempts_remaining: nowLocked ? 0 : MAX_PIN_ATTEMPTS - failedAttempts,
        via: "mcp_verify_voice_pin",
      },
    });
    if (nowLocked) {
      return {
        ok: false,
        error: "locked",
        retry_after_seconds: LOCKOUT_MINUTES * 60,
        message:
          "Too many wrong PIN attempts. Voice access is locked for 15 minutes.",
      };
    }
    // Same generic shape as the unknown-PIN response below: the presence
    // or absence of extra fields must not reveal whether a PIN is enrolled.
    return invalid;
  }

  // Success: reset the counter, revoke superseded sessions, issue a new one.
  const token = generateSessionToken();
  const expiresAt = sessionExpiresAt();
  await db.query(
    `UPDATE voice_access
        SET failed_attempts = 0, locked_until = NULL,
            last_verified_at = now(), updated_at = now()
      WHERE user_id = $1`,
    [access.user_id]
  );
  await db.query(
    `UPDATE voice_sessions SET revoked_at = now(), revoke_reason = 'superseded'
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [access.user_id]
  );
  const issued = await db.query<{ id: string }>(
    `INSERT INTO voice_sessions (token_hash, user_id, phone_e164, expires_at)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [hashSessionToken(token), access.user_id, access.phone_e164, expiresAt.toISOString()]
  );
  await logVoiceAudit(db, {
    userId: access.user_id,
    phoneE164: access.phone_e164,
    action: "session_issued",
    details: { session_id: issued.rows[0]?.id, via: "mcp_verify_voice_pin" },
  });
  return {
    ok: true,
    session_token: token,
    expires_in_minutes: SESSION_TTL_MINUTES,
    message:
      "Account verified. Pass session_token as an argument to every account tool call. Never read it aloud.",
  };
}

/**
 * Tools visible to this MCP client. A present-but-invalid authorization
 * value (e.g. the pre-auth "anonymous" marker, or an expired token) sees
 * only the anonymous knowledge-graph tool — the model can never even learn
 * account tool names before authentication. A missing header keeps today's
 * behavior (full list; tools/call still enforces auth) so clients that do
 * not forward the header on tools/list never break.
 */
async function visibleMcpTools(
  db: Db,
  authorizationHeader: string | null | undefined
): Promise<McpToolDef[]> {
  const anonymousOnly = MCP_TOOLS.filter((t) => t.anonymous);
  // Console-agent mode: the request provably comes from our xAI console agent
  // (static configured secret). Expose the full catalog so the model has every
  // tool schema; tools/call still enforces per-call authentication.
  if (isConsoleMcpRequest(authorizationHeader)) return MCP_TOOLS;
  if (!authorizationHeader || !authorizationHeader.trim()) return MCP_TOOLS;
  const token = extractMcpToken(authorizationHeader);
  if (!token) return anonymousOnly;
  try {
    await resolveVoiceContext(`Bearer ${token}`, db);
    return MCP_TOOLS;
  } catch {
    return anonymousOnly;
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
    case "tools/list": {
      const visible = await visibleMcpTools(db, authorizationHeader);
      return {
        status: 200,
        body: {
          jsonrpc: "2.0",
          id: req.id ?? null,
          result: {
            tools: visible.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            })),
          },
        },
      };
    }
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
