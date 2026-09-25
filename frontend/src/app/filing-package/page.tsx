"use client";

// ============================================================================
// Filing package.
//
// One intake sentence plus the answers SmartPR still needs, turned into the
// list of government artifacts that apply — each with how much of it is already
// populated from the shared business profile, and what it still needs.
//
// Copy on this page comes from the engine's status vocabulary: SmartPR never
// tells a user a filing was approved, granted or accepted.
// ============================================================================

import { useCallback, useMemo, useState } from "react";
import type { FilingPackage, FilingPackageItem } from "../forms/artifacts/filingPackage";
import type { OutstandingQuestion } from "../forms/artifacts/intakeExtraction";
import { STATUS_COPY } from "../forms/artifacts/statusVocabulary";
import type { CanonicalApplicationData, EntityType } from "../forms/engine/types";

const DEFAULT_DESCRIPTION = "I want to open a restaurant in Bayamón with 10 employees and outdoor seating.";

interface Answers {
  legalName: string;
  tradeName: string;
  entityType: EntityType;
  hasEin: boolean;
  ein: string;
  addressLine1: string;
  postalCode: string;
  ownerName: string;
  ownerTitle: string;
  ownerEmail: string;
  phone: string;
  startDate: string;
  estimatedPayroll: string;
  alcoholSales: boolean;
  entertainment: boolean;
  signage: boolean;
}

const EMPTY_ANSWERS: Answers = {
  legalName: "",
  tradeName: "",
  entityType: "stock_corporation",
  hasEin: false,
  ein: "",
  addressLine1: "",
  postalCode: "",
  ownerName: "",
  ownerTitle: "",
  ownerEmail: "",
  phone: "",
  startDate: "",
  estimatedPayroll: "",
  alcoholSales: false,
  entertainment: false,
  signage: false,
};

interface PackageResponse {
  extraction: {
    business_type?: string;
    municipality?: string;
    employee_count?: number;
    activities: Record<string, boolean>;
  } | null;
  questions: OutstandingQuestion[];
  package: FilingPackage;
}

/** Build the partial canonical profile the API merges onto its empty base. */
function profileFrom(answers: Answers): Partial<CanonicalApplicationData> {
  const address = answers.addressLine1
    ? {
        line1: answers.addressLine1,
        cityOrMunicipality: "",
        stateOrTerritory: "PR",
        postalCode: answers.postalCode,
        country: "US",
      }
    : undefined;
  return {
    business: {
      legalName: answers.legalName,
      tradeName: answers.tradeName || undefined,
      entityType: answers.entityType,
      formationStatus: "not_formed",
      ein: answers.hasEin ? answers.ein : undefined,
      einPending: !answers.hasEin,
      phone: answers.phone || undefined,
      operationsStartDate: answers.startDate || undefined,
    },
    contact: {
      fullName: answers.ownerName || undefined,
      role: answers.ownerTitle || undefined,
      email: answers.ownerEmail || undefined,
      phone: answers.phone || undefined,
    },
    addresses: address ? { operatingAddress: address, principalPhysical: address, mailingSameAsPhysical: true } : {},
    operations: {
      estimatedAnnualPayroll: answers.estimatedPayroll ? Number(answers.estimatedPayroll) : undefined,
    },
    activities: {
      alcoholSales: answers.alcoholSales || undefined,
      entertainment: answers.entertainment || undefined,
      signage: answers.signage || undefined,
    },
  } as Partial<CanonicalApplicationData>;
}

