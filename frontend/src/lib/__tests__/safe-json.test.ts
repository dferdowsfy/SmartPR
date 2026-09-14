// Tests for readJson (src/lib/safe-json.ts).
// Guarantees every Enterprise page fetch survives empty / non-JSON / error
// bodies with a friendly retry message instead of the raw
// "Failed to execute 'json' on 'Response'" error.
// Run with:
//   npx tsx --test src/lib/__tests__/safe-json.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readJson } from "../safe-json";

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("successful JSON body returns { ok: true, data }", async () => {
  const result = await readJson<{ workspaces: unknown[] }>(
    jsonRes({ workspaces: [{ id: "w1" }] })
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, { workspaces: [{ id: "w1" }] });
  assert.equal(result.status, 200);
});

test("empty body on success yields friendly retry message", async () => {
  const result = await readJson(new Response("", { status: 200 }));
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /empty response/i);
  assert.equal(result.data, null);
});

test("empty body on failure yields HTTP status message", async () => {
  const result = await readJson(new Response("", { status: 503 }));
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /HTTP 503/);
});

test("HTML/proxy error body yields friendly message, not a JSON parse throw", async () => {
  const result = await readJson(
    new Response("<html><body>Bad Gateway</body></html>", { status: 502 })
  );
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /unexpected response/i);
});

test("JSON error envelope prefers friendly message", async () => {
  const result = await readJson(
    jsonRes({ error: "internal_error", message: "Something went wrong. Please retry." }, 500)
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "Something went wrong. Please retry.");
  assert.deepEqual(result.data, { error: "internal_error", message: "Something went wrong. Please retry." });
});

test("JSON error envelope falls back to error code when no message", async () => {
  const result = await readJson(jsonRes({ error: "forbidden" }, 403));
  assert.equal(result.ok, false);
  assert.equal(result.error, "forbidden");
});

test("401 defaults to session-expired message", async () => {
  const result = await readJson(jsonRes({ error: "x" }, 401));
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /session expired/i);
});

test("401 respects server-provided message when present", async () => {
  const result = await readJson(
    jsonRes({ error: "x", message: "Custom re-login text." }, 401)
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, "Custom re-login text.");
});

test("non-JSON success body is tolerated as a thrown friendly error", async () => {
  const result = await readJson(new Response("not json at all", { status: 200 }));
  assert.equal(result.ok, false);
  assert.ok(result.error);
  assert.match(result.error, /unexpected response/i);
});
