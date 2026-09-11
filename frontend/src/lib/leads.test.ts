import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// notifyFounder must treat an HTTP-200 error payload as a delivery failure.
// (The previous provider answered 200 + {"success":"false"} to every
// server-side request, and the old code only checked response.ok — so every
// founder notification since launch silently died.)
describe("notifyFounder", () => {
  const realFetch = globalThis.fetch;
  let lastRequest: { url: string; init: RequestInit } | null = null;
  let responder: () => Response = () =>
    new Response(JSON.stringify({ id: "re_123" }), { status: 200 });

  beforeEach(() => {
    lastRequest = null;
    responder = () => new Response(JSON.stringify({ id: "re_123" }), { status: 200 });
    process.env.RESEND_API_KEY = "re_test_key";
    globalThis.fetch = (async (url: any, init: any) => {
      lastRequest = { url: String(url), init };
      return responder();
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  });

  it("posts to the Resend API with the founder as recipient", async () => {
    const { notifyFounder } = await import("./leads.ts");
    await notifyFounder("New signup", { Name: "Ayden Bermudez", Email: "ayden@example.com" });
    assert.ok(lastRequest, "expected an HTTP request");
    assert.equal(lastRequest!.url, "https://api.resend.com/emails");
    const body = JSON.parse(String(lastRequest!.init.body));
    assert.deepEqual(body.to, ["dferdows@gmail.com"]);
    assert.match(body.subject, /New signup/);
    assert.match(body.text, /Ayden Bermudez/);
    assert.equal(
      (lastRequest!.init.headers as Record<string, string>)["Authorization"],
      "Bearer re_test_key"
    );
  });

  it("logs an error when the provider returns 200 with an error payload", async () => {
    responder = () =>
      new Response(JSON.stringify({ error: { message: "rejected" } }), { status: 200 });
    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => errors.push(String(msg));
    try {
      const { notifyFounder } = await import("./leads.ts");
      await notifyFounder("New signup", { Name: "Ayden Bermudez" });
    } finally {
      console.error = origError;
    }
    assert.ok(
      errors.some((m) => m.includes("delivery failed")),
      `expected a delivery-failed log, got: ${JSON.stringify(errors)}`
    );
  });

  it("skips loudly when no API key is configured", async () => {
    delete process.env.RESEND_API_KEY;
    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => errors.push(String(msg));
    try {
      const { notifyFounder } = await import("./leads.ts");
      await notifyFounder("New signup", { Name: "Ayden Bermudez" });
    } finally {
      console.error = origError;
    }
    assert.equal(lastRequest, null, "no HTTP request should fire without a key");
    assert.ok(
      errors.some((m) => m.includes("RESEND_API_KEY is not set")),
      `expected a missing-key log, got: ${JSON.stringify(errors)}`
    );
  });
});
