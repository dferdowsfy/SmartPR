import type { User } from "@supabase/supabase-js";
import { getPool, isEnabled } from "../../app/graph/db";
import { ensureSchema } from "../../app/graph/store";
import { ensureUserWorkspace } from "../../app/compliance/server";
import {
  normalizePartnerCode,
  redeemPartnerCode,
  type RedeemResult,
} from "../partnerCodes";

export interface PlatformBootstrapResult {
  workspaceId: string;
  partner?: RedeemResult;
}

export type BootstrapOptions = {
  /** Explicit partner code from signup UI / ?code= (preferred over metadata). */
  partnerCode?: string | null;
};

/** Connect a Supabase Auth identity to SmartPR's persistent data model. */
export async function bootstrapPlatformUser(
  user: User,
  opts: BootstrapOptions = {}
): Promise<PlatformBootstrapResult> {
  if (!isEnabled()) throw new Error("DATABASE_URL is not configured.");
  await ensureSchema();
  const pool = getPool();
  if (!pool) throw new Error("Database connection is unavailable.");

  const partnerCode = normalizePartnerCode(
    opts.partnerCode ??
      (user.user_metadata?.partner_code as string | undefined) ??
      null
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const name =
      (user.user_metadata?.full_name as string | undefined) ||
      (user.user_metadata?.name as string | undefined) ||
      null;
    await client.query(
      `INSERT INTO users (id, email, name, last_login)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (id) DO UPDATE SET
         email = COALESCE(EXCLUDED.email, users.email),
         name = COALESCE(EXCLUDED.name, users.name),
         last_login = now()`,
      [user.id, user.email ?? null, name]
    );

    if (partnerCode) {
      const partner = await redeemPartnerCode(client, {
        userId: user.id,
        code: partnerCode,
        email: user.email,
        inTransaction: true,
      });
      await client.query("COMMIT");
      return { workspaceId: partner.workspaceId, partner };
    }

    const workspaceId = await ensureUserWorkspace(client, user);
    await client.query("COMMIT");
    return { workspaceId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
