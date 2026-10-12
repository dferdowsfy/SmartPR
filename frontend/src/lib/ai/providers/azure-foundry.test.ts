import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

// The Foundry client reads AZURE_FOUNDRY_* at module load, exactly as in
// production. Pin fake values and the deployment default BEFORE importing.
const ENV_KEYS = ["AZURE_FOUNDRY_ENDPOINT", "AZURE_FOUNDRY_API_KEY", "AZURE_FOUNDRY_DEPLOYMENT"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
for (const k of ENV_KEYS) delete process.env[k];
const TEST_ENDPOINT = "https://example-foundry.services.ai.azure.com/openai/v1/chat/completions";
const TEST_KEY = "test-foundry-key-not-a-secret";
process.env.AZURE_FOUNDRY_ENDPOINT = TEST_ENDPOINT;
process.env.AZURE_FOUNDRY_API_KEY = TEST_KEY;

type ProviderModule = typeof import("./azure-foundry");
let provider: ProviderModule;

const SECRET_PROMPT = "CONFIDENTIAL-CLIENT-DOCUMENT Acme Tax ID 66-1234567";
const SECRET_REPLY = "MODEL-REPLY-WITH-CLIENT-DATA";

type Captured = { url: string; init: RequestInit };
let calls: Captured[] = [];
let respond: () => Response = () => okResponse(SECRET_REPLY);
const realFetch = globalThis.fetch;

function okResponse(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function request() {
  return {
    input: [
      { role: "system" as const, content: "system prompt" },
      { role: "user" as const, content: SECRET_PROMPT },
    ],
    maxOutputTokens: 2000,
    temperature: 0.2,
    signal: new AbortController().signal,
  };
}

before(async () => {
  provider = await import("./azure-foundry");
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof fetch;
});
after(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});
beforeEach(() => {
  calls = [];
  respond = () => okResponse(SECRET_REPLY);
});

// Fresh module instance with a different env snapshot. The query string busts
// the ESM cache (one module record per URL); tsc skips resolving non-literal
// dynamic imports, tsx resolves them at runtime.
async function freshImport(query: string): Promise<ProviderModule> {
  return (await import(`./azure-foundry.ts?${query}`)) as ProviderModule;
}

describe("configuration", () => {
  it("defaults the deployment to grok-4.3 and reports it via the provider", () => {
    assert.equal(provider.AZURE_FOUNDRY_DEPLOYMENT, "grok-4.3");
    assert.equal(provider.azureFoundryProvider.id, "azure-foundry");
    assert.equal(provider.azureFoundryProvider.model(), "grok-4.3");
    assert.equal(provider.isAzureFoundryConfigured(), true);
    assert.equal(provider.azureFoundryProvider.isConfigured(), true);
  });

  it("a custom AZURE_FOUNDRY_DEPLOYMENT is honored", async () => {
    process.env.AZURE_FOUNDRY_DEPLOYMENT = "custom-deploy";
    try {
      const custom = await freshImport("deployment=custom");
      assert.equal(custom.AZURE_FOUNDRY_DEPLOYMENT, "custom-deploy");
      assert.equal(custom.azureFoundryProvider.model(), "custom-deploy");
      await custom.requestAzureFoundryText(request());
      const body = JSON.parse(String(calls[0].init.body));
      assert.equal(body.model, "custom-deploy");
    } finally {
      delete process.env.AZURE_FOUNDRY_DEPLOYMENT;
    }
  });
});

describe("request shape", () => {
  it("POSTs an OpenAI-compatible chat completion with bearer auth", async () => {
    const req = request();
    const text = await provider.requestAzureFoundryText(req);
    assert.equal(text, SECRET_REPLY);
    assert.equal(calls.length, 1);
    const [{ url, init }] = calls;
    assert.equal(url, TEST_ENDPOINT);
    assert.equal(init.method, "POST");
    assert.deepEqual(init.headers, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TEST_KEY}`,
    });
    assert.equal(init.signal, req.signal);
    assert.deepEqual(JSON.parse(String(init.body)), {
      model: "grok-4.3",
      messages: req.input,
      max_tokens: 2000,
      temperature: 0.2,
    });
  });

  it("the provider adapter delegates to the client", async () => {
    assert.equal(await provider.azureFoundryProvider.generateText(request()), SECRET_REPLY);
    assert.equal(calls.length, 1);
  });

  it("returns empty string when the response has no content", async () => {
    respond = () => okResponse("");
    assert.equal(await provider.requestAzureFoundryText(request()), "");
  });
});

describe("fail-closed behavior", () => {
  it("missing endpoint or key throws before any network call", async () => {
    // The module under test captured the test env at import; simulate a
    // misconfigured build with a fresh import and empty env.
    for (const k of ["AZURE_FOUNDRY_ENDPOINT", "AZURE_FOUNDRY_API_KEY"]) delete process.env[k];
    try {
      const bare = await freshImport("config=bare");
      assert.equal(bare.isAzureFoundryConfigured(), false);
      assert.equal(bare.azureFoundryProvider.isConfigured(), false);
      await assert.rejects(
        bare.requestAzureFoundryText(request()),
        (e: unknown) => e instanceof Error && /AZURE_FOUNDRY/.test(e.message)
      );
      assert.equal(calls.length, 0);
    } finally {
      process.env.AZURE_FOUNDRY_ENDPOINT = TEST_ENDPOINT;
      process.env.AZURE_FOUNDRY_API_KEY = TEST_KEY;
    }
  });

  it("HTTP errors throw AzureFoundryApiError with truncated detail", async () => {
    respond = () => new Response("upstream exploded " + "x".repeat(1000), { status: 500 });
    await assert.rejects(
      provider.requestAzureFoundryText(request()),
      (e: unknown) =>
        e instanceof provider.AzureFoundryApiError &&
        e.status === 500 &&
        e.detail.length <= 500 &&
        e.name === "AzureFoundryApiError"
    );
    assert.equal(calls.length, 1);
  });

  it("abort signals propagate unchanged", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    respond = () => {
      throw abort;
    };
    await assert.rejects(provider.requestAzureFoundryText(request()), (e: unknown) => e === abort);
  });
});
