"use client";

import { Building, Building2, Check, HeartPulse, Landmark, Lightbulb, Receipt, ShieldCheck } from "lucide-react";
import styles from "./filingPath.module.css";

type Language = "EN" | "ES";

const STEP_ICONS: Array<typeof Building2> = [
  Building2, // entity registration
  Receipt, // federal tax registration
  Landmark, // Puerto Rico tax registration (Hacienda)
  Building, // municipal registration
  ShieldCheck, // permits & use requirements
  HeartPulse, // health & fire requirements
  Check, // review & submission
];


type Token = { text: string; mark: boolean };

/** Splits `sentence` into ordered, non-overlapping segments, tagging the ones
 * that match an entry in `marks`. Rendered statically — no typing or staged
 * reveal (owner direction 2026-09-20). */
function tokenize(sentence: string, marks: string[]): Token[] {
  const lower = sentence.toLowerCase();
  const hits: { start: number; end: number }[] = [];
  for (const mark of marks) {
    const i = lower.indexOf(mark.toLowerCase());
    if (i < 0) continue;
    hits.push({ start: i, end: i + mark.length });
  }
  hits.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const hit of hits) {
    const last = merged[merged.length - 1];
    if (last && hit.start <= last.end) last.end = Math.max(last.end, hit.end);
    else merged.push({ ...hit });
  }
  const parts: Token[] = [];
  let cursor = 0;
  for (const hit of merged) {
    if (hit.start > cursor) parts.push({ text: sentence.slice(cursor, hit.start), mark: false });
    parts.push({ text: sentence.slice(hit.start, hit.end), mark: true });
    cursor = hit.end;
  }
  if (cursor < sentence.length) parts.push({ text: sentence.slice(cursor), mark: false });
  return parts;
}

const copy = {
  EN: {
    exampleLabel: "Example: a restaurant in Bayamón",
    flow: [
      "Answer a few questions about the business",
      "SmartPR checks it against the regulations",
      "You get what applies, prepared forms, and a ready-to-submit package",
    ],
    mapped: "Your filing path, mapped.",
    summary: "7 agencies · 7 filings",
    sentence: "I want to open a restaurant in Bayamón with 10 employees and outdoor seating.",
    marks: ["restaurant", "Bayamón", "10 employees", "outdoor seating"],
    chips: ["Restaurant", "Bayamón", "10 employees", "Outdoor seating"],
    parseReading: "Reading your business",
    parseDetails: (n: number) => `${n} details identified`,
    parseAgencies: (n: number) => `${n} agencies apply`,
    parseMapped: "Filing sequence mapped",
    agencies: [
      "Department of State",
      "IRS",
      "Hacienda",
      "Municipio de Bayamón",
      "OGPe",
      "Department of Health",
      "Fire Bureau",
    ],
    path: [
      { title: "Entity registration", detail: "Department of State · Corporation or LLC registration" },
      { title: "Federal tax registration", detail: "IRS · Employer Identification Number (EIN)" },
      { title: "Puerto Rico tax registration", detail: "Hacienda · SURI registration and applicable tax accounts" },
      { title: "Municipal registration", detail: "Municipio de Bayamón · Municipal patent and applicable local registrations" },
      { title: "Permits & use requirements", detail: "OGPe · Permiso Único and applicable use requirements" },
      { title: "Health & fire requirements", detail: "Department of Health · Fire Bureau / applicable inspections" },
      { title: "Review & submission", detail: "SmartPR review before you submit" },
    ],
    incentivesLabel: "Possible incentives",
    incentives: [
      "Municipal tax exemption",
      "Small business incentives (Act 60)",
      "Job creation incentive",
    ],
    incentivesNote: "Example only — actual eligibility depends on your full business profile.",
  },
  ES: {
    exampleLabel: "Ejemplo: un restaurante en Bayamón",
    flow: [
      "Contesta unas preguntas sobre el negocio",
      "SmartPR lo verifica contra los reglamentos",
      "Recibes lo que aplica, formularios preparados y un paquete listo para radicar",
    ],
    mapped: "Su ruta de radicación, trazada.",
    summary: "7 agencias · 7 trámites",
    sentence: "Quiero abrir un restaurante en Bayamón con 10 empleados y asientos al aire libre.",
    marks: ["restaurante", "Bayamón", "10 empleados", "asientos al aire libre"],
    chips: ["Restaurante", "Bayamón", "10 empleados", "Asientos al aire libre"],
    parseReading: "Leyendo su negocio",
    parseDetails: (n: number) => `${n} detalles identificados`,
    parseAgencies: (n: number) => `${n} agencias aplican`,
    parseMapped: "Ruta de radicación trazada",
    agencies: [
      "Departamento de Estado",
      "IRS",
      "Hacienda",
      "Municipio de Bayamón",
      "OGPe",
      "Departamento de Salud",
      "Negociado de Bomberos",
    ],
    path: [
      { title: "Registro de entidad", detail: "Departamento de Estado · Registro de corporación o LLC" },
      { title: "Registro contributivo federal", detail: "IRS · Número de identificación patronal (EIN)" },
      { title: "Registro contributivo de Puerto Rico", detail: "Hacienda · Registro en SURI y cuentas contributivas aplicables" },
      { title: "Registro municipal", detail: "Municipio de Bayamón · Patente municipal / registro local aplicable" },
      { title: "Permisos y requisitos de uso", detail: "OGPe · Permiso Único y requisitos de uso aplicables" },
      { title: "Requisitos de salud y bomberos", detail: "Departamento de Salud · Negociado de Bomberos / inspecciones aplicables" },
      { title: "Revisión y radicación", detail: "Revisión de SmartPR antes de presentar" },
    ],
    incentivesLabel: "Posibles incentivos",
    incentives: [
      "Exención de patente municipal",
      "Incentivos para pequeños negocios (Ley 60)",
      "Incentivo por creación de empleos",
    ],
    incentivesNote: "Solo un ejemplo — la elegibilidad real depende del perfil completo de su negocio.",
  },
} as const;

