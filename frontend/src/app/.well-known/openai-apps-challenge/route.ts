/**
 * OpenAI plugin domain-verification challenge.
 *
 * The Plugins dashboard shows a challenge token during MCP server setup; that
 * token must be served as plain text at
 * https://www.getsmartpr.com/.well-known/openai-apps-challenge
 *
 * Set OPENAI_APPS_CHALLENGE_TOKEN in the hosting environment to the exact
 * token from the dashboard. Returns 404 until it is configured.
 */
export async function GET() {
  const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN;
  if (!token) {
    return new Response("Not configured", { status: 404 });
  }
  return new Response(token.trim(), {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
