import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";

// The xAI client reads XAI_API_KEY / XAI_MODEL / XAI_BASE_URL at module load,
// exactly as in production. Pin a test key and the defaults BEFORE importing.
const ENV_KEYS = [
  "XAI_API_KEY",
  "XAI_MODEL",
  "XAI_BASE_URL",
  "XAI_REASONING_EFFORT",
  "DEPLOYMENT_MODE",
  "CUSTOMER_ID",
  "CLOUD_PROVIDER",
  "DATABASE_PROVIDER",
  "STORAGE_PROVIDER",
  "AUTH_PROVIDER",
  "MODEL_GATEWAY",
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
for (const k of ENV_KEYS) delete process.env[k];
const TEST_KEY = "test-key-not-a-secret";
process.env.XAI_API_KEY = TEST_KEY;

type RouterModule = typeof import("./router");
type ProviderModule = typeof import("./providers/xai");
let generateText: RouterModule["generateText"];
let isAiConfigured: RouterModule["isAiConfigured"];
let aiModelFor: RouterModule["aiModelFor"];
let setAiProviderForTests: RouterModule["setAiProviderForTests"];
let AI_USE_CASES: typeof import("./types")["AI_USE_CASES"];
let AiRoutingError: typeof import("./types")["AiRoutingError"];
let provider: ProviderModule;
let shim: ProviderModule;

const ENTERPRISE_BASE = {
  DEPLOYMENT_MODE: "enterprise",
  CUSTOMER_ID: "example-customer",
  CLOUD_PROVIDER: "azure",
  DATABASE_PROVIDER: "azure-postgres",
  STORAGE_PROVIDER: "azure-blob",
  AUTH_PROVIDER: "entra",
};
const DEPLOY_KEYS = [...Object.keys(ENTERPRISE_BASE), "MODEL_GATEWAY"];

const SECRET_PROMPT = "CONFIDENTIAL-CLIENT-DOCUMENT Acme Tax ID 66-1234567";
const SECRET_REPLY = "MODEL-REPLY-WITH-CLIENT-DATA";

type Captured = { url: string; init: RequestInit };
let calls: Captured[] = [];
let respond: () => Response = () => okResponse(SECRET_REPLY);
let logLines: string[] = [];
const realFetch = globalThis.fetch;
const realLog = console.log;
const realWarn = console.warn;

function okResponse(text: string): Response {
  return new Response(
    JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text }] }] }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
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

function setDeployment(env: Record<string, string>) {
  for (const k of DEPLOY_KEYS) delete process.env[k];
  Object.assign(process.env, env);
}

before(async () => {
  ({ generateText, isAiConfigured, aiModelFor, setAiProviderForTests } = await import("./router"));
  ({ AI_USE_CASES, AiRoutingError } = await import("./types"));
  provider = await import("./providers/xai");
  shim = await import("../../app/ai/xai");
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  console.log = (...args: unknown[]) => void logLines.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => void logLines.push(args.map(String).join(" "));
});
after(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
  console.warn = realWarn;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});
beforeEach(() => {
  calls = [];
  logLines = [];
  respond = () => okResponse(SECRET_REPLY);
  setDeployment({});
});
afterEach(() => setAiProviderForTests("azure-foundry", null));

