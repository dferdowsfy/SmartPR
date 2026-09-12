"use client";

import { useEffect, useState, use as usePromise } from "react";
import Link from "next/link";
import { TopNav, fmtDate, fmtDateTime, statusLabel, ScorePill, NotConnected } from "../ui";
import { KB } from "../../kb";

interface Detail {
  enabled: boolean;
  error?: string;
  summary?: any;
  questions?: { question_id: string; question_text: string; answer: string }[];
  requirements?: { document_name: string; agency: string; mandatory: boolean; source_rule: string | null }[];
  documents?: any[];
  timeline?: { event: string; kind: string; created_at: string }[];
  progression?: { score: number; status: string; created_at: string; seq: number }[];
  insights?: any;
}

const truthy = (a: string) => /^(true|yes|sí|si)$/i.test((a || "").trim());

// Documents a "Yes" answer triggered (from the bundled KB).
function whyItMattered(questionId: string): string[] {
  const docIds = KB.rules
    .filter((r) => r.rule_type === "question_trigger" && r.question_id === questionId)
    .map((r) => r.requires_document_id);
  return [...new Set(docIds)]
    .map((id) => KB.documents.find((d) => d.id === id)?.name)
    .filter(Boolean) as string[];
}

function Card({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-5" style={accent ? { borderTop: `3px solid ${accent}` } : undefined}>
      <div className="font-bold text-[#161616] mb-3">{title}</div>
      {children}
    </div>
  );
}

