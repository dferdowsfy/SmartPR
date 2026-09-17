// SmartPR Remote MCP server — Phase 2.
//
// Streamable HTTP endpoint (JSON-RPC 2.0 over POST) for xAI Speech-to-Speech
// Remote MCP tools. Stateless: no MCP session ids, single JSON responses.
//
//   POST /api/mcp/voice
//
// Authentication: `tools/call` requires the Phase 1 voice session token in
// the Authorization header (`Bearer <token>` or the raw token — xAI's docs
// do not specify a scheme). `initialize` and `tools/list` are unauthenticated
// and expose no account data.
//
// The server exposes only the 9 curated SmartPR voice tools. No SQL, no
// generic database access, no filesystem, no admin APIs, no credentials.

import { getPool, isEnabled } from "../../../graph/db";
import { handleMcpRequest } from "../../../../lib/voice/mcp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!isEnabled()) {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } },
        { status: 503 }
      );
    }
    const pool = getPool();
    if (!pool) {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } },
        { status: 503 }
      );
    }
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return Response.json(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Invalid Request: expected application/json." },
        },
        { status: 400 }
      );
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error." } },
        { status: 400 }
      );
    }
    const result = await handleMcpRequest(pool, body, request.headers.get("authorization"));
    if (result.body === null) {
      // JSON-RPC notification — acknowledge with an empty body.
      return new Response(null, { status: result.status });
    }
    return Response.json(result.body, { status: result.status });
  } catch (err) {
    console.error("[mcp] request failed:", (err as Error)?.message || err);
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } },
      { status: 500 }
    );
  }
}

// Streamable HTTP servers MAY offer an SSE stream on GET; this server is
// request/response only.
export async function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}

export async function DELETE() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
