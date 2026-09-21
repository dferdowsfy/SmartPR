import type { Metadata } from 'next';
import VoiceCallPage from './VoiceCallPage';

export const metadata: Metadata = {
  title: 'Try SmartPR Voice — Call now | SmartPR',
  description:
    'Call SmartPR Voice at +1 (740) 563-6900 for guidance on Puerto Rico business permits and requirements. Available 24/7 in English and Spanish.',
  alternates: { canonical: '/voice', languages: { en: '/voice', es: '/es/voz' } },
  openGraph: {
    title: 'Try SmartPR Voice',
    description: 'Call now and talk it through — guidance on your business permits and requirements, by phone.',
    url: '/voice',
    locale: 'en_US',
  },
};

export default function VoicePage() {
  return <VoiceCallPage language="en" />;
}
