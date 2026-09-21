import type { Metadata } from 'next';
import VoiceCallPage from '../../voice/VoiceCallPage';

export const metadata: Metadata = {
  title: 'Prueba SmartPR Voice — Llama ahora | SmartPR',
  description:
    'Llama a SmartPR Voice al +1 (740) 563-6900 para orientación sobre permisos y requisitos para tu negocio en Puerto Rico. Disponible 24/7 en español e inglés.',
  alternates: { canonical: '/es/voz', languages: { en: '/voice', es: '/es/voz' } },
  openGraph: {
    title: 'Prueba SmartPR Voice',
    description: 'Llama ahora y habla de tu negocio — orientación sobre permisos y requisitos, por teléfono.',
    url: '/es/voz',
    locale: 'es_PR',
  },
};

export default function VozPage() {
  return <VoiceCallPage language="es" />;
}
