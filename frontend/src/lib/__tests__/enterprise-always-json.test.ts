// Tests for withEnterpriseHandler (src/app/api/enterprise/_util.ts).
// Guarantees every enterprise route ALWAYS returns a JSON error body on
// unexpected throws — never an empty 500 body (which surfaces on the client
// as "Failed to execute 'json' on 'Response': Unexpected end of JSON input").
// Run with:
//   npx tsx --test src/lib/__tests__/enterprise-always-json.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { withEnterpriseHandler } from "../../app/api/enterprise/_util";

test("success passthrough: JSON response returned untouched", async () => {
  const inner = new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { "content-type": "application/json" },
  });
  const wrapped = withEnterpriseHandler("GET /api/enterprise/test", async () => inner);
  const res = await wrapped(new Request("https://x.test/api/enterprise/test"));
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ok: true });
});

test("success passthrough: non-JSON (CSV download) response returned untouched", async () => {
  const csv = "id,name\n1,Acme\n";
  const inner = new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv",
      "content-disposition": 'attachment; filename="report.csv"',
    },
  });
  const wrapped = withEnterpriseHandler("GET /api/enterprise/test", async () => inner);
  const res = await wrapped(new Request("https://x.test/api/enterprise/test"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/csv");
  assert.equal(res.headers.get("content-disposition"), 'attachment; filename="report.csv"');
  assert.equal(await res.text(), csv);
});

test("throwing handler -> HTTP 500 with JSON {error:'internal_error'}", async () => {
  const wrapped = withEnterpriseHandler("POST /api/enterprise/test", async () => {
    throw new Error("boom");
  });
  const res = await wrapped(new Request("https://x.test/api/enterprise/test", { method: "POST" }));
  assert.equal(res.status, 500);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.error, "internal_error");
});

test("missing-table throw -> HTTP 500 with JSON {error:'missing_table', table}", async () => {
  const wrapped = withEnterpriseHandler("GET /api/enterprise/test", async () => {
    throw new Error('relation "foo" does not exist');
  });
  const res = await wrapped(new Request("https://x.test/api/enterprise/test"));
  assert.equal(res.status, 500);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.error, "missing_table");
  assert.equal(body.table, "foo");
});

test("non-Error throw still yields a JSON 500 body", async () => {
  const wrapped = withEnterpriseHandler("GET /api/enterprise/test", async () => {
    // eslint-disable-next-line no-throw-literal
    throw "string failure";
  });
  const res = await wrapped(new Request("https://x.test/api/enterprise/test"));
  assert.equal(res.status, 500);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.error, "internal_error");
});
