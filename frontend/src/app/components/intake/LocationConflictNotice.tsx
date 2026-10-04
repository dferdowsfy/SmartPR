"use client";

/**
 * Persistent inline notice near the location section when the description
 * and the selected property disagree (or name several possible sites).
 * Presentation only: the decision is applied by the intake through the
 * shared location state (locations/locationState.ts).
 */
import { AlertTriangle, MapPin } from "lucide-react";
import type { Lang } from "../../forms/engine/types";
import { placeLabel, type LocationPrompt, type PromptPlace } from "../../locations/locationState";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

export function LocationConflictNotice({
  prompt, lang, onKeep, onUse, onChooseOnMap, onDismiss,
}: {
  prompt: LocationPrompt;
  lang: Lang;
  onKeep: (place: PromptPlace) => void;
  onUse: (place: PromptPlace) => void;
  onChooseOnMap: () => void;
  onDismiss?: (place: PromptPlace | null) => void;
}) {
  if (prompt.kind === "conflict") {
    const mentioned = placeLabel(prompt.place);
    return (
      <div className="spr-loc-conflict" role="region" aria-live="polite" aria-label={L("Location check", "Verificación de ubicación", lang)} data-testid="location-conflict">
        <AlertTriangle aria-hidden="true" />
        <div className="spr-loc-conflict-body">
          <p>
            {lang === "es"
              ? <>Tu descripción menciona <strong>{mentioned}</strong>, pero la propiedad seleccionada está en <strong>{prompt.current}</strong>. ¿Qué ubicación debe usar este proyecto?</>
              : <>Your description mentions <strong>{mentioned}</strong>, but your selected property is in <strong>{prompt.current}</strong>. Which location should this project use?</>}
          </p>
          <div className="spr-loc-conflict-actions">
            <button type="button" className="spr-loc-btn primary" onClick={() => onKeep(prompt.place)} data-testid="conflict-keep">{L("Keep selected property", "Mantener la propiedad seleccionada", lang)}</button>
            <button type="button" className="spr-loc-btn" onClick={() => onUse(prompt.place)} data-testid="conflict-use">{L("Use location from description", "Usar la ubicación de la descripción", lang)}</button>
            <button type="button" className="spr-loc-btn ghost" onClick={onChooseOnMap} data-testid="conflict-map"><MapPin aria-hidden="true" /> {L("Choose on map", "Elegir en el mapa", lang)}</button>
          </div>
          <p className="spr-loc-conflict-note">{L(`Until you choose, requirements use the selected property in ${prompt.current}.`, `Hasta que elijas, los requisitos usan la propiedad seleccionada en ${prompt.current}.`, lang)}</p>
        </div>
      </div>
    );
  }
  if (prompt.kind === "ambiguous") {
    return (
      <div className="spr-loc-conflict" role="region" aria-live="polite" aria-label={L("Location check", "Verificación de ubicación", lang)} data-testid="location-ambiguous">
        <AlertTriangle aria-hidden="true" />
        <div className="spr-loc-conflict-body">
          <p>{L("Your description mentions more than one place. Which one is the project site?", "Tu descripción menciona más de un lugar. ¿Cuál es el lugar del proyecto?", lang)}</p>
          <div className="spr-loc-conflict-actions">
            {prompt.places.map((p) => (
              <button key={p.key} type="button" className="spr-loc-btn" onClick={() => onUse(p)} data-testid="ambiguous-option">{placeLabel(p)}</button>
            ))}
            <button type="button" className="spr-loc-btn ghost" onClick={onChooseOnMap}><MapPin aria-hidden="true" /> {L("Choose on map", "Elegir en el mapa", lang)}</button>
            {onDismiss && <button type="button" className="spr-loc-btn ghost" onClick={() => onDismiss(null)}>{L("None of these", "Ninguno", lang)}</button>}
          </div>
        </div>
      </div>
    );
  }
  return null;
}
