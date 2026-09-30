"use client";

// The site a filing/project concerns: one of the business's saved Passport
// locations, referenced by stable id (PUT /api/matters/:id/location). The
// location's municipio and what it means for requirements live on the
// Passport → Property / Location section.

import { useEffect, useId, useState } from "react";
import { locationAddressLine, type PassportLocationWithGeographies } from "../locations/geo";
import type { Lang } from "../forms/engine/types";

const L = (en: string, es: string, lang: Lang) => (lang === "es" ? es : en);

function label(loc: PassportLocationWithGeographies, lang: Lang): string {
  const muni = loc.geographies.find((g) => g.geography_type === "municipality" && g.determination_method === "SPATIAL_INTERSECTION");
  const name = loc.name || locationAddressLine(loc) || L("Unnamed location", "Ubicación sin nombre", lang);
  return muni?.geography_name ? `${name} — ${muni.geography_name}` : name;
}

export function MatterSiteSelect({
  businessId,
  matterId,
  locationId,
  lang,
}: {
  businessId: string;
  matterId: string;
  locationId: string | null;
  lang: Lang;
}) {
  const selectId = useId();
  const [locations, setLocations] = useState<PassportLocationWithGeographies[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [value, setValue] = useState<string>(locationId ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/businesses/${encodeURIComponent(businessId)}/locations`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as { locations: PassportLocationWithGeographies[]; can_edit?: boolean };
        if (!cancelled) {
          setLocations(data.locations);
          setCanEdit(data.can_edit !== false);
        }
      })
      .catch(() => {
        if (!cancelled) setLocations([]);
      });
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  if (locations === null) return null;
  if (locations.length === 0) {
    return (
      <a href="#business-passport" className="text-xs font-medium text-brand hover:underline">
        {L("Add the site in the Passport", "Agregue el lugar en el Pasaporte", lang)}
      </a>
    );
  }

  const change = async (next: string) => {
    const previous = value;
    setValue(next);
    setStatus("saving");
    try {
      const res = await fetch(`/api/matters/${encodeURIComponent(matterId)}/location`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ location_id: next || null }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("saved");
    } catch {
      setValue(previous);
      setStatus("error");
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label htmlFor={selectId} className="font-semibold text-slate-600">
        {L("Site", "Lugar", lang)}
      </label>
      <select
        id={selectId}
        value={value}
        disabled={!canEdit || status === "saving"}
        onChange={(e) => void change(e.target.value)}
        className="max-w-[16rem] rounded-lg border border-slate-300 px-2 py-1 text-xs text-[#161616] disabled:opacity-60"
        data-testid="matter-site-select"
      >
        <option value="">{L("Not set", "Sin definir", lang)}</option>
        {locations.map((loc) => (
          <option key={loc.id} value={loc.id}>
            {label(loc, lang)}
          </option>
        ))}
      </select>
      <span aria-live="polite" className={status === "error" ? "text-red-700" : "text-slate-500"}>
        {status === "saving" && L("Saving…", "Guardando…", lang)}
        {status === "saved" && L("Saved", "Guardado", lang)}
        {status === "error" && L("Couldn't save", "No se pudo guardar", lang)}
      </span>
    </div>
  );
}
