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
import { assessmentOf, BASIS_TEXT, basisOf, findingStateText, reportArea, reportSummaryText, RETRIEVAL_TEXT, SCOPE_TEXT, type PropertyReport, type ReportFinding, type ReportGroup } from "../../locations/propertyReport";
import { FindingValue } from "./SiteReportPreview";
import { FindingReviewControls, PropertyReviewPanel, usePropertyReview, type ReviewApi, type ReviewTarget } from "./PropertyReviewPanel";
import { downloadPropertyReportPdf } from "../../locations/propertyReportPdf";
import { exportableReview, REVIEW_DISCLAIMER, REVIEW_STATUS_TEXT } from "../../locations/propertyReview";
import { ApprovalsSection, CompatibilitySection, EvidenceSection, ProposedActivityPanel, ReasoningDetails, StandardsList, UnresolvedSection, type ActivityInput } from "./LandUseSections";

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
  const basis = basisOf(f);
  const answered = f.state === "sourced" || f.state === "none_mapped";
  return (
    <li className={`spr-prd-finding spr-srp-tone-${f.tone}`} data-finding={f.id} data-state={f.state} data-basis={basis}>
      <div className="spr-prd-row">
        <span className="spr-srp-dot" aria-hidden="true" />
        <span className="spr-prd-finding-title">{f.title[lang]}</span>
        <span className="spr-prd-row-value"><FindingValue f={f} lang={lang} /></span>
        <span className={`spr-prd-badge spr-prd-badge-${f.state}`} data-testid="finding-scope">{answered ? SCOPE_TEXT[f.scope][lang] : findingStateText(f.state)[lang]}</span>
      </div>
      <details className="spr-prd-srcdet">
      <summary>{L("Source details", "Detalles de la fuente", lang)}</summary>
      <p className="spr-prd-evidence" data-testid="finding-evidence">
        <span>{L("Scope", "Alcance", lang)}: {SCOPE_TEXT[f.scope][lang]}{f.scope === "not_evaluated" && f.attempted_scope ? ` (${L("attempted", "intentado", lang)}: ${SCOPE_TEXT[f.attempted_scope][lang].toLowerCase()})` : ""}</span>
        <span> · {L("Retrieval", "Consulta", lang)}: {RETRIEVAL_TEXT[f.retrieval ?? (f.state === "sourced" || f.state === "none_mapped" ? "answered" : f.state === "unavailable" || f.state === "stale" ? "no_response" : "not_performed")][lang]}</span>
        {f.looked_up_at && <span> · {L("Looked up", "Consultado", lang)} {new Date(f.looked_up_at).toLocaleString(lang === "es" ? "es-PR" : "en-US")}</span>}
      </p>
      <div className="spr-prd-tags">
        <span className={`spr-prv-basis spr-prv-basis-${basis}`} data-testid="finding-basis">{BASIS_TEXT[basis][lang]}</span>
        {f.constraint !== "information" && <span className={`spr-prv-basis spr-prv-constraint-${f.constraint}`} data-testid="finding-constraint" data-constraint={f.constraint}>{CONSTRAINT_TEXT[f.constraint][lang]}</span>}
      </div>
      {f.plain && answered && <p className="spr-prd-finding-plain">{f.plain[lang]}</p>}
      {f.pin && <p className="spr-prd-finding-pin" data-testid="finding-pin"><strong>{L("At the pin", "En el pin", lang)}:</strong> {f.pin.value[lang]}</p>}
      {f.coverage && f.coverage.parts.length > 0 && (
        <table className="spr-prd-cov" data-testid="finding-coverage">
          <caption className="sr-only">{L("Share of the parcel", "Porcentaje de la parcela", lang)}</caption>
          <tbody>
            {f.coverage.parts.map((p) => (
              <tr key={p.key} data-small={p.small ? "true" : undefined}>
                <th scope="row">{p.label[lang]}{p.small && <small> · {L("small intersection", "intersección pequeña", lang)}</small>}{p.contains_pin && <small> · {L("contains the pin", "contiene el pin", lang)}</small>}{p.info && <small className="spr-prd-cov-info">{p.info[lang]}</small>}</th>
                <td>{p.area_text}</td>
                <td>{p.share_text}</td>
              </tr>
            ))}
            {f.coverage.contacts.length > 0 && (
              <tr className="spr-prd-cov-gap"><th scope="row" colSpan={3}>{f.coverage.contacts.map((k) => k.split("|")[0]).join(", ")}: {L("touches the parcel's edge only (no area inside)", "solo toca el borde de la parcela (sin área dentro)", lang)}</th></tr>
            )}
            {f.coverage.unmapped_share > 0.005 && (
              <tr className="spr-prd-cov-gap"><th scope="row">{L("Unmapped in this layer", "Sin mapear en esta capa", lang)}</th><td>{Math.round(f.coverage.unmapped_m2).toLocaleString("en-US")} m²</td><td>{(Math.round(f.coverage.unmapped_share * 1000) / 10).toFixed(1)}%</td></tr>
            )}
          </tbody>
        </table>
      )}
      {f.detail && !(f.coverage && f.coverage.parts.length > 0) && <p className="spr-prd-finding-detail">{f.detail[lang]}</p>}
      {(f.notes?.length ?? 0) > 0 && <ul className="spr-prd-notes" data-testid="finding-notes">{f.notes!.map((n, i) => <li key={i}>{n[lang]}</li>)}</ul>}
      {(f.ambiguities?.length ?? 0) > 0 && (
        <div className="spr-prd-ambiguity" role="note" data-testid="finding-ambiguities">
          <strong>{L("Ambiguity in the official record", "Ambigüedad en el registro oficial", lang)}</strong>
          <ul>{f.ambiguities!.map((a, i) => <li key={i}>{a[lang]}</li>)}</ul>
        </div>
      )}
      {f.raw && Object.values(f.raw).some(Boolean) && (
        <details className="spr-prd-raw">
          <summary>{L("Source fields (as recorded)", "Campos de la fuente (según constan)", lang)}</summary>
          <dl>{Object.entries(f.raw).filter(([, v]) => v).map(([k, v]) => <div key={k}><dt><code>{k}</code></dt><dd>{v}</dd></div>)}</dl>
        </details>
      )}
      {(f.sources.length > 0 || f.looked_up_at) && (
        <p className="spr-prd-finding-src">
          {f.sources.map((s, i) => (
            <span key={i}>{i > 0 && " · "}{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : s.name}{s.dataset_date ? ` (${L("dataset date", "fecha del conjunto de datos", lang)} ${s.dataset_date})` : ""}{s.version ? ` · ${s.version}` : ""}</span>
          ))}
          {f.looked_up_at && <span className="spr-prd-lookup"> · {L("looked up", "consultado", lang)} {new Date(f.looked_up_at).toLocaleString(lang === "es" ? "es-PR" : "en-US")}</span>}
        </p>
      )}
      {f.coverage?.raw_parts && (
        <p className="spr-prd-finding-src" data-testid="finding-raw-parts">{L("Source components before combining identical classes", "Componentes de la fuente antes de combinar clases idénticas", lang)}: {f.coverage.raw_parts.map((x) => `${x.label[lang]} ${x.share_text}`).join(" · ")}</p>
      )}
      </details>
      <FindingReviewControls api={api} findingId={f.id} lang={lang} />
    </li>
  );
}

