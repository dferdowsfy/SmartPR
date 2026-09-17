import Link from "next/link";
import { isCurrentUserSuperAdmin } from "../../../../lib/admin";
import { SmartPRLogo } from "../../../components/brand/SmartPRLogo";
import { AccessReviewClient } from "./AccessReviewClient";

export const dynamic = "force-dynamic";

export default async function AccessReviewPage() {
  const allowed = await isCurrentUserSuperAdmin();
  return (
    <div className="flex min-h-screen flex-col bg-[#f4f1ea] text-[#161616]">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" aria-label="SmartPR home">
          <SmartPRLogo size="auth" />
        </Link>
        <Link href="/admin/security" className="text-sm hover:underline">
          ← Security center
        </Link>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {!allowed ? (
          <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-8 text-center">
            <h1 className="text-2xl font-semibold">Not authorized</h1>
          </div>
        ) : (
          <>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium">
              Privileged access review
            </h1>
            <p className="mt-2 mb-8 text-sm text-[#5a5a5a]">
              Snapshot of platform admins, active support grants, and service accounts. Recording a
              review creates an evidence row — do not fabricate completion dates.
            </p>
            <AccessReviewClient />
          </>
        )}
      </main>
    </div>
  );
}
