import Link from "next/link";
import { isCurrentUserSuperAdmin } from "../../lib/admin";
import { SmartPRLogo } from "../components/brand/SmartPRLogo";
import { AdminWorkspaceList } from "./AdminWorkspaceList";

export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const allowed = await isCurrentUserSuperAdmin();
  return (
    <div className="flex min-h-screen flex-col bg-[#f4f1ea] text-[#161616]">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" aria-label="SmartPR home"><SmartPRLogo size="auth" /></Link>
        <span className="rounded-full bg-[#161616] px-3 py-1 text-xs font-semibold text-[#f6f3ea]">
          Super admin
        </span>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
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
            <h1 className="font-[family-name:var(--font-display)] text-4xl font-medium">Companies</h1>
            <p className="mt-2 mb-8 text-[#5a5a5a]">
              Every workspace on the platform. Select one to manage its team, branding, and plan.
            </p>
            <AdminWorkspaceList />
          </>
        )}
      </main>
    </div>
  );
}
