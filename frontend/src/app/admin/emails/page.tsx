import Link from "next/link";
import { isCurrentUserSuperAdmin } from "../../../lib/admin";
import { SmartPRLogo } from "../../components/brand/SmartPRLogo";
import { EmailsClient } from "./EmailsClient";

export const dynamic = "force-dynamic";

export default async function AdminEmailsPage() {
  const allowed = await isCurrentUserSuperAdmin();
  return (
    <div className="flex min-h-screen flex-col bg-[#f4f1ea] text-[#161616]">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" aria-label="SmartPR home"><SmartPRLogo size="auth" /></Link>
        <span className="rounded-full bg-[#161616] px-3 py-1 text-xs font-semibold text-[#f6f3ea]">
          Super admin
        </span>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        {!allowed ? (
          <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-8 text-center">
            <h1 className="text-2xl font-semibold">Not authorized</h1>
            <p className="mt-2 text-sm text-[#5a5a5a]">
              This area is restricted to SmartPR super admins.
            </p>
            <Link href="/businesses" className="mt-4 inline-block text-sm font-medium text-brand underline-offset-4 hover:underline">
              Back to your businesses
            </Link>
          </div>
        ) : (
          <>
            <h1 className="font-[family-name:var(--font-display)] text-4xl font-medium">Compliance emails</h1>
            <p className="mt-2 mb-8 max-w-3xl text-[#5a5a5a]">
              These wrappers are the Supabase-managed equivalent of Authentication → Emails:
              edit the subject, HTML, and text around the dynamic content, preview with
              realistic sample data, and save. The dynamic blocks (deadlines, action
              items, business names) are rendered by code and substituted into the{" "}
              <code className="rounded bg-[#161616]/5 px-1">{"{{placeholders}}"}</code> — a
              malformed edit can never break a send; the built-in wrapper is always the fallback.
            </p>
            <EmailsClient />
          </>
        )}
      </main>
    </div>
  );
}
