// Regression tests: GET /api/enterprise/work ALWAYS returns valid JSON.
//
// Production bug: an uncaught throw in the handler became a 500 with an
// empty body, and the client's res.json() surfaced
// "Failed to execute 'json' on 'Response': Unexpected end of JSON input".
// handleWorkQueueGet must return a JSON envelope on every path — including
// database failures, gate throws, and misconfiguration.
//
// Run with:
//   npx tsx --test src/lib/__tests__/enterprise-work-queue.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import {
  handleWorkQueueGet,
  type WorkQueueDeps,
} from "../../app/api/enterprise/work/route";

const WS = "11111111-1111-4111-8111-111111111111";

function makeRequest(search = ""): Request {
  return new Request(
    `http://localhost/api/enterprise/work?workspace_id=${WS}${search}`
  );
}

const okGate = (() =>
  (async () => ({
    user: { id: "user-1" },
    workspaceId: WS,
  }))) as unknown as WorkQueueDeps["gate"];

const okExportGate = okGate as unknown as WorkQueueDeps["exportGate"];

function throwingPool(message: string): Pool {
  return {
    query: async () => {
      throw new Error(message);
    },
  } as unknown as Pool;
}

function rowsPool(rows: unknown[], total: number): Pool {
  return {
    query: async (sql: string) => {
      if (/^\s*SELECT COUNT\(\*\)/i.test(sql)) return { rows: [{ total: String(total) }] };
      return { rows };
    },
  } as unknown as Pool;
}

/** Fails loudly if the body is empty or is not valid JSON — the regression. */
async function readBody(res: Response): Promise<any> {
  const text = await res.text();
  assert.ok(text.length > 0, "response body must not be empty");
  return JSON.parse(text);
}

test("database failure returns a JSON 500 envelope, never an empty body", async () => {
  const res = await handleWorkQueueGet(makeRequest(), {
    gate: okGate,
    pool: () => throwingPool('relation "obligation_work" does not exist'),
    exportGate: okExportGate,
  });
  assert.equal(res.status, 500);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  const body = await readBody(res);
  assert.equal(body.error, "work_queue_failed");
  assert.ok(typeof body.message === "string" && body.message.length > 0);
});

test("a throwing gate still returns a JSON 500 envelope", async () => {
  const badGate = (async () => {
    throw new Error("connection terminated");
  }) as unknown as WorkQueueDeps["gate"];
  const res = await handleWorkQueueGet(makeRequest(), {
    gate: badGate,
    pool: () => rowsPool([], 0),
    exportGate: okExportGate,
  });
  assert.equal(res.status, 500);
  const body = await readBody(res);
  assert.equal(body.error, "work_queue_failed");
});

test("gate denial passes through as JSON (403)", async () => {
  const denyGate = (async () => ({
    response: Response.json({ error: "forbidden" }, { status: 403 }),
  })) as unknown as WorkQueueDeps["gate"];
  const res = await handleWorkQueueGet(makeRequest(), {
    gate: denyGate,
    pool: () => rowsPool([], 0),
    exportGate: okExportGate,
  });
  assert.equal(res.status, 403);
  const body = await readBody(res);
  assert.equal(body.error, "forbidden");
});

test("success returns JSON 200 with items and total", async () => {
  const rows = [
    {
      obligation_id: "o1",
      obligation_name: "Permiso Único",
      work_status: "not_started",
    },
  ];
  const res = await handleWorkQueueGet(makeRequest(), {
    gate: okGate,
    pool: () => rowsPool(rows, 1),
    exportGate: okExportGate,
  });
  assert.equal(res.status, 200);
  const body = await readBody(res);
  assert.equal(body.total, 1);
  assert.ok(Array.isArray(body.items));
  assert.equal(body.items[0].obligation_id, "o1");
});

test("invalid view returns JSON 400, not a crash", async () => {
  const res = await handleWorkQueueGet(makeRequest("&view=bogus"), {
    gate: okGate,
    pool: () => rowsPool([], 0),
    exportGate: okExportGate,
  });
  assert.equal(res.status, 400);
  const body = await readBody(res);
  assert.equal(body.error, "bad_request");
});

test("missing database pool returns JSON 503", async () => {
  const res = await handleWorkQueueGet(makeRequest(), {
    gate: okGate,
    pool: () => null,
    exportGate: okExportGate,
  });
  assert.equal(res.status, 503);
  const body = await readBody(res);
  assert.equal(body.error, "no_database");
});
