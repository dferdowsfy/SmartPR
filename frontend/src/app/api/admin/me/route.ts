import { NextResponse } from "next/server";
import { isCurrentUserAdmin } from "../../../../lib/admin";

/** Lightweight admin check for client-side gating (e.g. demo features). */
export async function GET() {
  const admin = await isCurrentUserAdmin().catch(() => false);
  return NextResponse.json({ admin });
}
