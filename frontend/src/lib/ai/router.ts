// ============================================================================
// AI router — the single entry point for SmartPR core text generation.
//
//   feature -> generateText(useCase, request) -> policy -> provider
//
// Providers are looked up by id; an id without an implementation (e.g.
// "azure-foundry" before PR #5) is refused, never replaced by another vendor.
// Every call emits one metadata-only log line (no prompt/response text).
// ============================================================================

import { logAiEvent } from "../security/ai-logging";
import { resolveAiRoute, type AiRoute } from "./policy";
import { xaiProvider } from "./providers/xai";
import {
  AiRoutingError,
  type AiProviderId,
  type AiTextProvider,
  type AiUseCase,
  type GenerateTextRequest,
} from "./types";

const PROVIDERS: Partial<Record<AiProviderId, AiTextProvider>> = {
  xai: xaiProvider,
};

/** Test seam: replace or remove a provider implementation. */
export function setAiProviderForTests(id: AiProviderId, provider: AiTextProvider | null): void {
  if (provider) PROVIDERS[id] = provider;
  else if (id === "xai") PROVIDERS.xai = xaiProvider;
  else delete PROVIDERS[id];
}

function providerFor(route: AiRoute): AiTextProvider {
  const provider = PROVIDERS[route.providerId];
  if (!provider) {
    throw new AiRoutingError(
      "provider_not_implemented",
      `AI is unavailable: provider "${route.providerId}" is not implemented in this build.`
    );
  }
  return provider;
}

/**
 * Whether `useCase` can be served right now. False (never an exception) when
 * the policy denies it, the provider is missing, or it has no credentials —
 * callers keep their existing "AI not configured" responses.
 */
export function isAiConfigured(useCase: AiUseCase): boolean {
  try {
    return providerFor(resolveAiRoute(useCase)).isConfigured();
  } catch (err) {
    if (err instanceof AiRoutingError) {
      console.warn(`[ai] ${useCase} unavailable (${err.code}): ${err.message}`);
      return false;
    }
    throw err;
  }
}

/** Model identifier reported to clients for `useCase` ("unavailable" if unroutable). */
export function aiModelFor(useCase: AiUseCase): string {
  try {
    return providerFor(resolveAiRoute(useCase)).model();
  } catch {
    return "unavailable";
  }
}

/**
 * Generate text for a use case through the approved provider. Provider errors
 * (e.g. XaiApiError, AbortError) propagate unchanged so callers' existing
 * handling keeps working; routing failures throw AiRoutingError.
 */
export async function generateText(
  useCase: AiUseCase,
  request: GenerateTextRequest
): Promise<string> {
  const started = Date.now();
  let route: AiRoute | null = null;
  let provider: AiTextProvider | null = null;
  try {
    route = resolveAiRoute(useCase);
    provider = providerFor(route);
    const text = await provider.generateText(request);
    logAiEvent({
      event: "ai.generate_text",
      provider: provider.id,
      model: provider.model(),
      duration_ms: Date.now() - started,
      outcome: "ok",
      meta: { use_case: useCase, deployment_mode: route.deploymentMode },
    });
    return text;
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    logAiEvent({
      level: "error",
      event: "ai.generate_text",
      provider: provider?.id ?? route?.providerId,
      model: provider?.model(),
      duration_ms: Date.now() - started,
      outcome: aborted ? "timeout" : "error",
      error_code:
        err instanceof AiRoutingError
          ? err.code
          : err instanceof Error
            ? err.name
            : "unknown",
      meta: { use_case: useCase, deployment_mode: route?.deploymentMode ?? "unknown" },
    });
    throw err;
  }
}
