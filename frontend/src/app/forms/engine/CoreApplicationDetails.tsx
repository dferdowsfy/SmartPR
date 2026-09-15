"use client";

// ============================================================================
// CoreApplicationDetails — the "Enter your core business information once" step
// (Part 1). Collects only the fields reused across multiple government
// applications and writes them straight into the canonical application object.
// Structured address fields (line 1/2, city/municipality, state/territory,
// postal code, country) replace unparsed textareas so shared address data
// normalizes cleanly into every form.
// ============================================================================

import React from "react";
import { readPath } from "./formConditions.ts";
import { setCanonicalValue } from "./canonicalMapping.ts";
import { INTAKE_FIELDS, type IntakeFieldSpec } from "./intake.ts";
import { PASSPORT_INTAKE_FIELDS } from "./businessPassport.ts";
import { validatePuertoRicoAddress } from "./formValidation.ts";
import type { CanonicalAddress, CanonicalApplicationData, Lang } from "./types.ts";
import { localize } from "./types.ts";

const EMPTY_ADDRESS: CanonicalAddress = { line1: "", cityOrMunicipality: "", postalCode: "", country: "Puerto Rico" };

function AddressFields({ value, lang, onChange }: { value: CanonicalAddress | undefined; lang: Lang; onChange: (a: CanonicalAddress) => void }) {
  const addr = value ?? EMPTY_ADDRESS;
  const set = (patch: Partial<CanonicalAddress>) => onChange({ ...addr, ...patch });
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  const input: React.CSSProperties = { padding: "6px 8px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, width: "100%" };
  const cell = (label: string, node: React.ReactNode, span = 1): React.ReactNode => (
    <label style={{ display: "flex", flexDirection: "column", gap: 2, gridColumn: span === 2 ? "1 / -1" : undefined }}>
      <span style={{ fontSize: 11, opacity: 0.7 }}>{label}</span>
      {node}
    </label>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, background: "#f8fafc", padding: 10, borderRadius: 8 }}>
      {cell(L("Address line 1", "Dirección línea 1"), <input style={input} value={addr.line1} onChange={(e) => set({ line1: e.target.value })} />, 2)}
      {cell(L("Address line 2", "Dirección línea 2"), <input style={input} value={addr.line2 ?? ""} onChange={(e) => set({ line2: e.target.value })} />, 2)}
      {cell(L("City / Municipality", "Ciudad / Municipio"), <input style={input} value={addr.cityOrMunicipality} onChange={(e) => set({ cityOrMunicipality: e.target.value })} />)}
      {cell(L("State / Territory", "Estado / Territorio"), <input style={input} value={addr.stateOrTerritory ?? ""} placeholder="PR" onChange={(e) => set({ stateOrTerritory: e.target.value })} />)}
      {cell(L("Postal code", "Código postal"), <input style={input} value={addr.postalCode} placeholder="00901" onChange={(e) => set({ postalCode: e.target.value })} />)}
      {cell(L("Country", "País"), <input style={input} value={addr.country} onChange={(e) => set({ country: e.target.value })} />)}
    </div>
  );
}

export interface CoreApplicationDetailsProps {
  canonical: CanonicalApplicationData;
  lang: Lang;
  onChange: (next: CanonicalApplicationData) => void;
  /** When true, use the full Business Passport field set (NAICS, formation date, registry). */
  passportMode?: boolean;
  /** Override the intro banner copy. */
  banner?: { en: string; es: string };
}

const GROUP_TITLES: Record<IntakeFieldSpec["group"], { en: string; es: string }> = {
  business: { en: "Business", es: "Negocio" },
  contact: { en: "Primary contact", es: "Contacto principal" },
  address: { en: "Addresses", es: "Direcciones" },
  property: { en: "Property", es: "Propiedad" },
};

