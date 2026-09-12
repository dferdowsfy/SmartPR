"use client";

import { useCallback, useEffect, useState } from "react";

type Ent = Record<string, string | number | boolean | null | undefined>;

const LIMIT_FIELDS: Array<{ key: string; label: string; hint: string }> = [
  { key: "max_seats", label: "Seat limit", hint: "Blank = plan default. Counts members + pending invites." },
  { key: "max_businesses", label: "Business limit", hint: "Blank = plan default." },
  { key: "max_facilities", label: "Facility limit", hint: "Blank = plan default." },
  { key: "max_projects", label: "Project limit", hint: "Blank = plan default." },
  { key: "data_retention_days", label: "Data retention (days)", hint: "Blank = plan default." },
];

const TOGGLE_FIELDS: Array<{ key: string; label: string }> = [
  { key: "api_access", label: "API access" },
  { key: "sso", label: "SSO" },
  { key: "scim", label: "SCIM provisioning" },
  { key: "white_labeling", label: "White labeling" },
  { key: "custom_domain", label: "Custom domain" },
  { key: "advanced_reporting", label: "Advanced reporting" },
  { key: "regulatory_alerts", label: "Regulatory alerts" },
];

const inputCls =
  "rounded-lg border border-[#161616]/22 bg-[#fbf8f2] px-3 py-2 text-sm placeholder:text-[#5a5a5a]";
const btnPrimary =
  "rounded-lg bg-brand px-4 py-2 text-sm font-medium text-[#f6f3ea] disabled:opacity-50";

function toInput(v: unknown): string {
  return v == null ? "" : String(v);
}

export function CompanyPlanLimitsTab({ workspaceId }: { workspaceId: string }) {
  const [plan, setPlan] = useState("free");
  const [form, setForm] = useState<Ent>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/entitlements`);
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not load entitlements.");
      setPlan(d.plan);
      setForm({ ...(d.entitlements || {}) });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (key: string, v: string | boolean) => setForm((f) => ({ ...f, [key]: v }));

  async function save() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      // Numbers: blank -> null (remove override); storage entered in GB.
      const patch: Ent = { ...form };
      for (const f of LIMIT_FIELDS) {
        const raw = String(patch[f.key] ?? "").trim();
        patch[f.key] = raw === "" ? null : Number(raw);
      }
      const gbRaw = String(patch.storage_limit_gb ?? "").trim();
      patch.storage_limit_bytes = gbRaw === "" ? null : Math.round(Number(gbRaw) * 1024 ** 3);
      delete patch.storage_limit_gb;
      for (const t of TOGGLE_FIELDS) {
        if (typeof patch[t.key] !== "boolean") patch[t.key] = null;
      }
      for (const k of ["contract_start", "contract_renewal", "billing_contact", "smartpr_owner", "support_tier"]) {
        const raw = String(patch[k] ?? "").trim();
        patch[k] = raw === "" ? null : raw;
      }
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/entitlements`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Save failed.");
      setMsg("Contract entitlements saved.");
      setForm({ ...(d.entitlements || {}) });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="py-6 text-sm text-[#5a5a5a]">Loading plan & limits…</p>;

  const storageGb =
    form.storage_limit_bytes != null && form.storage_limit_bytes !== ""
      ? String(Number(form.storage_limit_bytes) / 1024 ** 3)
      : "";

  return (
    <div className="space-y-6">
      {err && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}
      {msg && <p className="rounded-lg bg-green-50 px-4 py-2 text-sm text-green-800">{msg}</p>}

      <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
        <h3 className="font-semibold">Plan</h3>
        <p className="mt-1 text-sm text-[#5a5a5a]">
          Current plan: <span className="font-medium text-[#161616]">{plan}</span> (plan_id enum —
          changed in the existing Plan tab, not here).
        </p>
      </div>

      <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
        <h3 className="font-semibold">Contract</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs text-[#5a5a5a]">Contract start</label>
            <input type="date" className={`${inputCls} mt-1 w-full`} value={toInput(form.contract_start)} onChange={(e) => set("contract_start", e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[#5a5a5a]">Contract renewal</label>
            <input type="date" className={`${inputCls} mt-1 w-full`} value={toInput(form.contract_renewal)} onChange={(e) => set("contract_renewal", e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[#5a5a5a]">Billing contact</label>
            <input className={`${inputCls} mt-1 w-full`} placeholder="finance@company.com" value={toInput(form.billing_contact)} onChange={(e) => set("billing_contact", e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[#5a5a5a]">SmartPR owner</label>
            <input className={`${inputCls} mt-1 w-full`} placeholder="Account owner email" value={toInput(form.smartpr_owner)} onChange={(e) => set("smartpr_owner", e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-[#5a5a5a]">Support tier</label>
            <select className={`${inputCls} mt-1 w-full`} value={toInput(form.support_tier)} onChange={(e) => set("support_tier", e.target.value)}>
              <option value="">Plan default</option>
              {["standard", "priority", "enterprise", "dedicated"].map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
        <h3 className="font-semibold">Limits</h3>
        <p className="mt-1 text-xs text-[#5a5a5a]">
          Contract overrides. Leave blank to fall back to the plan catalog — a blank limit never locks the company out.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LIMIT_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="text-xs text-[#5a5a5a]">{f.label}</label>
              <input
                type="number"
                min={0}
                className={`${inputCls} mt-1 w-full`}
                placeholder="Plan default"
                value={toInput(form[f.key])}
                onChange={(e) => set(f.key, e.target.value)}
              />
              <p className="mt-0.5 text-[11px] text-[#5a5a5a]">{f.hint}</p>
            </div>
          ))}
          <div>
            <label className="text-xs text-[#5a5a5a]">Storage limit (GB)</label>
            <input
              type="number"
              min={0}
              className={`${inputCls} mt-1 w-full`}
              placeholder="Plan default"
              value={form.storage_limit_gb != null ? String(form.storage_limit_gb) : storageGb}
              onChange={(e) => set("storage_limit_gb", e.target.value)}
            />
            <p className="mt-0.5 text-[11px] text-[#5a5a5a]">Stored as bytes in entitlements.</p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#161616]/15 bg-[#fbf8f2] p-5">
        <h3 className="font-semibold">Feature toggles</h3>
        <p className="mt-1 text-xs text-[#5a5a5a]">
          Unchecked = use plan default. Checked on/off overrides the plan for this company.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {TOGGLE_FIELDS.map((t) => {
            const v = form[t.key];
            return (
              <label key={t.key} className="flex items-center gap-2 rounded-lg border border-[#161616]/12 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={v === true}
                  ref={(el) => {
                    if (el) el.indeterminate = v !== true && v !== false;
                  }}
                  onChange={(e) => set(t.key, e.target.checked)}
                />
                <span>
                  {t.label}
                  <span className="ml-1 text-[11px] text-[#5a5a5a]">
                    {v === true ? "(on)" : v === false ? "(off)" : "(plan default)"}
                  </span>
                </span>
                {v !== null && v !== undefined && (
                  <button
                    type="button"
                    className="ml-auto text-[11px] text-[#245c5c] underline"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      set(t.key, null as unknown as string);
                    }}
                  >
                    reset
                  </button>
                )}
              </label>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button className={btnPrimary} onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save entitlements"}
        </button>
        <p className="text-xs text-[#5a5a5a]">
          Enforced server-side: seat limit on enterprise invites, business limit on business creation.
        </p>
      </div>
    </div>
  );
}