export default function FilingPathStory({ language }: { language: Language }) {
  const c = copy[language];
  const tokens = tokenize(c.sentence, [...c.marks]);

  // Static render: the full sentence, chips, agencies, steps and incentives
  // are all visible immediately. The typewriter and the staged-reveal
  // timeline were removed (owner direction 2026-09-20).
  return (
    <section id="filing-example" className={styles.pin} aria-labelledby="filing-path-title">
      <div className={styles.frame}>
        <p className={styles.exampleEyebrow}>{c.exampleLabel}</p>
        <div className={styles.headingRow}>
          <h2 id="filing-path-title" className={styles.heading}>{c.mapped}</h2>
          <span className={styles.summary}>{c.summary}</span>
        </div>

        <ol className={styles.flow}>
          {c.flow.map((step, i) => (
            <li key={i} className={styles.flowStep}>
              <span className={styles.flowNum}>{String(i + 1).padStart(2, "0")}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <div className={styles.sentence}>
          {tokens.map((token, i) => (
            <span
              key={i}
              className={
                token.mark
                  ? `${styles.tok} ${styles.key} ${styles.marked} ${styles.lifted}`
                  : styles.tok
              }
            >
              {token.text}
            </span>
          ))}
        </div>

        <div className={`${styles.parse} ${styles.on} ${styles.settled}`}>
          <span>{c.parseMapped}</span>
        </div>

        <div className={styles.chips}>
          {c.chips.map((label) => (
            <div key={label} className={`${styles.chip} ${styles.in}`}>
              {label}
            </div>
          ))}
        </div>

        <p className={styles.agencies}>
          {c.agencies.map((agency, i) => (
            <span key={agency} className={`${styles.ag} ${styles.in}`}>
              {agency}
              {i < c.agencies.length - 1 ? <span className={styles.dot}>•</span> : null}
            </span>
          ))}
        </p>

        <div className={styles.stepsWrap}>
          <ol className={styles.steps}>
            {c.path.map((step, i) => {
              const Icon = STEP_ICONS[i];
              return (
                <li key={step.title} className={`${styles.step} ${styles.in}`}>
                  <div className={styles.node}>
                    <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
                  </div>
                  {/* A plain CSS line between fixed-position circles — always
                      geometrically correct, no measurement involved. */}
                  {i < c.path.length - 1 ? <span className={styles.connector} aria-hidden="true" /> : null}
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                </li>
              );
            })}
          </ol>
        </div>

        <div className={styles.incentivesWrap}>
          <p className={styles.incentivesLabel}>{c.incentivesLabel}</p>
          <ul className={styles.incentives}>
            {c.incentives.map((incentive) => (
              <li key={incentive} className={`${styles.incentive} ${styles.in}`}>
                <Lightbulb size={13} strokeWidth={1.75} aria-hidden="true" />
                <span>{incentive}</span>
              </li>
            ))}
          </ul>
          <p className={styles.incentivesNote}>{c.incentivesNote}</p>
        </div>
      </div>
    </section>
  );
}