const STATUS_HEAD = {
  review: { en: "Review required", es: "Requiere revisión", note: { en: "Material constraint or issue detected.", es: "Se detectó una restricción o asunto importante." } },
  clear: { en: "No mapped intersection identified", es: "No se identificó intersección mapeada", note: { en: "Checked; nothing mapped in the stated dataset at the stated scope. Not a clearance.", es: "Verificado; nada mapeado en el conjunto de datos y alcance indicados. No es una autorización." } },
  unable: { en: "Unable to verify", es: "No se pudo verificar", note: { en: "Source unavailable, did not respond, or evidence is insufficient — unknown, not clear.", es: "Fuente no disponible, no respondió o evidencia insuficiente — desconocido, no despejado." } },
} as const;

function KeyFindings({ report, lang }: { report: PropertyReport; lang: Lang }) {
  const a = assessmentOf(report);
  return (
    <section className="spr-prd-section spr-rv-findings" aria-labelledby="spr-rv-findings" data-testid="key-findings">
      <h3 id="spr-rv-findings">{L("Key regulatory findings", "Hallazgos regulatorios clave", lang)}</h3>
      {(["review", "clear", "unable"] as const).map((k) => a[k].length > 0 && (
        <div key={k} className={`spr-rv-group spr-rv-${k}`} data-status={k}>
          <h4>{STATUS_HEAD[k][lang]} <small>{STATUS_HEAD[k].note[lang]}</small></h4>
          <ul>{a[k].map((x) => (
            <li key={x.id} data-item={x.id} data-scope={x.scope} data-severe={x.severe ? "true" : undefined}><span className="spr-rv-dot" aria-hidden="true" /><strong>{x.label[lang]}</strong><span>{x.value[lang]}{(x.scope || x.dataset) && <small className="spr-rv-meta-line">{x.scope ? SCOPE_TEXT[x.scope][lang] : ""}{x.dataset ? <>{x.scope ? " · " : ""}{x.dataset.url ? <a href={x.dataset.url} target="_blank" rel="noreferrer">{x.dataset.name}</a> : x.dataset.name}{x.dataset.date ? ` (${x.dataset.date})` : ""}</> : null}</small>}</span></li>
          ))}</ul>
        </div>
      ))}
    </section>
  );
}

