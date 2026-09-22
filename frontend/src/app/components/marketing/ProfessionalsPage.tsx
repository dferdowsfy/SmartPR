"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "./marketing.module.css";
import { SiteHeader, SiteFooter, useMarketingLanguage, type Language } from "./MarketingChrome";

const copy = {
  EN: {
    kicker: "Professional workspace",
    heroTitle: "Manage every client's Puerto Rico filings in one dashboard.",
    heroSub:
      "SmartPR sits under your practice. You still talk to the client, review the package, and submit. The software removes the retyping, the missed requirement, and the “¿cómo va lo mío?” thread.",
    startPilot: "Start a pilot",
    bookDemo: "Book a demo",
    whoFor: "Gestores · CPAs · Permitting firms · Law firms · Consultants · Multi-entity operators",
    posKicker: "Positioning",
    posTitle: "A tool that makes the firm faster. Not a replacement for the firm.",
    posSub:
      "Clients hire you because someone has to own the filing. SmartPR gives that person a complete path, filled forms, and a status they can see without digging through email.",
    posCards: [
      {
        title: "One dashboard",
        body: "Every client's businesses, filings, documents, and deadlines in one view.",
      },
      {
        title: "Reusable profiles",
        body: "Enter facts once. Formation, SURI, Permiso Único, and renewals reuse the same record.",
      },
      {
        title: "Fewer rejected packages",
        body: "Completeness checks catch missing facts and documents before the agency does.",
      },
    ],
    tableKicker: "Example · multi-client view",
    tableTitle: "A gestor with four businesses, at four different stages.",
    thClient: "Client",
    thType: "Type",
    thStatus: "Status",
    thNext: "Next",
    rows: [
      { client: "Amigos Restaurant · Bayamón", type: "Restaurant", status: "78% ready", next: "Upload lease" },
      { client: "HealthPR · San Juan", type: "Healthcare", status: "40% ready", next: "Estado formation" },
      { client: "Marisquería del Oeste · Mayagüez", type: "Restaurant", status: "Due in 11 days", next: "Patente municipal" },
      { client: "Taller Norte LLC · Arecibo", type: "Workshop", status: "Ready to submit", next: "Review package" },
    ],
    tableCaption: "Example only — sample names and statuses for the professional workspace.",
    firmKicker: "Firm controls",
    firmTitle: "Several people can work a client without mixing files.",
    firmCards: [
      {
        title: "Role-based access",
        body: "Owners, preparers, and reviewers see what their role allows. A junior can prepare. A partner submits.",
      },
      {
        title: "Audit trail",
        body: "Who changed a fact, uploaded a document, or marked a filing ready — on the client record.",
      },
    ],
    pilotKicker: "How a pilot works",
    pilotTitle: "Bring real clients. Measure what changes.",
    pilotCards: [
      {
        num: "01",
        title: "One client — or five",
        body: "Pick filings you already know. The test is whether the path and the package match the work you do now.",
      },
      {
        num: "02",
        title: "We set up the workspace with you",
        body: "Roles, client records, and the first profiles. No training theater.",
      },
      {
        num: "03",
        title: "Run the filings",
        body: "Hours per package, missing-document catches, and time-to-ready get written down. We publish numbers when pilots produce them — not before.",
      },
    ],
    closeTitle: "Start with the book of business you already have.",
    closeSub: "If it does not save your team time on a real client, it does not belong in the firm.",
  },
  ES: {
    kicker: "Espacio profesional",
    heroTitle: "Maneje las radicaciones de Puerto Rico de todos sus clientes en un solo panel.",
    heroSub:
      "SmartPR trabaja bajo su práctica. Usted sigue hablando con el cliente, revisando el paquete y radicando. El software elimina la redigitación, el requisito que se escapa y el hilo de “¿cómo va lo mío?”.",
    startPilot: "Comenzar un piloto",
    bookDemo: "Agendar una demo",
    whoFor: "Gestores · CPAs · Firmas de permisos · Bufetes · Consultores · Operadores con varias entidades",
    posKicker: "Posicionamiento",
    posTitle: "Una herramienta que hace la firma más rápida. No un reemplazo de la firma.",
    posSub:
      "Los clientes lo contratan porque alguien tiene que responder por la radicación. SmartPR le da a esa persona una ruta completa, formularios llenados y un estatus visible sin escarbar en el email.",
    posCards: [
      {
        title: "Un solo panel",
        body: "Los negocios, radicaciones, documentos y vencimientos de cada cliente en una sola vista.",
      },
      {
        title: "Perfiles reutilizables",
        body: "Registre los datos una vez. Formación, SURI, Permiso Único y renovaciones reusan el mismo récord.",
      },
      {
        title: "Menos paquetes rechazados",
        body: "Los chequeos de completitud detectan datos y documentos que faltan antes que la agencia.",
      },
    ],
    tableKicker: "Ejemplo · vista multi-cliente",
    tableTitle: "Un gestor con cuatro negocios, en cuatro etapas distintas.",
    thClient: "Cliente",
    thType: "Tipo",
    thStatus: "Estatus",
    thNext: "Próximo",
    rows: [
      { client: "Amigos Restaurant · Bayamón", type: "Restaurante", status: "78% listo", next: "Subir contrato de alquiler" },
      { client: "HealthPR · San Juan", type: "Salud", status: "40% listo", next: "Formación estatal" },
      { client: "Marisquería del Oeste · Mayagüez", type: "Restaurante", status: "Vence en 11 días", next: "Patente municipal" },
      { client: "Taller Norte LLC · Arecibo", type: "Taller", status: "Listo para radicar", next: "Revisar paquete" },
    ],
    tableCaption: "Ejemplo solamente — nombres y estatus de muestra para el espacio profesional.",
    firmKicker: "Controles de la firma",
    firmTitle: "Varias personas pueden trabajar un cliente sin mezclar archivos.",
    firmCards: [
      {
        title: "Acceso por rol",
        body: "Dueños, preparadores y revisores ven lo que su rol permite. Un junior puede preparar. Un socio radica.",
      },
      {
        title: "Registro de auditoría",
        body: "Quién cambió un dato, subió un documento o marcó una radicación como lista — en el récord del cliente.",
      },
    ],
    pilotKicker: "Cómo funciona un piloto",
    pilotTitle: "Traiga clientes reales. Mida qué cambia.",
    pilotCards: [
      {
        num: "01",
        title: "Un cliente — o cinco",
        body: "Escoja radicaciones que ya conoce. La prueba es si la ruta y el paquete coinciden con el trabajo que hace hoy.",
      },
      {
        num: "02",
        title: "Montamos el espacio con usted",
        body: "Roles, récords de clientes y los primeros perfiles. Sin teatro de adiestramiento.",
      },
      {
        num: "03",
        title: "Corra las radicaciones",
        body: "Horas por paquete, documentos detectados a tiempo y tiempo de preparación se anotan. Publicamos números cuando los pilotos los produzcan — no antes.",
      },
    ],
    closeTitle: "Empiece con la cartera de negocios que ya tiene.",
    closeSub: "Si no le ahorra tiempo a su equipo en un cliente real, no pertenece en la firma.",
  },
} as const;

