import test, { before } from "node:test";
import assert from "node:assert/strict";
import { applyPassportProposals } from "./passportExtraction.ts";
import { emptyCanonicalData } from "../../forms/engine/types.ts";

process.env.XAI_API_KEY = "voice-contract-test-only";
process.env.XAI_BASE_URL = "https://api.x.ai/v1";
let interpret: typeof import("../../api/intake/interpret/route.ts").POST;
let transcribe: typeof import("../../api/intake/voice/route.ts").POST;
before(async () => {
  interpret = (await import("../../api/intake/interpret/route.ts")).POST;
  transcribe = (await import("../../api/intake/voice/route.ts")).POST;
});

const candidates = { businessTypes: [{ id: "BT_RESTAURANT", name: "Restaurant" }], municipalities: ["San Juan"], questions: [{ id: "Q_ALCOHOL_SOLD", type: "boolean", question: "Sell alcohol?" }] };
const request = (body: unknown) => new Request("http://localhost/api/intake/interpret", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const response = (body: unknown) => Response.json({ output: [{ content: [{ type: "output_text", text: JSON.stringify(body) }] }] });

test("existing discovery route keeps prompt, request contract, and interpretation unchanged", async (t) => {
  const model = { summary: "A restaurant", businessType: { id: "BT_RESTAURANT", name: "Restaurant", confidence: 0.99 }, municipality: { value: "San Juan", confidence: 0.99 }, profileValues: [], answers: [] };
  t.mock.method(globalThis, "fetch", async (url: unknown, options: RequestInit) => {
    assert.equal(url, "https://api.x.ai/v1/responses");
    const body = JSON.parse(String(options.body));
    assert.equal(body.max_output_tokens, 1600);
    assert.equal(body.store, false);
    assert.match(body.input[0].content, /You are the SmartPR intake interpretation engine/);
    assert.doesNotMatch(body.input[0].content, /ADDITIONAL PASSPORT MODE/);
    return response(model);
  });
  const result = await interpret(request({ description: "I want to open a restaurant in San Juan.", candidates }));
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).interpretation, model);
});

test("Passport uses same Grok interpreter and rejects legacy paths around conflict review", async (t) => {
  const transcript = "My legal name is Caribe Foods LLC and EIN is 66-1234567. We have twelve employees. We sell alcohol.";
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    assert.equal(body.max_output_tokens, 6500);
    assert.match(body.input[0].content, /ADDITIONAL PASSPORT MODE/);
    return response({
      interpretation: { municipality: { value: "San Juan", confidence: 1 }, profileValues: [{ key: "name", value: "Silently overwritten", confidence: 1 }, { key: "ein", value: "99-9999999", confidence: 1 }], answers: [{ questionId: "Q_ALCOHOL_SOLD", value: true, confidence: 0.99 }] },
      proposals: Object.entries({ legalName: "Caribe Foods LLC", ein: "66-1234567", employeeCount: 12 }).map(([fieldId, value]) => ({ fieldId, value, confidence: 0.99, evidence: transcript, canonicalKey: "__proto__.ignore" })),
    });
  });
  const result = await interpret(request({ mode: "passport", description: transcript, candidates }));
  const data = await result.json();
  assert.equal(result.status, 200);
  assert.equal(data.proposals.length, 3);
  assert.deepEqual(data.interpretation.profileValues, []);
  assert.equal(data.interpretation.municipality, undefined);
  assert.equal(data.interpretation.answers[0].questionId, "Q_ALCOHOL_SOLD");
  const current = emptyCanonicalData(); current.business.legalName = "Manually entered LLC";
  const applied = applyPassportProposals(current, data.proposals);
  assert.equal(applied.next.business.legalName, "Manually entered LLC");
  assert.equal(applied.next.business.employeeCount, 12);
  assert.equal(applied.next.business.ein, "66-1234567");
  assert.equal(applied.conflicts.length, 1);
});

test("voice recording goes to Grok /stt, options before file, long transcript preserved", async (t) => {
  const transcript = `${"We have details to add. ".repeat(80)}My legal entity name is Caribe Foods LLC.`;
  t.mock.method(globalThis, "fetch", async (url: unknown, options: RequestInit) => {
    assert.equal(url, "https://api.x.ai/v1/stt");
    assert.match(String((options.headers as Record<string, string>).Authorization), /^Bearer /);
    const form = options.body as FormData;
    assert.equal(form.get("format"), "true");
    assert.equal(form.get("language"), "es");
    assert.equal([...form.keys()].at(-1), "file");
    return Response.json({ text: transcript, language: "es", duration: 30 });
  });
  const form = new FormData(); form.append("language", "es"); form.append("audio", new Blob([new Uint8Array(4000)], { type: "audio/webm" }), "audio.webm");
  const result = await transcribe(new Request("http://localhost/api/intake/voice", { method: "POST", body: form }));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).transcript, transcript);
});

test("malformed, oversized, provider errors and no speech cannot mutate Passport", async (t) => {
  assert.equal((await interpret(request({ mode: "passport", description: { unexpected: true } }))).status, 400);
  assert.equal((await interpret(request({ mode: "passport", description: "x".repeat(12001) }))).status, 400);
  t.mock.method(globalThis, "fetch", async () => new Response("failure", { status: 503 }));
  assert.equal((await interpret(request({ mode: "passport", description: "My name is Caribe LLC" }))).status, 502);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({ text: "" }));
  const form = new FormData(); form.append("audio", new Blob(["not-real-audio"]), "test.webm");
  assert.equal((await transcribe(new Request("http://localhost/api/intake/voice", { method: "POST", body: form }))).status, 422);
});
