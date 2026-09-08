// ============================================================================
// The schema is applied one statement at a time, so the splitter is now on the
// login path: if it mis-slices the script, tables silently stop being created
// and every user is locked out. These tests pin the edge cases that a naive
// `split(";")` gets wrong, and assert the real schema still splits cleanly.
// ============================================================================

import assert from "node:assert/strict";
import test from "node:test";

import { splitSqlStatements } from "./sqlStatements.ts";

test("splits plain statements and drops empty fragments", () => {
  assert.deepEqual(splitSqlStatements("SELECT 1; SELECT 2;;\n\n"), ["SELECT 1", "SELECT 2"]);
});

test("a semicolon inside a string literal does not end the statement", () => {
  assert.deepEqual(
    splitSqlStatements("INSERT INTO t VALUES ('a;b'); SELECT 1"),
    ["INSERT INTO t VALUES ('a;b')", "SELECT 1"]
  );
});

test("a doubled quote is an escape, not the end of the literal", () => {
  assert.deepEqual(
    splitSqlStatements("SELECT 'it''s; fine'; SELECT 2"),
    ["SELECT 'it''s; fine'", "SELECT 2"]
  );
});

test("semicolons in quoted identifiers and comments are ignored", () => {
  assert.deepEqual(splitSqlStatements('CREATE TABLE "we;ird" (a INT); SELECT 1'), [
    'CREATE TABLE "we;ird" (a INT)',
    "SELECT 1",
  ]);
  assert.deepEqual(splitSqlStatements("-- a; comment\nSELECT 1; /* b; c */ SELECT 2"), [
    "-- a; comment\nSELECT 1",
    "/* b; c */ SELECT 2",
  ]);
});

test("dollar-quoted bodies are kept whole", () => {
  const sql = "CREATE FUNCTION f() RETURNS int AS $$ BEGIN; RETURN 1; END; $$ LANGUAGE plpgsql; SELECT 1";
  assert.deepEqual(splitSqlStatements(sql), [
    "CREATE FUNCTION f() RETURNS int AS $$ BEGIN; RETURN 1; END; $$ LANGUAGE plpgsql",
    "SELECT 1",
  ]);
});

test("a $1 placeholder is not mistaken for a dollar-quote tag", () => {
  assert.deepEqual(splitSqlStatements("SELECT $1; SELECT $2"), ["SELECT $1", "SELECT $2"]);
});

test("the real schema splits into individually-runnable statements", async () => {
  // `store.ts` pulls in the `pg` pool, so the schema text is imported from the
  // dependency-free module that actually declares it.
  const { COMPLIANCE_SCHEMA_SQL } = await import("../compliance/schema.ts");

  const statements = splitSqlStatements(COMPLIANCE_SCHEMA_SQL);
  assert.ok(statements.length > 20, "the compliance schema should be many statements");

  for (const s of statements) {
    const body = s.replace(/^(--[^\n]*\n|\s)*/, "");
    assert.ok(
      /^(CREATE|ALTER|DROP|UPDATE|INSERT|COMMENT|DO|GRANT)\b/i.test(body),
      `statement does not start with a DDL/DML keyword: ${s.slice(0, 80)}`
    );
    // Balanced parentheses is a cheap proof that no statement was cut in half.
    let depth = 0;
    for (const ch of s.replace(/'[^']*'/g, "")) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
    }
    assert.equal(depth, 0, `unbalanced parentheses in: ${s.slice(0, 80)}`);
  }
});