export default function ProfessionalsPage({ initialLanguage = "EN" }: { initialLanguage?: Language }) {
  const router = useRouter();
  const { language, handleLanguageChange } = useMarketingLanguage(initialLanguage);
  const c = copy[language];
  const home = language === "ES" ? "/es" : "/";

  // Both CTAs enter the free platform directly — the existing guest intake
  // entry the landing page uses. No mailto, no invented routes.
  function goToAssessment() {
    router.push("/?entry=new-business");
  }

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className={styles.shell}>
      <SiteHeader language={language} home={home} variant="pro" onLanguageChange={handleLanguageChange} />

      <main>
        <section className={styles.heroPlain}>
          <p className={styles.eyebrow}>{c.kicker}</p>
          <h1>{c.heroTitle}</h1>
          <p className={styles.heroSub}>{c.heroSub}</p>
          <div className={styles.ctaRow}>
            <button type="button" className={styles.primary} onClick={goToAssessment}>
              {c.startPilot}
            </button>
            <button type="button" className={styles.secondary} onClick={goToAssessment}>
              {c.bookDemo}
            </button>
          </div>
          <p className={styles.escapeHatch}>{c.whoFor}</p>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.posKicker}</p>
            <h2>{c.posTitle}</h2>
            <p className={styles.lead}>{c.posSub}</p>
            <ol className={`${styles.cards} ${styles.cardsThree}`}>
              {c.posCards.map((card) => (
                <li key={card.title} className={styles.card}>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.tableKicker}</p>
            <h2>{c.tableTitle}</h2>
            <div className={styles.clientTableWrap}>
              <table className={styles.clientTable}>
                <thead>
                  <tr>
                    <th scope="col">{c.thClient}</th>
                    <th scope="col">{c.thType}</th>
                    <th scope="col">{c.thStatus}</th>
                    <th scope="col">{c.thNext}</th>
                  </tr>
                </thead>
                <tbody>
                  {c.rows.map((row) => (
                    <tr key={row.client}>
                      <td>{row.client}</td>
                      <td>{row.type}</td>
                      <td>
                        <span className={styles.statusPill}>{row.status}</span>
                      </td>
                      <td>{row.next}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.tableCaption}>{c.tableCaption}</p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.firmKicker}</p>
            <h2>{c.firmTitle}</h2>
            <ol className={styles.cards}>
              {c.firmCards.map((card) => (
                <li key={card.title} className={styles.card}>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionInner}>
            <p className={styles.eyebrow}>{c.pilotKicker}</p>
            <h2>{c.pilotTitle}</h2>
            <ol className={`${styles.cards} ${styles.cardsThree}`}>
              {c.pilotCards.map((card) => (
                <li key={card.title} className={styles.card}>
                  <span>{card.num}</span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.close}>
            <h2>{c.closeTitle}</h2>
            <p className={styles.lead}>{c.closeSub}</p>
            <div className={styles.ctaRow}>
              <button type="button" className={styles.primary} onClick={goToAssessment}>
                {c.startPilot}
              </button>
              <button type="button" className={styles.secondary} onClick={goToAssessment}>
                {c.bookDemo}
              </button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter language={language} variant="pro" />
    </div>
  );
}
