import Link from "next/link";
import { isCurrentUserSuperAdmin } from "../../../lib/admin";
import { SmartPRLogo } from "../../components/brand/SmartPRLogo";
import { ReviewQueueClient } from "./ReviewQueueClient";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  const allowed = await isCurrentUserSuperAdmin();
  return (
    <div className="flex min-h-screen flex-col bg-[#f4f1ea] text-[#161616]">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" aria-label="SmartPR home">
          <SmartPRLogo size="auth" />
        </Link>
        <Link href="/admin" className="text-sm hover:underline">
          ← Admin
        </Link>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {!allowed ? (
          <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-8 text-center">
            <h1 className="text-2xl font-semibold">Not authorized</h1>
          </div>
        ) : (
          <>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-medium">Map-data review queue</h1>
            <p className="mt-2 mb-8 text-sm text-[#5a5a5a]">
              Differences between the official map answers recorded for our sample parcels and the latest read-only check of the same
              government services. Nothing here changes rules or reports on its own; each item says who reviews it and what to do.
            </p>
            <ReviewQueueClient />
          </>
        )}
      </main>
    </div>
  );
}
