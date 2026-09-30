// ============================================================================
// SmartPR AI provider abstraction — shared types.
//
// Business code names WHAT it needs (a use case); the router decides WHICH
// approved provider serves it. Providers hold no permitting/business logic.
// See docs/enterprise-azure/ai-provider-architecture.md.
// ============================================================================

/** Core text-generation use cases routed through the AI router. */
export const AI_USE_CASES = [
  "document_analysis",
  "intake_interpret",
  "chat",
  "passport_extract",
  "regulatory_ingest",
] as const;

export type AiUseCase = (typeof AI_USE_CASES)[number];

/** Providers the router knows how to name. Only "xai" is implemented. */
export type AiProviderId = "xai" | "azure-foundry";

export interface AiInputMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateTextRequest {
  input: AiInputMessage[];
  maxOutputTokens: number;
  temperature: number;
  signal: AbortSignal;
}

export interface AiTextProvider {
  id: AiProviderId;
  /** Model identifier the provider will call (reported in responses/logs). */
  model(): string;
  isConfigured(): boolean;
  generateText(request: GenerateTextRequest): Promise<string>;
}

export type AiRoutingErrorCode =
  | "unknown_use_case"
  | "invalid_deployment_config"
  | "policy_denied"
  | "provider_not_implemented";

/** Raised when no approved provider may serve a request. Never falls back. */
export class AiRoutingError extends Error {
  constructor(
    public readonly code: AiRoutingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AiRoutingError";
  }
}
