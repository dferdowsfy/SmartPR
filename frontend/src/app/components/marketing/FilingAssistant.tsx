"use client";

import styles from "./filingAssistant.module.css";

type Language = "EN" | "ES";

const copy = {
  EN: {
    eyebrow: "Assisted live filing",
    beta: "Beta",
    title: "Skip the SURI maze.",
    lead: "The assistant opens the government website for you and fills in the forms with your business info. You watch it work, step by step. When it needs something only you can do — your login, a certification, a payment, or your approval — it stops and asks. At the end, you review everything and click submit yourself.",
    points: [
      "Opens the real government site and fills it in for you.",
      "Stops and asks when it needs you — your login, a captcha, or a payment.",
      "You review and submit. Nothing gets filed without you.",
    ],
    chatAlt:
      "Preview of the SmartPR filing assistant chat: it opens the SURI website, fills in the form from the business profile, pauses to ask for the user's SURI login, and waits for the user to review and submit.",
    chatTitle: "Filing assistant",
    chatSub: "SURI · Merchant registration",
    m1: "Opening the SURI website…",
    m2: "Filling in your business name, address, and contact info…",
    m3: "Uploading your lease agreement…",
    paused: "Paused — I need your SURI login to keep going.",
    takeover: "Take over",
    resume: "Resume",
    ready: "Ready for your review — you click submit.",
  },
  ES: {
    eyebrow: "Trámite asistido en vivo",
    beta: "Beta",
    title: "Sáltate el revolú de SURI.",
    lead: "El asistente abre la página del gobierno por ti y llena los formularios con los datos de tu negocio. Lo ves trabajar paso a paso. Cuando necesita algo que solo tú puedes hacer — tu inicio de sesión, una certificación, un pago o tu aprobación — se detiene y te avisa. Al final, revisas todo y lo envías tú mismo.",
    points: [
      "Abre la página real del gobierno y la llena por ti.",
      "Se detiene y te avisa cuando te necesita — tu inicio de sesión, un captcha o un pago.",
      "Revisas y envías tú. Nada se radica sin ti.",
    ],
    chatAlt:
      "Vista previa del chat del asistente de trámite de SmartPR: abre la página de SURI, llena el formulario con los datos del negocio, se detiene para pedir el inicio de sesión del usuario y espera a que el usuario revise y envíe.",
    chatTitle: "Asistente de trámite",
    chatSub: "SURI · Registro de comerciante",
    m1: "Abriendo la página de SURI…",
    m2: "Llenando el nombre, la dirección y el contacto de tu negocio…",
    m3: "Subiendo tu contrato de arrendamiento…",
    paused: "En pausa — necesito que inicies sesión en SURI para seguir.",
    takeover: "Tomar el control",
    resume: "Continuar",
    ready: "Listo para tu revisión — tú le das a enviar.",
  },
} as const;

export default function FilingAssistant({
  language,
  cta,
  onStart,
}: {
  language: Language;
  cta: string;
  onStart: () => void;
}) {
  const c = copy[language];
  return (
    <div className={styles.wrap}>
      <div className={styles.copy}>
        <p className={styles.eyebrow}>
          {c.eyebrow} <span className={styles.betaPill}>{c.beta}</span>
        </p>
        <h2>{c.title}</h2>
        <p className={styles.lead}>{c.lead}</p>
        <ul className={styles.points}>
          {c.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className={styles.cta}>
          <button type="button" className={styles.primary} onClick={onStart}>
            {cta}
          </button>
        </div>
      </div>
      <div className={styles.chatCol}>
        <div className={styles.chat} role="img" aria-label={c.chatAlt}>
          <div className={styles.chatHead} aria-hidden="true">
            <span className={styles.chatAvatar} />
            <div className={styles.chatHeadText}>
              <p className={styles.chatTitle}>{c.chatTitle}</p>
              <p className={styles.chatSub}>{c.chatSub}</p>
            </div>
            <span className={styles.betaPill}>{c.beta}</span>
          </div>
          <div className={styles.chatBody} aria-hidden="true">
            <div className={styles.msg}>
              <span className={styles.pulse} />
              <span>{c.m1}</span>
            </div>
            <div className={styles.msg}>
              <span className={styles.pulse} />
              <span>{c.m2}</span>
            </div>
            <div className={styles.msg}>
              <span className={styles.pulse} />
              <span>{c.m3}</span>
            </div>
            <div className={styles.pauseCard}>
              <p>{c.paused}</p>
              <div className={styles.pauseBtns}>
                <span className={styles.pauseBtnPrimary}>{c.takeover}</span>
                <span className={styles.pauseBtn}>{c.resume}</span>
              </div>
            </div>
            <div className={`${styles.msg} ${styles.readyMsg}`}>
              <span className={styles.check}>✓</span>
              <span>{c.ready}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
