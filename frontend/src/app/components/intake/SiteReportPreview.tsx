"use client";

/**
 * Compact Property & Site findings inside the intake location card: key
 * zoning / flood / environment findings, the most important unresolved
 * checks, and "View full property report". Reads the same PropertyReport
 * model as the drawer and the Passport copy. Sources stay collapsed.
 */
import { AlertTriangle, ChevronRight, CircleDashed, FileText, Loader2, RotateCw } from "lucide-react";
import type { Lang } from "../../forms/engine/types";
import { findingStateText, type PropertyReport, type ReportFinding } from "../../locations/propertyReport";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

export function FindingValue({ f, lang }: { f: ReportFinding; lang: Lang }) {
  if (f.state === "loading") return <span className="spr-srp-muted"><Loader2 className="spr-loc-spin" aria-hidden="true" /> {findingStateText("loading")[lang]}</span>;
  if (f.value && (f.state === "sourced" || f.state === "none_mapped")) return <span>{f.value[lang]}</span>;
  return <span className="spr-srp-muted">{findingStateText(f.state)[lang]}</span>;
}

export const scopeText = (f: ReportFinding, lang: Lang) =>
  f.scope === "parcel" ? L("whole parcel", "toda la parcela", lang) : f.scope === "point" ? L("at the pin", "en el pin", lang) : L("municipality", "municipio", lang);

export function SiteReportPreview({ report, lang, onOpen, onRetry }: { report: PropertyReport; lang: Lang; onOpen: () => void; onRetry?: () => void }) {
  const key = report.findings.filter((f) => f.key);
  const unresolved = report.findings.filter((f) => f.key && (f.state === "unavailable" || f.state === "stale"));
  const gaps = report.next_steps.missing.slice(0, 2);
  const retryable = report.findings.some((f) => f.state === "unavailable");
  return (
    <div className="spr-srp" data-testid="site-report-preview" data-revision={report.location_revision}>
      <ul className="spr-srp-list" aria-label={L("Site findings", "Hallazgos del lugar", lang)}>
        {key.map((f) => (
          <li key={f.id} className={`spr-srp-row spr-srp-tone-${f.tone}`} data-finding={f.id} data-state={f.state}>
            <span className="spr-srp-dot" aria-hidden="true" />
            <span className="spr-srp-label">{f.title[lang]}</span>
            <span className="spr-srp-value"><FindingValue f={f} lang={lang} />{(f.state === "sourced") && <small className="spr-srp-scope"> · {scopeText(f, lang)}</small>}</span>
          </li>
        ))}
      </ul>
      {(unresolved.length > 0 || gaps.length > 0) && (
        <div className="spr-srp-checks" data-testid="site-report-unresolved">
          <AlertTriangle aria-hidden="true" />
          <div>
            {unresolved.length > 0 && <p>{L("Not checked yet:", "Aún sin verificar:", lang)} {unresolved.map((f) => f.title[lang]).join(", ")}.</p>}
            {gaps.map((g, i) => <p key={i}>{g[lang]}</p>)}
            {retryable && onRetry && (
              <button type="button" className="spr-link" onClick={onRetry}><RotateCw aria-hidden="true" /> {L("Try the sources again", "Intentar las fuentes de nuevo", lang)}</button>
            )}
          </div>
        </div>
      )}
      <div className="spr-srp-foot">
        <button type="button" className="spr-srp-open" onClick={onOpen} data-testid="open-property-report" aria-haspopup="dialog">
          <FileText aria-hidden="true" /> {L("View full property report", "Ver informe completo de la propiedad", lang)} <ChevronRight aria-hidden="true" />
        </button>
        <details className="spr-srp-sources">
          <summary>{L("Sources", "Fuentes", lang)}</summary>
          <ul>
            {report.sources.map((s) => (
              <li key={`${s.name}|${s.dataset_date}`}>
                {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.name}</a> : s.name}
                {s.dataset_date ? ` · ${s.dataset_date}` : ""}
              </li>
            ))}
          </ul>
        </details>
      </div>
      {key.some((f) => f.state === "not_performed") && <p className="spr-srp-muted"><CircleDashed aria-hidden="true" /> {L("Some checks are not available yet.", "Algunas verificaciones aún no están disponibles.", lang)}</p>}
    </div>
  );
}
