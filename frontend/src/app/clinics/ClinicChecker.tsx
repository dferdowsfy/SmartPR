'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ClipboardList, MapPin, ShieldCheck } from 'lucide-react';
import municipalities from '../../kb/municipalities.json';
import { SmartPRLogo } from '../components/brand/SmartPRLogo';
import { checklistKeys, emptyAnswers, intakeUrl, kinds, type Answers } from './model';
import { trackAcquisition } from './analytics';
import styles from '../restaurants/restaurants.module.css';

const permitSource = 'https://www.permisos.pr.gov/sobre-nosotros';
const taxSource =
  'https://hacienda.pr.gov/comerciantes/procesos-y-requisitos-que-debe-cumplir-en-el-departamento-hacienda-al-establecer-un-negocio-en-puerto-rico';
const healthSource = 'https://www.salud.pr.gov/CMS/187';
const cncSource = 'https://www.salud.pr.gov/CMS/187';
const boardSource = 'https://www.salud.pr.gov/CMS/187';
const content: Record<string, { en: [string, string]; es: [string, string]; source: string }> = {
  location: {
    en: [
      'Verify the proposed use of your clinical space',
      'Before committing to a location, ask the permitting office to confirm whether the proposed clinic use fits the site and which existing approvals may cover it.',
    ],
    es: [
      'Verifica el uso propuesto del local clínico',
      'Antes de comprometerte con un local, consulta con la oficina de permisos si el uso clínico propuesto encaja y qué aprobaciones existentes pueden cubrirlo.',
    ],
    source: permitSource,
  },
  entity: {
    en: [
      'Form your entity and prepare Hacienda registration',
      'Confirm your legal entity structure and review the Registro de Comerciante and tax responsibilities that may apply to your planned clinical activities.',
    ],
    es: [
      'Constituye tu entidad y prepara el registro en Hacienda',
      'Confirma la estructura jurídica y revisa el Registro de Comerciante y las responsabilidades contributivas que puedan aplicar a tus actividades clínicas.',
    ],
    source: taxSource,
  },
  cnc: {
    en: [
      'Confirm whether a CNC (Certificate of Need) may apply',
      'Certain healthcare facilities may need a Certificado de Necesidad y Conveniencia. Confirm with the Department of Health whether your clinic type and services trigger CNC review — do not assume it always applies or never applies.',
    ],
    es: [
      'Confirma si puede aplicar un CNC (Certificado de Necesidad y Conveniencia)',
      'Ciertas instalaciones de salud pueden necesitar un CNC. Confirma con el Departamento de Salud si el tipo de clínica y servicios requieren revisión de CNC; no asumas que siempre aplica o que nunca aplica.',
    ],
    source: cncSource,
  },
  health: {
    en: [
      'Review Department of Health facility licensing',
      'Ask the Department of Health which facility license or health authorization may apply to your consultorio, outpatient site, laboratory or other clinical operation.',
    ],
    es: [
      'Revisa la licencia de facilidad del Departamento de Salud',
      'Consulta con el Departamento de Salud qué licencia de facilidad o autorización sanitaria puede aplicar a tu consultorio, centro ambulatorio, laboratorio u otra operación clínica.',
    ],
    source: healthSource,
  },
  permit: {
    en: [
      'Review the Permiso Único / OGPe pathway',
      'Confirm operating licenses, use, and certifications that may apply through the Permiso Único process, including fire-safety and other reviews tied to your premises.',
    ],
    es: [
      'Revisa el trámite del Permiso Único / OGPe',
      'Confirma las licencias de uso y certificaciones que puedan aplicar mediante el Permiso Único, incluyendo prevención de incendios y otras revisiones ligadas a tu local.',
    ],
    source: permitSource,
  },
  municipal: {
    en: [
      'Confirm municipal registration steps',
      'Ask your municipality about the patente municipal and the current registration documents and filing process for a healthcare business.',
    ],
    es: [
      'Confirma los trámites municipales',
      'Consulta con tu municipio sobre la patente municipal y los documentos de registro y radicación vigentes para un negocio de salud.',
    ],
    source: taxSource,
  },
  boards: {
    en: [
      'Check professional board licenses for your practitioners',
      'Physicians, nurses and other licensed professionals may need active board credentials for the services you plan to offer. Confirm requirements with the relevant licensing boards.',
    ],
    es: [
      'Verifica las licencias de las juntas profesionales',
      'Médicos, personal de enfermería y otros profesionales licenciados pueden necesitar credenciales activas para los servicios que planeas ofrecer. Confirma los requisitos con las juntas correspondientes.',
    ],
    source: boardSource,
  },
  services: {
    en: [
      'Clarify laboratory or pharmacy service requirements',
      'If you will offer lab or pharmacy services — or you are still deciding — confirm additional health, controlled-substance and facility requirements that may apply. An undecided answer remains an open question.',
    ],
    es: [
      'Aclara los requisitos de laboratorio o farmacia',
      'Si ofrecerás servicios de laboratorio o farmacia — o aún lo estás evaluando — confirma requisitos adicionales de salud, sustancias controladas y facilidad que puedan aplicar. Si no lo has decidido, este punto sigue pendiente.',
    ],
    source: healthSource,
  },
  renovation: {
    en: [
      'Review planned construction or alterations',
      'Describe the work to the permitting office before beginning. Confirm whether construction or other approvals may apply to your clinical renovation scope.',
    ],
    es: [
      'Revisa las obras o modificaciones',
      'Describe las obras a la oficina de permisos antes de comenzar. Confirma si tu remodelación clínica puede requerir permisos de construcción u otras aprobaciones.',
    ],
    source: 'https://www.municipiodebayamon.com/servicios-municipales/oficina-de-permisos/',
  },
};

