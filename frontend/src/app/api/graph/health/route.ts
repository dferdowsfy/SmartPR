// Knowledge-graph + platform health check.
//
// Lets you confirm, in one request, that DATABASE_URL is set, the database is
// reachable, and the tables exist (with current row counts). Safe to call
// anytime — read-only by default, and returns a clear status when no DB is
// configured.
//
// `?ensure=1` additionally applies the (idempotent, fixed-text) schema and
// reports exactly which statements the database rejected. That is the same
// work the login path does, exposed on its own so a broken schema can be
// diagnosed without first being able to log in.

import { describeConnection, getPool, isEnabled } from "../../../graph/db";
import { ensureSchema, schemaFailures } from "../../../graph/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Capture tables, plus the four the login bootstrap itself depends on — a
// health check that stayed green while login was broken was worse than none.
const TABLES = [
  "submissions",
  "question_responses",
  "requirements_generated",
  "document_validations",
  "readiness_scores",
  "scenario_patterns",
  "users",
  "businesses",
  "workspaces",
  "workspace_members",
];

const LOGIN_CRITICAL = ["users", "businesses", "workspaces", "workspace_members"];

export async function GET(request: Request) {
  if (!isEnabled()) {
    return Response.json({
      connected: false,
      configured: false,
      message: "DATABASE_URL is not set. Capture is a safe no-op until it is configured.",
    });
  }

  const pool = getPool();
  if (!pool) {
    return Response.json({ connected: false, configured: true, message: "Could not initialize the connection pool." }, { status: 500 });
  }

  let ensureError: string | null = null;
  if (new URL(request.url).searchParams.get("ensure")) {
    try {
      await ensureSchema();
    } catch (err) {
      ensureError = (err as Error).message;
    }
  }

  // Probe the connection BEFORE the per-table loop. Without this, a refused
  // login or an unreachable host was swallowed by the per-table catch below
  // and misreported as ten "missing" tables on a healthy connection — which is
  // exactly how a wrong database password hid behind `connected: true`.
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    return Response.json(
      {
        connected: false,
        configured: true,
        loginReady: false,
        message: "Could not query the database: " + (err as Error).message,
        ensureError,
        // Derived facts only — never the password, host or project reference.
        connection: describeConnection(),
      },
      { status: 503 }
    );
  }

  try {
    const tables: Record<string, number | "missing"> = {};
    for (const t of TABLES) {
      try {
        // Identifier is from a fixed allow-list above, never user input.
        const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
        tables[t] = rows[0].n as number;
      } catch {
        tables[t] = "missing";
      }
    }
    const allPresent = TABLES.every((t) => tables[t] !== "missing");
    const canLogIn = LOGIN_CRITICAL.every((t) => tables[t] !== "missing");
    return Response.json({
      connected: true,
      configured: true,
      tablesReady: allPresent,
      loginReady: canLogIn,
      message: allPresent
        ? "Connected. All tables exist."
        : canLogIn
          ? "Connected. Login tables exist; some capture tables are still missing."
          : "Connected, but tables the login bootstrap needs are missing. Call ?ensure=1 to apply the schema and see what the database rejected.",
      ensureError,
      schemaFailures: schemaFailures(),
      tables,
    });
  } catch (err) {
    return Response.json(
      { connected: false, configured: true, message: "Connection failed: " + (err as Error).message },
      { status: 500 }
    );
  }
}
