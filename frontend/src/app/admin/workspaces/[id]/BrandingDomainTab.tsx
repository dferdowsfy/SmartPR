// ============================================================================
// BrandingDomainTab — Phase 8 white-label branding + custom-domain verification.
//
// STANDALONE component (props { workspaceId }). NOT wired into any page — the
// coordinator wires it into /admin/workspaces/[id] (or /enterprise/admin).
//
// Flow: upload a logo (primary/compact/favicon) -> signed preview is shown
// BEFORE publish -> "Publish branding" saves the uploaded paths alongside
// company name, color, terminology, and email header HTML.
//
// Custom domains: request -> publish the shown TXT record ->
// Verify now. Status is never shown as active until DNS verification passes.
// ============================================================================

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LogoKind } from "../../../../lib/enterprise-branding";
import { sanitizeEmailHeaderHtml } from "../../../../lib/enterprise-branding";

const inputCls =
  "rounded-lg border border-[#161616]/22 bg-[#fbf8f2] px-3 py-2 text-sm placeholder:text-[#5a5a5a]";
const btnPrimary =
  "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-[#f6f3ea] disabled:opacity-50";
const btnGhost =
  "rounded-lg border border-[#161616]/22 px-4 py-2 text-sm font-medium text-[#161616] hover:bg-[#161616]/5 disabled:opacity-50";

interface Branding {
  company_name: string | null;
  primary_color: string | null;
  logo_primary_path: string | null;
  logo_compact_path: string | null;
  favicon_path: string | null;
  email_header_html: string | null;
  login_branding: Record<string, unknown> | null;
  terminology: Record<string, string> | null;
}

interface DomainVerification {
  domain: string;
  status: "pending" | "verifying" | "active" | "failed";
  tls_status: string;
  last_attempt_at: string | null;
  last_error: string | null;
  txt_host: string;
  txt_value: string | null;
}

const LOGO_LABELS: Record<LogoKind, string> = {
  primary: "Primary logo",
  compact: "Compact logo",
  favicon: "Favicon",
};

const TERMINOLOGY_FIELDS = [
  { key: "project_label", label: "Project label", placeholder: "e.g. Filing" },
  { key: "requirement_label", label: "Requirement label", placeholder: "e.g. Requirement" },
  { key: "facility_label", label: "Facility label", placeholder: "e.g. Location" },
  { key: "evidence_label", label: "Evidence label", placeholder: "e.g. Document" },
  { key: "workspace_label", label: "Workspace label", placeholder: "e.g. Company" },
] as const;

