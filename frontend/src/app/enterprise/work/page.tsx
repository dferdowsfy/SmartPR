"use client";

// Enterprise work queue — /enterprise/work
// Dense operational table over obligations + obligation_work: filters,
// saved views, bulk assignment, CSV export, and a detail drawer showing the
// Requirement -> Required evidence -> Uploaded versions -> Review decisions
// -> Status -> Readiness impact chain.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface EvidenceSummary {
  evidence_id: string;
  filename: string | null;
  enterprise_state: string;
  version_count: number;
  review_count: number;
  uploaded_by: string | null;
  created_at: string | null;
}

interface RequiredDoc {
  document_title: string | null;
  document_type: string | null;
}

interface WorkItem {
  obligation_id: string;
  obligation_name: string;
  agency: string | null;
  obligation_status: string | null;
  obligation_due_date: string | null;
  mandatory: boolean;
  matter_id: string | null;
  matter_title: string | null;
  matter_readiness_score: number | null;
  business_id: string;
  business_name: string | null;
  municipality: string | null;
  work_status: string;
  owner_user_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  department: string | null;
  reviewer_user_id: string | null;
  reviewer_name: string | null;
  priority: string;
  internal_due_date: string | null;
  effective_due_date: string | null;
  escalation_state: string | null;
  notes: string | null;
  completed_via_exception: boolean;
  domain: string | null;
  facility_name: string | null;
  days_overdue: number;
  required_documents: RequiredDoc[] | null;
  evidence: EvidenceSummary[];
}

interface TeamMember {
  user_id: string;
  name: string | null;
  email: string | null;
  workspace_role: string | null;
}

const VIEWS = [
  { key: "", label: "All" },
  { key: "my_work", label: "My work" },
  { key: "my_reviews", label: "My reviews" },
  { key: "overdue", label: "Overdue" },
  { key: "unassigned", label: "Unassigned" },
  { key: "critical", label: "Critical" },
] as const;

const WORK_STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
  evidence_submitted: "Evidence submitted",
  under_review: "Under review",
  changes_requested: "Changes requested",
  approved: "Approved",
  completed: "Completed",
};

const EVIDENCE_STATE_LABELS: Record<string, string> = {
  draft: "Draft",
  submitted_for_review: "Submitted for review",
  under_review: "Under review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
  superseded: "Superseded",
  expired: "Expired",
};

const PRIORITIES = ["low", "medium", "high", "critical"] as const;

