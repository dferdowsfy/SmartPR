"use client";

/**
 * Property & Site Report — wide drawer (full-screen on phones) opened from
 * the intake location card. The intake stays mounted underneath, so answers,
 * progress and scroll position are untouched; closing returns focus to the
 * control that opened it.
 *
 * Reads the shared PropertyReport model (locations/propertyReport.ts) — the
 * same object the preview shows and the Passport stores.
 */
import { useEffect, useId, useRef, useState } from "react";
import { BookmarkPlus, Check, ChevronDown, Copy, Download, FileJson, Loader2, X } from "lucide-react";
import type { Lang } from "../../forms/engine/types";
import { PassportMap } from "../map/PassportMap";
import { findingStateText, reportSummaryText, type PropertyReport, type ReportFinding, type ReportGroup } from "../../locations/propertyReport";
import { FindingValue, scopeText } from "./SiteReportPreview";
import { FindingReviewControls, PropertyReviewPanel, usePropertyReview, type ReviewApi, type ReviewTarget } from "./PropertyReviewPanel";
import { downloadPropertyReportPdf } from "../../locations/propertyReportPdf";
import { exportableReview, REVIEW_DISCLAIMER, REVIEW_STATUS_TEXT } from "../../locations/propertyReview";
import { ApprovalsSection, CompatibilitySection, EvidenceSection, ProposedActivityPanel, ReasoningDetails, RegulatoryFlags, StandardsList, UnresolvedSection, type ActivityInput } from "./LandUseSections";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

export type PassportSaveState =
  | { kind: "signed_out" }
  | { kind: "pending_location" }
  | { kind: "ready"; saving: boolean; saved: { version: number; created_at: string } | null; error: string | null; onSave: () => void };

const GROUPS: Array<{ id: ReportGroup; en: string; es: string }> = [
  { id: "land", en: "Land & zoning", es: "Terreno y calificación" },
  { id: "flood", en: "Flood & water", es: "Inundación y agua" },
  { id: "environment", en: "Environment & terrain", es: "Ambiente y terreno" },
];

const CONSTRAINT_TEXT = {
  protection: { en: "Protection constraint", es: "Restricción de protección" },
  documentation: { en: "Review / documentation", es: "Revisión / documentación" },
};

function FindingRow({ f, lang, api }: { f: ReportFinding; lang: Lang; api: ReviewApi }) {
  return (
    <li className={`spr-prd-finding spr-srp-tone-${f.tone}`} data-finding={f.id} data-state={f.state}>
      <div className="spr-prd-finding-head">
        <span className="spr-srp-dot" aria-hidden="true" />
        <span className="spr-prd-finding-title">{f.title[lang]}</span>
        <span className={`spr-prd-badge spr-prd-badge-${f.state}`}>{f.state === "sourced" ? scopeText(f, lang) : findingStateText(f.state)[lang]}</span>
      </div>
      <div className="spr-prd-tags">
        <span className="spr-prv-basis spr-prv-basis-official">{L("Official finding", "Hallazgo oficial", lang)}</span>
        {f.constraint !== "information" && <span className={`spr-prv-basis spr-prv-constraint-${f.constraint}`} data-testid="finding-constraint" data-constraint={f.constraint}>{CONSTRAINT_TEXT[f.constraint][lang]}</span>}
      </div>
      {f.plain && (f.state === "sourced" || f.state === "none_mapped") && <p className="spr-prd-finding-plain">{f.plain[lang]}</p>}
      <div className="spr-prd-finding-value"><FindingValue f={f} lang={lang} /></div>
      {f.detail && <p className="spr-prd-finding-detail">{f.detail[lang]}</p>}
      {(f.sources.length > 0 || f.looked_up_at) && (
        <p className="spr-prd-finding-src">
          {f.sources.map((s, i) => (
            <span key={i}>{i > 0 && " · "}{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : s.name}{s.dataset_date ? ` (${L("data", "datos", lang)} ${s.dataset_date})` : ""}{s.version ? ` · ${s.version}` : ""}</span>
          ))}
          {f.looked_up_at && <span className="spr-prd-lookup"> · {L("looked up", "consultado", lang)} {new Date(f.looked_up_at).toLocaleString(lang === "es" ? "es-PR" : "en-US")}</span>}
        </p>
      )}
      <FindingReviewControls api={api} findingId={f.id} lang={lang} />
    </li>
  );
}

