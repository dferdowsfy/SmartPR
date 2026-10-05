import Link from "next/link";
import { SmartPRLogo } from "../components/brand/SmartPRLogo";

export const metadata = {
  alternates: { canonical: "/terms" },
  title: "Terms of Service — SmartPR",
  description:
    "Terms governing use of the SmartPR platform and the SmartPR ChatGPT connector for preliminary Puerto Rico PR permit assessments.",
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
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-medium tracking-tight">
          Terms of Service
        </h1>
        <p className="mt-3 text-sm text-[#5a5a5a]">Last updated October 5, 2026</p>

        <div className="mt-10 space-y-8 text-[15px] leading-relaxed text-[#1b1b1b]">
          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Acceptance of these terms</h2>
            <p className="mt-3">
              These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of SmartPR, including
              the website at getsmartpr.com, related apps and APIs, and the SmartPR connector available in
              ChatGPT (together, the &ldquo;Service&rdquo;). By creating an account, using the Service, or
              continuing to use the Service after changes are posted, you agree to these Terms. If you do not
              agree, do not use the Service.
            </p>
            <p className="mt-3">
              If you use SmartPR on behalf of a business or other entity, you represent that you have authority
              to bind that entity, and &ldquo;you&rdquo; includes that entity.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">The Service</h2>
            <p className="mt-3">
              SmartPR is an independent readiness and compliance preparation platform for opening and operating
              a business in Puerto Rico. It helps you identify potentially applicable permits, licenses,
              registrations, inspections, and deadlines; prepare forms and submission packages; and track
              compliance obligations.
            </p>
            <p className="mt-3">
              The Service includes a free preview available through ChatGPT via SmartPR&apos;s Model Context
              Protocol (MCP) connector. That preview provides preliminary PR permit and requirements
              assessments based on facts you supply in the chat. It is the same style of public regulatory
              information available on the SmartPR website, not a substitute for a full SmartPR workspace or
              for advice from a licensed professional.
            </p>
            <p className="mt-3">
              SmartPR is not a government agency and does not approve, grant, deny, or issue any license,
              permit, registration, or other government authorization. Government agencies of Puerto Rico and
              the United States remain the sole authorities that decide those matters.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">
              Not legal advice; no attorney-client relationship
            </h2>
            <p className="mt-3">
              SmartPR provides regulatory information and preparation tools. It is not a law firm, not a
              licensed attorney, and not a substitute for legal, tax, engineering, or other professional
              advice. Using the Service does not create an attorney-client, fiduciary, or other professional
              relationship between you and SmartPR or any of its owners, employees, or contractors.
            </p>
            <p className="mt-3">
              Always confirm requirements, forms, fees, and deadlines with the issuing agency or a licensed
              professional before you file or rely on any SmartPR output. SmartPR packages, reports,
              worksheets, and ChatGPT assessments are preparation materials only — not official filings and
              not legal opinions.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Accuracy and preliminary assessments</h2>
            <p className="mt-3">
              Requirements change. Agency portals, forms, fees, and interpretations are updated over time.
              SmartPR works from curated knowledge and publicly available sources, but assessments —
              including ChatGPT free-preview assessments — are preliminary and may be incomplete, outdated,
              or wrong for your facts.
            </p>
            <p className="mt-3">You are responsible for:</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-6">
              <li>Providing accurate business facts (activity, location, size, renovations, and similar details).</li>
              <li>Reviewing every SmartPR output before you act on it.</li>
              <li>Verifying requirements directly with the relevant agencies or licensed professionals.</li>
              <li>Meeting all legal obligations for your business, regardless of what SmartPR shows.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Accounts</h2>
            <p className="mt-3">
              You must be at least 18 years old to create an account. You agree to provide accurate
              registration information, keep your credentials secure, and promptly update your contact
              details. You are responsible for all activity under your account. Notify us immediately if you
              suspect unauthorized access.
            </p>
            <p className="mt-3">
              We may refuse, suspend, or reclaim usernames or accounts that violate these Terms, appear
              inactive, or present a security or integrity risk to the Service.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Acceptable use</h2>
            <p className="mt-3">You agree not to:</p>
            <ul className="mt-3 list-disc space-y-1.5 pl-6">
              <li>Use the Service for any unlawful purpose or in violation of any applicable regulation.</li>
              <li>Submit false, misleading, infringing, or unauthorized information or documents.</li>
              <li>
                Attempt to disrupt, probe, reverse-engineer (except where mandatory law allows), scrape at
                abusive scale, or gain unauthorized access to the Service or related systems.
              </li>
              <li>Resell, sublicense, or redistribute SmartPR outputs as your own commercial product without our written permission.</li>
              <li>
                Misrepresent SmartPR outputs as government approvals, official filings, or legal advice, or
                submit a SmartPR package to an agency as if it were an official filing when it is not.
              </li>
              <li>Use the ChatGPT connector or APIs in a way that violates OpenAI&apos;s or ChatGPT&apos;s own terms, or that overloads or abuses rate limits.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Plans and payments</h2>
            <p className="mt-3">
              Sign-up, basic assessment, and requirements checklists are available without charge. Exportable
              deliverables, advanced features, and certain workspace capabilities require a paid plan. Current
              plans and prices are described on our{" "}
              <Link className="text-brand underline-offset-4 hover:underline" href="/pricing">
                Pricing
              </Link>{" "}
              page and at checkout.
            </p>
            <p className="mt-3">
              Paid plans are billed through our payment processor on the schedule shown at purchase
              (typically monthly or yearly). Subscriptions renew until you cancel. You can cancel at any time
              and keep access until the end of the then-current billing period, unless a specific offer states
              otherwise. Fees already paid are generally non-refundable except where required by law or where
              we expressly say otherwise at purchase.
            </p>
            <p className="mt-3">
              You are responsible for applicable taxes. We may change prices prospectively; material price
              changes for an active subscription will be communicated before they apply to a renewal.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Your content</h2>
            <p className="mt-3">
              You retain ownership of the business facts and documents you enter or upload. By using the
              Service you grant SmartPR a limited, worldwide, non-exclusive license to host, process, and
              display that content solely to operate the Service for you — for example, to determine
              requirements, populate forms, check evidence, and save your work. We do not sell your content.
              How we handle personal information is described in our{" "}
              <Link className="text-brand underline-offset-4 hover:underline" href="/privacy">
                Privacy Policy
              </Link>
              .
            </p>
            <p className="mt-3">
              You represent that you have the rights needed to provide the content you submit and that doing
              so does not violate any third-party rights or confidentiality obligations.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Intellectual property</h2>
            <p className="mt-3">
              The SmartPR platform — including its software, requirement logic, knowledge packs, designs,
              trademarks, and documentation — is owned by SmartPR and its licensors and is protected by
              intellectual property laws. These Terms do not transfer ownership of any SmartPR intellectual
              property to you. You may use the Service only as expressly allowed here.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">
              Third-party portals and government data
            </h2>
            <p className="mt-3">
              SmartPR may display links to, references from, or mappings against government portals, forms,
              maps, and public datasets (for example municipal, commonwealth, or federal sources). Those
              materials belong to their respective publishers. SmartPR does not control government systems,
              uptime, form revisions, fee schedules, or how an agency interprets its rules.
            </p>
            <p className="mt-3">
              Unless you later choose a submission path that requires it and you take the action yourself,
              SmartPR does not file with government agencies on your behalf. Always use the agency&apos;s
              official channels and instructions for final filings.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">ChatGPT and OpenAI</h2>
            <p className="mt-3">
              The SmartPR ChatGPT connector runs inside ChatGPT, a product operated by OpenAI (or its
              affiliates). ChatGPT is a separate platform with its own terms, privacy policy, and account
              relationship. SmartPR does not control ChatGPT&apos;s availability, model behavior, logging, or
              how OpenAI processes conversations outside the SmartPR tools.
            </p>
            <p className="mt-3">
              When you use the connector, facts you send as tool inputs may be processed by SmartPR to return
              a preliminary assessment. Account data stored in SmartPR is not shared back into ChatGPT except
              as needed to fulfill a tool call you initiate (for example, returning assessment text or a
              handoff link). Your use of ChatGPT remains subject to OpenAI&apos;s terms in addition to these
              Terms.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Disclaimers</h2>
            <p className="mt-3">
              THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT WARRANTIES OF
              ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING IMPLIED WARRANTIES OF
              MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. SMARTPR DOES NOT
              WARRANT THAT ASSESSMENTS ARE COMPLETE, ACCURATE, CURRENT, OR SUITABLE FOR YOUR SITUATION, OR
              THAT THE SERVICE WILL BE UNINTERRUPTED OR ERROR-FREE.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Limitation of liability</h2>
            <p className="mt-3">
              To the maximum extent permitted by law, SmartPR and its owners, officers, employees, and
              contractors are not liable for any indirect, incidental, special, consequential, exemplary, or
              punitive damages, or for lost profits, lost revenue, lost data, business interruption, or cost of
              substitute services, arising out of or related to the Service or these Terms, whether based on
              contract, tort, strict liability, or any other theory, even if advised of the possibility of such
              damages.
            </p>
            <p className="mt-3">
              To the maximum extent permitted by law, SmartPR&apos;s total liability for all claims arising out
              of or related to the Service or these Terms is limited to the greater of (a) the amounts you paid
              to SmartPR for the Service in the twelve (12) months before the claim, or (b) one hundred U.S.
              dollars (US$100) if you have not paid any fees.
            </p>
            <p className="mt-3">
              Some jurisdictions do not allow certain limitations; in those places, the limitations apply to
              the fullest extent permitted.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Indemnity</h2>
            <p className="mt-3">
              You agree to defend, indemnify, and hold harmless SmartPR and its owners, officers, employees,
              and contractors from and against any claims, damages, losses, liabilities, costs, and expenses
              (including reasonable attorneys&apos; fees) arising out of or related to: (a) your use of the
              Service; (b) content you submit; (c) your violation of these Terms or applicable law; or (d)
              your filings, applications, or business decisions made with or without reliance on SmartPR
              outputs.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Termination</h2>
            <p className="mt-3">
              You may stop using SmartPR at any time and may request export or deletion of your stored data as
              described in the Privacy Policy. We may suspend or terminate access if you violate these Terms,
              if required by law, or if we discontinue the Service. On termination, your right to use the
              Service ends. Provisions that by their nature should survive (including intellectual property,
              disclaimers, limitation of liability, indemnity, and governing law) will survive.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Governing law</h2>
            <p className="mt-3">
              These Terms are governed by the laws of the Commonwealth of Puerto Rico and the applicable
              federal laws of the United States, without regard to conflict-of-law rules. Subject to any
              mandatory consumer protections that apply where you live, the courts located in Puerto Rico have
              exclusive jurisdiction over disputes arising out of or relating to these Terms or the Service,
              and you consent to personal jurisdiction there.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Changes</h2>
            <p className="mt-3">
              We may update these Terms as the Service evolves. The &ldquo;Last updated&rdquo; date at the top
              of this page will change when we do. Material changes will be posted here; continued use after
              changes take effect means you accept the updated Terms. If you do not agree, stop using the
              Service.
            </p>
          </section>

          <section>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-medium">Contact</h2>
            <p className="mt-3">
              Questions about these Terms:{" "}
              <a
                className="text-brand underline-offset-4 hover:underline"
                href="mailto:darius@getsmartpr.com"
              >
                darius@getsmartpr.com
              </a>
              . For product help, see{" "}
              <Link className="text-brand underline-offset-4 hover:underline" href="/support">
                Support
              </Link>{" "}
              or email{" "}
              <a
                className="text-brand underline-offset-4 hover:underline"
                href="mailto:contact@getsmartpr.com"
              >
                contact@getsmartpr.com
              </a>
              . Privacy requests:{" "}
              <a
                className="text-brand underline-offset-4 hover:underline"
                href="mailto:privacy@smartpr.app"
              >
                privacy@smartpr.app
              </a>
              .
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
