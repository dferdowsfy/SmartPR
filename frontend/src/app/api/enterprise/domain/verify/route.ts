// POST /api/enterprise/domain/verify — run the verification attempt.
//
// Body: { workspace_id }
// State machine: pending/verifying/failed -> DNS TXT lookup of
// `_smartpr-challenge.<domain>` for the issued token ->
//   match    -> status=verifying -> TLS probe ->
//                 TLS ok / documented unchecked -> status=active
//                 TLS failed -> stays `verifying` (NEVER active until HTTPS succeeds)
//   mismatch -> status=failed + last_error
//
// The domain is NEVER reported active until the DNS token is verified.
// Gate: platform super admin OR `configure_branding_security`. Audited.

import { resolveTxt } from "node:dns/promises";
import { getPool, isEnabled } from "../../../../../app/graph/db";
import { requireBrandingSecurity } from "../../../../../lib/enterprise-gate";
import {
  canAttemptVerification,
  checkTls,
  transitionAfterTls,
  transitionOnDnsResult,
  verifyDomainDns,
  type DomainStatus,
} from "../../../../../lib/enterprise-domain";
import { writeAuditEvent, getRequestMeta } from "../../../../../lib/enterprise-permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DNS_TIMEOUT_MS = 8000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { workspace_id?: string };
  const workspaceId = typeof body.workspace_id === "string" ? body.workspace_id : "";
  const gate = await requireBrandingSecurity(workspaceId);
  if ("response" in gate) return gate.response;
  const { user } = gate;
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });

  const { rows } = await pool.query(
    `SELECT domain, dns_token, status, tls_status FROM domain_verifications WHERE workspace_id = $1`,
    [workspaceId]
  );
  const row = rows[0] as
    | { domain: string; dns_token: string | null; status: DomainStatus; tls_status: string }
    | undefined;
  if (!row) {
    return Response.json({ error: "no verification requested for this workspace" }, { status: 404 });
  }
  if (!canAttemptVerification(row.status)) {
    return Response.json({ error: `verification already ${row.status}; request a new domain to retry` }, { status: 409 });
  }
  if (!row.dns_token) {
    return Response.json({ error: "verification token missing; request a new domain" }, { status: 409 });
  }

  const before = { domain: row.domain, status: row.status, tls_status: row.tls_status };
  const meta = getRequestMeta(request);

  // --- Step 1: DNS TXT lookup for the challenge token -----------------------
  const dns = await verifyDomainDns(row.domain, row.dns_token, (host) =>
    withTimeout(resolveTxt(host), DNS_TIMEOUT_MS, "DNS TXT lookup")
  );
  const step1 = transitionOnDnsResult(row.status, dns.matched);

  if (!dns.matched) {
    await pool.query(
      `UPDATE domain_verifications
          SET status = 'failed', last_attempt_at = now(), last_error = $2, updated_at = now()
        WHERE workspace_id = $1`,
      [workspaceId, dns.error]
    );
    await writeAuditEvent(pool, {
      actorUserId: user.id, workspaceId, action: "enterprise.domain.verify",
      targetType: "domain_verification", targetId: workspaceId,
      before, after: { domain: row.domain, status: "failed", last_error: dns.error },
      ip: meta.ip, userAgent: meta.userAgent, correlationId: meta.correlationId, source: "api",
    });
    return Response.json({
      ok: false, domain: row.domain, status: "failed",
      last_error: dns.error,
      hint: `Publish a TXT record at _smartpr-challenge.${row.domain} with the token value, then retry.`,
    });
  }

  // DNS matched: record the intermediate `verifying` state before the TLS probe.
  await pool.query(
    `UPDATE domain_verifications
        SET status = 'verifying', last_attempt_at = now(), last_error = NULL, updated_at = now()
      WHERE workspace_id = $1`,
    [workspaceId]
  );

  // --- Step 2: TLS probe. `active` requires DNS match + TLS ok (or a
  //     documented `unchecked` when the probe was attempted but the domain
  //     does not resolve). A TLS failure keeps the domain `verifying` —
  //     it is NEVER reported active until HTTPS succeeds.
  const tls = await checkTls(row.domain);
  const final = transitionAfterTls(tls.tlsStatus);
  const tlsFailed = final.to === "verifying";
  await pool.query(
    `UPDATE domain_verifications
        SET status = $2, tls_status = $3, last_attempt_at = now(),
            last_error = $4, updated_at = now()
      WHERE workspace_id = $1`,
    [workspaceId, final.to, final.tlsStatus, tlsFailed ? tls.detail : null]
  );

  const after = {
    domain: row.domain, status: final.to, tls_status: final.tlsStatus,
    tls_detail: tls.detail, note: final.note,
  };
  await writeAuditEvent(pool, {
    actorUserId: user.id, workspaceId, action: "enterprise.domain.verify",
    targetType: "domain_verification", targetId: workspaceId,
    before, after,
    ip: meta.ip, userAgent: meta.userAgent, correlationId: meta.correlationId, source: "api",
  });

  if (tlsFailed) {
    return Response.json({
      ok: false, ...after,
      hint: `DNS ownership of ${row.domain} is verified, but the HTTPS check failed. Fix TLS on the domain, then retry verification — the domain stays in "verifying" and is never active until HTTPS succeeds.`,
    });
  }
  return Response.json({ ok: true, ...after });
}
