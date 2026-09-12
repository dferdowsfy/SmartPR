"use client";

// ============================================================================
// GovernmentFormRenderer — the ONE reusable renderer for every government form.
//
// There is intentionally no StockCorporationForm / NonprofitForm / etc. All six
// CORPREG variants (and any future schema) are rendered by this component from
// their `DigitalFormDefinition`. It supports every field type in Part 3:
// text, textarea, number, currency, email, phone, date, structured address,
// select, radio, checkbox, single-choice category grid, repeatable person/org
// records, file attachment, attestation, signature placeholder, conditional
// visibility / required, validation, bilingual labels/help, read-only statutory
// text, and section headings.
// ============================================================================

import React from "react";
import { evaluateConditions } from "./formConditions.ts";
import { validateForm, type FieldError } from "./formValidation.ts";
import type {
  CanonicalAddress,
  CanonicalApplicationData,
  DigitalFormDefinition,
  FormData,
  FormField,
  Lang,
  PartyRecord,
  RepeatableSubField,
} from "./types.ts";
import { localize } from "./types.ts";

export interface GovernmentFormRendererProps {
  definition: DigitalFormDefinition;
  formData: FormData;
  canonical: CanonicalApplicationData;
  lang: Lang;
  errors?: FieldError[];
  readOnly?: boolean;
  onChange: (fieldId: string, value: unknown) => void;
}

const EMPTY_ADDRESS: CanonicalAddress = {
  line1: "",
  cityOrMunicipality: "",
  postalCode: "",
  country: "Puerto Rico",
};

// --- Structured address ----------------------------------------------------

function AddressInput({
  value,
  lang,
  readOnly,
  onChange,
}: {
  value: CanonicalAddress | undefined;
  lang: Lang;
  readOnly?: boolean;
  onChange: (addr: CanonicalAddress) => void;
}) {
  const addr = value ?? EMPTY_ADDRESS;
  const set = (patch: Partial<CanonicalAddress>) => onChange({ ...addr, ...patch });
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  const cell: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 2 };
  const input: React.CSSProperties = { padding: "8px 10px", border: "1px solid var(--border, #cbd5e1)", borderRadius: 6, fontSize: 14 };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
      <label style={{ ...cell, gridColumn: "1 / -1" }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{L("Address line 1", "Dirección línea 1")}</span>
        <input style={input} disabled={readOnly} value={addr.line1} onChange={(e) => set({ line1: e.target.value })} />
      </label>
      <label style={{ ...cell, gridColumn: "1 / -1" }}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{L("Address line 2", "Dirección línea 2")}</span>
        <input style={input} disabled={readOnly} value={addr.line2 ?? ""} onChange={(e) => set({ line2: e.target.value })} />
      </label>
      <label style={cell}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{L("City / Municipality", "Ciudad / Municipio")}</span>
        <input style={input} disabled={readOnly} value={addr.cityOrMunicipality} onChange={(e) => set({ cityOrMunicipality: e.target.value })} />
      </label>
      <label style={cell}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{L("State / Territory", "Estado / Territorio")}</span>
        <input style={input} disabled={readOnly} value={addr.stateOrTerritory ?? ""} onChange={(e) => set({ stateOrTerritory: e.target.value })} placeholder="PR" />
      </label>
      <label style={cell}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{L("Postal code", "Código postal")}</span>
        <input style={input} disabled={readOnly} value={addr.postalCode} onChange={(e) => set({ postalCode: e.target.value })} placeholder="00901" />
      </label>
      <label style={cell}>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{L("Country", "País")}</span>
        <input style={input} disabled={readOnly} value={addr.country} onChange={(e) => set({ country: e.target.value })} />
      </label>
    </div>
  );
}

// --- Repeatable party/org records ------------------------------------------

