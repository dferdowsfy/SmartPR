"use client";

// Site intelligence for a confirmed pin: grouped, color-coded answers from
// the official maps (Flood · Land & zoning · Site · Environmental), the
// material considerations raised above them, and — one click away — the
// details and the sources. Everything stays in SmartPR; official sources are
// only linked from the collapsed "Sources & details".

import { AlertTriangle, CheckCircle2, ExternalLink, HelpCircle, Info, Leaf, Map, Mountain, RefreshCw, Waves } from "lucide-react";
import type { Lang } from "../../forms/engine/types";
import type { SiteLayers } from "../../locations/layers";
import { buildSiteIntelligence, type PillTone, type ProviderStatus, type SiteGroupId } from "../../locations/siteIntelligence";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);
const pick = (b: { en: string; es: string }, lang: Lang) => (lang === "es" ? b.es : b.en);

const GROUP_ICON: Record<SiteGroupId, typeof Waves> = { flood: Waves, land: Map, site: Mountain, environment: Leaf };

function ToneIcon({ tone }: { tone: PillTone }) {
  const props = { size: 13, "aria-hidden": true as const, className: "spr-si-pill-icon" };
  if (tone === "ok") return <CheckCircle2 {...props} />;
  if (tone === "info") return <Info {...props} />;
  if (tone === "unknown") return <HelpCircle {...props} />;
  return <AlertTriangle {...props} />;
}

const STATUS_LABEL: Record<ProviderStatus, { en: string; es: string }> = {
  confirmed: { en: "Confirmed", es: "Confirmado" },
  not_found: { en: "Nothing mapped", es: "Nada mapeado" },
  unavailable: { en: "Unavailable", es: "No disponible" },
  error: { en: "Couldn't be read", es: "No se pudo leer" },
};

export function SiteIntelligencePanel({
  layers,
  lang,
  municipality,
  address,
  onRetry,
}: {
  layers: SiteLayers;
  lang: Lang;
  municipality?: string | null;
  address?: string | null;
  onRetry?: () => void;
}) {
  const si = buildSiteIntelligence(layers, { municipality, address });
  const anyUnavailable = si.groups.some((g) => g.pills.some((p) => p.status === "unavailable"));
  return (
    <div className="spr-si" data-testid="site-intelligence">
      {si.considerations.length > 0 && (
        <div className="spr-si-alerts">
          {si.considerations.map((c, i) => (
            <div key={i} className={`spr-si-alert spr-si-alert-${c.tone}`} role="note" data-testid="site-consideration" data-layer={c.layer} data-tone={c.tone}>
              <AlertTriangle size={16} aria-hidden="true" />
              <span>
                <strong>{L("Site consideration", "Consideración del lugar", lang)}: </strong>
                {pick(c.text, lang)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="spr-si-groups">
        {si.groups.map((g) => {
          const Icon = GROUP_ICON[g.id];
          return (
            <div key={g.id} className="spr-si-group" data-group={g.id}>
              <span className="spr-si-group-title">
                <Icon size={14} aria-hidden="true" /> {pick(g.title, lang)}
              </span>
              <span className="spr-si-pills">
                {g.pills.map((p) => (
                  <span
                    key={p.layer}
                    className={`spr-si-pill spr-si-tone-${p.tone}`}
                    title={pick(p.title, lang)}
                    data-layer={p.layer}
                    data-status={p.status}
                    data-tone={p.tone}
                  >
                    <ToneIcon tone={p.tone} />
                    {pick(p.label, lang)}
                  </span>
                ))}
              </span>
            </div>
          );
        })}
      </div>

      {anyUnavailable && onRetry && (
        <p className="spr-si-retry-line">
          {L("Some official maps didn't answer. Nothing is assumed about them.", "Algunos mapas oficiales no respondieron. No se supone nada sobre ellos.", lang)}{" "}
          <button type="button" className="spr-si-retry" onClick={onRetry} data-testid="location-layers-retry">
            <RefreshCw size={13} aria-hidden="true" /> {L("Try again", "Intentar de nuevo", lang)}
          </button>
        </p>
      )}

      <details className="spr-si-details" data-testid="site-details">
        <summary>{L("View site details", "Ver detalles del lugar", lang)}</summary>
        <div className="spr-si-details-body">
          {si.groups.map((g) => (
            <section key={g.id} className="spr-si-detail-group">
              <h4>{pick(g.title, lang)}</h4>
              {g.details.map((d) => (
                <div key={d.layer} className="spr-si-detail" data-layer={d.layer} data-status={d.status}>
                  <div className="spr-si-detail-head">
                    <span>{pick(d.heading, lang)}</span>
                    <span className={`spr-si-status spr-si-status-${d.status}`}>{pick(STATUS_LABEL[d.status], lang)}</span>
                  </div>
                  {d.rows.length > 0 && (
                    <dl>
                      {d.rows.map((r) => (
                        <div key={r.label.en}>
                          <dt>{pick(r.label, lang)}</dt>
                          <dd>{pick(r.value, lang)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {d.reason && <p className="spr-si-detail-reason">{pick(d.reason, lang)}</p>}
                  {d.meaning && (
                    <p className="spr-si-detail-meaning">
                      <strong>{L("Why this matters", "Por qué importa", lang)}: </strong>
                      {pick(d.meaning, lang)}
                    </p>
                  )}
                </div>
              ))}
            </section>
          ))}
          <p className="spr-si-wetlands">
            {L("Wetlands (USFWS National Wetlands Inventory): not checked yet.", "Humedales (Inventario Nacional de Humedales del USFWS): aún no se verifican.", lang)}
          </p>

          <details className="spr-si-sources" data-testid="site-sources">
            <summary>{L("Sources & details", "Fuentes y detalles", lang)}</summary>
            <ul>
              {si.sources.map((s) => (
                <li key={s.layer}>
                  <span className="spr-si-source-name">{s.dataset}</span>
                  <span className="spr-si-source-meta">
                    {[s.version, s.datasetDate, `${L("checked", "consultado", lang)} ${s.retrievedAt.slice(0, 16).replace("T", " ")} UTC`, pick(STATUS_LABEL[s.status], lang)].filter(Boolean).join(" · ")}
                  </span>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="spr-si-source-link">
                    {L("View official source", "Ver fuente oficial", lang)} <ExternalLink size={11} aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </details>
    </div>
  );
}