describe("Standard deployment", () => {
  it("1+2. routes to xAI with the unchanged default model", async () => {
    assert.equal(provider.XAI_MODEL, "grok-4.3");
    assert.equal(aiModelFor("chat"), "grok-4.3");
    assert.equal(isAiConfigured("chat"), true);
    assert.equal(await generateText("chat", request()), SECRET_REPLY);
    assert.equal(calls.length, 1);
  });

  it("3. sends the identical xAI Responses request (endpoint, auth, body, store:false)", async () => {
    const req = request();
    await generateText("document_analysis", req);
    const [{ url, init }] = calls;
    assert.equal(url, "https://api.x.ai/v1/responses");
    assert.equal(init.method, "POST");
    assert.deepEqual(init.headers, {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TEST_KEY}`,
    });
    assert.equal(init.signal, req.signal);
    assert.deepEqual(JSON.parse(String(init.body)), {
      model: "grok-4.3",
      input: req.input,
      reasoning: { effort: "none" },
      max_output_tokens: 2000,
      temperature: 0.2,
      store: false,
    });
  });

  it("4. every supported use case routes to xAI", async () => {
    for (const useCase of AI_USE_CASES) {
      calls = [];
      logLines = [];
      await generateText(useCase, request());
      assert.equal(calls.length, 1, useCase);
      const line = JSON.parse(logLines.find((l) => l.includes("ai.generate_text"))!);
      assert.equal(line.provider, "xai");
      assert.equal(line.meta.use_case, useCase);
      assert.equal(line.meta.deployment_mode, "standard");
    }
  });

  it("explicit DEPLOYMENT_MODE=standard + MODEL_GATEWAY=direct behaves the same", async () => {
    setDeployment({ DEPLOYMENT_MODE: "standard", MODEL_GATEWAY: "direct" });
    await generateText("chat", request());
    assert.equal(calls.length, 1);
  });
});

describe("fail-closed routing", () => {
  it("5. unknown use case fails closed without a provider call", async () => {
    await assert.rejects(
      generateText("summarize_everything" as never, request()),
      (e: unknown) => e instanceof AiRoutingError && e.code === "unknown_use_case"
    );
    assert.equal(calls.length, 0);
  });

  it("6. enterprise + azure-foundry does NOT fall back to xAI", async () => {
    setDeployment({ ...ENTERPRISE_BASE, MODEL_GATEWAY: "azure-foundry" });
    for (const useCase of AI_USE_CASES) {
      await assert.rejects(
        generateText(useCase, request()),
        (e: unknown) => e instanceof AiRoutingError && e.code === "provider_not_implemented"
      );
      assert.equal(isAiConfigured(useCase), false);
      assert.equal(aiModelFor(useCase), "unavailable");
    }
    assert.equal(calls.length, 0);
  });

  it("6b. MODEL_GATEWAY=azure-foundry is refused in Standard too (never xAI)", async () => {
    setDeployment({ MODEL_GATEWAY: "azure-foundry" });
    await assert.rejects(generateText("chat", request()), AiRoutingError);
    assert.equal(calls.length, 0);
  });

  it("6c. enterprise + direct vendor gateway is denied by policy", async () => {
    setDeployment({ ...ENTERPRISE_BASE, MODEL_GATEWAY: "direct" });
    await assert.rejects(
      generateText("chat", request()),
      (e: unknown) => e instanceof AiRoutingError && e.code === "policy_denied"
    );
    assert.equal(isAiConfigured("chat"), false);
    assert.equal(calls.length, 0);
  });

  it("7. missing or invalid enterprise configuration fails closed", async () => {
    const cases: Record<string, string>[] = [
      { DEPLOYMENT_MODE: "enterprise" },
      { ...ENTERPRISE_BASE },
      { ...ENTERPRISE_BASE, MODEL_GATEWAY: "openai" },
      { DEPLOYMENT_MODE: "Enterprise", MODEL_GATEWAY: "direct" },
    ];
    for (const env of cases) {
      setDeployment(env);
      await assert.rejects(
        generateText("chat", request()),
        (e: unknown) => e instanceof AiRoutingError && e.code === "invalid_deployment_config",
        JSON.stringify(env)
      );
      assert.equal(isAiConfigured("chat"), false);
    }
    assert.equal(calls.length, 0);
  });
});

describe("errors and logging", () => {
  it("8. provider errors propagate unchanged (XaiApiError, AbortError)", async () => {
    respond = () => new Response("upstream exploded", { status: 500 });
    await assert.rejects(
      generateText("chat", request()),
      (e: unknown) => e instanceof shim.XaiApiError && e.status === 500
    );
    const line = JSON.parse(logLines.find((l) => l.includes("ai.generate_text"))!);
    assert.equal(line.outcome, "error");
    assert.equal(line.error_code, "XaiApiError");

    const abort = new Error("aborted");
    abort.name = "AbortError";
    respond = () => {
      throw abort;
    };
    await assert.rejects(generateText("chat", request()), (e: unknown) => e === abort);
  });

  it("9. metadata logger never receives prompt, response or key content", async () => {
    await generateText("document_analysis", request());
    respond = () => new Response("bad", { status: 400 });
    await assert.rejects(generateText("document_analysis", request()));
    setDeployment({ ...ENTERPRISE_BASE, MODEL_GATEWAY: "azure-foundry" });
    await assert.rejects(generateText("document_analysis", request()));

    const all = logLines.join("\n");
    assert.ok(logLines.length >= 3);
    for (const forbidden of [SECRET_PROMPT, "Acme", SECRET_REPLY, "system prompt", TEST_KEY]) {
      assert.ok(!all.includes(forbidden), `log leaked: ${forbidden}`);
    }
  });
});

describe("compatibility", () => {
  it("10. app/ai/xai keeps every public export callers use", () => {
    assert.equal(shim.XAI_MODEL, provider.XAI_MODEL);
    assert.equal(shim.requestXaiText, provider.requestXaiText);
    assert.equal(shim.requestXaiStt, provider.requestXaiStt);
    assert.equal(shim.isXaiConfigured, provider.isXaiConfigured);
    assert.equal(shim.XaiApiError, provider.XaiApiError);
    assert.equal(shim.rejectsReasoningEffort, provider.rejectsReasoningEffort);
    assert.equal(shim.isXaiConfigured(), true);
  });

  it("an implemented replacement provider is used only when the policy routes to it", async () => {
    setAiProviderForTests("azure-foundry", {
      id: "azure-foundry",
      model: () => "fake-deployment",
      isConfigured: () => true,
      generateText: async () => "from fake",
    });
    setDeployment({ ...ENTERPRISE_BASE, MODEL_GATEWAY: "azure-foundry" });
    assert.equal(await generateText("chat", request()), "from fake");
    assert.equal(calls.length, 0);
  });
});