export default function ClinicChecker({ language: initialLanguage }: { language: 'en' | 'es' }) {
  const [language, setLanguage] = useState(initialLanguage);
  const [answers, setAnswers] = useState<Answers>(emptyAnswers);
  const [result, setResult] = useState<Answers | null>(null);
  const [source, setSource] = useState('direct');
  const heading = useRef<HTMLHeadingElement>(null);
  const visited = useRef(false);
  const es = language === 'es';
  const t = (en: string, spanish: string) => (es ? spanish : en);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const value =
      (params.get('utm_source') || params.get('source') || 'direct').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) ||
      'direct';
    setSource(value);
    if (!visited.current) {
      trackAcquisition('visit', value, initialLanguage);
      visited.current = true;
    }
  }, [initialLanguage]);
  useEffect(() => {
    if (result) heading.current?.focus();
  }, [result]);
  const update = (key: keyof Answers, value: string) => setAnswers((a) => ({ ...a, [key]: value }));
  const next = result ? intakeUrl(result, language, source) : '';
  const signup = `/signup?lang=${language}&next=${encodeURIComponent(next)}`;
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setResult({ ...answers });
    trackAcquisition('checklist_completed', source, language);
  }
  const kindLabels = es
    ? ['Consultorio', 'Ambulatorio / outpatient', 'Laboratorio', 'Otro']
    : ['Consultorio (medical office)', 'Outpatient', 'Lab', 'Other'];
  return (
    <div className={styles.shell} lang={language}>
      <header className={styles.header}>
        <Link href="/" aria-label="SmartPR">
          <SmartPRLogo className={styles.logo} />
        </Link>
        <div className={styles.languages} aria-label={t('Language', 'Idioma')}>
          {(['en', 'es'] as const).map((l) => (
            <button
              key={l}
              onClick={() => {
                setLanguage(l);
                window.history.replaceState(
                  null,
                  '',
                  `${l === 'es' ? '/es/clinicas' : '/clinics'}${window.location.search}`,
                );
              }}
              aria-pressed={language === l}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>
      <main className={styles.main}>
        <aside className={styles.intro}>
          <p className={styles.eyebrow}>
            {t('PUERTO RICO · MEDICAL CLINIC OPENING CHECKER', 'PUERTO RICO · GUÍA PARA ABRIR TU CLÍNICA')}
          </p>
          <h1>
            {t(
              'How to Open a Medical Clinic in Puerto Rico: CNC, Health Licenses & Permits',
              'Cómo abrir una clínica en Puerto Rico: CNC, licencias de Salud y permisos',
            )}
          </h1>
          <p className={styles.lead}>
            {t(
              'Answer five questions to preview entity, CNC, Department of Health, Permiso Único, municipal and professional-board steps worth checking before you invest more time and money.',
              'Contesta cinco preguntas para conocer los pasos de entidad, CNC, Departamento de Salud, Permiso Único, trámites municipales y juntas profesionales que debes verificar antes de invertir más tiempo y dinero.',
            )}
          </p>
          <div className={styles.promises}>
            <p>
              <ClipboardList size={20} />
              {t('A checklist shaped by your clinic plans', 'Una lista según tu plan clínico')}
            </p>
            <p>
              <MapPin size={20} />
              {t('Start with your municipality', 'Comienza con tu municipio')}
            </p>
            <p>
              <ShieldCheck size={20} />
              {t('Free preview. No account required.', 'Vista previa gratuita. Sin crear cuenta.')}
            </p>
          </div>
          <p className={styles.note}>
            {t(
              'SmartPR helps you prepare. Government agencies remain the approving authorities. Nothing here guarantees approval.',
              'SmartPR te ayuda a prepararte. Las agencias gubernamentales conservan la autoridad para aprobar. Nada aquí garantiza una aprobación.',
            )}
          </p>
        </aside>
        <section className={styles.panel} aria-label={t('Clinic checker', 'Guía para tu clínica')}>
          {!result ? (
            <form onSubmit={submit}>
              <p className={styles.kicker}>{t('START WITH FIVE DETAILS', 'COMIENZA CON CINCO DATOS')}</p>
              <h2>{t('What are you planning?', '¿Qué tienes en mente?')}</h2>
              <div className={styles.fields}>
                <label>
                  {t('Municipality', 'Municipio')}
                  <select required value={answers.municipality} onChange={(e) => update('municipality', e.target.value)}>
                    <option value="">{t('Choose a municipality', 'Selecciona un municipio')}</option>
                    {municipalities.map((m) => (
                      <option key={m.id} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('Clinic type', 'Tipo de clínica')}
                  <select value={answers.kind} onChange={(e) => update('kind', e.target.value)}>
                    {kinds.map((kind, i) => (
                      <option key={kind} value={kind}>
                        {kindLabels[i]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t('Where are you with your location?', '¿En qué etapa está tu local?')}
                  <select required value={answers.premises} onChange={(e) => update('premises', e.target.value)}>
                    <option value="">{t('Choose your stage', 'Selecciona tu etapa')}</option>
                    <option value="searching">{t('Still looking for a space', 'Todavía busco un local')}</option>
                    <option value="considering">
                      {t('Considering a space — before signing', 'Estoy evaluando un local, antes de firmar')}
                    </option>
                    <option value="secured">{t('Already have a space', 'Ya tengo un local')}</option>
                  </select>
                </label>
                {(
                  [
                    ['renovation', t('Will you renovate or do construction?', '¿Harás remodelación o construcción?')],
                    [
                      'labPharmacy',
                      t('Will you offer lab or pharmacy services?', '¿Ofrecerás servicios de laboratorio o farmacia?'),
                    ],
                  ] as const
                ).map(([key, legend]) => (
                  <fieldset key={key}>
                    <legend>{legend}</legend>
                    <div className={styles.choices}>
                      {['yes', 'no', 'unknown'].map((v, i) => (
                        <label key={v}>
                          <input
                            type="radio"
                            name={key}
                            required
                            checked={answers[key] === v}
                            onChange={() => update(key, v)}
                            value={v}
                          />
                          <span>{(es ? ['Sí', 'No', 'No sé aún'] : ['Yes', 'No', 'Not sure'])[i]}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
              <button className={styles.primary} type="submit">
                {t('See my preparation checklist', 'Ver mi lista de preparación')}
                <ArrowRight size={20} />
              </button>
              <p className={styles.small}>
                {t('No email or payment needed to see your results.', 'No necesitas correo ni pago para ver tus resultados.')}
              </p>
            </form>
          ) : (
            <div>
              <p className={styles.kicker}>
                {result.municipality} · {t('YOUR PRELIMINARY PLAN', 'TU PLAN PRELIMINAR')}
              </p>
              <h2 ref={heading} tabIndex={-1}>
                {t('Here’s where to start.', 'Aquí puedes comenzar.')}
              </h2>
              <p className={styles.resultIntro}>
                {result.premises === 'secured'
                  ? t(
                      'Start by checking which approvals may cover your space and planned clinical activities.',
                      'Comienza verificando qué aprobaciones pueden cubrir tu local y las actividades clínicas propuestas.',
                    )
                  : t(
                      'Your first priority: verify a proposed clinical space before making a commitment.',
                      'Tu primera prioridad: verifica el local clínico propuesto antes de comprometerte.',
                    )}
              </p>
              <ol className={styles.results}>
                {checklistKeys(result).map((key, i) => (
                  <li key={key}>
                    <span className={styles.number}>{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <h3>{content[key][language][0]}</h3>
                      <p>{content[key][language][1]}</p>
                      <a href={content[key].source} target="_blank" rel="noreferrer">
                        {t('Official source', 'Fuente oficial')}
                      </a>
                    </div>
                  </li>
                ))}
              </ol>
              <p className={styles.disclaimer}>
                {t(
                  'Preliminary guidance, not a complete permit determination or approval. Exact requirements depend on your site, clinic type and services. Confirm with the responsible agencies. Source review: September 8, 2026.',
                  'Orientación preliminar, no una determinación completa de permisos ni una aprobación. Los requisitos dependen del local, tipo de clínica y servicios. Confirma con las agencias responsables. Fuentes revisadas: 8 de septiembre de 2026.',
                )}
              </p>
              <div className={styles.save}>
                <Check size={22} />
                <div>
                  <h3>{t('Turn this into your SmartPR project', 'Convierte esta lista en tu proyecto de SmartPR')}</h3>
                  <p>
                    {t(
                      'Create an account to continue with your answers already filled in, confirm what may apply and prepare your documents.',
                      'Crea una cuenta para continuar con tus respuestas completadas, confirmar qué puede aplicar y preparar tus documentos.',
                    )}
                  </p>
                </div>
              </div>
              <Link
                className={styles.primary}
                href={signup}
                onClick={() => trackAcquisition('signup_clicked', source, language)}
              >
                {t('Create account & continue my plan', 'Crear cuenta y continuar mi plan')}
                <ArrowRight size={20} />
              </Link>
              <button className={styles.back} onClick={() => setResult(null)}>
                {t('Edit my answers', 'Editar mis respuestas')}
              </button>
            </div>
          )}
        </section>
        <section className={styles.panel} style={{ gridColumn: '1 / -1' }} aria-labelledby="clinic-guide">
          <h2 id="clinic-guide">
            {t(
              'How to prepare to open a medical clinic in Puerto Rico',
              'Cómo prepararte para abrir una clínica en Puerto Rico',
            )}
          </h2>
          <p className={styles.resultIntro}>
            {t(
              'Start with your entity, location and planned services. A consultorio, outpatient site, laboratory or other clinic may follow different steps depending on CNC review, Department of Health facility licensing, Permiso Único/OGPe, municipal registration and professional boards.',
              'Comienza con tu entidad, local y servicios propuestos. Un consultorio, centro ambulatorio, laboratorio u otra clínica puede seguir pasos distintos según la revisión de CNC, la licencia de facilidad del Departamento de Salud, el Permiso Único/OGPe, el registro municipal y las juntas profesionales.',
            )}
          </p>
          <ol className={styles.results}>
            {['entity', 'cnc', 'health', 'permit'].map((key, i) => (
              <li key={key}>
                <span className={styles.number}>{i + 1}</span>
                <div>
                  <h3>{content[key][language][0]}</h3>
                  <p>{content[key][language][1]}</p>
                  <a href={content[key].source} target="_blank" rel="noreferrer">
                    {t('Official source', 'Fuente oficial')}
                  </a>
                </div>
              </li>
            ))}
          </ol>
          <h3>
            {t(
              'Does every clinic need a CNC in Puerto Rico?',
              '¿Toda clínica necesita un CNC en Puerto Rico?',
            )}
          </h3>
          <p className={styles.resultIntro}>
            {t(
              'Not necessarily. CNC requirements depend on facility type and services. Confirm with the Department of Health whether a Certificado de Necesidad y Conveniencia may apply to your plans — do not treat this checklist as a determination.',
              'No necesariamente. Los requisitos de CNC dependen del tipo de facilidad y los servicios. Confirma con el Departamento de Salud si un Certificado de Necesidad y Conveniencia puede aplicar a tus planes; no trates esta lista como una determinación.',
            )}
          </p>
          <h3>
            {t(
              'Are clinic permits the same in every municipality?',
              '¿Los permisos de clínica son iguales en todos los municipios?',
            )}
          </h3>
          <p className={styles.resultIntro}>
            {t(
              'Do not assume the same process applies everywhere. Confirm municipal registration, the proposed clinical use of the space and the office responsible for your location before committing to a lease or construction.',
              'No supongas que el mismo proceso aplica en todos los lugares. Confirma los trámites municipales, el uso clínico propuesto y la oficina responsable de tu local antes de comprometerte con un alquiler u obras.',
            )}
          </p>
          <h3>{t('Does this checklist approve my clinic?', '¿Esta lista aprueba mi clínica?')}</h3>
          <p className={styles.resultIntro}>
            {t(
              'No. This is a preliminary preparation tool, not a permit, legal determination or guarantee of approval. Confirm requirements with the responsible agencies. Complete the five questions above to see which preparation topics match your plans.',
              'No. Es una herramienta de preparación preliminar, no un permiso, determinación legal ni garantía de aprobación. Confirma los requisitos con las agencias responsables. Contesta las cinco preguntas para identificar los temas de preparación relacionados con tus planes.',
            )}
          </p>
        </section>
      </main>
      <footer className={styles.footer}>
        <span>© 2026 SmartPR</span>
        <Link href="/privacy">{t('Privacy policy', 'Política de privacidad')}</Link>
        <Link href={es ? '/clinics' : '/es/clinicas'}>{es ? 'English version' : 'Versión en español'}</Link>
      </footer>
    </div>
  );
}