function StatusPill({ item }: { item: FilingPackageItem }) {
  const tone =
    item.status === "information_complete"
      ? "bg-emerald-50 text-emerald-700"
      : item.status === "additional_information_required"
        ? "bg-amber-50 text-amber-800"
        : "bg-slate-100 text-slate-700";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${tone}`}>{STATUS_COPY[item.status].en}</span>;
}

export default function FilingPackagePage() {
  const [description, setDescription] = useState(DEFAULT_DESCRIPTION);
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const [data, setData] = useState<PackageResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Answers>(key: K, value: Answers[K]) => setAnswers((a) => ({ ...a, [key]: value }));

  const build = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/forms/artifacts/filing-package", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description, profile: profileFrom(answers) }),
      });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      setData((await response.json()) as PackageResponse);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [description, answers]);

  const reviewForm = useCallback(
    async (item: FilingPackageItem) => {
      if (!item.formCode) return;
      setError(null);
      const response = await fetch(`/api/forms/artifacts/${item.formCode}/populate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ profile: profileFrom(answers) }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Could not prepare ${item.formCode}`);
        return;
      }
      const blob = await response.blob();
      window.open(URL.createObjectURL(blob), "_blank", "noopener");
    },
    [answers]
  );

  const grouped = useMemo(() => {
    const byAgency = new Map<string, FilingPackageItem[]>();
    for (const item of data?.package.items ?? []) {
      if (!byAgency.has(item.agency)) byAgency.set(item.agency, []);
      byAgency.get(item.agency)!.push(item);
    }
    return [...byAgency.entries()];
  }, [data]);

  return (
    <div className="page-viewport bg-[#f4f1ea]">
      
      <div className="mx-auto max-w-5xl px-5 py-8">
        <h1 className="text-2xl font-bold text-[#161616]">Filing package</h1>
        <p className="mt-1 text-sm text-[#161616]/60">
          SmartPR collects your information once, decides which government artifacts apply, and populates a working copy
          of the real form where one is available. SmartPR does not submit filings and does not issue approvals.
        </p>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
          <label className="text-sm font-semibold text-[#161616]" htmlFor="description">
            Describe the business
          </label>
          <textarea
            id="description"
            className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <Field label="Legal business name" value={answers.legalName} onChange={(v) => set("legalName", v)} />
            <Field label="Trade name" value={answers.tradeName} onChange={(v) => set("tradeName", v)} />
            <label className="text-xs font-semibold text-[#161616]">
              Entity type
              <select
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-normal"
                value={answers.entityType}
                onChange={(e) => set("entityType", e.target.value as EntityType)}
              >
                <option value="stock_corporation">Stock corporation</option>
                <option value="limited_liability_company">Limited liability company</option>
                <option value="sole_proprietorship">Sole proprietorship</option>
                <option value="partnership">Partnership</option>
                <option value="nonprofit_nonstock_corporation">Nonprofit corporation</option>
              </select>
            </label>
            <Field label="Street address" value={answers.addressLine1} onChange={(v) => set("addressLine1", v)} />
            <Field label="Postal code" value={answers.postalCode} onChange={(v) => set("postalCode", v)} />
            <Field label="Business phone" value={answers.phone} onChange={(v) => set("phone", v)} />
            <Field label="Owner / representative" value={answers.ownerName} onChange={(v) => set("ownerName", v)} />
            <Field label="Owner title" value={answers.ownerTitle} onChange={(v) => set("ownerTitle", v)} />
            <Field label="Owner email" value={answers.ownerEmail} onChange={(v) => set("ownerEmail", v)} />
            <Field label="Planned start date" type="date" value={answers.startDate} onChange={(v) => set("startDate", v)} />
            <Field label="Estimated annual payroll" type="number" value={answers.estimatedPayroll} onChange={(v) => set("estimatedPayroll", v)} />
            <Field label="EIN (if issued)" value={answers.ein} onChange={(v) => { set("ein", v); set("hasEin", v.trim().length > 0); }} />
          </div>

          <div className="mt-3 flex flex-wrap gap-4 text-xs text-[#161616]">
            <Toggle label="Alcohol sales" checked={answers.alcoholSales} onChange={(v) => set("alcoholSales", v)} />
            <Toggle label="Entertainment" checked={answers.entertainment} onChange={(v) => set("entertainment", v)} />
            <Toggle label="Commercial signage" checked={answers.signage} onChange={(v) => set("signage", v)} />
          </div>

          <button
            onClick={build}
            disabled={busy}
            className="mt-4 rounded-full bg-[#161616] px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? "Preparing…" : "Build filing package"}
          </button>
          {error && <div className="mt-3 rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</div>}
        </section>

        {data?.extraction && (
          <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-bold text-[#161616]">Read from your description</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {Object.entries({
                business_type: data.extraction.business_type,
                municipality: data.extraction.municipality,
                employee_count: data.extraction.employee_count,
                ...data.extraction.activities,
              })
                .filter(([, value]) => value !== undefined && value !== null)
                .map(([key, value]) => (
                  <span key={key} className="rounded-full bg-slate-100 px-2.5 py-1 text-[#161616]">
                    {key}: <strong>{String(value)}</strong>
                  </span>
                ))}
            </div>
            {data.questions.length > 0 && (
              <div className="mt-3 text-xs text-[#161616]/70">
                Still needed: {data.questions.map((q) => q.label).join(" · ")}
              </div>
            )}
          </section>
        )}

        {grouped.map(([agency, items]) => (
          <section key={agency} className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-bold text-[#161616]">{agency}</div>
            {items.map((item) => (
              <div key={`${item.requirementCode}-${item.formCode ?? ""}`} className="mt-3 border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-[#161616]">
                    {item.title}
                    {item.formCode && <span className="ml-2 text-xs font-normal text-[#161616]/50">{item.formCode}</span>}
                  </div>
                  <StatusPill item={item} />
                </div>
                <div className="mt-1 text-xs text-[#161616]/70">{item.message.en}</div>
                <div className="mt-2 flex flex-wrap gap-4 text-xs">
                  <span className="text-emerald-700">✓ {item.populatedCount} fields populated</span>
                  <span className="text-amber-700">△ {item.unansweredCount} answers required</span>
                  {item.presentableAsOfficial ? (
                    <span className="text-[#161616]/60">Official form</span>
                  ) : (
                    <span className="text-[#161616]/60">Requirements prepared</span>
                  )}
                </div>
                {item.unanswered.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-xs text-[#161616]/60">
                    {item.unanswered.slice(0, 6).map((field) => (
                      <li key={field.pdfField}>{field.label ?? field.pdfField}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex gap-2">
                  {item.canGenerateWorkingCopy && (
                    <button
                      onClick={() => reviewForm(item)}
                      className="rounded-full border border-[#161616] px-4 py-1.5 text-xs font-medium text-[#161616]"
                    >
                      Review form
                    </button>
                  )}
                  {item.portalUrl && (
                    <a
                      href={item.portalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-full border border-slate-300 px-4 py-1.5 text-xs font-medium text-[#161616]"
                    >
                      Open portal
                    </a>
                  )}
                </div>
              </div>
            ))}
          </section>
        ))}

        {data && <p className="mt-4 text-xs text-[#161616]/50">{data.package.disclaimer}</p>}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="text-xs font-semibold text-[#161616]">
      {label}
      <input
        type={type}
        className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-normal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