type ReviewExport = ReturnType<typeof exportableReview>;

function downloadJson(report: PropertyReport, review: ReviewExport) {
  const blob = new Blob([JSON.stringify({ ...report, professional_review: review }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `property-report-${(report.property.catastro.value ?? report.property.municipality).replace(/[^A-Za-z0-9-]+/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** document.execCommand("copy") from a temporary textarea inside the dialog (focus-trap safe). */
function legacyCopy(text: string, host: HTMLElement | null): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  // 16px avoids iOS zoom; off-screen but still selectable.
  ta.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0;font-size:16px;";
  (host ?? document.body).appendChild(ta);
  const active = document.activeElement as HTMLElement | null;
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
    active?.focus?.({ preventScroll: true });
  }
}

export function PropertyReportDrawer({
  open, report, lang, onClose, onEditLocation, passport, returnFocusTo, reviewTarget = null, activity, onActivityChange,
}: {
  /** Proposed activity (natural language + answers to follow-up questions). */
  activity?: ActivityInput;
  onActivityChange?: (next: ActivityInput) => void;
  /** Professional review is available once the report is saved to a Passport location. */
  reviewTarget?: ReviewTarget | null;
  open: boolean;
  report: PropertyReport | null;
  lang: Lang;
  onClose: () => void;
  onEditLocation: () => void;
  passport: PassportSaveState;
  /** The control that opened the drawer (focus returns here). */
  returnFocusTo?: HTMLElement | null;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "pdf">(null);
  const [showTech, setShowTech] = useState(false);
  const savedVersion = passport.kind === "ready" ? passport.saved?.version ?? null : null;
  const api = usePropertyReview(open && savedVersion ? reviewTarget : null, savedVersion);
  const reviewExport = exportableReview(api.review);

  // Focus management + scroll lock that preserves the page position.
  useEffect(() => {
    if (!open) return;
    const opener = returnFocusTo ?? (document.activeElement as HTMLElement | null);
    const scrollY = window.scrollY;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => closeRef.current?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      window.scrollTo({ top: scrollY });
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open, onClose, returnFocusTo]);

  if (!open || !report) return null;
  const p = report.property;
  const area = p.boundary.area_m2;

  const copy = async () => {
    const text = reportSummaryText(report, lang, reviewExport);
    setCopyFallback(null);
    // 1) Async Clipboard API (refused in some mobile browsers / in-app views).
    let ok = false;
    try {
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch { /* fall through */ }
    // 2) Legacy copy from a selected textarea (works on iOS Safari/Chrome).
    if (!ok) ok = legacyCopy(text, panelRef.current);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } else {
      // 3) Show the text selected so the user can copy it by hand.
      setCopyFallback(text);
    }
  };

  return (
    <div className="spr-prd-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} data-testid="property-report-backdrop">
      <div ref={panelRef} className="spr-prd" role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="property-report" data-revision={report.location_revision}>
        <header className="spr-prd-head">
          <div>
            <p className="spr-prd-kicker">{L("Property & Site Report", "Informe de propiedad y lugar", lang)}</p>
            <h2 id={titleId} className="spr-prd-title">{p.title}</h2>
            <p className="spr-prd-sub">{p.address.primary} · {p.address.secondary}</p>
            {api.review && (
              <p className={`spr-prv-pill spr-prv-pill-${api.review.status}`} data-testid="review-status-pill" title={REVIEW_DISCLAIMER[lang]}>
                {REVIEW_STATUS_TEXT[api.review.status][lang]} <span>· {L("not a government approval", "no es aprobación del gobierno", lang)}</span>
              </p>
            )}
          </div>
          <button ref={closeRef} type="button" className="spr-prd-close" onClick={onClose} aria-label={L("Close report", "Cerrar informe", lang)} data-testid="property-report-close"><X aria-hidden="true" /></button>
        </header>

        <div className="spr-prd-actions">
          {passport.kind === "ready" ? (
            <button type="button" className="spr-loc-btn primary" onClick={passport.onSave} disabled={passport.saving} data-testid="report-save-passport">
              {passport.saving ? <Loader2 className="spr-loc-spin" aria-hidden="true" /> : passport.saved ? <Check aria-hidden="true" /> : <BookmarkPlus aria-hidden="true" />}
              {passport.saved ? L(`Saved to Passport · v${passport.saved.version}`, `Guardado en el Pasaporte · v${passport.saved.version}`, lang) : L("Save to Passport", "Guardar en el Pasaporte", lang)}
            </button>
          ) : (
            <span className="spr-prd-draft" data-testid="report-draft-note">
              {passport.kind === "signed_out"
                ? L("Draft — kept with this intake. Sign in to save it to your Business Passport.", "Borrador — se conserva con esta solicitud. Inicia sesión para guardarlo en tu Pasaporte.", lang)
                : L("Draft — it will be saved to the Passport once the business and location are saved.", "Borrador — se guardará en el Pasaporte cuando se guarden el negocio y la ubicación.", lang)}
            </span>
          )}
          <button type="button" className="spr-loc-btn" onClick={async () => { setBusy("pdf"); try { await downloadPropertyReportPdf(report, lang, reviewExport); } finally { setBusy(null); } }} data-testid="report-pdf">
            {busy === "pdf" ? <Loader2 className="spr-loc-spin" aria-hidden="true" /> : <Download aria-hidden="true" />} {L("Download PDF", "Descargar PDF", lang)}
          </button>
          <button type="button" className="spr-loc-btn" onClick={copy} data-testid="report-copy">
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copied ? L("Copied", "Copiado", lang) : L("Copy summary", "Copiar resumen", lang)}
          </button>
          <button type="button" className="spr-loc-btn" onClick={() => downloadJson(report, reviewExport)} data-testid="report-json">
            <FileJson aria-hidden="true" /> {L("Export data (JSON)", "Exportar datos (JSON)", lang)}
          </button>
          {passport.kind === "ready" && passport.error && <span className="spr-prd-error" role="alert">{passport.error}</span>}
          {copyFallback && (
            <div className="spr-prd-copybox" role="alert" data-testid="report-copy-fallback">
              <p>{L("Your browser blocked automatic copying. The summary is selected below — use Copy from your browser's menu.", "Tu navegador bloqueó la copia automática. El resumen está seleccionado abajo — usa Copiar en el menú del navegador.", lang)}</p>
              <textarea readOnly value={copyFallback} rows={6} ref={(el) => { if (el) { el.focus(); el.select(); el.setSelectionRange(0, el.value.length); } }} />
              <button type="button" className="spr-link" onClick={() => setCopyFallback(null)}>{L("Done", "Listo", lang)}</button>
            </div>
          )}
        </div>

        <div className="spr-prd-body">
          <section className="spr-prd-section spr-prd-property" aria-labelledby={`${titleId}-p`}>
            <h3 id={`${titleId}-p`}>{L("Property", "Propiedad", lang)}</h3>
            <div className="spr-prd-property-grid">
              <div className="spr-prd-map">
                <PassportMap
                  point={{ latitude: p.latitude, longitude: p.longitude }}
                  parcel={p.boundary.geometry}
                  layerControls
                  navigable
                  layerLabels={{ streets: L("Map", "Mapa", lang), satellite: L("Satellite", "Satélite", lang), flood: L("Flood zones (FEMA)", "Zonas inundables (FEMA)", lang), zoning: L("Zoning (JP)", "Calificación (JP)", lang), parcel: L("Parcel", "Parcela", lang), layers: L("Map layers", "Capas del mapa", lang) }}
                  label={L(`Map of the property in ${p.municipality}`, `Mapa de la propiedad en ${p.municipality}`, lang)}
                  loadingText={L("Loading map…", "Cargando mapa…", lang)}
                  errorText={L("The map could not load.", "El mapa no pudo cargar.", lang)}
                  className="spr-prd-map-canvas"
                />
                <p className="spr-prd-caption">{p.boundary.geometry ? L("Parcel boundary from the CRIM digital cadastre — not a survey.", "Límite de parcela del catastro digital del CRIM — no es una mensura.", lang) : L("No parcel boundary determined — showing the pin only.", "No se determinó el límite de la parcela — se muestra solo el pin.", lang)}</p>
              </div>
              <dl className="spr-prd-facts">
                <div><dt>{L("Municipality", "Municipio", lang)}</dt><dd>{p.municipality}</dd></div>
                {p.barrio && <div><dt>{L("Barrio", "Barrio", lang)}</dt><dd>{p.barrio}</dd></div>}
                {p.address.formatted && <div><dt>{L("Address", "Dirección", lang)}</dt><dd>{p.address.primary}</dd></div>}
                <div><dt>{L("Catastro", "Catastro", lang)}</dt><dd data-testid="report-catastro">{p.catastro.value ?? findingStateText(p.catastro.state)[lang]}</dd></div>
                <div><dt>{L("Approximate area", "Área aproximada", lang)}</dt><dd>{area ? <>{area.toLocaleString(lang === "es" ? "es-PR" : "en-US")} m² <small>({(area / 3930.395).toFixed(2)} {L("cuerdas", "cuerdas", lang)}) · {L("mapped boundary, not a survey", "límite mapeado, no mensura", lang)}</small></> : findingStateText(p.boundary.state)[lang]}</dd></div>
                <div><dt>{L("Coordinates", "Coordenadas", lang)}</dt><dd>{p.latitude.toFixed(6)}, {p.longitude.toFixed(6)}</dd></div>
                <div><dt>{L("Location", "Ubicación", lang)}</dt><dd>{p.coordinate_source === "GEOCODED_ADDRESS" ? L("From the address search", "Según la búsqueda de dirección", lang) : L("Selected point in the parcel", "Punto seleccionado en la parcela", lang)} · <button type="button" className="spr-link" onClick={onEditLocation}>{L("Edit location", "Editar ubicación", lang)}</button></dd></div>
              </dl>
            </div>
            <button type="button" className="spr-prd-tech-toggle" aria-expanded={showTech} onClick={() => setShowTech((v) => !v)}>
              <ChevronDown aria-hidden="true" className={showTech ? "open" : ""} /> {L("Technical coordinates & identifiers", "Coordenadas técnicas e identificadores", lang)}
            </button>
            {showTech && (
              <dl className="spr-prd-facts spr-prd-tech" data-testid="report-technical">
                <div><dt>NAD83 / PR State Plane (EPSG:32161)</dt><dd>X {p.technical.nad83_state_plane.x.toLocaleString("en-US")} m · Y {p.technical.nad83_state_plane.y.toLocaleString("en-US")} m <small>{p.technical.nad83_state_plane.note[lang]}</small></dd></div>
                <div><dt>{L("Municipality FIPS", "FIPS del municipio", lang)}</dt><dd>{p.technical.municipality_fips ?? "—"}</dd></div>
                <div><dt>{L("Barrio GEOID", "GEOID del barrio", lang)}</dt><dd>{p.technical.barrio_geoid ?? "—"}</dd></div>
                <div><dt>{L("Passport location id", "Id de ubicación en el Pasaporte", lang)}</dt><dd>{p.technical.location_id ?? L("not saved yet", "aún no guardada", lang)}</dd></div>
              </dl>
            )}
          </section>

          <RegulatoryFlags report={report} lang={lang} />

          {onActivityChange && <ProposedActivityPanel value={activity ?? { text: "", construction: null, use: null }} analysis={report.land_use ?? null} lang={lang} onChange={onActivityChange} />}

          {report.land_use?.activity.use && <CompatibilitySection lu={report.land_use} lang={lang} />}

          <section className="spr-prd-section" aria-labelledby={`${titleId}-c`}>
            <h3 id={`${titleId}-c`}>{L("Land & zoning", "Terreno y calificación", lang)}</h3>
            <ul>{report.findings.filter((f) => f.group === "land").map((f) => <FindingRow key={f.id} f={f} lang={lang} api={api} />)}</ul>
            {report.land_use && <StandardsList lu={report.land_use} lang={lang} />}
          </section>

          <section className="spr-prd-section" aria-labelledby={`${titleId}-s`} data-testid="site-constraints">
            <h3 id={`${titleId}-s`}>{L("Site constraints", "Restricciones del lugar", lang)}</h3>
            {GROUPS.filter((g) => g.id !== "land").map((g) => (
              <div key={g.id} className="spr-prd-group" data-group={g.id}>
                <h4>{lang === "es" ? g.es : g.en}</h4>
                <ul>{report.findings.filter((f) => f.group === g.id).map((f) => <FindingRow key={f.id} f={f} lang={lang} api={api} />)}</ul>
              </div>
            ))}
          </section>

          {report.land_use?.activity.use ? (
            <>
              {report.next_steps.steps.some((x) => x.constraint === "protection") && (
                <section className="spr-prd-section">
                  <div className="spr-prd-stepgroup spr-prd-stepgroup-protection" data-testid="steps-protection">
                    <h4>{L("Protection constraints", "Restricciones de protección", lang)}</h4>
                    <p className="spr-prd-because">{L("Conservation and protection designations restrict what may be done on the land. Additional documents do not remove them.", "Las designaciones de conservación y protección restringen lo que puede hacerse en el terreno. Documentos adicionales no las eliminan.", lang)}</p>
                    <ol className="spr-prd-steps">
                      {report.next_steps.steps.filter((x) => x.constraint === "protection").map((x) => (
                        <li key={x.id}><span className="spr-prv-basis spr-prv-basis-rule">{L("Rule result", "Resultado de regla", lang)}</span><p>{x.text[lang]}</p><p className="spr-prd-because">{L("Because", "Porque", lang)}: {x.because[lang]} — {x.sources.map((src) => src.name).join("; ")}</p></li>
                      ))}
                    </ol>
                  </div>
                </section>
              )}
              <ApprovalsSection lu={report.land_use} lang={lang} />
              <EvidenceSection lu={report.land_use} lang={lang} />
              <UnresolvedSection lu={report.land_use} lang={lang} extra={report.next_steps.missing.map((m) => m[lang])} />
            </>
          ) : (
          <section className="spr-prd-section" aria-labelledby={`${titleId}-n`}>
            <h3 id={`${titleId}-n`}>{L("Next steps", "Próximos pasos", lang)}</h3>
            <p className="spr-prd-activity">{report.next_steps.activity[lang]}</p>
            {([
              ["protection", L("Protection constraints", "Restricciones de protección", lang), L("Conservation and protection designations restrict what may be done on the land. Additional documents do not remove them.", "Las designaciones de conservación y protección restringen lo que puede hacerse en el terreno. Documentos adicionales no las eliminan.", lang)],
              ["documentation", L("Reviews that may be met with additional documentation", "Revisiones que pueden atenderse con documentación adicional", lang), null],
              ["information", L("Preparation steps", "Pasos de preparación", lang), null],
            ] as const).map(([c, title, note]) => {
              const list = report.next_steps.steps.filter((s) => s.constraint === c);
              if (!list.length) return null;
              return (
                <div key={c} className={`spr-prd-stepgroup spr-prd-stepgroup-${c}`} data-testid={`steps-${c}`}>
                  <h4>{title}</h4>
                  {note && <p className="spr-prd-because">{note}</p>}
                  <ol className="spr-prd-steps">
                    {list.map((s) => (
                      <li key={s.id}>
                        <span className="spr-prv-basis spr-prv-basis-rule">{L("Rule result", "Resultado de regla", lang)}</span>
                        <p>{s.text[lang]}</p>
                        <p className="spr-prd-because">{L("Because", "Porque", lang)}: {s.because[lang]} — {s.sources.map((x, i) => <span key={i}>{i > 0 && "; "}{x.url ? <a href={x.url} target="_blank" rel="noreferrer">{x.name}</a> : x.name}</span>)}</p>
                      </li>
                    ))}
                  </ol>
                </div>
              );
            })}
            {(report.next_steps.missing.length > 0 || report.next_steps.unresolved.length > 0) && (
              <div className="spr-prd-missing">
                <h4>{L("Missing information & unresolved checks", "Información faltante y verificaciones pendientes", lang)}</h4>
                <ul>{[...report.next_steps.missing, ...report.next_steps.unresolved].map((m, i) => <li key={i}>{m[lang]}</li>)}</ul>
              </div>
            )}
          </section>
          )}
          {report.next_steps.location_requirements.length > 0 && (
            <section className="spr-prd-section spr-prd-reqs">
              <h4>{L("Requirements that depend on this location", "Requisitos que dependen de esta ubicación", lang)}</h4>
              <ul>{report.next_steps.location_requirements.map((r, i) => <li key={i}>{r.title}{r.reason ? <small> — {r.reason}</small> : null}</li>)}</ul>
            </section>
          )}

          {api.enabled ? (
            <PropertyReviewPanel api={api} lang={lang} />
          ) : (
            <p className="spr-prd-draft" data-testid="review-unavailable">
              {L("Professional review: save this report to the Business Passport to annotate it, flag questions and record its review status.", "Revisión profesional: guarda este informe en el Pasaporte para anotarlo, marcar preguntas y registrar su estado de revisión.", lang)}
            </p>
          )}

          <details className="spr-prd-section spr-prd-sources">
            <summary>{L("Sources & reasoning", "Fuentes y razonamiento", lang)}</summary>
            {report.land_use && <ReasoningDetails lu={report.land_use} lang={lang} />}
            <div className="spr-prd-ai" data-testid="ai-explanations">
              <span className="spr-prv-basis spr-prv-basis-ai">{L("AI explanations", "Explicaciones de IA", lang)}</span>
              {report.ai_explanations.length === 0
                ? <p className="spr-prd-because">{L("None in this report. Every statement is an official finding or a fixed rule result from SmartPR's knowledge graph.", "Ninguna en este informe. Cada afirmación es un hallazgo oficial o un resultado de regla fija del grafo de conocimiento de SmartPR.", lang)}</p>
                : <ul>{report.ai_explanations.map((a, i) => <li key={i}>{a.text[lang]} <small>({a.model})</small></li>)}</ul>}
            </div>
            <h4>{L("Sources", "Fuentes", lang)}</h4>
            <ul>{report.sources.map((s, i) => <li key={i}>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : s.name}{s.dataset_date ? ` · ${L("data", "datos", lang)} ${s.dataset_date}` : ""}{s.version ? ` · ${s.version}` : ""}</li>)}</ul>
            <p>{L("Report", "Informe", lang)} {report.fingerprint} · {L("location revision", "revisión de ubicación", lang)} {report.location_revision} · {new Date(report.generated_at).toLocaleString(lang === "es" ? "es-PR" : "en-US")}</p>
          </details>
          <p className="spr-prd-disclaimer">{report.disclaimer[lang]} {L("SmartPR intelligence is not a survey, title report, engineering determination, legal opinion or agency permit decision.", "La inteligencia de SmartPR no es una mensura, estudio de título, determinación de ingeniería, opinión legal ni decisión de permiso de una agencia.", lang)}</p>
        </div>
      </div>
    </div>
  );
}
