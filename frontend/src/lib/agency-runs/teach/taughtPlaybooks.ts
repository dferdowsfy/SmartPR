/**
 * Teach Clara v1 — "describe it" playbooks.
 *
 * The live Teach Clara recorder (teachSessions.ts) needs the self-hosted
 * browser worker. When it isn't available — and for anyone who would rather
 * just explain — the person describes how the filing is done: the portal
 * address, the steps in their own words, optional screenshots / a screen
 * recording, and which business detail goes into which portal field.
 *
 * That is saved as a per-portal, per-requirement playbook. Clara's Browser
 * Use runs read it as instructions (renderTaughtPlaybookBlock → task
 * prompt): a goal-directed agent with a hint cache, never a click map — if
 * the portal differs from the description, Clara pursues the goal and says
 * what changed. Field bindings learned on runs merge back in
 * (mergeLearnedBindings). The safety rules never change: Clara pauses for
 * sign-in, uploads, payment and signatures, and never clicks final submit.
 *
 * Values are never stored: step text is scrubbed of anything that looks like
 * a secret (SSN, EIN-like digit runs, passwords) before it is saved.
 */
import { randomUUID } from "node:crypto";
import { PASSPORT_CATALOG } from "./passportCatalog";

export interface PlaybookBinding {
  /** The portal's own label for the field ("Nombre legal"). */
  label: string;
  /** Business Passport path it fills from; null = ask the person each time. */
  path: string | null;
  /** Who said so: the teacher, or a Clara run that learned it. */
  source: "teacher" | "run";
}

export interface PlaybookAttachment {
  name: string;
  type: string;
  size: number;
  /** data: URL — screenshots and short recordings only (capped). */
  data_url: string | null;
}

