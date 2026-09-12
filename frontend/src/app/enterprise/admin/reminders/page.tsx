"use client";
// Enterprise admin: reminder rules, escalation policies, deadline schedules.
// Phase 4. Mutations are permission-gated server-side (assign_requirements,
// approve_evidence for is_verified=true).
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { L } from "../../../i18n";
import { useLang } from "../../../useLang";

const ESCALATION_ACTIONS = [
  "notify_owner",
  "escalate_facility_manager",
  "escalate_compliance_manager",
  "flag_executive",
];
const TRIGGERS = ["overdue", "unassigned", "critical_unreviewed"];

interface Rule {
  id: string;
  obligation_id: string | null;
  obligation_name: string | null;
  offsets_days: number[];
  channels: string[];
  active: boolean;
}
interface Policy {
  id: string;
  trigger: string;
  steps: Array<{ after: string; action: string }>;
  active: boolean;
}
interface Schedule {
  id: string;
  obligation_id: string | null;
  obligation_name: string | null;
  business_name: string | null;
  schedule_type: string;
  due_date: string;
  recurrence_rule: string | null;
  grace_days: number;
  effective_due_date: string | null;
  is_verified: boolean;
  badge: string;
  label: string | null;
  source_note: string | null;
}

function Page() {
  const lang = useLang();
  const searchParams = useSearchParams();
  const [workspaceId, setWorkspaceId] = useState<string | null>(searchParams.get("workspace"));
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [policies, setPolicies] = useState<Policy[] | null>(null);
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testRun, setTestRun] = useState<Record<string, unknown> | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [editing, setEditing] = useState<{ kind: "rule" | "policy" | "schedule"; id: string | null } | null>(null);

  const ws = useMemo(() => `?workspace=${encodeURIComponent(workspaceId ?? "")}`, [workspaceId]);

  useEffect(() => {
    if (workspaceId) return;
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setWorkspaceId(d?.user?.workspace_id ?? null))
      .catch(() => setWorkspaceId(null));
  }, [workspaceId]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setError(null);
    try {
      const [rr, pp, ss] = await Promise.all([
        fetch(`/api/enterprise/reminders/rules${ws}`).then((r) => {
          if (!r.ok) throw new Error(`rules: ${r.status}`);
          return r.json();
        }),
        fetch(`/api/enterprise/reminders/policies${ws}`).then((r) => {
          if (!r.ok) throw new Error(`policies: ${r.status}`);
          return r.json();
        }),
        fetch(`/api/enterprise/reminders/schedules${ws}`).then((r) => {
          if (!r.ok) throw new Error(`schedules: ${r.status}`);
          return r.json();
        }),
      ]);
      setRules(rr.rules);
      setPolicies(pp.policies);
      setSchedules(ss.schedules);
    } catch (e) {
      setError((e as Error).message);
      setRules([]);
      setPolicies([]);
      setSchedules([]);
    }
  }, [workspaceId, ws]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(path: string, method: string, body?: unknown) {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.detail || data?.error || `request failed (${res.status})`);
      }
      setNotice(L("Saved.", lang));
      setEditing(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function runTest() {
    if (!workspaceId) return;
    setTestRunning(true);
    setTestRun(null);
    setError(null);
    try {
      const res = await fetch("/api/enterprise/cron/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `test run failed (${res.status})`);
      setTestRun(data);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTestRunning(false);
    }
  }

  if (!workspaceId) {
    return (
      <main className="p-8">
        <p>{L("Loading…", lang)}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl p-6 md:p-8" aria-labelledby="reminders-title">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 id="reminders-title" className="text-2xl font-bold">
            {L("Reminders & deadlines", lang)}
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {L("Reminder rules, escalation policies and deadline schedules for this organization.", lang)}
          </p>
          <p className="mt-2 max-w-2xl rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {L("An internal target is a planning date, not a verified regulatory deadline.", lang)}
          </p>
        </div>
        <button
          type="button"
          onClick={runTest}
          disabled={testRunning}
          aria-label={L("Test run", lang)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {testRunning ? L("Running…", lang) : `${L("Test run", lang)} — ${L("Run now", lang)}`}
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mb-4 rounded-md bg-green-50 px-4 py-3 text-sm text-green-800">
          {notice}
        </div>
      )}
      {testRun && (
        <div role="status" className="mb-4 rounded-md bg-blue-50 px-4 py-3 text-sm text-blue-900">
          {L("Test run", lang)} ({String(testRun.today)}):{" "}
          {String(testRun.reminders_sent)} {L("reminders sent", lang)},{" "}
          {String(testRun.escalations_fired)} {L("escalations fired", lang)},{" "}
          {String(testRun.skipped_dedupe)} {L("skipped (already sent)", lang)}
          {Array.isArray(testRun.errors) && testRun.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {(testRun.errors as string[]).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Section
        title={L("Reminder rules", lang)}
        onNew={() => setEditing({ kind: "rule", id: null })}
        newLabel={L("New rule", lang)}
      >
        {rules === null ? (
          <p>{L("Loading…", lang)}</p>
        ) : rules.length === 0 ? (
          <p className="text-sm text-slate-500">{L("No reminder rules yet.", lang)}</p>
        ) : (
          <ul className="space-y-2">
            {rules.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-3">
                <div>
                  <div className="text-sm font-medium">
                    {r.obligation_name ?? L("All businesses and obligations", lang)}
                  </div>
                  <div className="text-xs text-slate-500">
                    {r.offsets_days.join(", ")}d · {r.channels.join(", ")} ·{" "}
                    {r.active ? L("Active", lang) : L("Inactive", lang)}
                  </div>
                </div>
                <RowActions
                  lang={lang}
                  active={r.active}
                  onEdit={() => setEditing({ kind: "rule", id: r.id })}
                  onToggle={() => mutate(`/api/enterprise/reminders/rules/${r.id}${ws}`, "PATCH", { active: !r.active })}
                  onDelete={() => mutate(`/api/enterprise/reminders/rules/${r.id}${ws}`, "DELETE")}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={L("Escalation policies", lang)}
        onNew={() => setEditing({ kind: "policy", id: null })}
        newLabel={L("New policy", lang)}
      >
        {policies === null ? (
          <p>{L("Loading…", lang)}</p>
        ) : policies.length === 0 ? (
          <p className="text-sm text-slate-500">{L("No escalation policies yet.", lang)}</p>
        ) : (
          <ul className="space-y-2">
            {policies.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-3">
                <div>
                  <div className="text-sm font-medium">
                    {L("Trigger", lang)}: {p.trigger}
                  </div>
                  <div className="text-xs text-slate-500">
                    {L("Steps", lang)}: {p.steps.map((s) => `${s.after} → ${s.action}`).join(" · ")} ·{" "}
                    {p.active ? L("Active", lang) : L("Inactive", lang)}
                  </div>
                </div>
                <RowActions
                  lang={lang}
                  active={p.active}
                  onEdit={() => setEditing({ kind: "policy", id: p.id })}
                  onToggle={() => mutate(`/api/enterprise/reminders/policies/${p.id}${ws}`, "PATCH", { active: !p.active })}
                  onDelete={() => mutate(`/api/enterprise/reminders/policies/${p.id}${ws}`, "DELETE")}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={L("Deadline schedules", lang)}
        onNew={() => setEditing({ kind: "schedule", id: null })}
        newLabel={L("New deadline", lang)}
      >
        {schedules === null ? (
          <p>{L("Loading…", lang)}</p>
        ) : schedules.length === 0 ? (
          <p className="text-sm text-slate-500">{L("No deadline schedules yet.", lang)}</p>
        ) : (
          <ul className="space-y-2">
            {schedules.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {s.label ?? s.obligation_name ?? s.due_date}
                    <Badge verified={s.is_verified} lang={lang} />
                  </div>
                  <div className="text-xs text-slate-500">
                    {s.schedule_type} · {L("Due", lang)} {s.due_date}
                    {s.grace_days > 0 && ` (${L("grace", lang)} ${s.grace_days}d → ${s.effective_due_date})`}
                    {s.business_name && ` · ${s.business_name}`}
                    {s.is_verified && s.source_note && ` · ${L("Source", lang)}: ${s.source_note}`}
                  </div>
                </div>
                <RowActions
                  lang={lang}
                  active
                  hideToggle
                  onEdit={() => setEditing({ kind: "schedule", id: s.id })}
                  onToggle={() => {}}
                  onDelete={() => mutate(`/api/enterprise/reminders/schedules/${s.id}${ws}`, "DELETE")}
                />
              </li>
            ))}
          </ul>
        )}
      </Section>

      {editing && (
        <Editor
          lang={lang}
          editing={editing}
          rules={rules ?? []}
          policies={policies ?? []}
          schedules={schedules ?? []}
          ws={ws}
          onClose={() => setEditing(null)}
          onSave={(path, method, body) => mutate(path, method, body)}
        />
      )}
    </main>
  );
}

function Badge({ verified, lang }: { verified: boolean; lang: "en" | "es" }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        verified ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-900"
      }`}
      title={
        verified
          ? L("verified deadline", lang)
          : L("An internal target is a planning date, not a verified regulatory deadline.", lang)
      }
    >
      {L(verified ? "verified deadline" : "internal target", lang)}
    </span>
  );
}

function Section({
  title,
  onNew,
  newLabel,
  children,
}: {
  title: string;
  onNew: () => void;
  newLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8" aria-label={title}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onNew}
          className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
        >
          {newLabel}
        </button>
      </div>
      {children}
    </section>
  );
}

function RowActions({
  lang,
  active,
  hideToggle,
  onEdit,
  onToggle,
  onDelete,
}: {
  lang: "en" | "es";
  active: boolean;
  hideToggle?: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex gap-2">
      <button type="button" onClick={onEdit} aria-label={L("Edit", lang)} className="rounded border px-2 py-1 text-xs hover:bg-slate-50">
        {L("Edit", lang)}
      </button>
      {!hideToggle && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={active ? L("Deactivate", lang) : L("Activate", lang)}
          className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
        >
          {active ? L("Deactivate", lang) : L("Activate", lang)}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          if (window.confirm(L("Delete", lang) + "?")) onDelete();
        }}
        aria-label={L("Delete", lang)}
        className="rounded border px-2 py-1 text-xs text-red-700 hover:bg-red-50"
      >
        {L("Delete", lang)}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor modal (rule / policy / schedule forms)
// ---------------------------------------------------------------------------

function Editor({
  lang,
  editing,
  rules,
  policies,
  schedules,
  ws,
  onClose,
  onSave,
}: {
  lang: "en" | "es";
  editing: { kind: "rule" | "policy" | "schedule"; id: string | null };
  rules: Rule[];
  policies: Policy[];
  schedules: Schedule[];
  ws: string;
  onClose: () => void;
  onSave: (path: string, method: string, body: unknown) => void;
}) {
  const existingRule = rules.find((r) => r.id === editing.id);
  const existingPolicy = policies.find((p) => p.id === editing.id);
  const existingSchedule = schedules.find((s) => s.id === editing.id);

  const [offsets, setOffsets] = useState((existingRule?.offsets_days ?? [90, 60, 30, 7, 0]).join(","));
  const [channels, setChannels] = useState<string[]>(existingRule?.channels ?? ["in_app"]);
  const [trigger, setTrigger] = useState(existingPolicy?.trigger ?? "overdue");
  const [steps, setSteps] = useState(
    existingPolicy?.steps ?? [
      { after: "1d", action: "notify_owner" },
      { after: "3d", action: "escalate_facility_manager" },
      { after: "7d", action: "escalate_compliance_manager" },
      { after: "14d", action: "flag_executive" },
    ]
  );
  const [schedType, setSchedType] = useState(existingSchedule?.schedule_type ?? "one_time");
  const [dueDate, setDueDate] = useState(existingSchedule?.due_date ?? "");
  const [grace, setGrace] = useState(String(existingSchedule?.grace_days ?? 0));
  const [label, setLabel] = useState(existingSchedule?.label ?? "");
  const [verified, setVerified] = useState(existingSchedule?.is_verified ?? false);
  const [sourceNote, setSourceNote] = useState(existingSchedule?.source_note ?? "");

  function save() {
    if (editing.kind === "rule") {
      const parsed = offsets
        .split(",")
        .map((x) => parseInt(x.trim(), 10))
        .filter((n) => Number.isInteger(n));
      const path = editing.id ? `/api/enterprise/reminders/rules/${editing.id}${ws}` : `/api/enterprise/reminders/rules${ws}`;
      onSave(path, editing.id ? "PATCH" : "POST", { offsets_days: parsed, channels });
    } else if (editing.kind === "policy") {
      const path = editing.id ? `/api/enterprise/reminders/policies/${editing.id}${ws}` : `/api/enterprise/reminders/policies${ws}`;
      onSave(path, editing.id ? "PATCH" : "POST", { trigger, steps });
    } else {
      const path = editing.id ? `/api/enterprise/reminders/schedules/${editing.id}${ws}` : `/api/enterprise/reminders/schedules${ws}`;
      onSave(path, editing.id ? "PATCH" : "POST", {
        schedule_type: schedType,
        due_date: dueDate,
        grace_days: parseInt(grace || "0", 10),
        label: label || null,
        is_verified: verified,
        source_note: sourceNote || null,
      });
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={L("Edit", lang)}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold">
          {editing.kind === "rule" && L("Reminder rules", lang)}
          {editing.kind === "policy" && L("Escalation policies", lang)}
          {editing.kind === "schedule" && L("Deadline schedules", lang)}
        </h3>

        {editing.kind === "rule" && (
          <>
            <label htmlFor="rule-offsets" className="mb-1 block text-sm font-medium">
              {L("Offsets (days before due)", lang)}
            </label>
            <input
              id="rule-offsets"
              type="text"
              value={offsets}
              onChange={(e) => setOffsets(e.target.value)}
              placeholder="90, 60, 30, 7, 0"
              className="mb-3 w-full rounded border px-3 py-2 text-sm"
            />
            <fieldset className="mb-3">
              <legend className="mb-1 text-sm font-medium">{L("Channels", lang)}</legend>
              {["in_app", "email"].map((c) => (
                <label key={c} className="mr-4 text-sm">
                  <input
                    type="checkbox"
                    checked={channels.includes(c)}
                    onChange={() =>
                      setChannels(channels.includes(c) ? channels.filter((x) => x !== c) : [...channels, c])
                    }
                    className="mr-1"
                  />
                  {c}
                </label>
              ))}
            </fieldset>
          </>
        )}

        {editing.kind === "policy" && (
          <>
            <label htmlFor="policy-trigger" className="mb-1 block text-sm font-medium">
              {L("Trigger", lang)}
            </label>
            <select
              id="policy-trigger"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              className="mb-3 w-full rounded border px-3 py-2 text-sm"
            >
              {TRIGGERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <fieldset>
              <legend className="mb-1 text-sm font-medium">{L("Steps", lang)}</legend>
              {steps.map((s, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <input
                    type="text"
                    value={s.after}
                    aria-label={`Step ${i + 1} after`}
                    onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, after: e.target.value } : x)))}
                    placeholder="1d"
                    className="w-24 rounded border px-2 py-1.5 text-sm"
                  />
                  <select
                    value={s.action}
                    aria-label={`Step ${i + 1} action`}
                    onChange={(e) => setSteps(steps.map((x, j) => (j === i ? { ...x, action: e.target.value } : x)))}
                    className="flex-1 rounded border px-2 py-1.5 text-sm"
                  >
                    {ESCALATION_ACTIONS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove step ${i + 1}`}
                    onClick={() => setSteps(steps.filter((_, j) => j !== i))}
                    className="rounded border px-2 text-sm text-red-700"
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setSteps([...steps, { after: "", action: "notify_owner" }])}
                className="mt-1 rounded border px-3 py-1 text-xs"
              >
                + {L("Steps", lang)}
              </button>
            </fieldset>
          </>
        )}

        {editing.kind === "schedule" && (
          <>
            <label htmlFor="sched-label" className="mb-1 block text-sm font-medium">
              {L("Label", lang)}
            </label>
            <input
              id="sched-label"
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mb-3 w-full rounded border px-3 py-2 text-sm"
            />
            <div className="mb-3 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="sched-type" className="mb-1 block text-sm font-medium">
                  {L("Type", lang)}
                </label>
                <select
                  id="sched-type"
                  value={schedType}
                  onChange={(e) => setSchedType(e.target.value)}
                  className="w-full rounded border px-3 py-2 text-sm"
                >
                  <option value="one_time">one_time</option>
                  <option value="recurring">recurring</option>
                  <option value="expiration">expiration</option>
                </select>
              </div>
              <div>
                <label htmlFor="sched-due" className="mb-1 block text-sm font-medium">
                  {L("Due", lang)}
                </label>
                <input
                  id="sched-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full rounded border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mb-3">
              <label htmlFor="sched-grace" className="mb-1 block text-sm font-medium">
                {L("Grace days", lang)}
              </label>
              <input
                id="sched-grace"
                type="number"
                min={0}
                value={grace}
                onChange={(e) => setGrace(e.target.value)}
                className="w-32 rounded border px-3 py-2 text-sm"
              />
            </div>
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
              {L("verified deadline", lang)}{" "}
              <span className="text-xs text-slate-500">({L("requires compliance manager approval", lang)})</span>
            </label>
            <label htmlFor="sched-source" className="mb-1 block text-sm font-medium">
              {L("Source", lang)} {verified && <span className="text-red-600">*</span>}
            </label>
            <input
              id="sched-source"
              type="text"
              value={sourceNote}
              onChange={(e) => setSourceNote(e.target.value)}
              placeholder="e.g. OGPe portal export 2026-09-12"
              className="mb-3 w-full rounded border px-3 py-2 text-sm"
            />
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-4 py-2 text-sm">
            {L("Cancel", lang)}
          </button>
          <button type="button" onClick={save} className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            {L("Save", lang)}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RemindersAdminPage() {
  return (
    <Suspense fallback={<main className="p-8">Loading…</main>}>
      <Page />
    </Suspense>
  );
}
