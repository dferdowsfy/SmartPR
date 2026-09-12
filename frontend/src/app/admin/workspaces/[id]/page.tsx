import Link from "next/link";
import { isCurrentUserSuperAdmin } from "../../../../lib/admin";
import { SmartPRLogo } from "../../../components/brand/SmartPRLogo";
import { WorkspaceDetail } from "./WorkspaceDetail";

export const dynamic = "force-dynamic";

export default async function AdminWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
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
        <Link href="/admin" className="text-sm text-[#5a5a5a] hover:text-[#161616]">
          ← All companies
        </Link>
        {!allowed ? (
          <div className="mt-6 rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-8 text-center">
            <h1 className="text-2xl font-semibold">Not authorized</h1>
            <p className="mt-2 text-sm text-[#5a5a5a]">
              This area is restricted to SmartPR super admins.
            </p>
          </div>
        ) : (
          <WorkspaceDetail workspaceId={id} />
        )}
      </main>
    </div>
  );
}
