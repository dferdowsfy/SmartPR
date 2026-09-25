"use client";

// Business Passport editor — summary-first card on the business profile.
// Writes the same CanonicalApplicationData the artifact engine already reads.

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CoreApplicationDetails } from "../forms/engine/CoreApplicationDetails";
import { PassportVoiceOrb } from "./PassportVoiceOrb";
import {
  canonicalFromBusinessRow,
  PASSPORT_INTAKE_FIELDS,
  passportCoverage,
  passportJsonFromCanonical,
  type BusinessRowFacts,
} from "../forms/engine/businessPassport";
import { readPath } from "../forms/engine/formConditions";
import type { IntakeFieldSpec } from "../forms/engine/intake";
import type { CanonicalAddress, CanonicalApplicationData, Lang } from "../forms/engine/types";
import { localize } from "../forms/engine/types";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

/** Local address formatter — avoids pulling the artifacts tree into this client panel. */
function formatAddressLine(addr: CanonicalAddress | undefined): string {
  if (!addr) return "";
  return [addr.line1, addr.line2, addr.cityOrMunicipality, addr.stateOrTerritory, addr.postalCode]
    .filter((part) => Boolean(part && String(part).trim()))
    .join(", ");
}


const GROUP_ORDER: IntakeFieldSpec["group"][] = ["business", "contact", "address", "property"];

const GROUP_TITLES: Record<IntakeFieldSpec["group"], { en: string; es: string }> = {
  business: { en: "Business", es: "Negocio" },
  contact: { en: "Contact", es: "Contacto" },
  address: { en: "Addresses", es: "Direcciones" },
  property: { en: "Property", es: "Propiedad" },
};

function displayValue(spec: IntakeFieldSpec, raw: unknown, lang: Lang): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (spec.type === "checkbox") {
    return raw === true
      ? L("Yes", "Sí", lang)
      : raw === false
        ? L("No", "No", lang)
        : null;
  }
  if (spec.type === "address") {
    const line = formatAddressLine(raw as CanonicalAddress);
    return line.trim() ? line : null;
  }
  if (spec.type === "select" && spec.options) {
    const match = spec.options.find((o) => o.value === String(raw));
    if (match) return localize(match.label, lang) || null;
  }
  const text = String(raw).trim();
  return text || null;
}

export interface BusinessPassportPanelProps {
  businessId: string;
  business: BusinessRowFacts & { id?: string };
  lang: Lang;
  onSaved?: (next: { passport_json: unknown; denormalized: Record<string, string | null> }) => void;
  /** Increment to open the passport editor (e.g. voice orb "Use text instead"). */
  editSignal?: number;
}

