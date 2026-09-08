'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ClipboardList, MapPin, ShieldCheck } from 'lucide-react';
import municipalities from '../../kb/municipalities.json';
import { SmartPRLogo } from '../components/brand/SmartPRLogo';
import { checklistKeys, emptyAnswers, intakeUrl, kinds, type Answers } from './model';
import { trackAcquisition } from './analytics';
import styles from './restaurants.module.css';

const permitSource = 'https://www.permisos.pr.gov/sobre-nosotros';
const taxSource = 'https://hacienda.pr.gov/comerciantes/procesos-y-requisitos-que-debe-cumplir-en-el-departamento-hacienda-al-establecer-un-negocio-en-puerto-rico';
const alcoholSource = 'https://hacienda.pr.gov/comerciantes/licencias-de-rentas-internas/requisitos-para-cada-tipo-de-licencia-de-rentas-internas';
const content: Record<string, { en: [string, string]; es: [string, string]; source: string }> = {
  location: { en: ['Verify the proposed use of your space', 'Before committing to a location, ask the permitting office to confirm the proposed restaurant use and which existing approvals cover it.'], es: ['Verifica el uso propuesto del local', 'Antes de comprometerte con un local, consulta con la oficina de permisos sobre el uso propuesto y las aprobaciones existentes que lo cubren.'], source: permitSource },
  permit: { en: ['Review the Permiso Único pathway', 'Confirm the operating licenses and certifications applicable to your food business, including sanitary and fire-safety review.'], es: ['Revisa el trámite del Permiso Único', 'Confirma las licencias y certificaciones aplicables a tu negocio de alimentos, incluyendo la revisión sanitaria y de prevención de incendios.'], source: permitSource },
  merchant: { en: ['Prepare your Hacienda registration', 'Review the Registro de Comerciante and the tax responsibilities associated with your planned activities.'], es: ['Prepara tu registro en Hacienda', 'Revisa el Registro de Comerciante y las responsabilidades contributivas asociadas a tus actividades.'], source: taxSource },
  municipal: { en: ['Confirm municipal registration steps', 'Ask your municipality about the patente municipal and its current registration documents and filing process.'], es: ['Confirma los trámites municipales', 'Consulta con tu municipio sobre la patente municipal, los documentos de registro y el proceso de radicación vigente.'], source: alcoholSource },
  alcohol: { en: ['Resolve alcohol licensing', 'If you plan to sell alcohol, confirm the appropriate license category and supporting documents with Hacienda. An undecided answer remains an open question.'], es: ['Aclara la licencia de bebidas alcohólicas', 'Si venderás alcohol, confirma con Hacienda la categoría de licencia y sus documentos. Si aún no lo has decidido, este punto sigue pendiente.'], source: alcoholSource },
  renovation: { en: ['Review planned construction or alterations', 'Describe the work to the permitting office before beginning. Confirm whether construction or other approvals apply to your scope.'], es: ['Revisa las obras o modificaciones', 'Describe las obras a la oficina de permisos antes de comenzar. Confirma si tu proyecto requiere permisos de construcción u otras aprobaciones.'], source: 'https://www.municipiodebayamon.com/servicios-municipales/oficina-de-permisos/' },
};

