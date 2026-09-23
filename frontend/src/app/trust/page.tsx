import type { Metadata } from "next";
import Link from "next/link";
import { SmartPRLogo } from "../components/brand/SmartPRLogo";

export const metadata: Metadata = {
  title: "Trust Center — SmartPR",
  description:
    "SmartPR security posture, SOC 2 readiness, and control overview for customers and prospects. Not a certification claim.",
  alternates: { canonical: "https://trust.getsmartpr.com/" },
  openGraph: {
    title: "SmartPR Trust Center",
    description:
      "How SmartPR protects customer data — authentication, isolation, audit, and SOC 2 readiness (not certified).",
    url: "https://trust.getsmartpr.com/",
    type: "website",
  },
};

type ControlCard = {
  title: string;
  summary: string;
  status: "In product" | "Verify in prod" | "Readiness";
};

const CONTROLS: ControlCard[] = [
  {
    title: "Authentication",
    summary:
      "Supabase Auth with session refresh in application middleware. Protected app routes require a signed-in user.",
    status: "In product",
  },
  {
    title: "RBAC & enterprise roles",
    summary:
      "Workspace membership and role-based permissions enforced in server-side APIs, including enterprise admin gates.",
    status: "In product",
  },
  {
    title: "Tenant isolation",
    summary:
      "Workspace-scoped access checks on sensitive APIs. Production RLS coverage is tracked as a verification item.",
    status: "In product",
  },
  {
    title: "SSO & SCIM",
    summary:
      "Enterprise SSO configuration and SCIM provisioning with hashed service-account credentials. Production IdP wiring requires verification per customer environment.",
    status: "Verify in prod",
  },
  {
    title: "Support access",
    summary:
      "Time-boxed operator access: reason and duration required, read-only by default, expiry enforced, and audited.",
    status: "In product",
  },
  {
    title: "Audit logging",
    summary:
      "Append-only audit events for sensitive enterprise and admin actions, with helpers to redact secrets from logs and responses.",
    status: "In product",
  },
  {
    title: "Secrets & service accounts",
    summary:
      "Hash-only credential storage, show-once secrets, rotate/revoke, scoped tokens, and fingerprinting for service accounts.",
    status: "In product",
  },
  {
    title: "AI governance",
    summary:
      "Server-side AI calls only, structured metadata logging (not raw confidential content), and workspace auth on AI routes. Vendor DPA details require verification.",
    status: "In product",
  },
  {
    title: "Vulnerability readiness",
    summary:
      "Documented vulnerability management process and control inventory. Ongoing scan cadence and production evidence are part of readiness work — not a completed certification.",
    status: "Readiness",
  },
];