function statusBadge(status: string): string {
  switch (status) {
    case "completed":
    case "approved":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "in_progress":
    case "under_review":
    case "evidence_submitted":
      return "bg-brand/10 text-brand border-brand/30";
    case "blocked":
    case "changes_requested":
    case "rejected":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function priorityBadge(priority: string): string {
  switch (priority) {
    case "critical":
      return "bg-red-600 text-white";
    case "high":
      return "bg-orange-100 text-orange-800 border border-orange-200";
    case "low":
      return "bg-gray-100 text-gray-600 border border-gray-200";
    default:
      return "bg-brand/10 text-brand border border-brand/30";
  }
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : d;
}

interface Filters {
  search: string;
  business: string;
  agency: string;
  department: string;
  domain: string;
  municipality: string;
  work_status: string;
  priority: string;
  owner: string;
  due_from: string;
  due_to: string;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  business: "",
  agency: "",
  department: "",
  domain: "",
  municipality: "",
  work_status: "",
  priority: "",
  owner: "",
  due_from: "",
  due_to: "",
};

// ---------------------------------------------------------------------------
// Detail drawer: Requirement -> Required evidence -> Uploaded versions ->
// Review decisions -> Status -> Readiness impact
// ---------------------------------------------------------------------------

interface VersionRow {
  version_id: string;
  version_number: number;
  storage_path: string | null;
  file_hash: string | null;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  created_at: string | null;
}

interface ReviewRow {
  review_id: string;
  evidence_version_id: string | null;
  version_number: number | null;
  reviewer_user_id: string | null;
  reviewer_name: string | null;
  decision: string;
  reason: string | null;
  previous_state: string | null;
  resulting_state: string | null;
  created_at: string | null;
}

function ChainDrawer({
  item,
  workspaceId,
  onClose,
  onChanged,
}: {
  item: WorkItem;
  workspaceId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [versionsByEvidence, setVersionsByEvidence] = useState<Record<string, { versions: VersionRow[]; reviews: ReviewRow[] }>>({});
  const [expandedEvidence, setExpandedEvidence] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState(item.work_status);
  const [statusNote, setStatusNote] = useState("");
  const [exceptionReason, setExceptionReason] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loadEvidenceDetail = useCallback(
    async (evidenceId: string) => {
      if (versionsByEvidence[evidenceId]) {
        setExpandedEvidence((cur) => (cur === evidenceId ? null : evidenceId));
        return;
      }
      try {
        const res = await fetch(
          `/api/enterprise/evidence/${evidenceId}/versions?workspace_id=${workspaceId}`
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error || "Failed to load versions.");
        setVersionsByEvidence((m) => ({ ...m, [evidenceId]: { versions: data.versions, reviews: data.reviews } }));
        setExpandedEvidence(evidenceId);
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [versionsByEvidence, workspaceId]
  );

  async function postJson(url: string, payload: Record<string, unknown>): Promise<void> {
    setBusy(url);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Request failed.");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function submitStatus() {
    if (newStatus === item.work_status) return;
    const payload: Record<string, unknown> = { work_status: newStatus };
    if (statusNote.trim()) payload.notes = statusNote.trim();
    if (newStatus === "completed" && exceptionReason.trim()) {
      payload.exception_reason = exceptionReason.trim();
    }
    setBusy("status");
    setError(null);
    try {
      const res = await fetch(`/api/enterprise/work/${item.obligation_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Update failed.");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const evidence = item.evidence ?? [];
  const requiredDocs = item.required_documents ?? [];

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Work detail: ${item.obligation_name}`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside className="absolute right-0 top-0 bottom-0 w-full max-w-xl bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Requirement</p>
            <h2 className="text-lg font-semibold text-gray-900">{item.obligation_name}</h2>
            <p className="text-sm text-gray-600">
              {item.business_name}
              {item.municipality ? ` · ${item.municipality}` : ""}
              {item.facility_name ? ` · ${item.facility_name}` : ""}
            </p>
          </div>
          <button
            ref={closeRef}
            onClick={onClose}
            aria-label="Close detail panel"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        <div className="px-5 py-4 space-y-6 text-sm">
          {error && (
            <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">
              {error}
            </div>
          )}

          {/* Status */}
          <section aria-label="Status">
            <h3 className="font-semibold text-gray-900 mb-2">Status</h3>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusBadge(item.work_status)}`}>
                {WORK_STATUS_LABELS[item.work_status] ?? item.work_status}
              </span>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${priorityBadge(item.priority)}`}>
                {item.priority}
              </span>
              {item.completed_via_exception && (
                <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  Completed via audited exception
                </span>
              )}
              {item.days_overdue > 0 && (
                <span className="text-xs font-medium text-red-700">{item.days_overdue} days overdue</span>
              )}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><dt className="text-gray-500 text-xs">Agency</dt><dd className="text-gray-900">{item.agency ?? "—"}</dd></div>
              <div><dt className="text-gray-500 text-xs">Domain</dt><dd className="text-gray-900">{item.domain ?? "—"}</dd></div>
              <div><dt className="text-gray-500 text-xs">Owner</dt><dd className="text-gray-900">{item.owner_name ?? "Unassigned"}</dd></div>
              <div><dt className="text-gray-500 text-xs">Reviewer</dt><dd className="text-gray-900">{item.reviewer_name ?? "—"}</dd></div>
              <div><dt className="text-gray-500 text-xs">Department</dt><dd className="text-gray-900">{item.department ?? "—"}</dd></div>
              <div><dt className="text-gray-500 text-xs">Due (internal target)</dt><dd className="text-gray-900">{fmtDate(item.internal_due_date) ?? "—"}{item.internal_due_date ? <span className="text-xs text-gray-500"> · internal target</span> : ""}</dd></div>
            </dl>
            {item.notes && <p className="mt-2 text-gray-700"><span className="text-xs text-gray-500">Notes: </span>{item.notes}</p>}

            <div className="mt-4 rounded border border-gray-200 p-3 space-y-2">
              <label htmlFor="drawer-status" className="text-xs font-medium text-gray-700">Update work status</label>
              <div className="flex flex-wrap gap-2">
                <select
                  id="drawer-status"
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  className="rounded border border-gray-300 px-2 py-1.5 text-sm"
                >
                  {Object.entries(WORK_STATUS_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <button
                  onClick={submitStatus}
                  disabled={busy === "status" || newStatus === item.work_status}
                  className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {busy === "status" ? "Saving…" : "Save"}
                </button>
              </div>
              <input
                aria-label="Status note"
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
                placeholder="Note (optional)"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
              />
              {newStatus === "completed" && (
                <div>
                  <label htmlFor="drawer-exception" className="text-xs font-medium text-gray-700">
                    Exception reason (required to complete without approved evidence)
                  </label>
                  <textarea
                    id="drawer-exception"
                    value={exceptionReason}
                    onChange={(e) => setExceptionReason(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                    placeholder="Why is this requirement complete without approved evidence?"
                  />
                </div>
              )}
            </div>
          </section>

          {/* Required evidence (from the knowledge graph) */}
          <section aria-label="Required evidence">
            <h3 className="font-semibold text-gray-900 mb-2">Required evidence</h3>
            {requiredDocs.length === 0 ? (
              <p className="text-gray-500 text-sm">No required documents mapped in the knowledge graph for this requirement.</p>
            ) : (
              <ul className="list-disc pl-5 space-y-1">
                {requiredDocs.map((d, i) => (
                  <li key={i} className="text-gray-800">
                    {d.document_title ?? "Document"}
                    {d.document_type ? <span className="text-gray-500 text-xs"> · {d.document_type}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Uploaded evidence + versions + review decisions */}
          <section aria-label="Uploaded evidence">
            <h3 className="font-semibold text-gray-900 mb-2">Uploaded evidence</h3>
            {evidence.length === 0 ? (
              <p className="text-gray-500 text-sm">No evidence uploaded yet.</p>
            ) : (
              <div className="space-y-3">
                {evidence.map((ev) => {
                  const detail = versionsByEvidence[ev.evidence_id];
                  const open = expandedEvidence === ev.evidence_id;
                  return (
                    <div key={ev.evidence_id} className="rounded border border-gray-200 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-gray-900">{ev.filename ?? "Evidence"}</p>
                          <p className="text-xs text-gray-500">
                            {ev.version_count} version{ev.version_count === 1 ? "" : "s"} · {ev.review_count} review{ev.review_count === 1 ? "" : "s"}
                          </p>
                        </div>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadge(ev.enterprise_state)}`}>
                          {EVIDENCE_STATE_LABELS[ev.enterprise_state] ?? ev.enterprise_state}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={() => loadEvidenceDetail(ev.evidence_id)}
                          aria-expanded={open}
                          className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                        >
                          {open ? "Hide versions & decisions" : "Show versions & decisions"}
                        </button>
                        {(ev.enterprise_state === "draft" || ev.enterprise_state === "changes_requested") && (
                          <button
                            onClick={() => postJson(`/api/enterprise/evidence/${ev.evidence_id}/submit`, {})}
                            disabled={busy !== null}
                            className="rounded bg-brand px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                          >
                            Submit for review
                          </button>
                        )}
                      </div>
                      {open && detail && (
                        <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                          <div>
                            <p className="text-xs font-medium text-gray-700 mb-1">Versions</p>
                            {detail.versions.length === 0 ? (
                              <p className="text-xs text-gray-500">No version rows recorded.</p>
                            ) : (
                              <ul className="space-y-1">
                                {detail.versions.map((v) => (
                                  <li key={v.version_id} className="text-xs text-gray-700">
                                    <span className="font-medium">v{v.version_number}</span>
                                    {" · "}{v.uploaded_by_name ?? "unknown uploader"}
                                    {v.created_at ? ` · ${new Date(v.created_at).toLocaleString()}` : ""}
                                    {v.file_hash ? <span className="text-gray-400"> · sha256 {v.file_hash.slice(0, 12)}…</span> : null}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          <div>
                            <p className="text-xs font-medium text-gray-700 mb-1">Review decisions</p>
                            {detail.reviews.length === 0 ? (
                              <p className="text-xs text-gray-500">No review decisions yet.</p>
                            ) : (
                              <ul className="space-y-1">
                                {detail.reviews.map((r) => (
                                  <li key={r.review_id} className="text-xs text-gray-700">
                                    <span className={`inline-flex items-center rounded-full border px-1.5 py-px text-[11px] font-medium ${statusBadge(r.resulting_state ?? "")}`}>
                                      {r.decision.replace(/_/g, " ")}
                                    </span>
                                    {" "}{r.reviewer_name ?? "reviewer"}
                                    {r.version_number ? ` · v${r.version_number}` : ""}
                                    {r.previous_state ? ` · ${r.previous_state} → ${r.resulting_state}` : ""}
                                    {r.reason ? <span className="block text-gray-600">“{r.reason}”</span> : null}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          {(ev.enterprise_state === "submitted_for_review" || ev.enterprise_state === "under_review") && (
                            <div className="rounded bg-gray-50 p-2 space-y-2">
                              <label htmlFor={`review-reason-${ev.evidence_id}`} className="text-xs font-medium text-gray-700">
                                Decision reason (required for request changes / reject)
                              </label>
                              <input
                                id={`review-reason-${ev.evidence_id}`}
                                value={reviewReason}
                                onChange={(e) => setReviewReason(e.target.value)}
                                className="w-full rounded border border-gray-300 px-2 py-1 text-xs"
                                placeholder="Reason for the decision"
                              />
                              <div className="flex flex-wrap gap-2">
                                <button
                                  onClick={() => postJson(`/api/enterprise/evidence/${ev.evidence_id}/review`, { decision: "approve", reason: reviewReason || undefined })}
                                  disabled={busy !== null}
                                  className="rounded bg-emerald-600 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => postJson(`/api/enterprise/evidence/${ev.evidence_id}/review`, { decision: "request_changes", reason: reviewReason })}
                                  disabled={busy !== null}
                                  className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 disabled:opacity-50"
                                >
                                  Request changes
                                </button>
                                <button
                                  onClick={() => postJson(`/api/enterprise/evidence/${ev.evidence_id}/review`, { decision: "reject", reason: reviewReason })}
                                  disabled={busy !== null}
                                  className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-medium text-red-800 disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Readiness impact */}
          <section aria-label="Readiness impact">
            <h3 className="font-semibold text-gray-900 mb-2">Readiness impact</h3>
            {item.matter_id ? (
              <div className="rounded border border-gray-200 p-3">
                <p className="text-sm text-gray-800">
                  Project: <span className="font-medium">{item.matter_title ?? item.matter_id.slice(0, 8)}</span>
                </p>
                <p className="mt-1 text-sm text-gray-700">
                  Matter readiness:{" "}
                  <span className="font-semibold text-brand">
                    {item.matter_readiness_score === null || item.matter_readiness_score === undefined
                      ? "not computed yet"
                      : `${item.matter_readiness_score}%`}
                  </span>
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  Full credit comes only from approved evidence. Submitted or under-review evidence counts as progress, not completion.
                </p>
              </div>
            ) : (
              <p className="text-gray-500 text-sm">This requirement is not linked to a project.</p>
            )}
          </section>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk assign drawer
// ---------------------------------------------------------------------------

function AssignDrawer({
  selectedIds,
  team,
  workspaceId,
  onClose,
  onAssigned,
}: {
  selectedIds: string[];
  team: TeamMember[];
  workspaceId: string;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [owner, setOwner] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [department, setDepartment] = useState("");
  const [priority, setPriority] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { workspace_id: workspaceId, obligation_ids: selectedIds };
      if (owner) payload.owner_user_id = owner;
      if (reviewer) payload.reviewer_user_id = reviewer;
      if (department.trim()) payload.department = department.trim();
      if (priority) payload.priority = priority;
      if (dueDate) payload.internal_due_date = dueDate;
      const res = await fetch("/api/enterprise/work/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Assignment failed.");
      onAssigned();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Bulk assign work">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <aside className="absolute right-0 top-0 bottom-0 w-full max-w-md bg-white shadow-xl overflow-y-auto">
        <div className="border-b border-gray-200 px-5 py-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Assign work</h2>
            <p className="text-sm text-gray-600">{selectedIds.length} requirement{selectedIds.length === 1 ? "" : "s"} selected</p>
          </div>
          <button onClick={onClose} aria-label="Close assign panel" className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
            Close
          </button>
        </div>
        <div className="px-5 py-4 space-y-4 text-sm">
          {error && <div role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-red-800">{error}</div>}
          <div>
            <label htmlFor="assign-owner" className="block text-xs font-medium text-gray-700 mb-1">Owner</label>
            <select id="assign-owner" value={owner} onChange={(e) => setOwner(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5">
              <option value="">No change</option>
              {team.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="assign-reviewer" className="block text-xs font-medium text-gray-700 mb-1">Reviewer</label>
            <select id="assign-reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5">
              <option value="">No change</option>
              {team.map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? m.user_id.slice(0, 8)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="assign-department" className="block text-xs font-medium text-gray-700 mb-1">Department</label>
            <input id="assign-department" value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Compliance" className="w-full rounded border border-gray-300 px-2 py-1.5" />
          </div>
          <div>
            <label htmlFor="assign-priority" className="block text-xs font-medium text-gray-700 mb-1">Priority</label>
            <select id="assign-priority" value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5">
              <option value="">No change</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="assign-due" className="block text-xs font-medium text-gray-700 mb-1">
              Internal due date <span className="font-normal text-gray-500">(internal target)</span>
            </label>
            <input id="assign-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded border border-gray-300 px-2 py-1.5" />
          </div>
          <button
            onClick={submit}
            disabled={busy}
            className="w-full rounded bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Assigning…" : `Assign ${selectedIds.length} requirement${selectedIds.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function EnterpriseWorkPage() {
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  const [view, setView] = useState<string>("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [items, setItems] = useState<WorkItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [sort, setSort] = useState("due_date");
  const [order, setOrder] = useState("asc");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerItem, setDrawerItem] = useState<WorkItem | null>(null);
  const [drawerTick, setDrawerTick] = useState(0);
  const [assignOpen, setAssignOpen] = useState(false);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [businesses, setBusinesses] = useState<Array<{ id: string; name: string }>>([]);
  const [exporting, setExporting] = useState(false);

  // Resolve workspace from /api/me (default workspace), mirroring other pages.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/me");
        const data = await res.json();
        const ws = data?.user?.workspace_id as string | undefined;
        if (!ws) {
          setBootError("No workspace found for this account.");
          setLoading(false);
          return;
        }
        setWorkspaceId(ws);
      } catch (e) {
        setBootError("Could not load your workspace. Please sign in and retry.");
        setLoading(false);
      }
    })();
  }, []);

  const buildParams = useCallback(
    (extra?: Record<string, string>) => {
      const p = new URLSearchParams();
      if (workspaceId) p.set("workspace_id", workspaceId);
      if (view) p.set("view", view);
      for (const [k, v] of Object.entries(filters)) {
        if (v) p.set(k, v);
      }
      p.set("sort", sort);
      p.set("order", order);
      p.set("page", String(page));
      p.set("limit", String(limit));
      if (extra) for (const [k, v] of Object.entries(extra)) p.set(k, v);
      return p;
    },
    [workspaceId, view, filters, sort, order, page, limit]
  );

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const res = await fetch(`/api/enterprise/work?${buildParams()}`);
      const data = await res.json();
      if (res.status === 403) {
        setForbidden(true);
        setItems([]);
        return;
      }
      if (!res.ok) throw new Error(data.message || data.error || "Failed to load work queue.");
      setItems(data.items ?? []);
      setTotal(data.total ?? 0);
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, buildParams]);

  useEffect(() => {
    load();
  }, [load]);

  // Team + businesses for filter/assign pickers.
  useEffect(() => {
    if (!workspaceId) return;
    (async () => {
      try {
        const [tRes, bRes] = await Promise.all([
          fetch(`/api/enterprise/team?workspace_id=${workspaceId}`),
          fetch(`/api/businesses`),
        ]);
        if (tRes.ok) {
          const t = await tRes.json();
          setTeam(t.members ?? []);
        }
        if (bRes.ok) {
          const b = await bRes.json();
          setBusinesses((b.businesses ?? []).map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
        }
      } catch {
        // Pickers stay empty; filters still work as text.
      }
    })();
  }, [workspaceId]);

  // Keep the open drawer in sync after mutations.
  useEffect(() => {
    if (drawerItem && drawerTick > 0) {
      const fresh = items.find((i) => i.obligation_id === drawerItem.obligation_id);
      if (fresh) setDrawerItem(fresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawerTick]);

  const refresh = useCallback(() => {
    setDrawerTick((t) => t + 1);
    load();
  }, [load]);

  function setFilter<K extends keyof Filters>(key: K, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelected((s) => {
      if (s.size === items.length && items.length > 0) return new Set();
      return new Set(items.map((i) => i.obligation_id));
    });
  }

  async function exportCsv() {
    if (!workspaceId) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/enterprise/work?${buildParams({ format: "csv" })}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || data.error || "Export failed.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "work-queue.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const filterCount = useMemo(
    () => Object.values(filters).filter(Boolean).length + (view ? 1 : 0),
    [filters, view]
  );

  if (bootError) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-10">
        <div role="alert" className="rounded border border-red-200 bg-red-50 px-4 py-3 text-red-800">{bootError}</div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Work queue</h1>
          <p className="text-sm text-gray-600">Requirements, owners, evidence review, and readiness — one operational list.</p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              onClick={() => setAssignOpen(true)}
              className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white"
            >
              Assign ({selected.size})
            </button>
          )}
          <button
            onClick={exportCsv}
            disabled={exporting || loading}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>

      {/* Saved views */}
      <nav aria-label="Saved views" className="mt-4 flex flex-wrap gap-1 border-b border-gray-200">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            onClick={() => { setView(v.key); setPage(1); }}
            aria-pressed={view === v.key}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
              view === v.key
                ? "border-brand text-brand"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            {v.label}
          </button>
        ))}
      </nav>

      {/* Filter bar */}
      <div className="mt-4 rounded border border-gray-200 bg-gray-50 p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <label className="col-span-2">
            <span className="sr-only">Search requirements</span>
            <input
              value={filters.search}
              onChange={(e) => setFilter("search", e.target.value)}
              placeholder="Search requirement or business…"
              aria-label="Search requirements"
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
            />
          </label>
          <label>
            <span className="sr-only">Business</span>
            <select value={filters.business} onChange={(e) => setFilter("business", e.target.value)} aria-label="Business" className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm">
              <option value="">All businesses</option>
              {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Work status</span>
            <select value={filters.work_status} onChange={(e) => setFilter("work_status", e.target.value)} aria-label="Work status" className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm">
              <option value="">All statuses</option>
              {Object.entries(WORK_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Priority</span>
            <select value={filters.priority} onChange={(e) => setFilter("priority", e.target.value)} aria-label="Priority" className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm">
              <option value="">All priorities</option>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Owner</span>
            <select value={filters.owner} onChange={(e) => setFilter("owner", e.target.value)} aria-label="Owner" className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm">
              <option value="">All owners</option>
              {team.map((m) => <option key={m.user_id} value={m.user_id}>{m.name ?? m.email ?? "member"}</option>)}
            </select>
          </label>
          <label>
            <span className="sr-only">Agency</span>
            <input value={filters.agency} onChange={(e) => setFilter("agency", e.target.value)} placeholder="Agency" aria-label="Agency" className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm" />
          </label>
          <label>
            <span className="sr-only">Department</span>
            <input value={filters.department} onChange={(e) => setFilter("department", e.target.value)} placeholder="Department" aria-label="Department" className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm" />
          </label>
          <label>
            <span className="sr-only">Domain</span>
            <input value={filters.domain} onChange={(e) => setFilter("domain", e.target.value)} placeholder="Domain" aria-label="Domain" className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm" />
          </label>
          <label>
            <span className="sr-only">Municipality</span>
            <input value={filters.municipality} onChange={(e) => setFilter("municipality", e.target.value)} placeholder="Municipality" aria-label="Municipality" className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm" />
          </label>
          <label>
            <span className="sr-only">Due from</span>
            <input type="date" value={filters.due_from} onChange={(e) => setFilter("due_from", e.target.value)} aria-label="Due from" className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm" />
          </label>
          <label>
            <span className="sr-only">Due to</span>
            <input type="date" value={filters.due_to} onChange={(e) => setFilter("due_to", e.target.value)} aria-label="Due to" className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm" />
          </label>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-600">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by" className="ml-1 rounded border border-gray-300 bg-white px-1.5 py-1 text-xs">
              <option value="due_date">Due date</option>
              <option value="priority">Priority</option>
              <option value="name">Requirement</option>
              <option value="business_name">Business</option>
              <option value="work_status">Status</option>
              <option value="agency">Agency</option>
              <option value="updated">Recently updated</option>
            </select>
          </label>
          <button onClick={() => setOrder((o) => (o === "asc" ? "desc" : "asc"))} aria-label={`Sort ${order === "asc" ? "descending" : "ascending"}`} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-gray-700">
            {order === "asc" ? "↑" : "↓"}
          </button>
          {filterCount > 0 && (
            <button
              onClick={() => { setFilters(EMPTY_FILTERS); setView(""); setPage(1); }}
              className="text-xs text-brand underline"
            >
              Clear all filters ({filterCount})
            </button>
          )}
          <span className="ml-auto text-xs text-gray-500" aria-live="polite">
            {loading ? "Loading…" : `${total} result${total === 1 ? "" : "s"}`}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={items.length > 0 && selected.size === items.length}
                  onChange={toggleSelectAll}
                  className="h-4 w-4"
                />
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-gray-700">Requirement</th>
              <th scope="col" className="hidden md:table-cell px-3 py-2 text-left font-medium text-gray-700">Business</th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-gray-700">Status</th>
              <th scope="col" className="hidden lg:table-cell px-3 py-2 text-left font-medium text-gray-700">Owner</th>
              <th scope="col" className="px-3 py-2 text-left font-medium text-gray-700">Due</th>
              <th scope="col" className="hidden sm:table-cell px-3 py-2 text-left font-medium text-gray-700">Priority</th>
              <th scope="col" className="hidden lg:table-cell px-3 py-2 text-left font-medium text-gray-700">Evidence</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {items.map((item) => (
              <tr
                key={item.obligation_id}
                tabIndex={0}
                onClick={() => setDrawerItem(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setDrawerItem(item);
                  }
                }}
                aria-label={`Open detail for ${item.obligation_name}`}
                className="cursor-pointer hover:bg-brand/5 focus:outline-none focus:bg-brand/10"
              >
                <td className="px-3 py-2" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${item.obligation_name}`}
                    checked={selected.has(item.obligation_id)}
                    onChange={() => toggleSelect(item.obligation_id)}
                    className="h-4 w-4"
                  />
                </td>
                <td className="px-3 py-2">
                  <p className="font-medium text-gray-900">{item.obligation_name}</p>
                  <p className="text-xs text-gray-500">
                    {item.agency ?? "—"}
                    {item.domain ? ` · ${item.domain}` : ""}
                    {item.mandatory ? "" : " · optional"}
                  </p>
                </td>
                <td className="hidden md:table-cell px-3 py-2 text-gray-700">
                  {item.business_name}
                  {item.municipality ? <span className="block text-xs text-gray-500">{item.municipality}</span> : null}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadge(item.work_status)}`}>
                    {WORK_STATUS_LABELS[item.work_status] ?? item.work_status}
                  </span>
                  {item.days_overdue > 0 && (
                    <span className="block text-xs font-medium text-red-700">{item.days_overdue}d overdue</span>
                  )}
                </td>
                <td className="hidden lg:table-cell px-3 py-2 text-gray-700">{item.owner_name ?? <span className="text-gray-400">Unassigned</span>}</td>
                <td className="px-3 py-2 text-gray-700 whitespace-nowrap">
                  {fmtDate(item.effective_due_date)}
                  {item.internal_due_date && <span className="block text-[11px] text-gray-500">internal target</span>}
                </td>
                <td className="hidden sm:table-cell px-3 py-2">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${priorityBadge(item.priority)}`}>{item.priority}</span>
                </td>
                <td className="hidden lg:table-cell px-3 py-2 text-xs text-gray-600">
                  {item.evidence.length === 0 ? (
                    <span className="text-gray-400">none</span>
                  ) : (
                    item.evidence.map((ev) => (
                      <span key={ev.evidence_id} className={`mr-1 inline-flex items-center rounded-full border px-1.5 py-px ${statusBadge(ev.enterprise_state)}`}>
                        {EVIDENCE_STATE_LABELS[ev.enterprise_state] ?? ev.enterprise_state}
                      </span>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {loading && (
          <div className="bg-white px-4 py-10 text-center text-sm text-gray-500" aria-live="polite">
            Loading work queue…
          </div>
        )}
        {!loading && forbidden && (
          <div className="bg-white px-4 py-10 text-center" role="alert">
            <p className="text-sm font-medium text-gray-900">You don’t have access to the work queue.</p>
            <p className="mt-1 text-sm text-gray-600">Ask your workspace administrator for the viewer role or higher.</p>
          </div>
        )}
        {!loading && !forbidden && error && (
          <div className="bg-white px-4 py-10 text-center" role="alert">
            <p className="text-sm text-red-700">{error}</p>
            <button onClick={load} className="mt-2 rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
              Retry
            </button>
          </div>
        )}
        {!loading && !forbidden && !error && items.length === 0 && (
          <div className="bg-white px-4 py-10 text-center">
            <p className="text-sm font-medium text-gray-900">No requirements match these filters.</p>
            <p className="mt-1 text-sm text-gray-600">Try clearing filters or choosing a different saved view.</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm">
          <span className="text-gray-600">Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
              className="rounded border border-gray-300 px-3 py-1.5 text-gray-700 disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              aria-label="Next page"
              className="rounded border border-gray-300 px-3 py-1.5 text-gray-700 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {drawerItem && workspaceId && (
        <ChainDrawer
          key={drawerItem.obligation_id}
          item={drawerItem}
          workspaceId={workspaceId}
          onClose={() => setDrawerItem(null)}
          onChanged={refresh}
        />
      )}
      {assignOpen && workspaceId && (
        <AssignDrawer
          selectedIds={[...selected]}
          team={team}
          workspaceId={workspaceId}
          onClose={() => setAssignOpen(false)}
          onAssigned={refresh}
        />
      )}
    </main>
  );
}
