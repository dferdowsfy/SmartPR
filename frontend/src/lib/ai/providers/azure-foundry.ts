// Azure Foundry provider (server-only): OpenAI-compatible chat completions
// client for SmartPR core AI paths. Business code reaches text generation
// through src/lib/ai/router.ts; MODEL_GATEWAY=azure-foundry routes here.
// Fail-closed: a missing endpoint or key throws; the router never replaces
// this provider with another vendor.
// See docs/enterprise-azure/ai-provider-architecture.md.

import type { AiInputMessage, AiTextProvider } from "../types";

export const AZURE_FOUNDRY_DEPLOYMENT = process.env.AZURE_FOUNDRY_DEPLOYMENT || "grok-4.3";

const AZURE_FOUNDRY_API_KEY = process.env.AZURE_FOUNDRY_API_KEY || "";
const AZURE_FOUNDRY_ENDPOINT = (process.env.AZURE_FOUNDRY_ENDPOINT || "").replace(/\/$/, "");

export function isAzureFoundryConfigured(): boolean {
  return Boolean(AZURE_FOUNDRY_API_KEY && AZURE_FOUNDRY_ENDPOINT);
}

export class AzureFoundryApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string
  ) {
    super(`Azure Foundry error ${status}`);
    this.name = "AzureFoundryApiError";
  }
}

type FoundryChatResponse = {
  choices?: Array<{
    message?: { content?: string | null };
  }>;
};

function responseText(payload: FoundryChatResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

export async function requestAzureFoundryText(options: {
  input: AiInputMessage[];
  maxOutputTokens: number;
  temperature: number;
  signal: AbortSignal;
}): Promise<string> {
  if (!AZURE_FOUNDRY_ENDPOINT || !AZURE_FOUNDRY_API_KEY) {
    throw new Error("AZURE_FOUNDRY_ENDPOINT and AZURE_FOUNDRY_API_KEY must be configured on the server.");
  }

  const response = await fetch(AZURE_FOUNDRY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AZURE_FOUNDRY_API_KEY}`,
    },
    body: JSON.stringify({
      model: AZURE_FOUNDRY_DEPLOYMENT,
      messages: options.input,
      max_tokens: options.maxOutputTokens,
      temperature: options.temperature,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new AzureFoundryApiError(response.status, detail);
  }

  return responseText((await response.json()) as FoundryChatResponse);
}

/** Provider-interface adapter over the client above (no behavior of its own). */
export const azureFoundryProvider: AiTextProvider = {
  id: "azure-foundry",
  model: (): string => AZURE_FOUNDRY_DEPLOYMENT,
  isConfigured: isAzureFoundryConfigured,
  generateText: requestAzureFoundryText,
};
