'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Clock, KeyRound, Phone } from 'lucide-react';
import { SmartPRLogo } from '../components/brand/SmartPRLogo';
import styles from './voice.module.css';

const VOICE_TEL = 'tel:+17405636900';
const VOICE_NUMBER = '+1 (740) 563-6900';

const copy = {
  en: {
    eyebrow: 'SmartPR Voice',
    title: 'Try SmartPR Voice',
    lead: 'Call now and talk it through — get general guidance on the permits and requirements for your business, or verify with your PIN to check your project status by voice.',
    callNow: 'Call Now',
    availability: 'Available 24/7 · English and Spanish',
    pinNote: 'Have your voice PIN ready to access your account.',
  },
  es: {
    eyebrow: 'SmartPR Voice',
    title: 'Prueba SmartPR Voice',
    lead: 'Llama ahora y habla de tu negocio — recibe orientación general sobre los permisos y requisitos, o verifícate con tu PIN para chequear el estatus de tu proyecto por voz.',
    callNow: 'Llamar ahora',
    availability: 'Disponible 24/7 · Español e inglés',
    pinNote: 'Ten tu PIN de voz a la mano para acceder a tu cuenta.',
  },
} as const;

export default function VoiceCallPage({ language: initialLanguage }: { language: 'en' | 'es' }) {
  const [language, setLanguage] = useState(initialLanguage);
  const c = copy[language];
  const es = language === 'es';

  return (
    <div className={styles.shell} lang={language}>
      <header className={styles.header}>
        <Link href={es ? '/es' : '/'} aria-label="SmartPR" className={styles.logo}>
          <SmartPRLogo />
        </Link>
        <div className={styles.languages} aria-label={es ? 'Idioma' : 'Language'}>
          {(['en', 'es'] as const).map((l) => (
            <button
              key={l}
              onClick={() => {
                setLanguage(l);
                window.history.replaceState(null, '', `${l === 'es' ? '/es/voz' : '/voice'}${window.location.search}`);
              }}
              aria-pressed={language === l}
              aria-label={l === 'en' ? 'English' : 'Español'}
              title={l === 'en' ? 'English' : 'Español'}
            >
              {l}
            </button>
          ))}
        </div>
      </header>
      <main className={styles.main}>
        <div className={styles.card}>
          <p className={styles.eyebrow}>{c.eyebrow}</p>
          <h1 className={styles.title}>{c.title}</h1>
          <p className={styles.lead}>{c.lead}</p>
          <a className={styles.callButton} href={VOICE_TEL}>
            <Phone size={22} aria-hidden="true" />
            {c.callNow}
          </a>
          <a className={styles.number} href={VOICE_TEL}>
            {VOICE_NUMBER}
          </a>
          <div className={styles.meta}>
            <p>
              <Clock size={16} aria-hidden="true" />
              {c.availability}
            </p>
            <p>
              <KeyRound size={16} aria-hidden="true" />
              {c.pinNote}
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
