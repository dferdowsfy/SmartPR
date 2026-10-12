// Azure AI Speech — fast transcription (STT) via the REST API.
//
// Replaces the direct xAI /stt call for intake voice input so spoken business
// descriptions are processed under Microsoft's data-protection terms.
// Uses the fast transcription endpoint (server-side audio decoding — no
// GStreamer/SDK needed) with the es-PR locale for Puerto Rican Spanish and
// the SmartPR/PR vocabulary as a phrase list.
//
// Auth: AZURE_SPEECH_KEY (falls back to AZURE_FOUNDRY_API_KEY — the AI
// Services multi-service key also authorizes Speech). Region:
// AZURE_SPEECH_REGION (default eastus2).

export class AzureSpeechApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`Azure Speech STT error ${status}`);
    this.name = "AzureSpeechApiError";
    this.status = status;
    this.detail = detail;
  }
}

export interface AzureSttResult {
  text: string;
  language?: string;
  duration?: number;
}

export function azureSpeechKey(): string | undefined {
  return process.env.AZURE_SPEECH_KEY || process.env.AZURE_FOUNDRY_API_KEY || undefined;
}

export function azureSpeechRegion(): string {
  return process.env.AZURE_SPEECH_REGION || "eastus2";
}

export function isAzureSpeechConfigured(): boolean {
  return Boolean(azureSpeechKey());
}

export function sttLocale(language?: string): string {
  return language === "es" ? "es-PR" : "en-US";
}

export async function requestAzureStt(options: {
  file: Blob;
  filename?: string;
  language?: string;
  keyterms?: string[];
  signal?: AbortSignal;
}): Promise<AzureSttResult> {
  const key = azureSpeechKey();
  if (!key) throw new Error("Azure Speech is not configured on the server.");
  const region = azureSpeechRegion();
  const locale = sttLocale(options.language);

  const form = new FormData();
  form.append("audio", options.file, options.filename || "audio.webm");
  const definition: Record<string, unknown> = { locales: [locale] };
  const phrases = (options.keyterms || [])
    .map((t) => t.trim().slice(0, 50))
    .filter(Boolean);
  if (phrases.length > 0) definition.phraseList = { phrases };
  form.append("definition", JSON.stringify(definition));

  const url =
    `https://${region}.api.cognitive.microsoft.com` +
    `/speechtotext/transcriptions:transcribe?api-version=2025-10-15`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      Accept: "application/json",
    },
    body: form,
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new AzureSpeechApiError(response.status, detail);
  }

  const payload = (await response.json()) as {
    combinedPhrases?: { text?: string }[];
    durationMilliseconds?: number;
  };
  const text = (payload.combinedPhrases || [])
    .map((p) => p.text || "")
    .join(" ")
    .trim();
  return {
    text,
    language: locale,
    duration: (payload.durationMilliseconds || 0) / 1000,
  };
}
