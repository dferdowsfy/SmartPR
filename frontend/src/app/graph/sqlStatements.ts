// ============================================================================
// SQL statement splitter.
//
// Dependency-free on purpose: this sits on the login path (the schema is
// applied one statement at a time) and is unit-tested directly, so it must be
// importable without pulling in the `pg` pool.
// ============================================================================

/**
 * Split a DDL script into individual statements.
 *
 * A naive `split(";")` corrupts the script the moment a semicolon appears
 * inside a string literal, a quoted identifier, a comment or a dollar-quoted
 * body — so those regions are skipped over rather than scanned for terminators.
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i += 1;
      while (i < sql.length) {
        if (sql[i] === quote) {
          // A doubled quote is an escaped quote, not the end of the literal.
          if (sql[i + 1] === quote) { i += 2; continue; }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      i += 2;
      while (i < sql.length && !(sql[i] === "*" && sql[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === "$") {
      // $tag$ ... $tag$ / $$ ... $$. A `$1` placeholder cannot match: a tag
      // never starts with a digit.
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        i = end === -1 ? sql.length : end + tag[0].length;
        continue;
      }
    }
    if (ch === ";") {
      const statement = sql.slice(start, i).trim();
      if (statement) out.push(statement);
      start = i + 1;
    }
    i += 1;
  }
  const tail = sql.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}
