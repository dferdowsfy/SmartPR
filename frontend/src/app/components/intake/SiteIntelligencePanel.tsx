"use client";

// Site intelligence for a confirmed pin: grouped, color-coded answers from
// the official maps (Flood · Land & zoning · Site · Environmental), the
// material considerations raised above them, and — one click away — the
// details and the sources. Everything stays in SmartPR; official sources are
// only linked from the collapsed "Sources & details".

import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, HelpCircle, Info, Leaf, Map, Mountain, RefreshCw, Waves } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { Lang } from "../../forms/engine/types";
import type { SiteLayers } from "../../locations/layers";
import { buildSiteIntelligence, type PillTone, type ProviderStatus, type SiteGroupId, type SourceAgencyKey } from "../../locations/siteIntelligence";

/** Agency marks (public/sources); FEMA is a plain text badge. */
const SOURCE_ICON: Record<SourceAgencyKey, string> = {
  fema: "/sources/fema.svg",
  jp: "/sources/jp.png",
  crim: "/sources/crim.png",
  usgs: "/sources/usgs.png",
  noaa: "/sources/noaa.png",
};

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

type SiteSourceView = ReturnType<typeof buildSiteIntelligence>["sources"][number];

/** One official source: what it answered, why it matters, version/date and the link. */
function SourceArticle({ s, lang }: { s: SiteSourceView; lang: Lang }) {
  return (
    <article className="spr-si-source" data-agency={s.agencyKey} data-status={s.status}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={SOURCE_ICON[s.agencyKey]} alt={s.agency} className="spr-si-source-logo" width={28} height={28} />
      <div className="spr-si-source-body">
        <div className="spr-si-source-head">
          <span className="spr-si-source-name">{s.dataset}</span>
          <span className={`spr-si-status spr-si-status-${s.status}`}>{pick(STATUS_LABEL[s.status], lang)}</span>
        </div>
        {s.answer && <p className="spr-si-source-answer">{pick(s.answer, lang)}</p>}
        {s.meaning && (
          <p className="spr-si-source-meaning">
            <strong>{L("Why this matters", "Por qué importa", lang)}: </strong>
            {pick(s.meaning, lang)}
          </p>
        )}
        <span className="spr-si-source-meta">
          {[s.version, s.datasetDate, `${L("checked", "consultado", lang)} ${s.retrievedAt.slice(0, 16).replace("T", " ")} UTC`].filter(Boolean).join(" · ")}
        </span>
        <a href={s.url} target="_blank" rel="noopener noreferrer" className="spr-si-source-link">
          {L("View official source", "Ver fuente oficial", lang)} <ExternalLink size={11} aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

export function SiteIntelligencePanel({
  layers,
  lang,
  municipality,
  address,
  onRetry,
  variant = "cards",
}: {
  layers: SiteLayers;
  lang: Lang;
  municipality?: string | null;
  address?: string | null;
  onRetry?: () => void;
  /** "rows": Requirements page — advisory banners + one compact row per group. */
  variant?: "cards" | "rows";
}) {
  const si = buildSiteIntelligence(layers, { municipality, address });
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<SiteGroupId | null>(null);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const rows = variant === "rows";
  const groupOf = (layer: string) =>
    si.groups.find((g) => g.pills.some((p) => p.layer === layer) || g.details.some((d) => d.layer === layer))?.id ?? null;
  /** Banner "View map details" → open that group's source details and bring them into view. */
  const showGroup = (id: SiteGroupId | null) => {
    if (!id) { setSourcesOpen(true); return; }
    setOpenGroup(id);
    requestAnimationFrame(() => rootRef.current?.querySelector(`[data-group="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const agencyKeys = [...new Set(si.sources.map((s) => s.agencyKey))];
  const anyUnavailable = si.groups.some((g) => g.pills.some((p) => p.status === "unavailable"));
  return (
    <div ref={rootRef} className={`spr-si${rows ? " spr-si-rows" : ""}`} data-testid="site-intelligence">
      {si.considerations.length > 0 && (
        <div className="spr-si-alerts">
          {si.considerations.map((c, i) => (
            <div key={i} className={`spr-si-alert spr-si-alert-${c.tone}`} role="note" data-testid="site-consideration" data-layer={c.layer} data-tone={c.tone}>
              <AlertTriangle size={16} aria-hidden="true" />
              {rows ? (
                <span className="spr-si-alert-body">
                  <strong className="spr-si-alert-title">
                    {/flood/i.test(c.layer)
                      ? L("Flood advisory detected", "Aviso de inundación detectado", lang)
                      : L("Site consideration", "Consideración del lugar", lang)}
                  </strong>
                  <span>{pick(c.text, lang)}</span>
                  <button type="button" className="spr-si-alert-link" onClick={() => showGroup(groupOf(c.layer))} data-testid="site-consideration-details">
                    {L("View map details", "Ver detalles del mapa", lang)} →
                  </button>
                </span>
              ) : (
                <span>
                  <strong>{L("Site consideration", "Consideración del lugar", lang)}: </strong>
                  {pick(c.text, lang)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="spr-si-groups">
        {si.groups.map((g) => {
          const Icon = GROUP_ICON[g.id];
          const groupLayers = new Set([...g.pills.map((p) => p.layer), ...g.details.map((d) => d.layer)]);
          const groupSources = si.sources.filter((src) => src.layers.some((l) => groupLayers.has(l)));
          const open = openGroup === g.id;
          const pills = (
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
          );
          return (
            <section key={g.id} className="spr-si-group" data-group={g.id} aria-labelledby={`${panelId}-${g.id}`}>
              <div className="spr-si-group-head">
                <h4 className="spr-si-group-title" id={`${panelId}-${g.id}`}>
                  {rows ? <span className="spr-si-group-icon" aria-hidden="true"><Icon size={16} /></span> : <Icon size={14} aria-hidden="true" />} {pick(g.title, lang)}
                </h4>
                {rows && pills}
                {groupSources.length > 0 && (
                  <button
                    type="button"
                    className="spr-si-group-toggle"
                    aria-expanded={open}
                    aria-controls={`${panelId}-${g.id}-sources`}
                    onClick={() => setOpenGroup(open ? null : g.id)}
                    data-testid="site-group-sources-toggle"
                  >
                    {!rows && <ChevronDown size={14} aria-hidden="true" className={`spr-si-group-chevron${open ? " open" : ""}`} />}
                    {rows
                      ? L(`Source details (${groupSources.length})`, `Detalles de la fuente (${groupSources.length})`, lang)
                      : open ? L("Hide source details", "Ocultar detalles de la fuente", lang) : L(`Source details (${groupSources.length})`, `Detalles de la fuente (${groupSources.length})`, lang)}
                    {rows && <ChevronRight size={16} aria-hidden="true" className={`spr-si-group-chevron${open ? " open" : ""}`} />}
                  </button>
                )}
              </div>
              {!rows && pills}
              {open && (
                <div className="spr-si-group-sources" id={`${panelId}-${g.id}-sources`} data-testid="site-group-sources">
                  {groupSources.map((src) => <SourceArticle key={src.url} s={src} lang={lang} />)}
                </div>
              )}
            </section>
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

      <div className="spr-si-sources-bar">
        <button
          type="button"
          className="spr-si-sources-btn"
          aria-expanded={sourcesOpen}
          aria-controls={panelId}
          onClick={() => setSourcesOpen((o) => !o)}
          data-testid="site-sources-button"
        >
          <span className="spr-si-source-icons" aria-hidden="true">
            {agencyKeys.map((k) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={k} src={SOURCE_ICON[k]} alt="" className="spr-si-source-icon" width={18} height={18} />
            ))}
          </span>
          {L("Sources", "Fuentes", lang)}
        </button>
      </div>

      {sourcesOpen && (
        <div className="spr-si-sources-panel" id={panelId} data-testid="site-sources">
          {si.sources.map((src) => <SourceArticle key={src.url} s={src} lang={lang} />)}
          <p className="spr-si-wetlands">
            {L("Wetlands (USFWS National Wetlands Inventory): not checked yet.", "Humedales (Inventario Nacional de Humedales del USFWS): aún no se verifican.", lang)}
          </p>
        </div>
      )}
    </div>
  );
}