export function CoreApplicationDetails({ canonical, lang, onChange, passportMode, banner }: CoreApplicationDetailsProps) {
  const L = (en: string, es: string) => (lang === "es" ? es : en);
  const groups: IntakeFieldSpec["group"][] = ["business", "contact", "address", "property"];
  const fieldSpecs = passportMode ? PASSPORT_INTAKE_FIELDS : INTAKE_FIELDS;
  const input: React.CSSProperties = { padding: "7px 9px", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: 13, width: "100%" };

  const setField = (spec: IntakeFieldSpec, value: unknown) => {
    onChange(setCanonicalValue(canonical, spec.canonicalKey, value));
  };

  const mailingSame = Boolean(readPath(canonical, "addresses.mailingSameAsPhysical"));
  const bannerCopy = banner ?? {
    en: passportMode
      ? "Business Passport — enter these facts once. SmartPR stamps them onto every applicable form, worksheet, checklist, and package artifact."
      : "Enter your core business information once. SmartPR will reuse it across every applicable government application.",
    es: passportMode
      ? "Pasaporte comercial — ingrese estos datos una sola vez. SmartPR los aplica en cada formulario, hoja de trabajo, lista de verificación y paquete aplicable."
      : "Ingrese su información comercial una sola vez. SmartPR la reutilizará en cada solicitud gubernamental aplicable.",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "10px 12px", fontSize: 12.5, color: "#1e40af" }}>
        {L(bannerCopy.en, bannerCopy.es)}
      </div>
      {groups.map((group) => {
        const fields = fieldSpecs.filter((f) => f.group === group);
        return (
          <details key={group} open={group === "business"} style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 12px" }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>{localize(GROUP_TITLES[group], lang)}</summary>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
              {fields.map((spec) => {
                // Hide principal mailing address when "same as physical" is on.
                if (spec.id === "principalMailing" && mailingSame) return null;
                const raw = readPath(canonical, spec.canonicalKey);
                const span2 = spec.type === "address" || spec.type === "textarea";
                const addrErrors = spec.type === "address" && spec.id === "operatingAddress" && raw
                  ? validatePuertoRicoAddress(raw as CanonicalAddress)
                  : [];
                return (
                  <div key={spec.id} style={{ gridColumn: span2 ? "1 / -1" : undefined }}>
                    <label style={{ fontSize: 12, fontWeight: 500, display: "block", marginBottom: 3 }}>
                      {localize(spec.label, lang)} {spec.required && <span style={{ color: "#b91c1c" }}>*</span>}
                      {spec.optional && <span style={{ color: "#94a3b8", fontWeight: 400 }}> · {L("optional", "opcional")}</span>}
                    </label>
                    {spec.type === "address" ? (
                      <AddressFields value={raw as CanonicalAddress | undefined} lang={lang} onChange={(a) => setField(spec, a)} />
                    ) : spec.type === "checkbox" ? (
                      <input type="checkbox" checked={raw === true} onChange={(e) => setField(spec, e.target.checked)} />
                    ) : spec.type === "textarea" ? (
                      <textarea rows={2} style={input} value={String(raw ?? "")} onChange={(e) => setField(spec, e.target.value)} />
                    ) : spec.type === "select" ? (
                      <select style={input} value={String(raw ?? "")} onChange={(e) => setField(spec, e.target.value)}>
                        <option value="">—</option>
                        {spec.options?.map((o) => <option key={o.value} value={o.value}>{localize(o.label, lang)}</option>)}
                      </select>
                    ) : spec.type === "number" ? (
                      <input type="number" style={input} value={raw === undefined || raw === null ? "" : String(raw)} onChange={(e) => setField(spec, e.target.value === "" ? undefined : Number(e.target.value))} />
                    ) : (
                      <input type={spec.type === "email" ? "email" : spec.type === "phone" ? "tel" : spec.type === "date" ? "date" : "text"} style={input} value={String(raw ?? "")} onChange={(e) => setField(spec, e.target.value)} />
                    )}
                    {spec.id === "ein" && (
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#64748b", marginTop: 4 }}>
                        <input type="checkbox" checked={Boolean(readPath(canonical, "business.einPending"))} onChange={(e) => onChange(setCanonicalValue(canonical, "business.einPending", e.target.checked))} />
                        {L("I do not have one yet", "Aún no tengo uno")}
                      </label>
                    )}
                    {addrErrors.length > 0 && (
                      <p style={{ fontSize: 11, color: "#b91c1c", margin: "3px 0 0" }}>
                        {addrErrors.map((e) => localize(e.message, lang)).join(" ")}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
      <p style={{ fontSize: 11, color: "#64748b", margin: 0 }}>
        {L(
          "You can continue when optional or not-yet-available information is missing.",
          "Puede continuar aunque falte información opcional o aún no disponible."
        )}
      </p>
    </div>
  );
}
