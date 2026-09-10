// Minimal lead capture for the landing-page "Start my application" CTA.
// Guests give name + email before the assessment begins; authenticated users
// are tracked silently (we already know them). The founder is notified by
// email for every genuinely new lead — never more than once per address.
import { randomUUID } from "crypto";
import { getPool, isEnabled } from "../../graph/db";
import { ensureSchema } from "../../graph/store";
import { getCurrentUser } from "../../../lib/supabase/server";
import { rateLimitAllow } from "../../../lib/rateLimit";
import { markLeadConverted, notifyFounder } from "../../../lib/leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.trim().slice(0, max) || null : null;

// UTM is free-form query data: keep only short scalar string values so a
// crafted payload can't smuggle nested objects into the jsonb column.
function cleanUtm(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === "string" && entry.trim()) {
      out[key.slice(0, 40)] = entry.trim().slice(0, 200);
    } else if (typeof entry === "number" && Number.isFinite(entry)) {
      out[key.slice(0, 40)] = String(entry).slice(0, 200);
    }
  }
  return out;
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return (forwarded?.split(",")[0] || "unknown").trim().slice(0, 64);
}

export async function POST(request: Request) {
  if (!isEnabled()) return Response.json({ error: "no_database" }, { status: 503 });
  if (!rateLimitAllow(`leads:${clientIp(request)}`, 10, 60_000)) {
    return Response.json({ error: "Too many requests. Try again in a minute." }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const pool = getPool();
  if (!pool) return Response.json({ error: "no_database" }, { status: 503 });
  await ensureSchema();

  const user = await getCurrentUser();
  const email = ((user?.email as string | undefined) || String(body.email || "")).trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return Response.json({ error: "A valid email is required." }, { status: 400 });
  const name = clean(body.name, 120);
  const phone = clean(body.phone, 40);
  const source = clean(body.source, 80)?.replace(/[^a-zA-Z0-9_-]/g, "") || "landing_start_assessment";
  const language = clean(body.language, 8);
  const utm = cleanUtm(body.utm);

  const { rows } = await pool.query<{ id: string; status: string; notified_at: string | null }>(
    `SELECT id, status, notified_at FROM leads WHERE lower(email) = $1 LIMIT 1`,
    [email]
  );
  const existing = rows[0];

  if (existing) {
    // Returning lead: refresh details, link the account when known.
    await pool.query(
      `UPDATE leads SET name = COALESCE($2, name), phone = COALESCE($3, phone),
         source = $4, language = COALESCE($5, language),
         user_id = COALESCE(user_id, $6)
       WHERE id = $1`,
      [existing.id, name, phone, source, language, user?.id ?? null]
    );
    if (existing.status === "CAPTURED" && user && await markLeadConverted(pool, existing.id, user.id)) {
      await notifyFounder("Lead converted to signup", {
        Name: name || "(no name given)",
        Email: email,
        Detail: "Started as a landing-page lead, now started the assessment signed in.",
      });
    }
    return Response.json({ ok: true, lead_id: existing.id, returning: true });
  }

  const id = randomUUID();
  const status = user ? "CONVERTED" : "CAPTURED";
  await pool.query(
    `INSERT INTO leads (id, email, name, phone, source, language, utm, user_id, status,
        notified_at, converted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,now(),
        CASE WHEN $9 = 'CONVERTED' THEN now() ELSE NULL END)`,
    [id, email, name, phone, source, language, JSON.stringify(utm), user?.id ?? null, status]
  );

  if (status === "CAPTURED") {
    // Founder notification is fire-and-forget inside notifyFounder.
    void notifyFounder("New lead started the assessment", {
      Name: name || "(no name given)",
      Email: email,
      ...(phone ? { Phone: phone } : {}),
      Source: source,
      ...(language ? { Language: language } : {}),
    });
  } else {
    // Signed-in user starting the assessment: we know who they are, and the
    // founder wants to know too.
    const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
    const authedName = name
      || (typeof meta.full_name === "string" && meta.full_name)
      || (typeof meta.name === "string" && meta.name)
      || "(no name given)";
    void notifyFounder("Signed-in user started the assessment", {
      Name: authedName,
      Email: email,
      ...(phone ? { Phone: phone } : {}),
      Source: source,
      ...(language ? { Language: language } : {}),
    });
  }
  return Response.json({ ok: true, lead_id: id });
}
