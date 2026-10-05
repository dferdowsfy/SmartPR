import Link from "next/link";
import { SmartPRLogo } from "../components/brand/SmartPRLogo";

export const metadata = {
  alternates: { canonical: '/support' },
  title: "Support — SmartPR",
  description: "How to get help with SmartPR.",
};

const faqs = [
  {
    q: "I can't sign in to my account",
    a: "Use the password-reset link on the sign-in page. If you still can't get in, email us from the address on your account and we'll help.",
  },
  {
    q: "A requirement looks wrong or is missing",
    a: "Every requirement traces to the legal authority that creates it. If something looks off, tell us the business type, municipality, and the requirement — we review these reports against primary sources.",
  },
  {
    q: "How do I cancel my plan?",
    a: "You can cancel anytime from your account settings. You keep access until the end of the current billing period.",
  },
  {
    q: "Can I export or delete my data?",
    a: "Yes. Email privacy@smartpr.app from your account address and we'll export or delete your account and stored filings.",
  },
];

export default function SupportPage() {
  return (
    <div className="min-h-screen bg-[#f4f1ea] text-[#161616]">
      <header className="border-b border-[#161616]/12 px-6 py-5">
        <Link href="/" aria-label="SmartPR home">
          <SmartPRLogo size="auth" />
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-brand">Help</p>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-medium tracking-tight">Support</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[#1b1b1b]">
          Questions about your account, a requirement, or a filing package? Write to{" "}
          <a className="text-brand underline-offset-4 hover:underline" href="mailto:contact@getsmartpr.com">
            contact@getsmartpr.com
          </a>{" "}
          — we reply within two business days.
        </p>

        <div className="mt-10 space-y-8">
          {faqs.map((f) => (
            <section key={f.q}>
              <h2 className="font-[family-name:var(--font-display)] text-xl font-medium">{f.q}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-[#1b1b1b]">{f.a}</p>
            </section>
          ))}
        </div>

        <p className="mt-10 text-sm text-[#5a5a5a]">
          SmartPR provides regulatory information and preparation tools — not legal advice. For legal
          questions about your business, consult a licensed attorney.
        </p>
      </main>
    </div>
  );
}
