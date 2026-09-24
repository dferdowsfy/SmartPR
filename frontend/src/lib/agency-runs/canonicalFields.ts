/**
 * Canonical field mappings + normalizers for agency filings.
 *
 * Canonical dotted paths (e.g. "business.legalName") describe SmartPR passport
 * concepts. CANONICAL_LABELS gives each one a SmartPR label (EN + Puerto Rican
 * Spanish) plus per-portal label aliases (suri / deptstate / ogpe) so the
 * agent brief and the UI can name the same field the way each portal names it.
 *
 * Labels only — never values, never secrets.
 */

export function normalizeForAgency(
  value: string,
  kind: "ein" | "phone" | "date" | "text"
): string {
  const raw = typeof value === "string" ? value : String(value ?? "");
  switch (kind) {
    case "ein":
      return raw.replace(/\D/g, "");
    case "phone": {
      const trimmed = raw.trim();
      const leadingPlus = trimmed.startsWith("+") ? "+" : "";
      return leadingPlus + trimmed.replace(/\D/g, "");
    }
    case "date": {
      const t = raw.trim();
      if (!t) return "";
      // ISO: YYYY-MM-DD (optionally with time)
      let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
      if (m) return `${m[2]!.padStart(2, "0")}/${m[3]!.padStart(2, "0")}/${m[1]}`;
      // US: MM/DD/YYYY (accept 1-2 digit parts, - or / separators)
      m = t.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
      if (m) return `${m[1]!.padStart(2, "0")}/${m[2]!.padStart(2, "0")}/${m[3]}`;
      // European-ish: DD/MM/YYYY ambiguous with US — only accept explicit
      // DD.MM.YYYY or DD-Mon-YYYY style inputs.
      m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
      if (m) return `${m[2]!.padStart(2, "0")}/${m[1]!.padStart(2, "0")}/${m[3]}`;
      m = t.match(
        /^(\d{1,2})-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*-(\d{4})$/i
      );
      if (m) {
        const months: Record<string, string> = {
          jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
          jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
        };
        return `${months[m[2]!.toLowerCase()!]}/${m[1]!.padStart(2, "0")}/${m[3]}`;
      }
      // Unparseable — return trimmed as-is rather than inventing a date.
      return t;
    }
    case "text":
      return raw.trim();
  }
}

export interface CanonicalLabel {
  en: string;
  es: string;
  /** Per-portal label aliases keyed by portal slug. */
  agencyAliases: Record<string, string>;
}

export const CANONICAL_LABELS: Record<string, CanonicalLabel> = {
  "business.legalName": {
    en: "Legal business name",
    es: "Nombre legal del negocio",
    agencyAliases: {
      suri: "Nombre del contribuyente",
      deptstate: "Nombre de la entidad",
      ogpe: "Nombre del negocio",
    },
  },
  "business.tradeName": {
    en: "Trade name (DBA)",
    es: "Nombre comercial (DBA)",
    agencyAliases: {
      suri: "Nombre comercial",
      deptstate: "Nombre comercial",
      ogpe: "Nombre comercial",
    },
  },
  "business.entityType": {
    en: "Entity type",
    es: "Tipo de entidad",
    agencyAliases: {
      demo: "Entity type",
      suri: "Tipo de contribuyente",
      deptstate: "Tipo de entidad jurídica",
      ogpe: "Tipo de negocio",
    },
  },
  "business.ein": {
    en: "Employer Identification Number (EIN)",
    es: "Número de Identificación Patronal (EIN)",
    agencyAliases: {
      suri: "Número de Seguro Social Patronal",
      deptstate: "EIN",
      ogpe: "EIN",
    },
  },
  "business.registryNumber": {
    en: "Entity / registry number",
    es: "Número de registro de la entidad",
    agencyAliases: {
      suri: "Número de registro",
      deptstate: "Número de registro",
      ogpe: "Número de registro",
    },
  },
  "contact.fullName": {
    en: "Contact full name",
    es: "Nombre completo del contacto",
    agencyAliases: {
      demo: "Contact full name",
      suri: "Nombre y apellidos",
      deptstate: "Nombre del organizador",
      ogpe: "Nombre del solicitante",
    },
  },
  "contact.email": {
    en: "Email",
    es: "Correo electrónico",
    agencyAliases: {
      demo: "Email",
      suri: "Email",
      deptstate: "Email",
      ogpe: "Email",
    },
  },
  "contact.phone": {
    en: "Phone",
    es: "Teléfono",
    agencyAliases: {
      demo: "Phone (10 digits)",
      suri: "Número de teléfono",
      deptstate: "Teléfono",
      ogpe: "Teléfono",
    },
  },
  "addresses.principalPhysical.line1": {
    en: "Physical address — street",
    es: "Dirección física — calle",
    agencyAliases: {
      demo: "Street address",
      suri: "Dirección física",
      deptstate: "Dirección física",
      ogpe: "Dirección física del local",
    },
  },
  "addresses.principalPhysical.line2": {
    en: "Physical address — line 2",
    es: "Dirección física — línea 2",
    agencyAliases: {
      suri: "Dirección física (línea 2)",
      deptstate: "Dirección física (línea 2)",
      ogpe: "Dirección física (línea 2)",
    },
  },
  "addresses.municipality": {
    en: "Municipality",
    es: "Municipio",
    agencyAliases: {
      demo: "City",
      suri: "Municipio",
      deptstate: "Municipio",
      ogpe: "Municipio",
    },
  },
  "addresses.principalPhysical.postalCode": {
    en: "Postal code",
    es: "Código postal",
    agencyAliases: {
      demo: "Postal code",
      suri: "Código postal",
      deptstate: "Código postal",
      ogpe: "Código postal",
    },
  },
  "addresses.state": {
    en: "State",
    es: "Estado",
    agencyAliases: {
      suri: "Estado",
      deptstate: "Estado",
      ogpe: "Estado",
    },
  },
};

/**
 * Portal slug per filing-config agencyId — matches the agencyAliases keys.
 */
const AGENCY_ID_TO_PORTAL_SLUG: Record<string, string> = {
  HACIENDA_SURI: "suri",
  DEPT_STATE: "deptstate",
  OGPE: "ogpe",
  DEMO_REHEARSAL: "demo",
};

/**
 * Renders the passport-key → portal-label mapping table for the agent task
 * prompt, using the target portal's own field labels so the agent prefills
 * everything the passport already holds instead of stalling or re-asking.
 * Labels only — never values, never secrets.
 */
export function renderPortalFieldMapping(
  agencyId: string | undefined
): string {
  const slug = (agencyId && AGENCY_ID_TO_PORTAL_SLUG[agencyId]) || null;
  const lines = Object.entries(CANONICAL_LABELS).map(([key, label]) => {
    const portalLabel = (slug && label.agencyAliases[slug]) || label.en;
    return `  - ${key} → "${portalLabel}"`;
  });
  return [
    `FIELD MAPPING — passport key → ${slug ? `this portal's` : "portal"} field label (use this table, do not guess):`,
    ...lines,
    `  - Puerto Rico has municipalities, not cities — addresses.municipality fills any City / Ciudad field. Never leave it empty or ask the human when the passport has it.`,
  ].join("\n");
}
