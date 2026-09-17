import Link from "next/link";
import { isCurrentUserSuperAdmin } from "../../../lib/admin";
import { SmartPRLogo } from "../../components/brand/SmartPRLogo";
import { SecurityDashboardClient } from "./SecurityDashboardClient";

export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  const allowed = await isCurrentUserSuperAdmin();
  return (
    <div className="flex min-h-screen flex-col bg-[#f4f1ea] text-[#161616]">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/" aria-label="SmartPR home">
          <SmartPRLogo size="auth" />
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-sm text-[#5a5a5a] hover:underline">
            Companies
          </Link>
          <span className="rounded-full bg-[#161616] px-3 py-1 text-xs font-semibold text-[#f6f3ea]">
            Security
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {!allowed ? (
          <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-8 text-center">
            <h1 className="text-2xl font-semibold">Not authorized</h1>
            <p className="mt-2 text-sm text-[#5a5a5a]">
              This area is restricted to SmartPR super admins. Authorization is enforced on every API.
            </p>
          </div>
        ) : (
          <>
            <h1 className="font-[family-name:var(--font-display)] text-4xl font-medium">
              Security center
            </h1>
            <p className="mt-2 mb-2 text-[#5a5a5a]">
              SOC 2 <em>readiness</em> inventory and operational modules — not a certification status
              or compliance score.
            </p>
            <p className="mb-8 text-xs text-[#5a5a5a]">
              Apply <code className="rounded bg-[#161616]/8 px-1">data/security_soc2_readiness.sql</code>{" "}
              before using evidence / incidents / risks / policies tables.
            </p>
            <nav className="mb-6 flex flex-wrap gap-3 text-sm">
              <Link className="underline" href="/admin/security/access-review">
                Access review
              </Link>
              <span className="text-[#5a5a5a]">Repo docs: docs/security/</span>
            </nav>
            <SecurityDashboardClient />
          </>
        )}
      </main>
    </div>
  );
}