export default function SubmissionDetailPage({ params }: { params: Promise<{ submissionId: string }> }) {
  const { submissionId } = usePromise(params);
  const [d, setD] = useState<Detail | null>(null);

  useEffect(() => {
    fetch(`/api/history/${submissionId}`)
      .then((r) => r.json())
      .then(setD)
      .catch(() => setD({ enabled: true, error: "fetch_failed" }));
  }, [submissionId]);

  if (!d) return <div className="min-h-screen bg-[#f4f1ea]"><TopNav active="history" /><div className="p-10 text-center text-[#161616]/50">Loading…</div></div>;
  if (!d.enabled) return <div className="min-h-screen bg-[#f4f1ea]"><TopNav active="history" /><NotConnected /></div>;
  if (d.error || !d.summary) return <div className="min-h-screen bg-[#f4f1ea]"><TopNav active="history" /><div className="p-10 text-center text-[#161616]/50">Submission not found.</div></div>;

  const s = d.summary;
  const score = s.readiness_score as number | null;
  const canResume = score == null || score < 100;
  const insights = d.insights || {};

  return (
    <div className="min-h-screen bg-[#f4f1ea]">
      <TopNav active="history" />
      <div className="max-w-6xl mx-auto px-5 py-8">
        <Link href="/history" className="text-sm text-brand font-medium">← Back to History</Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-3">
          {/* Main column */}
          <div className="lg:col-span-2">
            {/* Summary */}
            <Card title="Submission Summary" accent="var(--brand-primary)">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Field label="Municipality" value={s.municipality} />
                <Field label="Business Type" value={s.business_type} />
                <Field label="Business Structure" value={s.business_structure} />
                <Field label="Location Type" value={s.location_type} />
                <Field label="Date Created" value={fmtDate(s.created_at)} />
                <div>
                  <div className="text-xs text-[#161616]/50">Readiness Score</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <ScorePill score={score} />
                    <span className="text-xs text-[#161616]/70">{statusLabel(score, s.readiness_status)}</span>
                  </div>
                </div>
              </div>
              {canResume && (
                <Link href={`/?entry=new-business&resume=${s.id}`} className="inline-block mt-4 bg-[#161616] text-white rounded-full px-5 py-2 text-sm font-medium">
                  Resume Submission →
                </Link>
              )}
            </Card>

            {/* Questions answered — only affirmative responses the user
                actually gave. Older submissions captured every KB question
                (including the default "false" fan-out), so filter on display. */}
            {(() => {
              const answered = (d.questions || []).filter((q) => truthy(q.answer));
              return (
            <Card title="Questions Answered" accent="#f59e0b">
              {answered.length === 0 ? <Empty /> : (
                <div className="divide-y divide-slate-100">
                  {answered.map((q) => {
                    const triggered = truthy(q.answer) ? whyItMattered(q.question_id) : [];
                    return (
                      <div key={q.question_id} className="py-2.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm text-[#161616]">{q.question_text}</span>
                          <span className={`text-xs font-bold rounded px-2 py-0.5 ${truthy(q.answer) ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{q.answer}</span>
                        </div>
                        {triggered.length > 0 && (
                          <div className="text-xs text-[#161616]/60 mt-1">Triggered: {triggered.join(", ")}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
              );
            })()}

            {/* Requirements generated */}
            <Card title="Requirements Generated" accent="#10b981">
              {(d.requirements || []).length === 0 ? <Empty /> : (
                <div className="space-y-2">
                  {d.requirements!.map((r, i) => {
                    const dv = (d.documents || []).find((x) => x.document_type && r.document_name && (x.document_type === r.document_name));
                    return (
                      <div key={i} className="flex items-center justify-between gap-3 border border-slate-100 rounded-lg px-3 py-2">
                        <div>
                          <div className="text-sm font-medium text-[#161616]">{r.document_name}</div>
                          <div className="text-xs text-[#161616]/50">{r.agency} · {r.mandatory ? "Mandatory" : "Recommended"}</div>
                        </div>
                        {dv ? (
                          <div className="text-right">
                            <ValidationBadge result={dv.validation_result} />
                            <div className="text-xs text-[#161616]/50 mt-0.5">{dv.confidence != null ? `${Math.round(dv.confidence)}%` : ""}</div>
                          </div>
                        ) : <span className="text-xs text-[#161616]/40">Not uploaded</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            {/* Document intelligence */}
            <Card title="Document Intelligence" accent="#6366f1">
              {(d.documents || []).length === 0 ? <Empty text="No documents uploaded for this submission." /> : (
                <div className="space-y-4">
                  {d.documents!.map((dv, i) => (
                    <div key={i} className="border border-slate-100 rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="font-medium text-[#161616] text-sm">{dv.document_type}</span>
                        <ValidationBadge result={dv.validation_result} />
                      </div>
                      {Array.isArray(dv.fields_found) && dv.fields_found.length > 0 && (
                        <div className="text-xs mb-1">
                          <span className="font-semibold text-emerald-700">Fields Found: </span>
                          <span className="text-[#161616]/80">{dv.fields_found.join(", ")}</span>
                        </div>
                      )}
                      {dv.extracted_fields && (
                        <div className="text-xs text-[#161616]/70 grid grid-cols-2 gap-x-4 gap-y-0.5 mb-1">
                          {Object.entries(dv.extracted_fields).filter(([, v]) => v).map(([k, v]) => (
                            <div key={k}><span className="text-[#161616]/50">{k}:</span> {String(v)}</div>
                          ))}
                        </div>
                      )}
                      <div className="text-xs">
                        <span className="font-semibold text-red-700">Fields Missing: </span>
                        <span className="text-[#161616]/80">{Array.isArray(dv.fields_missing) && dv.fields_missing.length ? dv.fields_missing.join(", ") : "None"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Readiness timeline */}
            <Card title="Readiness Timeline" accent="#0ea5e9">
              {(d.timeline || []).length === 0 ? <Empty /> : (
                <div className="relative pl-4 border-l-2 border-slate-200 space-y-3">
                  {d.timeline!.map((t, i) => (
                    <div key={i} className="relative">
                      <span className="absolute -left-[21px] top-1 w-3 h-3 rounded-full bg-brand border-2 border-white" />
                      <div className="text-sm text-[#161616]">{t.event}</div>
                      <div className="text-xs text-[#161616]/50">{fmtDateTime(t.created_at)}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1">
            {/* Graph factors */}
            <Card title="Graph Factors">
              <div className="space-y-2 text-sm">
                <Factor label="Business Type" value={s.business_type} />
                <Factor label="Municipality" value={s.municipality} />
                <Factor label="Question Triggers" value={`${(d.questions || []).filter((q) => truthy(q.answer)).length} answered Yes`} />
                <Factor label="Rules Triggered" value={`${new Set((d.requirements || []).map((r) => r.source_rule).filter(Boolean)).size}`} />
                <Factor label="Documents Generated" value={`${(d.requirements || []).length}`} />
                <Factor label="Validation Outcomes" value={`${(d.documents || []).filter((x) => x.pass_fail).length}/${(d.documents || []).length} passed`} />
              </div>
            </Card>

            {/* Intelligence insights */}
            <Card title="Businesses Similar To Yours" accent="#8b5cf6">
              {insights.similarCount > 0 ? (
                <div className="text-sm space-y-3">
                  <div className="text-xs text-[#161616]/60">
                    {s.business_type} · {s.municipality} · {s.business_structure || "—"}<br />
                    Based on <span className="font-semibold text-[#161616]">{insights.similarCount}</span> submissions.
                  </div>
                  {Array.isArray(insights.commonDocuments) && insights.commonDocuments.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-[#161616] mb-1">Most Common Documents</div>
                      <ul className="text-xs text-[#161616]/80 space-y-0.5">
                        {insights.commonDocuments.slice(0, 5).map((c: any) => <li key={c.document}>• {c.document}</li>)}
                      </ul>
                    </div>
                  )}
                  {Array.isArray(insights.commonMissing) && insights.commonMissing.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-[#161616] mb-1">Most Common Missing</div>
                      <ul className="text-xs text-red-700 space-y-0.5">
                        {insights.commonMissing.map((c: any) => <li key={c.field}>• {c.field} ({c.cnt}×)</li>)}
                      </ul>
                    </div>
                  )}
                  {insights.avgReadiness != null && (
                    <div className="pt-1 border-t border-slate-100">
                      <span className="text-xs text-[#161616]/60">Average Readiness: </span>
                      <span className="font-bold" style={{ color: "var(--brand-primary)" }}>{insights.avgReadiness}%</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-[#161616]/50">Not enough similar submissions yet to generate insights.</div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-xs text-[#161616]/50">{label}</div>
      <div className="text-sm font-medium text-[#161616]">{value || "—"}</div>
    </div>
  );
}
function Factor({ label, value }: { label: string; value: any }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-[#161616]/60">{label}</span>
      <span className="text-[#161616] font-medium text-right">{value || "—"}</span>
    </div>
  );
}
function Empty({ text }: { text?: string }) {
  return <div className="text-xs text-[#161616]/40">{text || "No data recorded."}</div>;
}
function ValidationBadge({ result }: { result: string | null }) {
  const map: Record<string, string> = {
    PASS: "bg-emerald-100 text-emerald-700", FAIL: "bg-red-100 text-red-700", NEEDS_REVIEW: "bg-amber-100 text-amber-700",
  };
  const label = result === "PASS" ? "PASS" : result === "FAIL" ? "FAIL" : "REVIEW";
  return <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${map[result || "NEEDS_REVIEW"] || "bg-slate-100 text-slate-600"}`}>{label}</span>;
}
