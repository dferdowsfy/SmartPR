import Link from "next/link";
import { SmartPRLogo } from "../components/brand/SmartPRLogo";

export const metadata = {
  alternates: { canonical: '/privacy' },
  title: "Privacy Policy — SmartPR",
  description: "How SmartPR collects, uses, and protects information.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#161616]">
      <header className="border-b border-[#161616]/12 px-6 py-5">
        <Link href="/" aria-label="SmartPR home">
          <SmartPRLogo size="auth" />
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">Legal</p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-medium tracking-tight">Privacy Policy</h1>
        <p className="mt-3 text-sm text-[#5a5a5a]">Last updated August 20, 2026</p>

        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-[#1b1b1b]">
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">What SmartPR is</h2>
            <p className="mt-3">
              SmartPR is an independent platform that helps people understand and prepare Puerto Rico business
              registrations, permits, licenses, and filing packages. Government agencies remain the authorities
              that approve those filings.
            </p>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Information we collect</h2>
            <p className="mt-3">We collect only what is needed to run the product:</p>
            <ul className="mt-3 list-disc space-y-2 pl-5">
              <li>Account details such as name, email, and password (stored by our authentication provider).</li>
              <li>Business facts you enter or confirm, including municipality, activity, and entity type.</li>
              <li>Documents you upload so SmartPR can map fields and check evidence.</li>
              <li>Usage data needed to keep the service secure and working.</li>
            </ul>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">How we use it</h2>
            <p className="mt-3">
              Information is used to interpret your request, determine applicable requirements, populate official
              forms, calculate readiness, and save your work so you can resume later. We do not sell personal
              information. We do not use your filings for advertising.
            </p>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Sharing</h2>
            <p className="mt-3">
              We share information with service providers that host authentication, storage, and document
              processing, and only as needed to operate SmartPR. We do not file with government agencies on your
              behalf unless you later choose a submission path that requires it, and then only with your action.
            </p>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Retention and control</h2>
            <p className="mt-3">
              You can request export or deletion of your account and stored filings by emailing
              privacy@smartpr.app. We keep records as long as your account is active, or longer if required by law.
            </p>
          </section>
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Contact</h2>
            <p className="mt-3">
              Questions about this policy: <a className="text-brand underline-offset-4 hover:underline" href="mailto:privacy@smartpr.app">privacy@smartpr.app</a>
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