export interface TaughtPlaybook {
  id: string;
  owner_user_id: string;
  /** Engine document id or energy process id (or a requirement code). */
  requirement_key: string;
  requirement_name: string;
  agency: string | null;
  portal_url: string;
  portal_host: string;
  steps: string[];
  bindings: PlaybookBinding[];
  attachments: PlaybookAttachment[];
  notes: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TaughtPlaybookInput {
  requirement_key: string;
  requirement_name: string;
  agency?: string | null;
  portal_url: string;
  steps: string[];
  bindings?: { label: string; path: string | null }[];
  attachments?: PlaybookAttachment[];
  notes?: string | null;
}

export class PlaybookError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export const PLAYBOOK_LIMITS = {
  steps: 40,
  stepChars: 600,
  bindings: 60,
  attachments: 6,
  /** Per attachment (data URL bytes ≈ 4/3 of the file). */
  attachmentBytes: 6 * 1024 * 1024,
  totalAttachmentBytes: 16 * 1024 * 1024,
} as const;

const KNOWN_PATHS = new Set(PASSPORT_CATALOG.map((e) => e.path));

/** Removes anything that looks like a secret value from free text. */
export function scrubSecrets(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    // SSN / EIN-shaped digit groups and long digit runs (account numbers).
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[removed]")
    .replace(/\b\d{2}-\d{7}\b/g, "[removed]")
    .replace(/\b\d{9,}\b/g, "[removed]")
    // "password: hunter2" / "contraseña = …" / "pin 1234"
    .replace(/\b(password|passcode|contraseña|contrasena|clave|pin|otp|código de verificación)\b\s*[:=]?\s*\S+/gi, "$1 [removed]")
    .trim();
}

export function portalHostOf(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    throw new PlaybookError("bad_portal_url", "Portal address must be a full https:// address.");
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new PlaybookError("bad_portal_url", "Portal address must be a web address.");
  return u.hostname.toLowerCase();
}

/** Validates and normalizes a teacher's description (throws PlaybookError). */
export function normalizePlaybookInput(input: TaughtPlaybookInput): Omit<TaughtPlaybook, "id" | "owner_user_id" | "version" | "created_at" | "updated_at"> {
  const key = String(input.requirement_key ?? "").trim().slice(0, 120);
  const name = scrubSecrets(String(input.requirement_name ?? "")).slice(0, 200);
  if (!key || !name) throw new PlaybookError("bad_request", "Which requirement is this for?");
  const portal_url = String(input.portal_url ?? "").trim();
  const portal_host = portalHostOf(portal_url);
  const steps = (Array.isArray(input.steps) ? input.steps : [])
    .map((s) => scrubSecrets(String(s ?? "")).slice(0, PLAYBOOK_LIMITS.stepChars))
    .filter(Boolean);
  if (!steps.length) throw new PlaybookError("no_steps", "Describe at least one step.");
  if (steps.length > PLAYBOOK_LIMITS.steps) throw new PlaybookError("too_many_steps", `At most ${PLAYBOOK_LIMITS.steps} steps.`);
  const bindings: PlaybookBinding[] = [];
  for (const b of (input.bindings ?? []).slice(0, PLAYBOOK_LIMITS.bindings)) {
    const label = scrubSecrets(String(b?.label ?? "")).slice(0, 120);
    if (!label) continue;
    const path = b?.path && KNOWN_PATHS.has(b.path) ? b.path : null;
    if (!bindings.some((x) => x.label.toLowerCase() === label.toLowerCase())) bindings.push({ label, path, source: "teacher" });
  }
  const attachments: PlaybookAttachment[] = [];
  let total = 0;
  for (const a of (input.attachments ?? []).slice(0, PLAYBOOK_LIMITS.attachments)) {
    const type = String(a?.type ?? "");
    if (!/^(image\/(png|jpeg|webp|gif)|video\/(mp4|webm|quicktime))$/.test(type)) throw new PlaybookError("bad_attachment", "Screenshots (PNG/JPEG/WebP) or a screen recording (MP4/WebM/MOV) only.");
    const data = typeof a?.data_url === "string" && a.data_url.startsWith(`data:${type};base64,`) ? a.data_url : null;
    const bytes = data ? data.length : 0;
    if (bytes > PLAYBOOK_LIMITS.attachmentBytes) throw new PlaybookError("attachment_too_large", "Each screenshot or recording must be under ~4 MB.");
    total += bytes;
    if (total > PLAYBOOK_LIMITS.totalAttachmentBytes) throw new PlaybookError("attachments_too_large", "Attachments are too large together.");
    attachments.push({ name: String(a?.name ?? "attachment").slice(0, 120), type, size: Number(a?.size) || 0, data_url: data });
  }
  const notes = input.notes ? scrubSecrets(String(input.notes)).slice(0, 2000) || null : null;
  return { requirement_key: key, requirement_name: name, agency: input.agency ? String(input.agency).slice(0, 120) : null, portal_url, portal_host, steps, bindings, attachments, notes };
}

/** Bindings a run learned (labels the person filled in, ids → paths). Teacher bindings win. */
export function mergeLearnedBindings(pb: TaughtPlaybook, learned: { label: string; path: string | null }[]): TaughtPlaybook {
  const bindings = [...pb.bindings];
  for (const l of learned) {
    const label = scrubSecrets(String(l.label ?? "")).slice(0, 120);
    if (!label) continue;
    const path = l.path && KNOWN_PATHS.has(l.path) ? l.path : null;
    const i = bindings.findIndex((b) => b.label.toLowerCase() === label.toLowerCase());
    if (i === -1) bindings.push({ label, path, source: "run" });
    else if (bindings[i].source === "run" && path && !bindings[i].path) bindings[i] = { label, path, source: "run" };
  }
  return { ...pb, bindings: bindings.slice(0, PLAYBOOK_LIMITS.bindings) };
}

/**
 * The task-prompt block a Browser Use run reads. Labels and steps only —
 * never values. It is guidance: the goal and the safety rules above it in
 * the prompt always win.
 */
export function renderTaughtPlaybookBlock(pb: TaughtPlaybook | null | undefined): string {
  if (!pb || !pb.steps.length) return "";
  const lines = [
    "",
    `TAUGHT PLAYBOOK (a SmartPR user described how "${pb.requirement_name}" is filed on ${pb.portal_host}; v${pb.version})`,
    "- Use these steps as a map to get there faster. They are guidance, not a script: if a screen differs, keep pursuing the filing goal and report what changed.",
    "- The safety rules above always win: stay on the allowlisted domains, pause for sign-in, uploads, CAPTCHA, payment and signatures; never click the final submit unless authorized.",
    `- Start at: ${pb.portal_url}`,
    ...pb.steps.map((s, i) => `${i + 1}. ${s}`),
  ];
  const mapped = pb.bindings.filter((b) => b.path);
  const ask = pb.bindings.filter((b) => !b.path);
  if (mapped.length) {
    lines.push("FIELD BINDINGS (portal label ← Business Passport path):");
    for (const b of mapped) lines.push(`- "${b.label}" ← ${b.path}`);
  }
  if (ask.length) lines.push(`ASK THE PERSON EACH TIME (list them in REQUIRED_FIELDS on that form step; never guess): ${ask.map((b) => `"${b.label}"`).join(", ")}`);
  if (pb.notes) lines.push(`NOTES: ${pb.notes}`);
  return lines.join("\n");
}

/** Public shape (attachments without their bytes). */
export function playbookSummary(pb: TaughtPlaybook) {
  return { ...pb, attachments: pb.attachments.map(({ name, type, size }) => ({ name, type, size })) };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export const CLARA_PLAYBOOKS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS clara_taught_playbooks (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL,
  requirement_key TEXT NOT NULL,
  portal_host TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  playbook_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_clara_taught_playbooks_owner ON clara_taught_playbooks (owner_user_id, requirement_key, portal_host);
CREATE INDEX IF NOT EXISTS idx_clara_taught_playbooks_host ON clara_taught_playbooks (owner_user_id, portal_host);
`;

export interface PlaybookRepo {
  upsert(pb: TaughtPlaybook): Promise<void>;
  find(owner: string, requirementKey: string, host: string): Promise<TaughtPlaybook | null>;
  list(owner: string, filter?: { requirementKey?: string; host?: string }): Promise<TaughtPlaybook[]>;
}

export class MemoryPlaybookRepo implements PlaybookRepo {
  rows = new Map<string, TaughtPlaybook>();
  private k(o: string, r: string, h: string) {
    return `${o}|${r}|${h}`;
  }
  async upsert(pb: TaughtPlaybook) {
    this.rows.set(this.k(pb.owner_user_id, pb.requirement_key, pb.portal_host), structuredClone(pb));
  }
  async find(owner: string, requirementKey: string, host: string) {
    const r = this.rows.get(this.k(owner, requirementKey, host));
    return r ? structuredClone(r) : null;
  }
  async list(owner: string, filter: { requirementKey?: string; host?: string } = {}) {
    return [...this.rows.values()]
      .filter((r) => r.owner_user_id === owner)
      .filter((r) => !filter.requirementKey || r.requirement_key === filter.requirementKey)
      .filter((r) => !filter.host || r.portal_host === filter.host)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
      .map((r) => structuredClone(r));
  }
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export class PgPlaybookRepo implements PlaybookRepo {
  constructor(private pool: Queryable) {}
  private ready: Promise<void> | null = null;
  private ensure() {
    if (!this.ready) {
      this.ready = (async () => {
        for (const stmt of CLARA_PLAYBOOKS_SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean)) await this.pool.query(stmt);
      })();
    }
    return this.ready;
  }
  async upsert(pb: TaughtPlaybook) {
    await this.ensure();
    await this.pool.query(
      `INSERT INTO clara_taught_playbooks (id, owner_user_id, requirement_key, portal_host, version, playbook_json, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (owner_user_id, requirement_key, portal_host)
       DO UPDATE SET version = EXCLUDED.version, playbook_json = EXCLUDED.playbook_json, updated_at = EXCLUDED.updated_at`,
      [pb.id, pb.owner_user_id, pb.requirement_key, pb.portal_host, pb.version, JSON.stringify(pb), pb.created_at, pb.updated_at]
    );
  }
  async find(owner: string, requirementKey: string, host: string) {
    await this.ensure();
    const { rows } = await this.pool.query(
      `SELECT playbook_json FROM clara_taught_playbooks WHERE owner_user_id = $1 AND requirement_key = $2 AND portal_host = $3`,
      [owner, requirementKey, host]
    );
    return rows[0] ? (rows[0].playbook_json as TaughtPlaybook) : null;
  }
  async list(owner: string, filter: { requirementKey?: string; host?: string } = {}) {
    await this.ensure();
    const { rows } = await this.pool.query(
      `SELECT playbook_json FROM clara_taught_playbooks WHERE owner_user_id = $1
         AND ($2::text IS NULL OR requirement_key = $2) AND ($3::text IS NULL OR portal_host = $3)
       ORDER BY updated_at DESC LIMIT 100`,
      [owner, filter.requirementKey ?? null, filter.host ?? null]
    );
    return rows.map((r) => r.playbook_json as TaughtPlaybook);
  }
}

/** Saves a description as the owner's playbook for that requirement + portal (new version on update). */
export async function saveTaughtPlaybook(repo: PlaybookRepo, owner: string, input: TaughtPlaybookInput, now = new Date()): Promise<TaughtPlaybook> {
  const norm = normalizePlaybookInput(input);
  const prev = await repo.find(owner, norm.requirement_key, norm.portal_host);
  const ts = now.toISOString();
  const pb: TaughtPlaybook = {
    ...norm,
    // Run-learned bindings survive a re-teach unless the teacher overrode them.
    bindings: prev ? mergeLearnedBindings({ ...prev, bindings: norm.bindings }, prev.bindings.filter((b) => b.source === "run")).bindings : norm.bindings,
    id: prev?.id ?? randomUUID(),
    owner_user_id: owner,
    version: (prev?.version ?? 0) + 1,
    created_at: prev?.created_at ?? ts,
    updated_at: ts,
  };
  await repo.upsert(pb);
  return pb;
}

/**
 * The playbook a run should read: the one taught for this requirement on
 * this portal, else the newest one for the same portal host.
 */
export async function playbookForRun(repo: PlaybookRepo, owner: string, opts: { requirementKeys: string[]; portalUrl: string }): Promise<TaughtPlaybook | null> {
  let host: string;
  try {
    host = portalHostOf(opts.portalUrl);
  } catch {
    return null;
  }
  for (const key of opts.requirementKeys.filter(Boolean)) {
    const hit = await repo.find(owner, key, host);
    if (hit) return hit;
  }
  const sameHost = await repo.list(owner, { host });
  return sameHost[0] ?? null;
}

const globalRepo = globalThis as typeof globalThis & { __smartprPlaybookMemoryRepo?: MemoryPlaybookRepo };

/** Postgres when configured; an in-process store otherwise (dev only). */
export async function playbookRepo(): Promise<PlaybookRepo> {
  const { getPool, isEnabled } = await import("../../../app/graph/db");
  if (isEnabled()) {
    const pool = getPool();
    if (pool) return new PgPlaybookRepo(pool as unknown as Queryable);
  }
  if (!globalRepo.__smartprPlaybookMemoryRepo) globalRepo.__smartprPlaybookMemoryRepo = new MemoryPlaybookRepo();
  return globalRepo.__smartprPlaybookMemoryRepo;
}

/**
 * A run learned something: the person answered a portal field Clara could
 * not fill from the Business Passport. Its label is remembered on the
 * playbook (mapped when a catalog entry clearly names it, else "ask each
 * time") so the next run knows the field exists. Sensitive fields and
 * values are never recorded.
 */
export function learnedBindingsFromRun(
  pending: { id: string; label: string; sensitive: boolean }[],
  suppliedIds: string[]
): { label: string; path: string | null }[] {
  const supplied = new Set(suppliedIds);
  const norm = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  return pending
    .filter((f) => !f.sensitive && supplied.has(f.id) && f.label.trim())
    .map((f) => {
      const l = norm(f.label);
      const hit = PASSPORT_CATALOG.find((e) => e.keywords.some((k) => l === k || l.includes(k)));
      return { label: f.label.trim(), path: hit?.path ?? null };
    });
}

export async function recordRunLearning(
  repo: PlaybookRepo,
  ref: { owner_user_id: string; requirement_key: string; portal_host: string } | null | undefined,
  learned: { label: string; path: string | null }[],
  now = new Date()
): Promise<TaughtPlaybook | null> {
  if (!ref || !learned.length) return null;
  const pb = await repo.find(ref.owner_user_id, ref.requirement_key, ref.portal_host);
  if (!pb) return null;
  const next = { ...mergeLearnedBindings(pb, learned), updated_at: now.toISOString() };
  if (JSON.stringify(next.bindings) === JSON.stringify(pb.bindings)) return pb;
  await repo.upsert(next);
  return next;
}