export default function RestaurantChecker({ language: initialLanguage }: { language: 'en' | 'es' }) {
  const [language, setLanguage] = useState(initialLanguage);
  const [answers, setAnswers] = useState<Answers>(emptyAnswers);
  const [result, setResult] = useState<Answers | null>(null);
  const [source, setSource] = useState('direct');
  const heading = useRef<HTMLHeadingElement>(null);
  const visited = useRef(false);
  const es = language === 'es';
  const t = (en: string, spanish: string) => es ? spanish : en;
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value = (params.get('utm_source') || params.get('source') || 'direct').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || 'direct';
    setSource(value);
    if (!visited.current) { trackAcquisition('visit', value, initialLanguage); visited.current = true; }
  }, [initialLanguage]);
  useEffect(() => { if (result) heading.current?.focus(); }, [result]);
  const update = (key: keyof Answers, value: string) => setAnswers(a => ({ ...a, [key]: value }));
  const next = result ? intakeUrl(result, language, source) : '';
  const signup = `/signup?lang=${language}&next=${encodeURIComponent(next)}`;
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setResult({ ...answers });
    trackAcquisition('checklist_completed', source, language);
  }
  return <div className={styles.shell} lang={language}>
    <header className={styles.header}>
      <Link href="/" aria-label="SmartPR"><SmartPRLogo className={styles.logo} /></Link>
      <div className={styles.languages} aria-label={t('Language', 'Idioma')}>
        {(['en', 'es'] as const).map(l => <button key={l} onClick={() => { setLanguage(l); window.history.replaceState(null, '', `${l === 'es' ? '/es/restaurantes' : '/restaurants'}${window.location.search}`); }} aria-pressed={language === l} aria-label={l === 'en' ? 'English' : 'Español'} title={l === 'en' ? 'English' : 'Español'}>{l}</button>)}
      </div>
    </header>
    <main className={styles.main}>
      <aside className={styles.intro}>
        <p className={styles.eyebrow}>{t('PUERTO RICO · RESTAURANT OPENING CHECKER', 'PUERTO RICO · GUÍA PARA ABRIR TU RESTAURANTE')}</p>
        <h1>{t('Opening a restaurant in Puerto Rico? Start with a clear plan.', '¿Vas a abrir un restaurante en Puerto Rico? Empieza con un plan claro.')}</h1>
        <p className={styles.lead}>{t('Answer five questions to preview the permits, licenses, municipal steps and location issues worth checking before you invest more time and money.', 'Contesta cinco preguntas para conocer los permisos, licencias, trámites municipales y asuntos del local que debes verificar antes de invertir más tiempo y dinero.')}</p>
        <div className={styles.promises}>
          <p><ClipboardList size={20} />{t('A checklist shaped by your plans', 'Una lista según tus planes')}</p>
          <p><MapPin size={20} />{t('Start with your municipality', 'Comienza con tu municipio')}</p>
          <p><ShieldCheck size={20} />{t('Free preview. No account required.', 'Vista previa gratuita. Sin crear cuenta.')}</p>
        </div>
        <p className={styles.note}>{t('SmartPR helps you prepare. Government agencies remain the approving authorities.', 'SmartPR te ayuda a prepararte. Las agencias gubernamentales conservan la autoridad para aprobar.')}</p>
      </aside>
      <section className={styles.panel} aria-label={t('Restaurant checker', 'Guía para tu restaurante')}>
        {!result ? <form onSubmit={submit}>
          <p className={styles.kicker}>{t('START WITH FIVE DETAILS', 'COMIENZA CON CINCO DATOS')}</p>
          <h2>{t('What are you planning?', '¿Qué tienes en mente?')}</h2>
          <div className={styles.fields}>
            <label>{t('Municipality', 'Municipio')}<select required value={answers.municipality} onChange={e => update('municipality', e.target.value)}><option value="">{t('Choose a municipality', 'Selecciona un municipio')}</option>{municipalities.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}</select></label>
            <label>{t('Business type', 'Tipo de negocio')}<select value={answers.kind} onChange={e => update('kind', e.target.value)}>{kinds.map((kind, i) => <option key={kind} value={kind}>{es ? ['Restaurante', 'Café', 'Panadería', 'Restaurante de comida rápida'][i] : kind}</option>)}</select></label>
            <label>{t('Where are you with your location?', '¿En qué etapa está tu local?')}<select required value={answers.premises} onChange={e => update('premises', e.target.value)}><option value="">{t('Choose your stage', 'Selecciona tu etapa')}</option><option value="searching">{t('Still looking for a space', 'Todavía busco un local')}</option><option value="considering">{t('Considering a space — before signing', 'Estoy evaluando un local, antes de firmar')}</option><option value="secured">{t('Already have a space', 'Ya tengo un local')}</option></select></label>
            {(['alcohol', 'renovation'] as const).map(key => <fieldset key={key}><legend>{key === 'alcohol' ? t('Will you sell alcohol?', '¿Venderás alcohol?') : t('Will you renovate or do construction?', '¿Harás remodelación o construcción?')}</legend><div className={styles.choices}>{['yes', 'no', 'unknown'].map((v, i) => <label key={v}><input type="radio" name={key} required checked={answers[key] === v} onChange={() => update(key, v)} value={v} /><span>{(es ? ['Sí', 'No', 'No sé aún'] : ['Yes', 'No', 'Not sure'])[i]}</span></label>)}</div></fieldset>)}
          </div>
          <button className={styles.primary} type="submit">{t('See my preparation checklist', 'Ver mi lista de preparación')}<ArrowRight size={20} /></button>
          <p className={styles.small}>{t('No email or payment needed to see your results.', 'No necesitas correo ni pago para ver tus resultados.')}</p>
        </form> : <div>
          <p className={styles.kicker}>{result.municipality} · {t('YOUR PRELIMINARY PLAN', 'TU PLAN PRELIMINAR')}</p>
          <h2 ref={heading} tabIndex={-1}>{t('Here’s where to start.', 'Aquí puedes comenzar.')}</h2>
          <p className={styles.resultIntro}>{result.premises === 'secured' ? t('Start by checking which approvals cover your space and planned activities.', 'Comienza verificando qué aprobaciones cubren tu local y las actividades propuestas.') : t('Your first priority: verify a proposed space before making a commitment.', 'Tu primera prioridad: verifica el local propuesto antes de comprometerte.')}</p>
          <ol className={styles.results}>{checklistKeys(result).map((key, i) => <li key={key}><span className={styles.number}>{String(i + 1).padStart(2, '0')}</span><div><h3>{content[key][language][0]}</h3><p>{content[key][language][1]}</p><a href={content[key].source} target="_blank" rel="noreferrer">{t('Official source', 'Fuente oficial')}</a></div></li>)}</ol>
          <p className={styles.disclaimer}>{t('Preliminary guidance, not a complete permit determination or approval. Exact requirements depend on your site and activities. Source review: September 8, 2026.', 'Orientación preliminar, no una determinación completa de permisos ni una aprobación. Los requisitos dependen del local y las actividades. Fuentes revisadas: 8 de septiembre de 2026.')}</p>
          <div className={styles.save}><Check size={22} /><div><h3>{t('Turn this into your SmartPR project', 'Convierte esta lista en tu proyecto de SmartPR')}</h3><p>{t('Create an account to continue with your answers already filled in, confirm what applies and prepare your documents.', 'Crea una cuenta para continuar con tus respuestas completadas, confirmar qué aplica y preparar tus documentos.')}</p></div></div>
          <Link className={styles.primary} href={signup} onClick={() => trackAcquisition('signup_clicked', source, language)}>{t('Create account & continue my plan', 'Crear cuenta y continuar mi plan')}<ArrowRight size={20} /></Link>
          <button className={styles.back} onClick={() => setResult(null)}>{t('Edit my answers', 'Editar mis respuestas')}</button>
        </div>}
      </section>
      <section className={styles.panel} style={{ gridColumn: '1 / -1' }} aria-labelledby="restaurant-guide">
        <h2 id="restaurant-guide">{t('How to prepare to open a restaurant in Puerto Rico', 'Cómo prepararte para abrir un restaurante en Puerto Rico')}</h2>
        <p className={styles.resultIntro}>{t('Start with your location and planned activities. A café, bakery or restaurant may follow different steps depending on its premises, municipality, alcohol sales and proposed construction.', 'Comienza con el local y las actividades propuestas. Los pasos para un café, panadería o restaurante pueden variar según el local, municipio, venta de alcohol y obras propuestas.')}</p>
        <ol className={styles.results}>{['location', 'permit', 'merchant'].map((key, i) => <li key={key}><span className={styles.number}>{i + 1}</span><div><h3>{content[key][language][0]}</h3><p>{content[key][language][1]}</p><a href={content[key].source} target="_blank" rel="noreferrer">{t('Official source', 'Fuente oficial')}</a></div></li>)}</ol>
        <h3 className={styles.faqQuestion}>{t('Are restaurant permits the same in every municipality?', '¿Los permisos son iguales en todos los municipios?')}</h3>
        <p className={styles.faqAnswer}>{t('Do not assume the same process applies everywhere. Confirm municipal registration, the proposed use of the space and the office responsible for your location before committing to a lease or construction.', 'No supongas que el mismo proceso aplica en todos los lugares. Confirma los trámites municipales, el uso propuesto y la oficina responsable de tu local antes de comprometerte con un alquiler u obras.')}</p>
        <h3 className={styles.faqQuestion}>{t('Does this checklist approve my restaurant?', '¿Esta lista aprueba mi restaurante?')}</h3>
        <p className={styles.faqAnswer}>{t('No. This is a preliminary preparation tool, not a permit, legal determination or guarantee of approval. Confirm requirements with the responsible agencies. Complete the five questions above to see which preparation topics match your plans.', 'No. Es una herramienta de preparación preliminar, no un permiso, determinación legal ni garantía de aprobación. Confirma los requisitos con las agencias responsables. Contesta las cinco preguntas para identificar los temas de preparación relacionados con tus planes.')}</p>
      </section>
    </main>
    <footer className={styles.footer}><span>© 2026 SmartPR</span><Link href="/privacy">{t('Privacy policy', 'Política de privacidad')}</Link><Link href={es ? '/restaurants' : '/es/restaurantes'}>{es ? 'English version' : 'Versión en español'}</Link></footer>
  </div>;
}
