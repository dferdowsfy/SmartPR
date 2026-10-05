"use client";

/**
 * Compact Property & Site findings inside the intake location card: key
 * zoning / flood / environment findings, the most important unresolved
 * checks, and "View full property report". Reads the same PropertyReport
 * model as the drawer and the Passport copy. Sources stay collapsed.
 */
import { AlertTriangle, ChevronRight, FileText, Loader2, RotateCw } from "lucide-react";
import type { Lang } from "../../forms/engine/types";
import { findingStateText, SCOPE_TEXT, type PropertyReport, type ReportFinding } from "../../locations/propertyReport";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

export function FindingValue({ f, lang }: { f: ReportFinding; lang: Lang }) {
  if (f.state === "loading") return <span className="spr-srp-muted"><Loader2 className="spr-loc-spin" aria-hidden="true" /> {findingStateText("loading")[lang]}</span>;
  if (f.value && (f.state === "sourced" || f.state === "none_mapped" || f.state === "not_evaluated")) return <span>{f.value[lang]}</span>;
  return <span className="spr-srp-muted">{findingStateText(f.state)[lang]}</span>;
}

export const scopeText = (f: ReportFinding, lang: Lang) => (SCOPE_TEXT[f.scope] ?? SCOPE_TEXT.not_evaluated)[lang];

export function SiteReportPreview({ report, lang, onOpen, onRetry, onAdjustPin, onConfirmPoint }: { report: PropertyReport; lang: Lang; onOpen: () => void; onRetry?: () => void; onAdjustPin?: () => void; onConfirmPoint?: () => void }) {
  const loc = report.property.location;
  // Pills only: the most useful findings in plain words, colour-coded. Every
  // detail (codes, sources, gaps) lives in the full report.
  const order = ["zoning", "land_class", "flood_zone", "floodway", "flood_advisory", "terrain", "coastal_zone", "historic_zone", "protected_area"];
  const chips = order
    .map((id) => report.findings.find((f) => f.id === id))
    .filter((f): f is ReportFinding => !!f && (f.key || f.tone === "hazard" || f.tone === "attention") && (!!f.pill || f.state === "loading" || f.state === "unavailable" || f.state === "stale"))
    .filter((f) => !(f.state === "unavailable" && !f.key));
  const loading = chips.some((f) => f.state === "loading");
  const keyDown = report.findings.filter((f) => f.key && f.state === "unavailable");
  return (
    <div className="spr-srp" data-testid="site-report-preview" data-revision={report.location_revision}>
      <ul className="spr-srp-pills" aria-label={L("Site findings", "Hallazgos del lugar", lang)}>
        {chips.map((f) => (
          <li key={f.id} className={`spr-srp-pill spr-srp-tone-${f.state === "sourced" || f.state === "none_mapped" ? f.tone : "unknown"}`} data-finding={f.id} data-state={f.state} title={f.plain?.[lang] ?? f.title[lang]}>
            <span className="spr-srp-dot" aria-hidden="true" />
            {f.state === "loading" ? <><Loader2 className="spr-loc-spin" aria-hidden="true" /> {f.title[lang]}</>
              : f.pill && (f.state === "sourced" || f.state === "none_mapped") ? <span>{f.pill[lang]}{f.value && f.id === "flood_zone" ? <small> · {f.value[lang]}</small> : null}</span>
              : <span>{f.title[lang]}: {findingStateText(f.state)[lang]}</span>}
          </li>
        ))}
      </ul>
      {loc && loc.notices.length > 0 && (
        <div className={`spr-srp-location${loc.roadway ? " road" : ""}`} role="note" data-testid="preview-location-notice" data-parcel={loc.parcel} data-roadway={loc.roadway ? "true" : undefined}>
          {loc.notices.map((n, i) => <p key={i}>{n[lang]}</p>)}
          <div>
            {onAdjustPin && <button type="button" className="spr-link" onClick={onAdjustPin} data-testid="preview-adjust-pin">{L("Adjust pin", "Ajustar pin", lang)}</button>}
            {onConfirmPoint && !loc.point_confirmed && <button type="button" className="spr-link" onClick={onConfirmPoint} data-testid="preview-confirm-point">{L("Confirm this point", "Confirmar este punto", lang)}</button>}
          </div>
        </div>
      )}
      {keyDown.length > 0 && onRetry && !loading && (
        <p className="spr-srp-retry" role="status">
          <AlertTriangle aria-hidden="true" /> {L("Some official map services didn't respond.", "Algunos servicios oficiales de mapas no respondieron.", lang)}{" "}
          <button type="button" className="spr-link" onClick={onRetry}><RotateCw aria-hidden="true" /> {L("Check again", "Verificar de nuevo", lang)}</button>
        </p>
      )}
      <div className="spr-srp-foot">
        <button type="button" className="spr-srp-open" onClick={onOpen} data-testid="open-property-report" aria-haspopup="dialog">
          <FileText aria-hidden="true" /> {L("View full property report", "Ver informe completo de la propiedad", lang)} <ChevronRight aria-hidden="true" />
        </button>
        <span className="spr-srp-hint">{L("Details, sources and next steps", "Detalles, fuentes y próximos pasos", lang)}</span>
      </div>
    </div>
  );
}
