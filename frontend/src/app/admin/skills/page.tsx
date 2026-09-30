"use client";

/**
 * /admin/skills — review and promote taught skills (Teach Clara spec §8).
 * Each item shows its skill card; "Run checks" runs the automated
 * sanitization + replay checks; Approve re-runs them server side and, for a
 * private skill, publishes it to the shared library as the next version
 * attributed to its teacher. Reject keeps it private with notes.
 */
import { useCallback, useEffect, useState } from "react";
import { SkillCardView } from "../../components/skills/SkillCardView";
import type { SkillCard } from "../../../lib/agency-runs/skills/skillCard";
import type { SkillChecks } from "../../../lib/agency-runs/skills/reviewChecks";

interface QueueItem {
  id: string;
  scope: "shared" | "private";
  status: string;
  taught_by: string;
  portal_host: string;
  form: string;
  version: number;
  submitted_at: string | null;
  card: SkillCard;
}

export default function SkillReviewPage() {
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checks, setChecks] = useState<Record<string, SkillChecks>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(
    () =>
      fetch("/api/skills/review", { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) throw new Error(res.status === 403 ? "Only the SmartPR team can review skills." : "Couldn't load the review queue.");
          return (await res.json()).queue as QueueItem[];
        })
        .then(setQueue, (e: Error) => setError(e.message)),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  const runChecks = async (id: string) => {
    setBusy(id);
    const res = await fetch(`/api/skills/${id}/checks`, { method: "POST" });
    if (res.ok) {
      const body = await res.json();
      setChecks((c) => ({ ...c, [id]: body.checks }));
    }
    setBusy(null);
  };

  const decide = async (id: string, decision: "approve" | "reject") => {
    setBusy(id);
    setError(null);
    const res = await fetch(`/api/skills/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision, notes: notes[id] ?? "" }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (body.checks) setChecks((c) => ({ ...c, [id]: body.checks }));
      setError(body.message ?? (body.error === "checks_failed" ? "The automated checks didn't pass." : "That didn't work."));
    }
    setBusy(null);
    await load();
  };

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Skill review</h1>
        <p className="text-sm text-slate-600">
          Skills people taught Clara and sent for review, and SmartPR drafts. Nothing reaches the shared library until the automated checks pass and you approve it.
        </p>
      </header>
      {error && <p role="alert" className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>}
      {queue && queue.length === 0 && <p className="text-sm text-slate-600">Nothing waiting for review.</p>}
      {queue?.map((item) => {
        const c = checks[item.id];
        return (
          <article key={item.id} className="space-y-3 rounded-2xl border border-slate-200 bg-[#161616] p-4 text-[#e8e1d0]">
            <p className="text-xs font-bold uppercase tracking-wider text-[#9a917f]">
              {item.scope === "private" ? `Sent for review · taught by a ${item.taught_by}` : "SmartPR draft"} · {item.portal_host}
            </p>
            <SkillCardView card={item.card} lang="en" />
            {c && (
              <div className={`rounded-xl border p-3 text-sm ${c.ok ? "border-emerald-400/40" : "border-rose-400/40"}`}>
                <p className="font-semibold">{c.ok ? "Automated checks passed" : "Automated checks failed"}</p>
                <p>Sanitization: {c.sanitization.ok ? "clean" : c.sanitization.findings.join("; ")}</p>
                <p>
                  Replay: {c.replay.ok ? "clean" : c.replay.problems.join("; ")} — paused at {c.replay.gatesPaused.join(", ") || "no gates"}; filled {c.replay.filled}/{c.replay.expectedFills}; submit {c.replay.submitClicked ? "CLICKED" : "never clicked"}
                </p>
              </div>
            )}
            <textarea
              value={notes[item.id] ?? ""}
              onChange={(e) => setNotes((n) => ({ ...n, [item.id]: e.target.value }))}
              placeholder="Notes for the teacher (required when rejecting)"
              className="w-full rounded-xl border border-white/15 bg-[#1f1f1f] px-3 py-2 text-sm text-[#f4efe2]"
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy === item.id} onClick={() => runChecks(item.id)} className="rounded-full border border-white/20 px-3 py-1.5 text-sm font-semibold">Run checks</button>
              <button type="button" disabled={busy === item.id} onClick={() => decide(item.id, "approve")} className="rounded-full bg-[#fbf8f2] px-3 py-1.5 text-sm font-semibold text-[#161616]">
                Approve{item.scope === "private" ? " into the shared library" : ""}
              </button>
              <button type="button" disabled={busy === item.id || !(notes[item.id] ?? "").trim()} onClick={() => decide(item.id, "reject")} className="rounded-full border border-rose-300/60 px-3 py-1.5 text-sm font-semibold text-rose-200 disabled:opacity-50">
                Reject
              </button>
            </div>
          </article>
        );
      })}
    </main>
  );
}
