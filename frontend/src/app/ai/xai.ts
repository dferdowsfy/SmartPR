// Server-only xAI Responses API client shared by SmartPR's AI routes.

export const XAI_MODEL = process.env.XAI_MODEL || "grok-4.3";

const XAI_API_KEY = process.env.XAI_API_KEY || "";
const XAI_BASE_URL = (process.env.XAI_BASE_URL || "https://api.x.ai/v1").replace(/\/$/, "");

export function isXaiConfigured(): boolean {
  return Boolean(XAI_API_KEY);
}

export class XaiApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string
  ) {
    super(`xAI error ${status}`);
    this.name = "XaiApiError";
  }
}

type XaiInputMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type XaiResponse = {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
};

function outputText(payload: XaiResponse): string {
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text || "")
    .join("");
}

export async function requestXaiText(options: {
  input: XaiInputMessage[];
  maxOutputTokens: number;
  temperature: number;
  signal: AbortSignal;
}): Promise<string> {
  if (!XAI_API_KEY) throw new Error("XAI_API_KEY is not configured on the server.");

  const response = await fetch(`${XAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: XAI_MODEL,
      input: options.input,
      reasoning: { effort: "none" },
      max_output_tokens: options.maxOutputTokens,
      temperature: options.temperature,
      // Uploaded business documents should not be retained by the model provider.
      store: false,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new XaiApiError(response.status, detail);
  }

  return outputText((await response.json()) as XaiResponse);
}

export type XaiSttResult = {
  text: string;
  language?: string;
  duration?: number;
};

/**
 * REST speech-to-text via POST /v1/stt (multipart).
 * ~$0.10/hr — not speech-to-speech. Options must precede `file` in the form.
 */
export async function requestXaiStt(options: {
  file: Blob;
  filename?: string;
  language?: string;
  keyterms?: string[];
  signal?: AbortSignal;
}): Promise<XaiSttResult> {
  if (!XAI_API_KEY) throw new Error("XAI_API_KEY is not configured on the server.");

  const form = new FormData();
  // Option fields must precede `file` per xAI multipart requirements.
  form.append("format", "true");
  if (options.language) form.append("language", options.language);
  for (const term of options.keyterms || []) {
    const trimmed = term.trim().slice(0, 50);
    if (trimmed) form.append("keyterm", trimmed);
  }
  const filename = options.filename || "audio.webm";
  form.append("file", options.file, filename);

  const response = await fetch(`${XAI_BASE_URL}/stt`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${XAI_API_KEY}`,
      Accept: "application/json",
    },
    body: form,
    signal: options.signal,
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new XaiApiError(response.status, detail);
  }

  const payload = (await response.json()) as {
    text?: string;
    language?: string;
    duration?: number;
  };

  return {
    text: typeof payload.text === "string" ? payload.text : "",
    language: typeof payload.language === "string" ? payload.language : undefined,
    duration: typeof payload.duration === "number" ? payload.duration : undefined,
  };
}
