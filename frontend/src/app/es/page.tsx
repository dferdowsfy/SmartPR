import type { Metadata } from 'next';
import MarketingLanding from '../components/marketing/MarketingLanding';

export const metadata: Metadata = {
  title: 'Permisos y licencias para negocios en Puerto Rico | SmartPR',
  description:
    'Dile a SmartPR lo que quieres montar en Puerto Rico y te decimos qué permisos, licencias y radicaciones aplican — y te preparamos para someter. Lista preliminar gratuita.',
  alternates: { canonical: '/es', languages: { en: '/', es: '/es' } },
  openGraph: {
    title: 'Requisitos de negocio, simplificados.',
    description: 'Dile a SmartPR lo que quieres construir. Trazamos lo que sigue.',
    url: '/es',
    locale: 'es_PR',
  },
};

export default function SpanishHomePage() {
  return <MarketingLanding initialLanguage="ES" />;
}
