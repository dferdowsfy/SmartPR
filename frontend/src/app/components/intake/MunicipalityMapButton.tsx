"use client";

// "Find on map" for intake questions that need a physical location — a
// construction or renovation site, a solar/energy project, new premises, a
// facility. The municipio is determined from the pin by official Census
// boundaries (not typed text), which is what drives SmartPR's municipal and
// municipio-designation rules. Optionally saves the site to the business's
// Passport locations for reuse.

import { useState } from "react";
import { MapPin } from "lucide-react";
import { LocationPickerDialog, type PickedSite } from "../../businesses/LocationPickerDialog";
import { formatCoordinate, normalizeMunicipio } from "../../locations/geo";
import type { Lang } from "../../forms/engine/types";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

export function MunicipalityMapButton({
  lang,
  currentMunicipality,
  businessId,
  onPicked,
}: {
  lang: Lang;
  /** The municipality the question currently holds (to keep the note honest). */
  currentMunicipality: string;
  /** A persisted business the site may be saved to; null for guests / new drafts. */
  businessId: string | null;
  onPicked: (site: PickedSite) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedSite | null>(null);
  // The note describes the pin only while the answer still comes from it.
  const showNote =
    picked && normalizeMunicipio(picked.placement.municipality.name) === normalizeMunicipio(currentMunicipality);

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand hover:underline"
        data-testid="intake-find-on-map"
      >
        <MapPin className="h-4 w-4" aria-hidden="true" />
        {L("Find the site on the map", "Buscar el lugar en el mapa", lang)}
      </button>
      {showNote && picked && (
        <p className="mt-1 text-xs text-slate-600" data-testid="intake-map-note" role="status">
          {L("From the map pin", "Del pin en el mapa", lang)}: {picked.placement.barrio ? `${picked.placement.barrio.name}, ` : ""}
          {picked.placement.municipality.name} ({formatCoordinate(picked.latitude, 5)}, {formatCoordinate(picked.longitude, 5)})
          {picked.savedLocation ? L(" — saved to the Passport", " — guardado en el Pasaporte", lang) : ""}
        </p>
      )}
      {open && (
        <LocationPickerDialog
          mode="pick"
          lang={lang}
          businessId={businessId}
          offerSave={Boolean(businessId)}
          onClose={() => setOpen(false)}
          onPicked={(site) => {
            setPicked(site);
            setOpen(false);
            onPicked(site);
          }}
        />
      )}
    </div>
  );
}