function statusBadge(status: DomainVerification["status"]) {
  const map = {
    pending: "bg-amber-100 text-amber-900",
    verifying: "bg-sky-100 text-sky-900",
    active: "bg-emerald-100 text-emerald-900",
    failed: "bg-red-100 text-red-900",
  } as const;
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${map[status]}`}>
      {status}
    </span>
  );
}

export function BrandingDomainTab({ workspaceId }: { workspaceId: string }) {
  const [branding, setBranding] = useState<Branding | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("#245c5c");
  const [terminology, setTerminology] = useState<Record<string, string>>({});
  const [emailHeader, setEmailHeader] = useState("");
  // Staged (uploaded, not yet published) logo paths + previews.
  const [staged, setStaged] = useState<Record<LogoKind, { path: string; preview: string } | null>>({
    primary: null, compact: null, favicon: null,
  });
  const [publishedPreviews, setPublishedPreviews] = useState<Record<LogoKind, string | null>>({
    primary: null, compact: null, favicon: null,
  });
  const [domain, setDomain] = useState<DomainVerification | null>(null);
  const [domainInput, setDomainInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<LogoKind | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRefs = useRef<Record<LogoKind, HTMLInputElement | null>>({
    primary: null, compact: null, favicon: null,
  });

  const flash = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 5000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [bRes, dRes] = await Promise.all([
        fetch(`/api/enterprise/branding?workspace_id=${encodeURIComponent(workspaceId)}`),
        fetch(`/api/enterprise/domain/status?workspace_id=${encodeURIComponent(workspaceId)}`),
      ]);
      const b = await bRes.json();
      if (!bRes.ok) throw new Error(b.error || "Could not load branding.");
      const br = (b.branding || {}) as Branding;
      setBranding(br);
      setCompanyName(br.company_name || "");
      setPrimaryColor(br.primary_color || "#245c5c");
      setTerminology(br.terminology || {});
      setEmailHeader(br.email_header_html || "");
      setPublishedPreviews({
        primary: b.preview_urls?.primary || null,
        compact: b.preview_urls?.compact || null,
        favicon: b.preview_urls?.favicon || null,
      });
      const d = await dRes.json();
      if (dRes.ok) setDomain(d.verification || null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const uploadLogo = async (kind: LogoKind) => {
    const input = fileRefs.current[kind];
    const file = input?.files?.[0];
    if (!file) {
      setErr("Choose a file first.");
      return;
    }
    setUploading(kind);
    setErr(null);
    try {
      const form = new FormData();
      form.append("workspace_id", workspaceId);
      form.append("kind", kind);
      form.append("file", file);
      const res = await fetch("/api/enterprise/branding/logo", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed.");
      // Preview BEFORE publish: nothing is saved to workspace_branding yet.
      setStaged((s) => ({ ...s, [kind]: { path: data.path, preview: data.preview_url } }));
      flash(`${LOGO_LABELS[kind]} uploaded — preview below. Publish to make it live.`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setUploading(null);
      if (input) input.value = "";
    }
  };

  const publish = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/enterprise/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace_id: workspaceId,
          company_name: companyName,
          primary_color: primaryColor,
          logo_primary_path: staged.primary?.path ?? branding?.logo_primary_path ?? null,
          logo_compact_path: staged.compact?.path ?? branding?.logo_compact_path ?? null,
          favicon_path: staged.favicon?.path ?? branding?.favicon_path ?? null,
          email_header_html: emailHeader,
          terminology,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Publish failed.");
      setStaged({ primary: null, compact: null, favicon: null });
      flash("Branding published.");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const requestDomain = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/enterprise/domain/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, domain: domainInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Domain request failed.");
      setDomainInput("");
      flash(`Verification started for ${data.domain}. Publish the TXT record, then verify.`);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const verifyDomain = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/enterprise/domain/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.hint || data.last_error || data.error || "Verification failed.");
      }
      flash(
        data.tls_status === "unchecked"
          ? "Domain verified and active (DNS ownership proven; HTTPS could not be assessed because the domain does not resolve yet)."
          : "Domain verified and active."
      );
      await load();
    } catch (e) {
      setErr((e as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-[#5a5a5a]">Loading branding…</p>;

  return (
    <div className="space-y-8">
      {err && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800">{err}</p>}
      {msg && <p className="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-800">{msg}</p>}

      {/* ---- Logos: upload -> preview before publish ---- */}
      <section>
        <h3 className="text-base font-semibold text-[#161616]">Logo assets</h3>
        <p className="mt-1 text-sm text-[#5a5a5a]">
          Upload an image (≤ 2 MB). You will see a preview before anything goes live —
          nothing is published until you press “Publish branding”.
        </p>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          {(Object.keys(LOGO_LABELS) as LogoKind[]).map((kind) => {
            const preview = staged[kind]?.preview || (publishedPreviews[kind] ?? undefined);
            return (
              <div key={kind} className="rounded-xl border border-[#161616]/15 p-4">
                <p className="text-sm font-medium text-[#161616]">{LOGO_LABELS[kind]}</p>
                <div className="mt-2 flex h-20 items-center justify-center rounded-lg bg-[#fbf8f2]">
                  {preview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={preview} alt={`${LOGO_LABELS[kind]} preview`} className="max-h-16 w-auto object-contain" />
                  ) : (
                    <span className="text-xs text-[#5a5a5a]">No logo</span>
                  )}
                </div>
                {staged[kind] && (
                  <p className="mt-1 text-xs font-medium text-amber-700">Staged — not yet published</p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <input
                    ref={(el) => { fileRefs.current[kind] = el; }}
                    type="file"
                    accept="image/*"
                    className="min-w-0 flex-1 text-xs"
                  />
                  <button className={btnGhost} disabled={uploading === kind} onClick={() => void uploadLogo(kind)}>
                    {uploading === kind ? "Uploading…" : "Upload"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ---- Brand basics ---- */}
      <section>
        <h3 className="text-base font-semibold text-[#161616]">Brand basics</h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-sm text-[#5a5a5a]">Company name</span>
            <input
              className={`${inputCls} mt-1 w-full`}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Industrial Corp"
            />
          </label>
          <label className="block">
            <span className="text-sm text-[#5a5a5a]">Primary color</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : "#245c5c"}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-10 w-12 cursor-pointer rounded border border-[#161616]/22 bg-[#fbf8f2]"
              />
              <input
                className={`${inputCls} w-32`}
                value={primaryColor}
                onChange={(e) => setPrimaryColor(e.target.value)}
                placeholder="#245c5c"
              />
            </div>
          </label>
        </div>
      </section>

      {/* ---- Terminology ---- */}
      <section>
        <h3 className="text-base font-semibold text-[#161616]">Terminology</h3>
        <p className="mt-1 text-sm text-[#5a5a5a]">
          Rename product concepts for this client’s portal (leave blank for SmartPR defaults).
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {TERMINOLOGY_FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="text-sm text-[#5a5a5a]">{f.label}</span>
              <input
                className={`${inputCls} mt-1 w-full`}
                value={terminology[f.key] || ""}
                onChange={(e) => setTerminology((t) => ({ ...t, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
              />
            </label>
          ))}
        </div>
      </section>

      {/* ---- Email header ---- */}
      <section>
        <h3 className="text-base font-semibold text-[#161616]">Email header</h3>
        <p className="mt-1 text-sm text-[#5a5a5a]">
          Branded HTML shown at the top of notification emails. Scripts and event
          handlers are stripped on save.
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <textarea
            className={`${inputCls} min-h-32 w-full font-mono text-xs`}
            value={emailHeader}
            onChange={(e) => setEmailHeader(e.target.value)}
            placeholder='<div style="background:#245c5c;color:#fff;padding:16px">Acme Industrial Corp</div>'
          />
          <div>
            <p className="text-sm text-[#5a5a5a]">Preview</p>
            <div
              className="mt-1 min-h-32 rounded-lg border border-[#161616]/15 bg-white p-2 text-sm"
              dangerouslySetInnerHTML={{
                // Client-side preview is sanitized with the same rules the
                // server applies on publish (scripts, handlers, javascript:).
                __html:
                  sanitizeEmailHeaderHtml(emailHeader) ||
                  "<p class='text-xs text-[#5a5a5a]'>Nothing to preview.</p>",
              }}
            />
          </div>
        </div>
      </section>

      <div>
        <button className={btnPrimary} disabled={busy} onClick={() => void publish()}>
          {busy ? "Publishing…" : "Publish branding"}
        </button>
      </div>

      {/* ---- Custom domain ---- */}
      <section className="rounded-xl border border-[#161616]/15 p-4">
        <h3 className="text-base font-semibold text-[#161616]">Custom domain</h3>
        <p className="mt-1 text-sm text-[#5a5a5a]">
          The domain only becomes <strong>active</strong> after DNS verification.
          Until then the portal keeps working on its SmartPR address.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            className={`${inputCls} w-64`}
            value={domainInput}
            onChange={(e) => setDomainInput(e.target.value)}
            placeholder="portal.acme.com"
          />
          <button className={btnGhost} disabled={busy || !domainInput.trim()} onClick={() => void requestDomain()}>
            {busy ? "Working…" : domain ? "Request new domain" : "Request verification"}
          </button>
        </div>

        {domain && (
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center gap-3">
              <span className="font-mono">{domain.domain}</span>
              {statusBadge(domain.status)}
            </div>
            <div className="rounded-lg bg-[#fbf8f2] p-3">
              <p className="font-medium text-[#161616]">Required DNS TXT record</p>
              <dl className="mt-2 space-y-1 font-mono text-xs">
                <div className="flex gap-2"><dt className="w-16 text-[#5a5a5a]">Host</dt><dd className="break-all">{domain.txt_host}</dd></div>
                <div className="flex gap-2"><dt className="w-16 text-[#5a5a5a]">Value</dt><dd className="break-all">{domain.txt_value || "—"}</dd></div>
              </dl>
            </div>
            <dl className="grid gap-1 text-sm">
              <div className="flex gap-2"><dt className="w-32 text-[#5a5a5a]">TLS status</dt><dd>{domain.tls_status}</dd></div>
              <div className="flex gap-2"><dt className="w-32 text-[#5a5a5a]">Last attempt</dt><dd>{domain.last_attempt_at ? new Date(domain.last_attempt_at).toLocaleString() : "—"}</dd></div>
              {domain.last_error && (
                <div className="flex gap-2"><dt className="w-32 text-[#5a5a5a]">Error</dt><dd className="text-red-700">{domain.last_error}</dd></div>
              )}
            </dl>
            <button className={btnPrimary} disabled={busy} onClick={() => void verifyDomain()}>
              {busy ? "Verifying…" : domain.status === "failed" ? "Retry verification" : "Verify now"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
