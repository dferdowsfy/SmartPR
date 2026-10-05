import Link from "next/link";
import { SmartPRLogo } from "../components/brand/SmartPRLogo";

export const metadata = {
  alternates: { canonical: '/terms' },
  title: "Terms of Service — SmartPR",
  description: "The terms governing use of SmartPR.",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#161616]">
      <header className="border-b border-[#161616]/12 px-6 py-5">
        <Link href="/" aria-label="SmartPR home">
          <SmartPRLogo size="auth" />
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">Legal</p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-medium tracking-tight">Terms of Service</h1>
        <p className="mt-3 text-sm text-[#5a5a5a]">Last updated October 5, 2026</p>

        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-[#1b1b1b]">
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">The service</h2>
            <p className="mt-3">
              SmartPR is a readiness and compliance preparation platform for opening and operating a business
              in Puerto Rico. It helps you identify applicable permits, licenses, registrations, inspections,
              and deadlines, prepare official forms and submission packages, and track compliance obligations.
              SmartPR is not a government agency and does not approve, grant, or issue any license or permit.
            </p>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Your account</h2>
            <p className="mt-3">
              You are responsible for keeping your account credentials secure and for all activity under your
              account. You must provide accurate information when you sign up, and you must be at least 18
              years old to use SmartPR.
            </p>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Acceptable use</h2>
            <p className="mt-3">You agree not to:</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-6">
              <li>Use SmartPR for any unlawful purpose or in violation of any regulation.</li>
              <li>Submit false, misleading, or infringing information or documents.</li>
              <li>Attempt to disrupt, reverse-engineer, or gain unauthorized access to the service.</li>
              <li>Resell or redistribute SmartPR outputs as your own commercial product.</li>
            </ul>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Plans and payments</h2>
            <p className="mt-3">
              Sign-up, assessment, and requirements checklists are free. Exportable deliverables and advanced
              features require a paid plan. Prices are shown at purchase and are charged per the billing terms
              presented then. Paid plans renew until cancelled; you can cancel at any time and keep access
              until the end of the current billing period.
            </p>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Your content</h2>
            <p className="mt-3">
              You own the business facts and documents you enter or upload. By using SmartPR you grant us a
              limited license to process that content solely to operate the service for you — to determine
              requirements, populate forms, and check evidence. We do not sell your content. See our{" "}
              <Link className="text-brand underline-offset-4 hover:underline" href="/privacy">Privacy Policy</Link>{" "}
              for how we handle information.
            </p>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Not legal advice</h2>
            <p className="mt-3">
              SmartPR provides regulatory information and preparation tools. It is not a law firm and does not
              provide legal advice. Requirements change over time; always confirm with the issuing agency or a
              licensed professional before filing. SmartPR packages are preparation materials, not official
              filings.
            </p>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Intellectual property</h2>
            <p className="mt-3">
              The SmartPR platform, including its software, requirement logic, and design, is owned by SmartPR
              and protected by intellectual property laws. These terms do not grant you any ownership rights in
              the service.
            </p>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Disclaimers and liability</h2>
            <p className="mt-3">
              SmartPR is provided &ldquo;as is&rdquo; without warranties of any kind. To the maximum extent
              permitted by law, SmartPR is not liable for indirect, incidental, or consequential damages, or
              for decisions you make based on SmartPR outputs. Our total liability is limited to the amount you
              paid for the service in the 12 months before the claim.
            </p>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Termination</h2>
            <p className="mt-3">
              You may stop using SmartPR at any time. We may suspend or terminate accounts that violate these
              terms. On termination, your right to use the service ends; you may request export or deletion of
              your stored data as described in our Privacy Policy.
            </p>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Changes</h2>
            <p className="mt-3">
              We may update these terms as the service evolves. Material changes will be posted here with a new
              &ldquo;last updated&rdquo; date; continued use after changes take effect means you accept them.
            </p>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Contact</h2>
            <p className="mt-3">
              Questions about these terms: <a className="text-brand underline-offset-4 hover:underline" href="mailto:contact@getsmartpr.com">contact@getsmartpr.com</a>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