export function BusinessPassportPanel({ businessId, business, lang, onSaved, editSignal }: BusinessPassportPanelProps) {
  const initial = useMemo(() => canonicalFromBusinessRow(business), [business]);
  const [canonical, setCanonical] = useState<CanonicalApplicationData>(initial);
  const [draft, setDraft] = useState<CanonicalApplicationData>(initial);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /** Collapsible summary sections — undefined means "default" (first group or
   * any group with empty fields starts open). */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCanonical(initial);
    setDraft(initial);
    setEditing(false);
    setOpenGroups({});
  }, [initial]);

  useEffect(() => {
    if (editSignal == null || editSignal <= 0) return;
    setDraft(canonical);
    setMessage(null);
    setEditing(true);
  }, [editSignal]); // eslint-disable-line react-hooks/exhaustive-deps -- signal-driven open only

  const coverage = useMemo(() => passportCoverage(canonical), [canonical]);
  const totalFields = coverage.filled.length + coverage.empty.length;
  const pct = totalFields ? Math.round((coverage.filled.length / totalFields) * 100) : 0;

  const onChange = useCallback((next: CanonicalApplicationData) => {
    setDraft(next);
    setMessage(null);
  }, []);

  const startEdit = () => {
    setDraft(canonical);
    setMessage(null);
    setEditing(true);
  };

  const cancelEdit = () => {
    setDraft(canonical);
    setMessage(null);
    setEditing(false);
  };

  const save = async (value = draft, fromVoice = false) => {
    setBusy(true);
    setMessage(null);
    try {
      const passport_json = passportJsonFromCanonical(value);
      const response = await fetch(`/api/businesses/${businessId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passport: passport_json }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(result.error || L("Could not save passport.", "No se pudo guardar el pasaporte.", lang));
        if (fromVoice) throw new Error("passport_save_failed");
        return;
      }
      setCanonical(value);
      if (!fromVoice) setEditing(false);
      setMessage(L(
        "Passport saved. Regenerated downloads will use these values.",
        "Pasaporte guardado. Las descargas regeneradas usarán estos valores.",
        lang
      ));
      if (!fromVoice) onSaved?.({
        passport_json: result.business?.passport_json ?? passport_json,
        denormalized: {
          legal_name: result.business?.legal_name ?? null,
          municipality: result.business?.municipality ?? null,
          physical_address: result.business?.physical_address ?? null,
          business_structure: result.business?.business_structure ?? null,
          entity_number: result.business?.entity_number ?? null,
        },
      });
    } finally {
      setBusy(false);
    }
  };

  const summaryGroups = useMemo(() => {
    return GROUP_ORDER.map((group, groupIndex) => {
      const fields = PASSPORT_INTAKE_FIELDS.filter((f) => f.group === group).map((spec) => {
        const raw = readPath(canonical, spec.canonicalKey);
        const value = displayValue(spec, raw, lang);
        return {
          id: spec.id,
          label: lang === "es" ? spec.label.es : spec.label.en,
          value,
        };
      });
      const filledCount = fields.filter((f) => f.value).length;
      return {
        group,
        groupIndex,
        title: lang === "es" ? GROUP_TITLES[group].es : GROUP_TITLES[group].en,
        fields,
        filledCount,
        emptyCount: fields.length - filledCount,
      };
    });
  }, [canonical, lang]);

  const toggleGroup = useCallback((group: string, fallbackOpen: boolean) => {
    setOpenGroups((prev) => ({
      ...prev,
      [group]: !(prev[group] ?? fallbackOpen),
    }));
  }, []);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-950/[0.02]">
      <PassportVoiceOrb canonical={editing ? draft : canonical} lang={lang} disabled={busy}
        onUseTextInstead={startEdit}
        onChange={async (next) => {
          setDraft(next);
          // Keep failed saves visible/editable and never replace subsequent typing.
          setEditing(true);
          await save(next, true);
        }} />
      {/* Sticky editor bar: Save/Cancel stay reachable while scrolling the long form.
          top-16 docks it just under the sticky 64px app bar — top-0 would slide
          it underneath the nav (z-50) and hide the actions. */}
      <div className="sticky top-16 z-20 -mx-5 -mt-5 mb-4 flex flex-wrap items-start justify-between gap-3 rounded-t-2xl bg-white/95 px-5 py-3 shadow-[0_1px_0_0_rgba(15,23,42,0.06)] backdrop-blur-sm">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-bold text-[#161616]">
              {L("Business Passport", "Pasaporte comercial", lang)}
            </h2>
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
              {L(`${pct}% complete`, `${pct}% completado`, lang)}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {editing
              ? L(
                  "Edit passport facts once. SmartPR stamps them onto every applicable form and package.",
                  "Edite los datos del pasaporte una sola vez. SmartPR los aplica en cada formulario y paquete aplicable.",
                  lang
                )
              : L(
                  "Stored business facts used across forms. Empty fields stay blank — SmartPR never invents values.",
                  "Datos comerciales guardados que se usan en los formularios. Los vacíos quedan en blanco — SmartPR nunca inventa valores.",
                  lang
                )}
          </p>
        </div>
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-[#f6f3ea]"
          >
            {L("Edit passport", "Editar pasaporte", lang)}
          </button>
        )}
        {editing && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={cancelEdit}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"
            >
              {L("Cancel", "Cancelar", lang)}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void save()}
              className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-[#f6f3ea] disabled:opacity-40"
            >
              {busy
                ? L("Saving…", "Guardando…", lang)
                : L("Save passport", "Guardar pasaporte", lang)}
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <CoreApplicationDetails
          canonical={draft}
          lang={lang}
          onChange={onChange}
          passportMode
          banner={{
            en: "Update the fields below, then save. Cancel discards unsaved changes.",
            es: "Actualice los campos a continuación y luego guarde. Cancelar descarta los cambios sin guardar.",
          }}
        />
      ) : (
        <div>
          <div className="mb-4">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-600">
                {L("Profile completeness", "Perfil completado", lang)}
              </span>
              <span className="font-bold text-[#161616]">
                {L(
                  `${coverage.filled.length} of ${totalFields} fields`,
                  `${coverage.filled.length} de ${totalFields} campos`,
                  lang
                )}
              </span>
            </div>
            <div
              className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-brand transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200">
            {summaryGroups.map((section) => {
              const fallbackOpen = section.groupIndex === 0 || section.emptyCount > 0;
              const open = openGroups[section.group] ?? fallbackOpen;
              const complete = section.emptyCount === 0;
              return (
                <div key={section.group} className={open ? "bg-white" : "bg-slate-50/50"}>
                  <button
                    type="button"
                    onClick={() => toggleGroup(section.group, fallbackOpen)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className="flex items-center gap-2.5">
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${
                          open ? "" : "-rotate-90"
                        }`}
                      />
                      <span className="text-sm font-bold text-[#161616]">{section.title}</span>
                    </span>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        complete
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-800"
                      }`}
                    >
                      {complete
                        ? L("Complete", "Completo", lang)
                        : L(
                            `${section.filledCount}/${section.fields.length}`,
                            `${section.filledCount}/${section.fields.length}`,
                            lang
                          )}
                    </span>
                  </button>
                  {open && (
                    <div className="grid gap-2 px-4 pb-4 sm:grid-cols-2">
                      {section.fields.map((field) => (
                        <div
                          key={field.id}
                          className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5"
                        >
                          <div className="text-[11px] font-medium text-slate-500">
                            {field.label}
                          </div>
                          {field.value ? (
                            <div className="mt-0.5 break-words text-sm font-semibold text-[#161616]">
                              {field.value}
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={startEdit}
                              className="mt-0.5 text-sm font-medium italic text-brand hover:underline"
                            >
                              {L("+ Add", "+ Agregar", lang)}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {message && <p className="mt-3 text-xs font-medium text-emerald-700">{message}</p>}
      <p className="mt-3 text-[11px] text-slate-500">
        {L(
          "Refresh path: populate / download again after saving — working copies are generated from the current passport. Previously prepared forms that used changed fields are flagged Needs refresh in intake.",
          "Ruta de actualización: vuelva a generar o descargar después de guardar — las copias de trabajo se generan desde el pasaporte actual. Los formularios preparados que usaban campos cambiados se marcan Necesita actualización en el intake.",
          lang
        )}
      </p>
    </section>
  );
}