function RepeatableRecords({
  field,
  value,
  lang,
  readOnly,
  onChange,
}: {
  field: FormField;
  value: PartyRecord[] | undefined;
  lang: Lang;
  readOnly?: boolean;
  onChange: (items: PartyRecord[]) => void;
}) {
  const items = Array.isArray(value) ? value : [];
  const subFields = field.subFields ?? [];
  const L = (en: string, es: string) => (lang === "es" ? es : en);

  const addItem = () => {
    const id = `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    onChange([...items, { id, fullName: "" }]);
  };
  const removeItem = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const patchItem = (idx: number, sub: RepeatableSubField, subVal: unknown) => {
    const next = items.map((it, i) => (i === idx ? { ...it, [sub.partyKey ?? sub.id]: subVal } : it));
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((item, idx) => (
        <div key={item.id ?? idx} style={{ border: "1px solid var(--border, #e2e8f0)", borderRadius: 8, padding: 10, position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <strong style={{ fontSize: 13.5 }}>{localize(field.label, lang)} {idx + 1}</strong>
            {!readOnly && (
              <button type="button" onClick={() => removeItem(idx)} style={{ fontSize: 12.5, color: "#b91c1c", background: "none", border: "none", cursor: "pointer" }}>
                {L("Remove", "Eliminar")}
              </button>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {subFields.map((sub) => {
              const key = (sub.partyKey ?? sub.id) as keyof PartyRecord;
              const subVal = item[key];
              if (sub.visibleWhen && !evaluateConditions(sub.visibleWhen, item as unknown as FormData)) return null;
              return (
                <div key={sub.id}>
                  <label style={{ fontSize: 13.5, fontWeight: 500, display: "block", marginBottom: 2 }}>
                    {localize(sub.label, lang)} {sub.required && <span style={{ color: "#b91c1c" }}>*</span>}
                  </label>
                  {sub.type === "address" ? (
                    <AddressInput value={subVal as CanonicalAddress | undefined} lang={lang} readOnly={readOnly} onChange={(a) => patchItem(idx, sub, a)} />
                  ) : sub.type === "checkbox" ? (
                    <input type="checkbox" disabled={readOnly} checked={subVal === true} onChange={(e) => patchItem(idx, sub, e.target.checked)} />
                  ) : sub.type === "signature" ? (
                    <SignaturePlaceholder value={subVal as string} lang={lang} readOnly={readOnly} onChange={(v) => patchItem(idx, sub, v)} />
                  ) : sub.type === "select" ? (
                    <select disabled={readOnly} value={String(subVal ?? "")} onChange={(e) => patchItem(idx, sub, e.target.value)} style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, width: "100%" }}>
                      <option value="">—</option>
                      {sub.options?.map((o) => <option key={o.value} value={o.value}>{localize(o.label, lang)}</option>)}
                    </select>
                  ) : (
                    <input disabled={readOnly} value={String(subVal ?? "")} onChange={(e) => patchItem(idx, sub, e.target.value)} style={{ padding: "8px 10px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 14, width: "100%" }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {!readOnly && (
        <button type="button" onClick={addItem} style={{ alignSelf: "flex-start", fontSize: 13.5, padding: "8px 14px", border: "1px dashed #94a3b8", borderRadius: 6, background: "none", cursor: "pointer" }}>
          + {L("Add", "Agregar")} {localize(field.label, lang)}
        </button>
      )}
    </div>
  );
}

function SignaturePlaceholder({
  value,
  lang,
  readOnly,
  onChange,
}: {
  value: string | undefined;
  lang: Lang;
  readOnly?: boolean;
  onChange: (v: string) => void;
}) {
  const signed = value === "signed";
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13.5, padding: "8px 10px", border: "1px dashed #cbd5e1", borderRadius: 6 }}>
      <input type="checkbox" disabled={readOnly} checked={signed} onChange={(e) => onChange(e.target.checked ? "signed" : "not_started")} />
      <span>{signed ? L("Signature captured (placeholder)", "Firma capturada (marcador)") : L("Mark as signed (signature placeholder)", "Marcar como firmado (marcador de firma)")}</span>
    </label>
  );
}

function SensitiveTextInput({
  value,
  lang,
  readOnly,
  style,
  onChange,
}: {
  value: unknown;
  lang: Lang;
  readOnly?: boolean;
  style: React.CSSProperties;
  onChange: (value: string) => void;
}) {
  const [visible, setVisible] = React.useState(false);
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
      <input
        type={visible ? "text" : "password"}
        autoComplete="off"
        disabled={readOnly}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        style={style}
      />
      {!readOnly && (
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? L("Hide sensitive value", "Ocultar valor confidencial") : L("Show sensitive value", "Mostrar valor confidencial")}
          style={{ minWidth: 58, padding: "2px 10px", border: "1px solid #cbd5e1", borderRadius: 6, background: "white", fontSize: 13, cursor: "pointer" }}
        >
          {visible ? L("Hide", "Ocultar") : L("Show", "Mostrar")}
        </button>
      )}
    </div>
  );
}

// --- Field dispatcher ------------------------------------------------------

function FieldControl({
  field,
  formData,
  lang,
  readOnly,
  onChange,
}: {
  field: FormField;
  formData: FormData;
  lang: Lang;
  readOnly?: boolean;
  onChange: (id: string, v: unknown) => void;
}) {
  const value = (formData as Record<string, unknown>)[field.id];
  const input: React.CSSProperties = { padding: "8px 10px", border: "1px solid var(--border, #cbd5e1)", borderRadius: 6, fontSize: 14, width: "100%", background: readOnly ? "#f8fafc" : "white" };

  if (field.sensitive) {
    return (
      <SensitiveTextInput
        value={value}
        lang={lang}
        readOnly={readOnly}
        style={input}
        onChange={(next) => onChange(field.id, next)}
      />
    );
  }

  switch (field.type) {
    case "heading":
      return <h4 style={{ margin: "8px 0 0", fontSize: 16 }}>{localize(field.label, lang)}</h4>;
    case "statutory_text":
      return <p style={{ fontSize: 14, color: "#475569", background: "#f1f5f9", padding: 10, borderRadius: 6, margin: 0 }}>{localize(field.body ?? field.label, lang)}</p>;
    case "textarea":
      return <textarea disabled={readOnly} value={String(value ?? "")} onChange={(e) => onChange(field.id, e.target.value)} rows={3} style={input} />;
    case "select":
      return (
        <select disabled={readOnly} value={String(value ?? "")} onChange={(e) => onChange(field.id, e.target.value)} style={input}>
          <option value="">—</option>
          {field.options?.map((o) => <option key={o.value} value={o.value}>{localize(o.label, lang)}</option>)}
        </select>
      );
    case "radio":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {field.options?.map((o) => (
            <label key={o.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14.5 }}>
              <input type="radio" disabled={readOnly} name={field.id} checked={String(value ?? "") === o.value} onChange={() => onChange(field.id, o.value)} />
              {localize(o.label, lang)}
            </label>
          ))}
        </div>
      );
    case "category_grid":
      return (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 6 }}>
          {field.options?.map((o) => {
            const active = String(value ?? "") === o.value;
            return (
              <button
                key={o.value}
                type="button"
                disabled={readOnly}
                onClick={() => onChange(field.id, o.value)}
                style={{ textAlign: "left", fontSize: 14, padding: "10px 12px", borderRadius: 6, cursor: readOnly ? "default" : "pointer", border: active ? "2px solid var(--brand-2, #245c5c)" : "1px solid #cbd5e1", background: active ? "rgba(13,148,136,0.08)" : "white" }}
              >
                {localize(o.label, lang)}
              </button>
            );
          })}
        </div>
      );
    case "checkbox":
    case "attestation":
      return (
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 14.5 }}>
          <input type="checkbox" disabled={readOnly} checked={value === true} onChange={(e) => onChange(field.id, e.target.checked)} style={{ marginTop: 3 }} />
          <span>{localize(field.label, lang)}</span>
        </label>
      );
    case "address":
      return <AddressInput value={value as CanonicalAddress | undefined} lang={lang} readOnly={readOnly} onChange={(a) => onChange(field.id, a)} />;
    case "repeatable":
      return <RepeatableRecords field={field} value={value as PartyRecord[] | undefined} lang={lang} readOnly={readOnly} onChange={(items) => onChange(field.id, items)} />;
    case "signature":
      return <SignaturePlaceholder value={value as string} lang={lang} readOnly={readOnly} onChange={(v) => onChange(field.id, v)} />;
    case "file":
      return (
        <input type="file" disabled={readOnly} onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onChange(field.id, { id: `att_${Date.now()}`, name: f.name, mimeType: f.type, size: f.size, uploadedAt: new Date().toISOString() });
        }} style={{ fontSize: 13.5 }} />
      );
    case "number":
    case "currency":
      return <input type="number" min={field.validation?.find((rule) => rule.type === "number_min")?.param} disabled={readOnly} value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(field.id, e.target.value === "" ? "" : Number(e.target.value))} style={input} placeholder={field.type === "currency" ? "$" : undefined} />;
    case "date":
      return <input type="date" disabled={readOnly} value={String(value ?? "")} onChange={(e) => onChange(field.id, e.target.value)} style={input} />;
    case "email":
      return <input type="email" disabled={readOnly} value={String(value ?? "")} onChange={(e) => onChange(field.id, e.target.value)} style={input} />;
    case "phone":
      return <input type="tel" disabled={readOnly} value={String(value ?? "")} onChange={(e) => onChange(field.id, e.target.value)} style={input} />;
    default:
      return <input disabled={readOnly} value={String(value ?? "")} onChange={(e) => onChange(field.id, e.target.value)} style={input} />;
  }
}

export function GovernmentFormRenderer(props: GovernmentFormRendererProps) {
  const { definition, formData, canonical, lang, errors, readOnly, onChange } = props;
  const errorByField = new Map<string, string>();
  for (const e of errors ?? []) if (!errorByField.has(e.fieldId)) errorByField.set(e.fieldId, localize(e.message, lang));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {definition.sections.map((section) => {
        if (!evaluateConditions(section.visibleWhen, formData, canonical)) return null;
        const visibleFields = section.fields.filter((f) => evaluateConditions(f.visibleWhen, formData, canonical));
        if (visibleFields.length === 0) return null;
        return (
          <section key={section.id}>
            <h3 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 4px", color: "var(--brand-1, #0a2540)" }}>{localize(section.title, lang)}</h3>
            {section.description && <p style={{ fontSize: 13.5, color: "#64748b", margin: "0 0 8px" }}>{localize(section.description, lang)}</p>}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {visibleFields.map((field) => {
                const requiredMark = field.required || (field.requiredWhen && evaluateConditions(field.requiredWhen, formData, canonical));
                const err = errorByField.get(field.id);
                const showLabel = field.type !== "attestation" && field.type !== "checkbox" && field.type !== "statutory_text" && field.type !== "heading";
                return (
                  <div key={field.id} id={`govfield-${field.id}`} style={{ scrollMarginTop: 10 }}>
                    {showLabel && field.label && (
                      <label style={{ fontSize: 14, fontWeight: 600, display: "block", marginBottom: 4 }}>
                        {localize(field.label, lang)} {requiredMark && <span style={{ color: "#b91c1c" }}>*</span>}
                      </label>
                    )}
                    <FieldControl field={field} formData={formData} lang={lang} readOnly={readOnly} onChange={onChange} />
                    {field.helpText && <p style={{ fontSize: 12.5, color: "#64748b", margin: "4px 0 0", lineHeight: 1.5 }}>{localize(field.helpText, lang)}</p>}
                    {err && <p style={{ fontSize: 12.5, fontWeight: 600, color: "#b91c1c", margin: "4px 0 0" }}>{err}</p>}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Re-export so callers can compute completion errors alongside the renderer. */
export { validateForm };
