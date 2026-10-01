// ============================================================================
// AI provider policy — which provider may serve a use case in this deployment.
//
// Deterministic and fail-closed:
//   standard   + MODEL_GATEWAY=direct        -> xai (today's behavior)
//   any mode   + MODEL_GATEWAY=azure-foundry -> azure-foundry (not implemented
//                                              yet: the router refuses; never xAI)
//   enterprise + MODEL_GATEWAY=direct        -> denied. Enterprise model access
//                                              requires an approved deployment
//                                              allowlist, which does not exist yet.
//   invalid deployment config / unknown use case -> denied.
// ============================================================================

import { loadDeploymentConfig, type DeploymentConfig } from "../config/deployment";
import { AI_USE_CASES, AiRoutingError, type AiProviderId, type AiUseCase } from "./types";

export interface AiRoute {
  useCase: AiUseCase;
  providerId: AiProviderId;
  deploymentMode: DeploymentConfig["mode"];
}

export function isAiUseCase(value: unknown): value is AiUseCase {
  return typeof value === "string" && (AI_USE_CASES as readonly string[]).includes(value);
}

export function resolveAiRoute(
  useCase: unknown,
  env: Record<string, string | undefined> = process.env
): AiRoute {
  if (!isAiUseCase(useCase)) {
    throw new AiRoutingError("unknown_use_case", `Unknown AI use case: ${String(useCase)}`);
  }

  let config: Readonly<DeploymentConfig>;
  try {
    config = loadDeploymentConfig(env);
  } catch {
    throw new AiRoutingError(
      "invalid_deployment_config",
      "AI is unavailable: the deployment configuration is invalid."
    );
  }

  if (config.modelGateway === "azure-foundry") {
    return { useCase, providerId: "azure-foundry", deploymentMode: config.mode };
  }
  if (config.mode === "enterprise") {
    throw new AiRoutingError(
      "policy_denied",
      "AI is unavailable: direct vendor model access is not approved in enterprise mode."
    );
  }
  return { useCase, providerId: "xai", deploymentMode: config.mode };
}
