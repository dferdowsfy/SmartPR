// The runtime locations schema and the checked-in migration must not drift,
// and the runtime SQL must survive the statement splitter intact (it runs on
// the login path via ensureSchema()).
// Run: npx tsx --test src/app/locations/schemaSync.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { splitSqlStatements } from "../graph/sqlStatements.ts";
import { LOCATIONS_SCHEMA_SQL } from "./schema.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migration = readFileSync(join(here, "..", "..", "..", "..", "data", "locations_schema.sql"), "utf8");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

test("every runtime statement is present verbatim in data/locations_schema.sql", () => {
  const file = norm(migration);
  for (const statement of splitSqlStatements(LOCATIONS_SCHEMA_SQL)) {
    assert.ok(file.includes(norm(statement)), `missing from migration: ${statement.slice(0, 100)}`);
  }
});

test("runtime statements split cleanly and are additive (no destructive DDL on existing data)", () => {
  const statements = splitSqlStatements(LOCATIONS_SCHEMA_SQL);
  assert.ok(statements.length >= 12);
  for (const s of statements) {
    const body = s.replace(/^(--[^\n]*\n|\s)*/, "");
    assert.match(body, /^(CREATE|ALTER|DROP TRIGGER|DO)\b/i, s.slice(0, 80));
    assert.doesNotMatch(body, /\b(DROP\s+TABLE|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i, s.slice(0, 80));
    let depth = 0;
    for (const ch of s.replace(/'[^']*'/g, "")) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
    }
    assert.equal(depth, 0, `unbalanced parentheses in: ${s.slice(0, 80)}`);
  }
});

test("the runtime bootstrap never installs extensions (that is an explicit migration step)", () => {
  assert.doesNotMatch(LOCATIONS_SCHEMA_SQL, /CREATE\s+EXTENSION/i);
  assert.match(migration, /CREATE EXTENSION IF NOT EXISTS postgis/);
});
