'use client';

import { useState } from 'react';

type Lang = 'es' | 'en';

interface Option {
  key: string;
  title: Record<Lang, string>;
  desc: Record<Lang, string>;
}

interface Question {
  key: string;
  title: Record<Lang, string>;
  subtitle: Record<Lang, string>;
  multi: boolean;
  options: Option[];
}

const QUESTIONS: Question[] = [
  {
    key: 'what',
    title: { es: '¿Qué vas a vender u ofrecer?', en: 'What will you sell or offer?' },
    subtitle: { es: 'Si ofreces más de una cosa, escoge la que mande.', en: 'If you offer more than one thing, pick the main one.' },
    multi: false,
    options: [
      { key: 'comida', title: { es: 'Comida o bebida', en: 'Food or drink' }, desc: { es: 'Comida de verdad, bebida, repostería, café…', en: 'Real food, drinks, bakery, coffee…' } },
      { key: 'producto', title: { es: 'Producto físico', en: 'Physical product' }, desc: { es: 'Ropa, artesanía, equipo, mercancía…', en: 'Clothing, crafts, equipment, merch…' } },
      { key: 'servicio', title: { es: 'Servicio', en: 'Service' }, desc: { es: 'Belleza, reparaciones, consultoría, clases…', en: 'Beauty, repairs, consulting, classes…' } },
      { key: 'experiencia', title: { es: 'Experiencia', en: 'Experience' }, desc: { es: 'Hospedaje, turismo, eventos, shows…', en: 'Lodging, tourism, events, shows…' } },
    ],
  },
  {
    key: 'where',
    title: { es: '¿Dónde vas a operar?', en: 'Where will you operate?' },
    subtitle: { es: 'Todo negocio tiene un espacio. También cuenta si es por internet.', en: 'Every business has a space. Online counts too.' },
    multi: false,
    options: [
      { key: 'local', title: { es: 'Local comercial', en: 'Commercial space' }, desc: { es: 'Calle, centro comercial o plaza…', en: 'Street, mall, or plaza…' } },
      { key: 'casa', title: { es: 'Casa u oficina', en: 'Home or office' }, desc: { es: 'Desde tu casa o un estudio…', en: 'From home or a studio…' } },
      { key: 'calle', title: { es: 'En la calle', en: 'On the street' }, desc: { es: 'Carrito, kiosco, pop-up…', en: 'Cart, kiosk, pop-up…' } },
      { key: 'internet', title: { es: 'Por internet', en: 'Online' }, desc: { es: 'Sin espacio físico: e-commerce, digital…', en: 'No physical space: e-commerce, digital…' } },
    ],
  },
  {
    key: 'extras',
    title: { es: '¿Hay algo de esto en tu negocio?', en: 'Does your business include any of this?' },
    subtitle: { es: 'Marca todas las que te apliquen.', en: 'Check all that apply.' },
    multi: true,
    options: [
      { key: 'cocina', title: { es: 'Cocina propia', en: 'Own kitchen' }, desc: { es: 'Preparas comida en tu local…', en: 'You prepare food on site…' } },
      { key: 'alcohol', title: { es: 'Venta de alcohol', en: 'Alcohol sales' }, desc: { es: 'Para consumir en el lugar o para llevar…', en: 'For on-site or takeaway…' } },
      { key: 'musica', title: { es: 'Música o entretenimiento', en: 'Music or entertainment' }, desc: { es: 'Bocina, shows, baile…', en: 'Speakers, shows, dancing…' } },
      { key: 'letrero', title: { es: 'Letrero afuera', en: 'Outdoor sign' }, desc: { es: 'Anuncio visible desde la calle…', en: 'Signage visible from the street…' } },
    ],
  },
  {
    key: 'empleados',
    title: { es: '¿Vas a contratar empleados?', en: 'Will you hire employees?' },
    subtitle: { es: 'Cuenta también a la gente que piensas contratar cuando abras.', en: 'Count people you plan to hire when you open too.' },
    multi: false,
    options: [
      { key: 'si', title: { es: 'Sí, desde que abra', en: 'Yes, from day one' }, desc: { es: '', en: '' } },
      { key: 'despues', title: { es: 'Más adelante', en: 'Later on' }, desc: { es: '', en: '' } },
      { key: 'no', title: { es: 'No, voy a bregar por mi cuenta', en: "No, I'm going solo" }, desc: { es: '', en: '' } },
    ],
  },
  {
    key: 'etapa',
    title: { es: '¿Por dónde vas?', en: 'Where are you at?' },
    subtitle: { es: 'Esto nos ayuda a ponerte los próximos pasos en orden.', en: 'This helps us order your next steps.' },
    multi: false,
    options: [
      { key: 'idea', title: { es: 'Por ahora es una idea', en: "It's just an idea for now" }, desc: { es: 'Quiero saber en qué me estoy metiendo', en: 'I want to know what I\'m getting into' } },
      { key: 'bregando', title: { es: 'Ya estoy bregando con eso', en: "I'm already working on it" }, desc: { es: 'Escogí nombre, estructura o local', en: 'Picked a name, structure, or location' } },
      { key: 'operando', title: { es: 'Ya estoy operando o voy a expandir', en: "I'm operating or expanding" }, desc: { es: 'Quiero ver qué me puede faltar', en: 'I want to see what I might be missing' } },
    ],
  },
];