function NextSteps({ report, lang }: { report: PropertyReport; lang: Lang }) {
  const a = assessmentOf(report);
  return (
    <section className="spr-prd-section spr-rv-steps" aria-labelledby="spr-rv-steps" data-testid="next-steps">
      <h3 id="spr-rv-steps">{L("Recommended next steps", "Próximos pasos recomendados", lang)}</h3>
      {a.actions.length === 0 ? <p className="spr-prd-because">{L("No actions identified from the available map sources.", "No se identificaron acciones con las fuentes disponibles.", lang)}</p> : (
        <ol>{a.actions.map((x) => (
          <li key={x.id} data-action={x.id}>
            <strong>{x.issue[lang]}</strong>
            <p>{x.action[lang]}</p>
            {(x.why || x.sources.length > 0) && (
              <details className="spr-rv-why">
                <summary>{L("Why? · Sources", "¿Por qué? · Fuentes", lang)}</summary>
                {x.why && <p>{x.why[lang]}</p>}
                {x.sources.length > 0 && <p className="spr-prd-finding-src">{x.sources.map((s, i) => <span key={i}>{i > 0 && " · "}{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : s.name}{s.version ? ` — ${s.version}` : ""}</span>)}</p>}
              </details>
            )}
          </li>
        ))}</ol>
      )}
    </section>
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
  open, report, lang, onClose, onEditLocation, passport, returnFocusTo, reviewTarget = null, activity, onActivityChange, onConfirmPoint,
}: {
  /** Proposed activity (natural language + answers to follow-up questions). */
  activity?: ActivityInput;
  onActivityChange?: (next: ActivityInput) => void;
  /** Records the user's confirmation of the selected point (never a parcel verification). */
  onConfirmPoint?: () => void;
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
  const area = reportArea(report);
  const assessment = assessmentOf(report);
  const nad = p.technical.nad83_state_plane;

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
            <p className="spr-prd-kicker">{L("Property & Site Report", "Informe de propiedad y lugar", lang)}{p.location?.preliminary && p.location.parcel !== "loading" ? <span className="spr-rv-prelim" data-testid="report-preliminary"> · {L("Preliminary — selected point only", "Preliminar — solo el punto seleccionado", lang)}</span> : null}</p>
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
          <section className="spr-prd-section spr-rv-summary" aria-labelledby={`${titleId}-sum`} data-testid="site-summary">
            <h3 id={`${titleId}-sum`} className="sr-only">{L("Site summary", "Resumen del lugar", lang)}</h3>
            <dl className="spr-rv-meta">
              <div><dt>{L("Coordinates", "Coordenadas", lang)}</dt><dd>{p.latitude.toFixed(6)}, {p.longitude.toFixed(6)}</dd></div>
              <div><dt>{L("Catastro", "Catastro", lang)}</dt><dd data-testid="report-catastro">{p.catastro.text?.[lang] ?? p.catastro.value ?? findingStateText(p.catastro.state)[lang]}</dd></div>
              <div><dt>{L("Approximate parcel area", "Área aproximada de la parcela", lang)}</dt><dd data-testid="report-area">{area.text[lang]}<small className="spr-rv-subtle">{area.note[lang]}</small></dd></div>
            </dl>
            {(p.location?.notices.length ?? 0) > 0 && (
              <div className={`spr-rv-location${p.location!.roadway ? " spr-rv-location-road" : ""}`} role="note" data-testid="location-notice" data-parcel={p.location!.parcel} data-roadway={p.location!.roadway ? "true" : undefined}>
                {p.location!.notices.map((n, i) => <p key={i}>{n[lang]}</p>)}
                <div className="spr-rv-location-actions">
                  <button type="button" className="spr-loc-btn" onClick={onEditLocation} data-testid="adjust-pin">{L("Adjust pin", "Ajustar pin", lang)}</button>
                  {onConfirmPoint && !p.location!.point_confirmed && <button type="button" className="spr-loc-btn" onClick={onConfirmPoint} data-testid="confirm-point">{L("Confirm this point", "Confirmar este punto", lang)}</button>}
                </div>
              </div>
            )}
            <p className="spr-rv-conclusion" data-testid="reviewer-conclusion">{assessment.conclusion[lang]}</p>
          </section>

          <KeyFindings report={report} lang={lang} />

          <NextSteps report={report} lang={lang} />

          {(assessment.still_needed.length > 0 || onActivityChange) && (
            <section className="spr-prd-section spr-rv-needed" aria-labelledby={`${titleId}-need`} data-testid="still-needed">
              <h3 id={`${titleId}-need`}>{assessment.still_needed.length ? L("Still needed", "Aún falta", lang) : L("Proposed activity", "Actividad propuesta", lang)}</h3>
              {assessment.still_needed.length > 0 && <ul>{assessment.still_needed.map((x) => <li key={x.id} data-needed={x.id}><strong>{x.title[lang]}</strong> <span>{x.text[lang]}</span></li>)}</ul>}
              {onActivityChange && <ProposedActivityPanel value={activity ?? { text: "", construction: null, use: null }} analysis={report.land_use ?? null} lang={lang} onChange={onActivityChange} />}
            </section>
          )}

          <details className="spr-prd-section spr-rv-details" data-testid="detailed-findings">
            <summary><h3>{L("Detailed site findings", "Hallazgos detallados del lugar", lang)}</h3><small>{L("Technical source details for engineers, consultants and reviewers", "Detalles técnicos de las fuentes para ingenieros, consultores y evaluadores", lang)}</small></summary>
            <div className="spr-prd-property" data-testid="report-property">
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
                <div><dt>{L("Location", "Ubicación", lang)}</dt><dd>{p.coordinate_source === "GEOCODED_ADDRESS" ? L("From the address search", "Según la búsqueda de dirección", lang) : L("Selected point in the parcel", "Punto seleccionado en la parcela", lang)} · <button type="button" className="spr-link" onClick={onEditLocation}>{L("Edit location", "Editar ubicación", lang)}</button></dd></div>
              </dl>
            </div>
            <button type="button" className="spr-prd-tech-toggle" aria-expanded={showTech} onClick={() => setShowTech((v) => !v)}>
              <ChevronDown aria-hidden="true" className={showTech ? "open" : ""} /> {L("Technical coordinates & identifiers", "Coordenadas técnicas e identificadores", lang)}
            </button>
            {showTech && (
              <dl className="spr-prd-facts spr-prd-tech" data-testid="report-technical">
                <div><dt>{nad.crs ?? "NAD83 / Puerto Rico & Virgin Is. (EPSG:32161)"}</dt><dd data-testid="report-nad83">X {nad.x.toLocaleString("en-US")} m · Y {nad.y.toLocaleString("en-US")} m <small>{L("Units", "Unidades", lang)}: {nad.units ?? "metres"}{nad.projection ? ` · ${nad.projection}` : ""}. {nad.note[lang]}{nad.datum_note ? ` ${nad.datum_note[lang]}` : ""}</small></dd></div>
                <div><dt>{L("WGS84 pin", "Pin WGS84", lang)}</dt><dd>{p.latitude.toFixed(7)}, {p.longitude.toFixed(7)} <small>(EPSG:4326, {L("degrees", "grados", lang)})</small></dd></div>
                <div><dt>{L("Municipality FIPS", "FIPS del municipio", lang)}</dt><dd>{p.technical.municipality_fips ?? "—"}</dd></div>
                <div><dt>{L("Barrio GEOID", "GEOID del barrio", lang)}</dt><dd>{p.technical.barrio_geoid ?? "—"}</dd></div>
                <div><dt>{L("Passport location id", "Id de ubicación en el Pasaporte", lang)}</dt><dd>{p.technical.location_id ?? L("not saved yet", "aún no guardada", lang)}</dd></div>
              </dl>
            )}
            </div>
            {GROUPS.map((g) => (
              <div key={g.id} className="spr-prd-group" data-group={g.id}>
                <h4>{lang === "es" ? g.es : g.en}</h4>
                <ul>{report.findings.filter((f) => f.group === g.id).map((f) => <FindingRow key={f.id} f={f} lang={lang} api={api} />)}</ul>
              </div>
            ))}
            {report.land_use && <StandardsList lu={report.land_use} lang={lang} />}
            {report.land_use?.activity.use && (
              <div className="spr-rv-landuse" data-testid="land-use-details">
                <CompatibilitySection lu={report.land_use} lang={lang} />
                <ApprovalsSection lu={report.land_use} lang={lang} />
                <EvidenceSection lu={report.land_use} lang={lang} />
                <UnresolvedSection lu={report.land_use} lang={lang} extra={report.next_steps.missing.map((m) => m[lang])} />
              </div>
            )}
            {report.next_steps.location_requirements.length > 0 && (
              <div className="spr-prd-reqs">
                <h4>{L("Requirements that depend on this location", "Requisitos que dependen de esta ubicación", lang)}</h4>
                <ul>{report.next_steps.location_requirements.map((r, i) => <li key={i}>{r.title}{r.reason ? <small> — {r.reason}</small> : null}</li>)}</ul>
              </div>
            )}
            <details className="spr-prd-sources">
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
              {report.regulation && <p className="spr-prd-because" data-testid="report-regulation">{L("Regulation for use rules", "Reglamento para reglas de uso", lang)}: {report.regulation.url ? <a href={report.regulation.url} target="_blank" rel="noreferrer">{report.regulation.name}</a> : report.regulation.name}{report.regulation.publication_date ? ` · ${L("publication date", "fecha de publicación", lang)} ${report.regulation.publication_date}` : ""} · {L("applicability to this site", "aplicabilidad a este lugar", lang)}: <strong>{report.regulation.applicability === "verified" ? L("verified", "verificada", lang) : L("not verified", "no verificada", lang)}</strong>. {report.regulation.note[lang]}</p>}
              {report.versions && <p className="spr-prd-because" data-testid="report-versions">{L("Area method", "Método de áreas", lang)}: {report.versions.coverage_method} · {L("Rules", "Reglas", lang)}: {report.versions.rules}</p>}
            </details>
          </details>

          {api.enabled ? (
            <PropertyReviewPanel api={api} lang={lang} />
          ) : (
            <p className="spr-prd-draft" data-testid="review-unavailable">
              {L("Professional review: save this report to the Business Passport to annotate it, flag questions and record its review status.", "Revisión profesional: guarda este informe en el Pasaporte para anotarlo, marcar preguntas y registrar su estado de revisión.", lang)}
            </p>
          )}

          <footer className="spr-rv-footer" data-testid="report-footer">
            <p className="spr-prd-disclaimer">{report.disclaimer[lang]}</p>
            <p>{L("Generated", "Generado", lang)} {new Date(report.generated_at).toLocaleString(lang === "es" ? "es-PR" : "en-US")} · {L("Report", "Informe", lang)} {report.fingerprint} · {report.schema} · {L("location revision", "revisión de ubicación", lang)} {report.location_revision}</p>
          </footer>
        </div>
      </div>
    </div>
  );
}
