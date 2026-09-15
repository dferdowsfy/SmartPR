/**
 * GET /api/agency-runs/provider — which agent backend is active right now.
 * Lets the UI say definitively whether runs use Browser Use Cloud,
 * the self-hosted worker, or the mock timeline. No secrets returned.
 */
import {
  agentProvider,
  agentProviderLabel,
  isBrowserUseConfigured,
} from "../../../../lib/agency-runs/browserUseClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const configured = isBrowserUseConfigured();
  return Response.json({
    provider: configured ? agentProvider() : "mock",
    label: configured ? agentProviderLabel() : "Mock preview",
    configured,
  });
}