const T = {
  eyebrow: { es: 'CHEQUEO DE 60 SEGUNDOS', en: '60-SECOND CHECK' },
  headline: { es: '¿Cuánto revolú de permisos trae tu negocio?', en: 'How much permit hassle comes with your business?' },
  sub: {
    es: 'Cinco preguntas para darte una idea clara de los asuntos que tendrías que chequear si vas a montar un negocio en Puerto Rico.',
    en: 'Five questions to give you a clear idea of what you\'d need to check to start a business in Puerto Rico.',
  },
  next: { es: 'Seguimos →', en: 'Continue →' },
  seeResults: { es: 'Ver cómo me fue →', en: 'See my results →' },
  question: { es: 'Pregunta', en: 'Question' },
  of: { es: 'de', en: 'of' },
  resultsEyebrow: { es: 'ASÍ PINTA TU RUTA', en: 'HERE\'S YOUR ROUTE' },
  highHeadline: { es: 'Aquí hay bastante por coordinar', en: "There's a lot to coordinate here" },
  midHeadline: { es: 'Hay varias cosas que chequear', en: 'A few things to check' },
  lowHeadline: { es: 'Relativamente sencillo, pero no te confíes', en: 'Relatively simple, but don\'t get careless' },
  mattersIntro: {
    es: (n: number) => `Te salieron ${n} asuntos que debes chequear antes de pensar que ya estás al día.`,
    en: (n: number) => `You got ${n} items to check before assuming you're all set.`,
  },
  nextMove: { es: 'Tu próxima movida:', en: 'Your next move:' },
  leadHeading: { es: '¿Quieres tu checklist completa?', en: 'Want your full checklist?' },
  leadText: { es: 'Déjame tu email y te la envío.', en: 'Leave your email and I\'ll send it.' },
  emailPlaceholder: { es: 'Tu email', en: 'Your email' },
  leadButton: { es: 'Envíame la checklist', en: 'Send me the checklist' },
  leadSent: { es: '¡Listo! Chequea tu inbox.', en: 'Done! Check your inbox.' },
  explore: { es: 'o sigue explorando en getsmartpr.com', en: 'or keep exploring at getsmartpr.com' },
  download: { es: 'Bajar mi tarjeta', en: 'Download my card' },
  copy: { es: 'Copiar para compartir', en: 'Copy to share' },
  copied: { es: '¡Se copió!', en: 'Copied!' },
  restart: { es: 'Empezar de nuevo', en: 'Start over' },
  disclaimer: {
    es: 'Esto es una orientación, no una determinación legal ni la lista final de tus permisos. Lo que te aplique puede cambiar según la actividad, el municipio y los detalles de tu negocio.',
    en: 'This is guidance, not a legal determination or your final permit list. What applies can change with your activity, municipality, and business details.',
  },
};

interface Matter { es: string; en: string }

function buildMatters(answers: Record<string, string[]>): Matter[] {
  const matters: Matter[] = [
    { es: 'Registro del negocio', en: 'Business registration' },
    { es: 'Hacienda y registro de comerciante', en: 'Hacienda merchant registration' },
  ];
  const where = answers.where?.[0];
  const extras = answers.extras || [];
  const empleados = answers.empleados?.[0];
  if (where && where !== 'internet') matters.push({ es: 'Permiso de uso y operación', en: 'Use and operation permit' });
  if (where === 'local') matters.push({ es: 'Municipio', en: 'Municipality' });
  if (answers.what?.[0] === 'comida' && extras.includes('cocina'))
    matters.push({ es: 'Salud y manejo de alimentos', en: 'Health and food handling' });
  if (extras.includes('alcohol')) matters.push({ es: 'Licencia para vender alcohol', en: 'Alcohol sales license' });
  if (extras.includes('musica')) matters.push({ es: 'Música y entretenimiento', en: 'Music and entertainment' });
  if (extras.includes('letrero')) matters.push({ es: 'Permiso de letrero', en: 'Signage permit' });
  if (empleados === 'si' || empleados === 'despues')
    matters.push({ es: 'Nómina, seguros y retenciones', en: 'Payroll, insurance, and withholding' });
  return matters;
}