function StatusPill({ status }: { status: ControlCard["status"] }) {
  const styles =
    status === "In product"
      ? "bg-[#245c5c]/12 text-[#1a4545] ring-[#245c5c]/20"
      : status === "Verify in prod"
        ? "bg-[#8a6a20]/12 text-[#5c4810] ring-[#8a6a20]/25"
        : "bg-[#161616]/08 text-[#3a3a3a] ring-[#161616]/12";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide ring-1 ring-inset ${styles}`}
    >
      {status}
    </span>
  );
}

export default function TrustCenterPage() {
  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#161616]">
      <header className="border-b border-[#161616]/12">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="https://www.getsmartpr.com/" aria-label="SmartPR home">
            <SmartPRLogo size="auth" />
          </Link>
          <nav className="flex items-center gap-5 text-sm text-[#5a5a5a]">
            <a
              href="#controls"
              className="transition-colors hover:text-[#161616]"
            >
              Controls
            </a>
            <a
              href="#package"
              className="transition-colors hover:text-[#161616]"
            >
              Security package
            </a>
            <a
              href="mailto:contact@getsmartpr.com"
              className="rounded-full bg-brand px-3.5 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
            >
              Contact
            </a>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="border-b border-[#161616]/10">
          <div className="mx-auto max-w-5xl px-6 py-16 sm:py-20">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">
              Trust Center
            </p>
            <h1 className="mt-4 max-w-3xl font-[family-name:var(--font-display)] text-4xl font-medium tracking-tight sm:text-5xl">
              Security built into how SmartPR runs
            </h1>
            <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-[#3a3a3a]">
              A clear view of how we protect customer workspaces — authentication,
              isolation, auditability, and the controls we maintain as we prepare
              for formal assurance. Conservative claims only.
            </p>

            <div className="mt-10 flex flex-wrap items-stretch gap-4">
              <div className="flex min-w-[240px] flex-1 flex-col rounded-2xl border border-[#161616]/12 bg-white/70 p-5 shadow-[0_1px_0_rgba(22,22,22,0.04)]">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#5a5a5a]">
                  Assurance status
                </p>
                <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-medium tracking-tight">
                  SOC 2 readiness
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#5a5a5a]">
                  Internal control inventory and evidence work underway.{" "}
                  <strong className="font-medium text-[#161616]">
                    Not SOC 2 certified.
                  </strong>{" "}
                  No Type I or Type II attestation is claimed.
                </p>
              </div>
              <div className="flex min-w-[240px] flex-1 flex-col rounded-2xl border border-[#161616]/12 bg-white/70 p-5 shadow-[0_1px_0_rgba(22,22,22,0.04)]">
                <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#5a5a5a]">
                  Who this is for
                </p>
                <p className="mt-2 font-[family-name:var(--font-display)] text-2xl font-medium tracking-tight">
                  Prospects & customers
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[#5a5a5a]">
                  Security questionnaires, enterprise procurement, and diligence —
                  grounded in product engineering, not marketing badges.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Overview */}
        <section className="border-b border-[#161616]/10">
          <div className="mx-auto max-w-5xl px-6 py-14">
            <div className="grid gap-10 md:grid-cols-[1fr_1.2fr]">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">
                  Overview
                </p>
                <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-medium tracking-tight">
                  What we will say — and what we will not
                </h2>
              </div>
              <div className="space-y-4 text-[15px] leading-relaxed text-[#1b1b1b]">
                <p>
                  SmartPR is a Puerto Rico business permits and licensing platform.
                  Customer filings and workspace data are confidential. We document
                  security controls that exist in product engineering and the
                  readiness work toward a future independent audit.
                </p>
                <p>
                  We do <em>not</em> publish fake ISO marks, invented SOC 2 Type II
                  badges, or compliance scores. Where production configuration must
                  be confirmed (IdP wiring, RLS, vendor reports), we say so
                  explicitly.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Readiness badge callout */}
        <section className="border-b border-[#161616]/10 bg-[rgba(36,92,92,0.06)]">
          <div className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-12 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#245c5c]/25 bg-white text-brand"
                aria-hidden
              >
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 3l7 3v5c0 4.5-2.9 8.4-7 9.5C7.9 19.4 5 15.5 5 11V6l7-3z"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M9.5 12.2l1.8 1.8 3.4-3.6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <div>
                <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium tracking-tight">
                  SOC 2 readiness badge
                </h2>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-[#3a3a3a]">
                  Signals that SmartPR maintains a control inventory, security
                  documentation, and internal evidence workflows. It is{" "}
                  <strong className="font-medium">not</strong> an auditor
                  attestation and must not be read as “SOC 2 certified” or “SOC 2
                  Type II.”
                </p>
              </div>
            </div>
            <div className="shrink-0 rounded-xl border border-dashed border-[#245c5c]/35 bg-white/80 px-5 py-4 text-center">
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-brand">
                Status
              </p>
              <p className="mt-1 font-[family-name:var(--font-display)] text-lg font-medium">
                Readiness only
              </p>
              <p className="mt-0.5 text-xs text-[#5a5a5a]">Not certified</p>
            </div>
          </div>
        </section>

        {/* Control grid */}
        <section id="controls" className="border-b border-[#161616]/10">
          <div className="mx-auto max-w-5xl px-6 py-14">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">
              Controls
            </p>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-medium tracking-tight">
              Security control overview
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#5a5a5a]">
              Summaries of controls present in SmartPR engineering. Labels
              distinguish product-implemented features, items that need production
              verification, and readiness-track processes.
            </p>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {CONTROLS.map((control) => (
                <article
                  key={control.title}
                  className="flex flex-col rounded-2xl border border-[#161616]/10 bg-white/75 p-5 shadow-[0_1px_0_rgba(22,22,22,0.03)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-[family-name:var(--font-display)] text-xl font-medium tracking-tight">
                      {control.title}
                    </h3>
                    <StatusPill status={control.status} />
                  </div>
                  <p className="mt-3 flex-1 text-sm leading-relaxed text-[#3a3a3a]">
                    {control.summary}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* PDF download */}
        <section id="package" className="border-b border-[#161616]/10">
          <div className="mx-auto max-w-5xl px-6 py-14">
            <div className="overflow-hidden rounded-2xl border border-[#161616]/12 bg-white shadow-[0_1px_0_rgba(22,22,22,0.04)]">
              <div className="grid md:grid-cols-[1.4fr_1fr]">
                <div className="p-7 sm:p-9">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">
                    Documents
                  </p>
                  <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-medium tracking-tight">
                    Security &amp; Trust Package
                  </h2>
                  <p className="mt-3 max-w-lg text-sm leading-relaxed text-[#3a3a3a]">
                    Download the PDF overview of SmartPR security practices and SOC
                    2 readiness documentation. Suitable for security questionnaires
                    and early diligence. It does not constitute a certification.
                  </p>
                  <a
                    href="/trust/SmartPR-Security-Trust-Package.pdf"
                    className="mt-6 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
                    download
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                      <path
                        d="M8 2v8m0 0L5 7.5M8 10l3-2.5M3 13h10"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Download PDF
                  </a>
                </div>
                <div className="flex flex-col justify-center border-t border-[#161616]/08 bg-[#f4f1ea]/80 p-7 sm:p-9 md:border-l md:border-t-0">
                  <dl className="space-y-4 text-sm">
                    <div>
                      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#5a5a5a]">
                        File
                      </dt>
                      <dd className="mt-1 font-medium">
                        SmartPR-Security-Trust-Package.pdf
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-[#5a5a5a]">
                        Contents
                      </dt>
                      <dd className="mt-1 text-[#3a3a3a]">
                        Control overview, readiness posture, and security practices
                        for customer diligence.
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Contact */}
        <section className="border-b border-[#161616]/10">
          <div className="mx-auto max-w-5xl px-6 py-14">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">
              Contact
            </p>
            <h2 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-medium tracking-tight">
              Security &amp; trust inquiries
            </h2>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-[#3a3a3a]">
              For questionnaires, NDAs, or diligence follow-ups, email{" "}
              <a
                className="font-medium text-brand underline-offset-4 hover:underline"
                href="mailto:contact@getsmartpr.com"
              >
                contact@getsmartpr.com
              </a>
              . We respond with facts we can stand behind — not inflated claims.
            </p>
          </div>
        </section>
      </main>

      <footer className="bg-[#161616] text-[#c8c4bc]">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <SmartPRLogo size="auth" inverted className="[&_.smartpr-logo-wordmark]:text-[#f4f1ea]" />
              <p className="mt-3 max-w-md text-xs leading-relaxed text-[#8a8680]">
                trust.getsmartpr.com — public Trust Center for SmartPR.
              </p>
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <a
                href="https://www.getsmartpr.com/"
                className="text-[#c8c4bc] transition-colors hover:text-white"
              >
                getsmartpr.com
              </a>
              <a
                href="https://www.getsmartpr.com/privacy"
                className="text-[#c8c4bc] transition-colors hover:text-white"
              >
                Privacy
              </a>
              <a
                href="mailto:contact@getsmartpr.com"
                className="text-[#c8c4bc] transition-colors hover:text-white"
              >
                contact@getsmartpr.com
              </a>
            </div>
          </div>
          <p className="mt-8 border-t border-white/10 pt-6 text-[12px] leading-relaxed text-[#8a8680]">
            Disclaimer: This Trust Center describes SmartPR security practices and
            SOC 2 <em>readiness</em> only. Nothing on this page asserts that SmartPR
            is SOC 2 certified, SOC 2 compliant, ISO certified, or that an
            independent auditor has attested to these controls. Inventory and status
            labels reflect product engineering and documentation evidence;
            production configuration and vendor reports require separate
            verification. Last updated September 17, 2026.
          </p>
        </div>
      </footer>
    </div>
  );
}
