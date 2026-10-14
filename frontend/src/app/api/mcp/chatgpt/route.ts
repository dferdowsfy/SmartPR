// SmartPR ChatGPT MCP Apps endpoint — POST /api/mcp/chatgpt
//
// Stateless Streamable HTTP (JSON responses, no session ids). Anonymous,
// read-only free-preview triage; no DB access, no account data, no writes.
// See docs/chatgpt-mcp-assessment.md.

import { handleChatgptMcp } from "../../../../lib/chatgpt/mcp";
import { getClientIpKey, rateLimitAllow } from "../../../../lib/rateLimit";
import { portalUrlForRequest } from "../../../../lib/chatgpt/portalUrl";
import { defaultSiteLookups } from "../../../../lib/chatgpt/siteLookup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Pin lookups are bounded at ~4.5 s inside the handler. */
export const maxDuration = 20;

const rpcError = (code: number, message: string, status: number) =>
  Response.json({ jsonrpc: "2.0", id: null, error: { code, message } }, { status });

export async function POST(request: Request) {
  try {
    if (process.env.CHATGPT_MCP_ENABLED === "false") return rpcError(-32603, "Disabled", 503);
    if (!(request.headers.get("content-type") || "").includes("application/json")) {
      return rpcError(-32600, "Invalid Request: expected application/json.", 400);
    }
    const len = Number(request.headers.get("content-length") || 0);
    if (len > 64_000) return rpcError(-32600, "Request too large.", 413);
    if (!rateLimitAllow(getClientIpKey(request.headers, "chatgpt-mcp"), Number(process.env.CHATGPT_MCP_RATE_PER_MIN || 60), 60_000)) {
      return rpcError(-32000, "Rate limit exceeded. Try again in a minute.", 429);
    }
    let body: unknown;
    try { body = await request.json(); } catch { return rpcError(-32700, "Parse error.", 400); }
    // siteUrl: public portal, never localhost/tunnel. siteLookups: street +
    // official-map chips for a pinned site (same code as the portal intake).
    const result = await handleChatgptMcp(body, { siteUrl: portalUrlForRequest(request), siteLookups: defaultSiteLookups() });
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