function nextMoveText(answers: Record<string, string[]>, lang: Lang): string {
  const extras = answers.extras || [];
  if (lang === 'es') {
    if (extras.includes('alcohol'))
      return 'brega primero con el uso del espacio y tu registro de comerciante. La licencia de alcohol tarda, así que no la dejes para lo último. El orden importa, porque un trámite puede depender de otro.';
    return 'brega primero con el uso del espacio y tu registro de comerciante. Después, confirma los asuntos especiales que te salieron arriba. El orden importa, porque un trámite puede depender de otro.';
  }
  if (extras.includes('alcohol'))
    return 'start with your space\'s permitted use and your merchant registration. The alcohol license takes a while, so don\'t leave it for last. Order matters — one filing can depend on another.';
  return 'start with your space\'s permitted use and your merchant registration. Then confirm the special items above. Order matters — one filing can depend on another.';
}

export default function QuizClient() {
  const [lang, setLang] = useState<Lang>('es');
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [email, setEmail] = useState('');
  const [leadState, setLeadState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [copied, setCopied] = useState(false);

  const done = step >= QUESTIONS.length;
  const q = QUESTIONS[Math.min(step, QUESTIONS.length - 1)];
  const selected = answers[q.key] || [];
  const canNext = selected.length > 0;

  function toggle(key: string, optionKey: string, multi: boolean) {
    setAnswers((prev) => {
      if (multi) {
        const cur = prev[key] || [];
        return { ...prev, [key]: cur.includes(optionKey) ? cur.filter((k) => k !== optionKey) : [...cur, optionKey] };
      }
      return { ...prev, [key]: [optionKey] };
    });
  }

  const matters = done ? buildMatters(answers) : [];
  const score = Math.min(10, matters.length + 3);
  const headline = score >= 8 ? T.highHeadline[lang] : score >= 5 ? T.midHeadline[lang] : T.lowHeadline[lang];

  async function submitLead() {
    if (!email.includes('@')) return;
    setLeadState('sending');
    try {
      const res = await fetch('/api/quiz-lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, answers, lang, score, matters: matters.map((m) => m[lang]) }),
      });
      setLeadState(res.ok ? 'sent' : 'error');
    } catch {
      setLeadState('error');
    }
  }

  function copyShare() {
    const text = `${T.headline[lang]} ${typeof window !== 'undefined' ? window.location.href : ''}`;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row" style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif' }}>
      {/* Brand panel */}
      <aside className="md:w-[42%] md:min-h-screen md:sticky md:top-0 p-8 md:p-12 flex flex-col justify-center relative overflow-hidden" style={{ background: '#0f2e26' }}>
        <div className="relative z-10">
          <div className="text-xs font-bold tracking-[0.2em] mb-4" style={{ color: '#c8e04a' }}>{T.eyebrow[lang]}</div>
          <h1 className="text-white font-bold leading-tight mb-4" style={{ fontSize: 'clamp(28px,4vw,44px)', fontFamily: 'Georgia,"Times New Roman",serif' }}>
            {T.headline[lang]}
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: '#b9cdc4' }}>{T.sub[lang]}</p>
        </div>
        <div className="absolute -right-24 top-1/4 w-72 h-72 rounded-full border-[28px] pointer-events-none" style={{ borderColor: '#1a4438' }} />
        <div className="absolute -left-10 -bottom-10 w-40 h-40 rounded-full border-[18px] pointer-events-none" style={{ borderColor: '#1a4438' }} />
      </aside>

      {/* Quiz panel */}
      <main className="flex-1 p-6 md:p-12 bg-white">
        <div className="max-w-xl mx-auto">
          <div className="flex justify-end mb-6">
            <div className="inline-flex rounded-full border border-gray-200 text-xs font-semibold overflow-hidden">
              <button onClick={() => setLang('es')} className="px-3 py-1.5" style={{ background: lang === 'es' ? '#0f2e26' : 'transparent', color: lang === 'es' ? '#fff' : '#555' }}>ES</button>
              <button onClick={() => setLang('en')} className="px-3 py-1.5" style={{ background: lang === 'en' ? '#0f2e26' : 'transparent', color: lang === 'en' ? '#fff' : '#555' }}>EN</button>
            </div>
          </div>

          {!done ? (
            <div>
              <div className="text-xs font-semibold text-gray-500 mb-1">{T.question[lang]} {step + 1} {T.of[lang]} {QUESTIONS.length}</div>
              <div className="h-1.5 rounded-full bg-gray-100 mb-6 overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${((step + 1) / QUESTIONS.length) * 100}%`, background: '#c8e04a' }} />
              </div>
              <h2 className="text-2xl font-bold mb-2" style={{ color: '#12212f' }}>{q.title[lang]}</h2>
              <p className="text-sm text-gray-500 mb-6">{q.subtitle[lang]}</p>
              <div className="space-y-3 mb-8">
                {q.options.map((o) => {
                  const active = selected.includes(o.key);
                  return (
                    <button
                      key={o.key}
                      onClick={() => toggle(q.key, o.key, q.multi)}
                      className="w-full text-left rounded-xl border p-4 transition-all"
                      style={{
                        borderColor: active ? '#0f2e26' : '#e5e9ec',
                        background: active ? '#f0f7f2' : '#fff',
                        boxShadow: active ? '0 0 0 1px #0f2e26' : 'none',
                      }}
                    >
                      <div className="font-bold text-[15px]" style={{ color: '#12212f' }}>{o.title[lang]}</div>
                      {o.desc[lang] && <div className="text-[13px] text-gray-500 mt-0.5">{o.desc[lang]}</div>}
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => canNext && setStep(step + 1)}
                  disabled={!canNext}
                  className="px-6 py-3 rounded-xl font-bold text-white text-[15px]"
                  style={{ background: canNext ? '#0f2e26' : '#c3ccd2', cursor: canNext ? 'pointer' : 'not-allowed' }}
                >
                  {step === QUESTIONS.length - 1 ? T.seeResults[lang] : T.next[lang]}
                </button>
              </div>
            </div>
          ) : (
            <div>
              {/* Result card */}
              <div className="rounded-2xl p-6 md:p-8 mb-6 relative overflow-hidden" style={{ background: '#0f2e26' }}>
                <div className="flex justify-between items-start">
                  <div>
                    <div className="text-xs font-bold tracking-[0.2em] mb-2" style={{ color: '#c8e04a' }}>{T.resultsEyebrow[lang]}</div>
                    <h2 className="text-white font-bold text-2xl leading-tight" style={{ fontFamily: 'Georgia,"Times New Roman",serif' }}>{headline}</h2>
                  </div>
                  <div className="text-white font-bold text-xl whitespace-nowrap ml-4">{score} /10</div>
                </div>
              </div>

              <p className="text-[15px] mb-4" style={{ color: '#12212f' }}>{T.mattersIntro[lang](matters.length)}</p>
              <div className="flex flex-wrap gap-2 mb-6">
                {matters.map((m) => (
                  <span key={m.es} className="px-3 py-1.5 rounded-full text-[13px] font-semibold" style={{ background: '#eef4ef', color: '#0f2e26' }}>
                    {m[lang]}
                  </span>
                ))}
              </div>

              <div className="rounded-xl p-4 mb-8" style={{ background: '#f7faf7', border: '1px solid #e5e9ec' }}>
                <span className="font-bold text-[15px]" style={{ color: '#12212f' }}>{T.nextMove[lang]} </span>
                <span className="text-[15px]" style={{ color: '#3c4b5a' }}>{nextMoveText(answers, lang)}</span>
              </div>

              {/* Lead capture */}
              <div className="rounded-2xl border p-6 mb-6" style={{ borderColor: '#e5e9ec' }}>
                <h3 className="font-bold text-lg mb-1" style={{ color: '#12212f' }}>{T.leadHeading[lang]}</h3>
                <p className="text-sm text-gray-500 mb-4">{T.leadText[lang]}</p>
                {leadState === 'sent' ? (
                  <div className="font-semibold" style={{ color: '#0f2e26' }}>{T.leadSent[lang]}</div>
                ) : (
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={T.emailPlaceholder[lang]}
                      className="flex-1 rounded-xl border px-4 py-3 text-[15px] outline-none"
                      style={{ borderColor: '#e5e9ec' }}
                    />
                    <button
                      onClick={submitLead}
                      disabled={leadState === 'sending' || !email.includes('@')}
                      className="px-6 py-3 rounded-xl font-bold text-white text-[15px] whitespace-nowrap"
                      style={{ background: '#0f2e26', opacity: leadState === 'sending' || !email.includes('@') ? 0.5 : 1 }}
                    >
                      {T.leadButton[lang]}
                    </button>
                  </div>
                )}
                <a href="https://www.getsmartpr.com" className="text-[13px] mt-3 inline-block underline" style={{ color: '#5b6b7b' }}>
                  {T.explore[lang]}
                </a>
              </div>

              <div className="flex flex-wrap gap-2 mb-6">
                <button onClick={copyShare} className="px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: '#eef4ef', color: '#0f2e26' }}>
                  {copied ? T.copied[lang] : T.copy[lang]}
                </button>
                <button onClick={() => { setStep(0); setAnswers({}); setEmail(''); setLeadState('idle'); }} className="px-4 py-2.5 text-sm font-semibold underline" style={{ color: '#5b6b7b' }}>
                  {T.restart[lang]}
                </button>
              </div>

              <p className="text-xs leading-relaxed" style={{ color: '#8a99a8' }}>{T.disclaimer[lang]}</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
