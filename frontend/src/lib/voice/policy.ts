/**
 * SmartPR Voice Phase 3: server-side voice action policy.
 *
 * Grok is the conversational interface. SmartPR is authoritative for whether
 * an action may happen at all, and in which mode. This classification is
 * computed HERE — never in the model prompt, and never from model input.
 *
 * Modes:
 *   IMMEDIATE             - safe to execute right away (reads, verified-email sends)
 *   CONFIRMATION_REQUIRED - needs an explicit caller "yes" via a server-side
 *                           pending action before anything is persisted
 *   SECURE_LINK_REQUIRED  - cannot be done by voice; offer a secure web link
 *   DENIED                - not permitted (prohibited action, role, or plan)
 */

import type { VoiceContext } from "./context";

export type VoiceActionMode =
  | "IMMEDIATE"
  | "CONFIRMATION_REQUIRED"
  | "SECURE_LINK_REQUIRED"
  | "DENIED";

export interface VoiceActionDecision {
  allowed: boolean;
  mode: VoiceActionMode;
  /** Safe error code when denied (maps into the MCP safe contract). */
  code?: string;
  /** Safe, speakable message. */
  message?: string;
  /** For SECURE_LINK_REQUIRED: why voice cannot do it. */
  reason?: string;
}

/** Phase 3 write-capable actions. */
export type VoiceActionKind =
  | "create_draft_project"
  | "update_project_fact"
  | "send_secure_upload_link"
  | "generate_deliverable"
  | "email_deliverable"
  | "add_note"
  | "send_secure_action_link";

/**
 * Actions that must NEVER be performed directly over voice (§8).
 * When requested, SmartPR may only prepare them and send a secure
 * authenticated web link.
 */
export const PROHIBITED_VOICE_ACTIONS: ReadonlySet<string> = new Set([
  "government_submission",
  "portal_filing",
  "electronic_signature",
  "legal_attestation",
  "tax_attestation",
  "ownership_change",
  "officer_change",
  "ein_change",
  "payment",
  "credit_card_change",
  "billing_change",
  "password_change",
  "pin_change",
  "mfa_change",
  "delete_business",
  "delete_project",
  "delete_evidence",
  "delete_user",
  "invite_member",
  "remove_member",
  "change_workspace_role",
  "sso_change",
  "final_filing_submission",
]);

/**
 * Prohibited actions that CAN be prepared as a secure web link via
 * send_secure_action_link. The link identifies exactly which action the
 * user is completing; nothing executes over voice.
 */
export const SECURE_LINKABLE_ACTIONS: ReadonlySet<string> = new Set([
  "government_submission",
  "portal_filing",
  "electronic_signature",
  "legal_attestation",
  "tax_attestation",
  "payment",
  "billing_change",
  "password_change",
  "pin_change",
  "mfa_change",
  "final_filing_submission",
  "download_deliverable",
  "upload_evidence",
]);

const WRITE_ROLES = new Set(["OWNER", "ADMIN", "MEMBER"]);

/** True when the caller's workspace role may perform voice writes. */
export function voiceCanWrite(ctx: VoiceContext): boolean {
  if (ctx.platformAdmin) return true;
  return !!ctx.workspaceRole && WRITE_ROLES.has(ctx.workspaceRole.toUpperCase());
}

/**
 * Classify a Phase 3 action server-side. The model never provides or
 * overrides this classification.
 */
export function evaluateVoiceAction(opts: {
  action: VoiceActionKind;
  ctx: VoiceContext;
}): VoiceActionDecision {
  const { action, ctx } = opts;
  switch (action) {
    case "create_draft_project":
    case "update_project_fact":
    case "add_note":
      if (!voiceCanWrite(ctx)) {
        return {
          allowed: false,
          mode: "DENIED",
          code: "forbidden",
          message:
            "Your workspace role does not permit making changes by voice.",
        };
      }
      return { allowed: true, mode: "CONFIRMATION_REQUIRED" };

    case "send_secure_upload_link":
    case "send_secure_action_link":
      // Sends go only to the verified account email; nothing is persisted
      // from model input beyond the link record itself.
      return { allowed: true, mode: "IMMEDIATE" };

    case "generate_deliverable":
      // Plan entitlement is enforced in the service via the existing
      // billing access check (free plans are denied there).
      return { allowed: true, mode: "IMMEDIATE" };

    case "email_deliverable":
      // Destination is always the verified account email; recipient
      // override is impossible by construction.
      return { allowed: true, mode: "IMMEDIATE" };

    default:
      return {
        allowed: false,
        mode: "DENIED",
        code: "forbidden",
        message: "That action is not available by voice.",
      };
  }
}

/**
 * Classify a requested sensitive action name (§8). Used by
 * send_secure_action_link to decide whether a secure link may be offered.
 */
export function classifySensitiveAction(actionType: string): {
  prohibited: boolean;
  linkable: boolean;
} {
  const normalized = actionType.trim().toLowerCase();
  const prohibited = PROHIBITED_VOICE_ACTIONS.has(normalized);
  return { prohibited, linkable: prohibited && SECURE_LINKABLE_ACTIONS.has(normalized) };
}
