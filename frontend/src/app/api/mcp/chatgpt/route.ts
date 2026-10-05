// SmartPR ChatGPT MCP Apps endpoint — POST /api/mcp/chatgpt
//
// Stateless Streamable HTTP (JSON responses, no session ids). Anonymous,
// read-only free-preview triage; no DB access, no account data, no writes.
// See docs/chatgpt-mcp-assessment.md.

import { handleChatgptMcp } from "../../../../lib/chatgpt/mcp";
import { rateLimitAllow } from "../../../../lib/rateLimit";
import { getSiteUrl } from "../../../../lib/siteUrl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rpcError = (code: number, message: string, status: number) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status });

function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for") || "";
  return (fwd.split(",")[0] || request.headers.get("x-real-ip") || "unknown").trim().slice(0, 64);
}

export async function POST(request: Request) {
  try {
    if (process.env.CHATGPT_MCP_ENABLED === "false") return rpcError(-32603, "Disabled", 503);
    if (!(request.headers.get("content-type") || "").includes("application/json")) {
      return rpcError(-32600, "Invalid Request: expected application/json.", 400);
    }
    const len = Number(request.headers.get("content-length") || 0);
    if (len > 64_000) return rpcError(-32600, "Request too large.", 413);
    if (!rateLimitAllow(`chatgpt-mcp:${clientKey(request)}`, Number(process.env.CHATGPT_MCP_RATE_PER_MIN || 60), 60_000)) {
      return rpcError(-32000, "Rate limit exceeded. Try again in a minute.", 429);
    }
    let body: unknown;
    try { body = await request.json(); } catch { return rpcError(-32700, "Parse error.", 400); }
    const result = handleChatgptMcp(body, { siteUrl: getSiteUrl() });
    if (result.body === null) return new Response(null, { status: result.status });
    return Response.json(result.body, { status: result.status });
  } catch (e) {
    console.error("[mcp/chatgpt] request failed:", (e as Error)?.message || e);
    return rpcError(-32603, "Internal error", 500);
  }
}

export async function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
export async function DELETE() {
  return Response.json({ error: "method_not_allowed" }, { status: 405 });
}
