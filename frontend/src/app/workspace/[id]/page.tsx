"use client";

import { useEffect, useState } from "react";
import { L, type Lang } from "../../i18n";

type ApprovedDoc = { name: string; type: string; status: string; req?: string };
type Requirement = { name: string; agency: string; status: string; mandatory: boolean };
type Finding = {
  severity: string;
  title: string;
  description?: string;
  recommended_action?: string;
};
type Payload = {
  v: number;
  lang?: Lang;
  name: string;
  municipality: string;
  industry: string;
  businessType: string;
  score: number | null;
  completed: number;
  total: number;
  approved: ApprovedDoc[];
  requirements: Requirement[];
  findings: Finding[];
  notices?: string[];
  generatedAt: string;
};

function decodePayload(encoded: string): Payload | null {
  try {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json) as Payload;
  } catch {
    return null;
  }
}

const isApproved = (status: string) =>
  status === "Complete" || status === "Verified" || status === "passed";

export default function WorkspacePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loaded, setLoaded] = useState(false);
  // The shareable workspace renders in whatever language the user picks here.
  // Initial value comes from the payload (whatever language the user was in
  // when they generated the link); the toggle below lets the viewer switch.
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    // Data is carried in the URL hash (#d=...) so the link is self-contained.
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const match = hash.match(/d=([^&]+)/);
    if (match) {
      const decoded = decodePayload(match[1]);
      if (decoded) {
        setData(decoded);
        if (decoded.lang) setLang(decoded.lang);
        setLoaded(true);
        return;
      }
    }
    // Fallback: same-browser localStorage copy keyed by the workspace id.
    try {
      const id = window.location.pathname.split("/").pop() || "";
      const raw = localStorage.getItem(`smartpr-workspace-${id}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Payload;
        setData(parsed);
        if (parsed.lang) setLang(parsed.lang);
      }
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  const t = (s: string) => L(s, lang);

  if (!loaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f4f1ea] text-[#161616]/60">
        {t("Loading workspace…")}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f4f1ea] px-6 text-center">
        <div className="text-2xl font-semibold text-[#161616] mb-2">{t("Workspace not found")}</div>
        <p className="text-[#161616]/60 max-w-md">
          {t("This workspace link is missing its data. Re-open the workspace from the SmartPR deliverables screen to generate a fresh shareable link.")}
        </p>
        <a href="/" className="mt-6 px-5 py-2.5 rounded-full bg-[#161616] text-white text-sm">
          {t("Go to SmartPR")}
        </a>
      </div>
    );
  }

  const ready = data.total > 0 && data.completed === data.total;
  const approvedDocs = data.approved.filter((d) => isApproved(d.status));
  const otherDocs = data.approved.filter((d) => !isApproved(d.status));

  return (
    <div className="min-h-screen bg-[#f4f1ea] font-sans text-[#161616]">
      {/* Header band */}
      <header className="bg-[#161616] text-white">
        <div className="max-w-4xl mx-auto px-6 py-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="font-bold tracking-wide text-lg">SMARTPR</div>
            <div className="text-xs uppercase tracking-widest text-white/70 hidden sm:block truncate">
              {t("PUERTO RICO BUSINESS LICENSING READINESS")}
            </div>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-xs text-white/70 hidden sm:block">{t("Readiness Workspace")}</div>
            {/* Language toggle — viewers can read the workspace in EN or ES
                regardless of which language the link was originally generated in. */}
            <div
              role="group"
              aria-label="Language"
              className="flex items-center gap-0.5 bg-white/10 border border-white/15 rounded-lg p-0.5"
            >
              <button
                onClick={() => setLang("en")}
                className={`text-[11px] font-semibold px-2 py-1 rounded-md transition-colors ${lang === "en" ? "bg-white text-[#161616]" : "text-white/70 hover:text-white"}`}
                aria-pressed={lang === "en"}
              >
                EN
              </button>
              <button
                onClick={() => setLang("es")}
                className={`text-[11px] font-semibold px-2 py-1 rounded-md transition-colors ${lang === "es" ? "bg-white text-[#161616]" : "text-white/70 hover:text-white"}`}
                aria-pressed={lang === "es"}
              >
                ES
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Title + business meta */}
        <h1 className="text-3xl font-semibold tracking-tight mb-1">{data.name}</h1>
        <div className="text-sm text-[#161616]/70 mb-6">
          {[data.businessType, data.industry, data.municipality].filter(Boolean).join(" · ")}
        </div>

        {/* Status banner */}
        <div
          className={`rounded-xl px-5 py-4 mb-8 text-white flex flex-wrap items-center gap-x-6 gap-y-1 ${
            ready ? "bg-brand" : "bg-amber-600"
          }`}
        >
          <div className="font-semibold">{ready ? t("READY FOR SUBMISSION") : t("NEEDS REVIEW")}</div>
          <div className="text-sm">{t("Readiness")} {data.score ?? "N/A"}%</div>
          <div className="text-sm">
            {data.completed} {t("of")} {data.total} {t("required documents validated")}
          </div>
        </div>

        {/* Approved deliverables */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#161616]/60 border-b pb-2 mb-4">
            {t("Approved Deliverables")}
          </h2>
          {approvedDocs.length === 0 ? (
            <p className="text-sm text-[#161616]/60">
              {t("No deliverables have been approved by the AI yet.")}
            </p>
          ) : (
            <div className="space-y-3">
              {approvedDocs.map((d, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 bg-white border border-emerald-200 rounded-xl px-4 py-3"
                >
                  <div className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-sm flex-shrink-0">
                    ✓
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{d.name}</div>
                    <div className="text-xs text-[#161616]/60">
                      {d.type} · {t(d.status)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Other uploaded docs needing review */}
        {otherDocs.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#161616]/60 border-b pb-2 mb-4">
              {t("Uploaded — Needs Review")}
            </h2>
            <div className="space-y-3">
              {otherDocs.map((d, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 bg-white border border-amber-200 rounded-xl px-4 py-3"
                >
                  <div className="w-6 h-6 rounded-full bg-amber-500 text-white flex items-center justify-center text-xs flex-shrink-0">
                    !
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{d.name}</div>
                    <div className="text-xs text-[#161616]/60">
                      {d.type} · {t(d.status)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Municipal notices */}
        {data.notices && data.notices.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#161616]/60 border-b pb-2 mb-4">
              {t("Municipal Notices")}
            </h2>
            <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3 text-sm text-sky-900 space-y-1">
              {data.notices.map((n, i) => (
                <div key={i}>• {t(n)}</div>
              ))}
            </div>
          </section>
        )}

        {/* Full requirements checklist */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#161616]/60 border-b pb-2 mb-4">
            {t("Requirements Checklist")}
          </h2>
          <div className="bg-white border rounded-xl divide-y">
            {data.requirements.map((r, i) => {
              const done = r.status === "passed" || r.status === "uploaded";
              return (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span
                    className={`w-4 h-4 rounded-sm flex items-center justify-center text-[10px] text-white flex-shrink-0 ${
                      done ? "bg-emerald-500" : "bg-slate-300"
                    }`}
                  >
                    {done ? "✓" : ""}
                  </span>
                  <span className="flex-1">{t(r.name)}</span>
                  <span className="text-xs text-[#161616]/50">{t(r.agency)}</span>
                </div>
              );
            })}
          </div>
        </section>

        {/* Findings */}
        {data.findings.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#161616]/60 border-b pb-2 mb-4">
              {t("Findings & Recommendations")}
            </h2>
            <div className="space-y-3">
              {data.findings.map((f, i) => (
                <div key={i} className="bg-white border rounded-xl px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#161616]/50">
                    {f.severity}
                  </div>
                  <div className="font-medium">{t(f.title)}</div>
                  {f.description && (
                    <div className="text-sm text-[#161616]/70 mt-0.5">{t(f.description)}</div>
                  )}
                  {f.recommended_action && (
                    <div className="text-sm text-brand mt-1">→ {t(f.recommended_action)}</div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Disclaimer */}
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-xs text-red-900">
          {t(
            "SmartPR determines READINESS for submission to Puerto Rico government agencies. It does NOT approve, grant, or issue any license or permit. All approvals are made exclusively by the Government of Puerto Rico and its agencies. This workspace is for preparation and organization only."
          )}
        </div>

        <div className="text-[11px] text-[#161616]/40 mt-4">
          {t("Generated")} {new Date(data.generatedAt).toLocaleString()} · SmartPR · {t("Powered by AI")}
        </div>
      </main>
    </div>
  );
}
