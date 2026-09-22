import type { Metadata } from 'next';
import MarketingLanding from '../components/marketing/MarketingLanding';

export const metadata: Metadata = {
  title: 'Radicaciones de Puerto Rico para cada cliente, en un solo lugar | SmartPR',
  description:
    'Un espacio por cliente. Requisitos mapeados a la ley, formularios oficiales llenados desde el perfil y renovaciones monitoreadas antes de su vencimiento.',
  alternates: { canonical: '/es', languages: { en: '/', es: '/es' } },
  openGraph: {
    title: 'Prepare las radicaciones de Puerto Rico de todos sus clientes en un solo lugar.',
    description: 'Tres cosas. No una pila de funciones.',
    url: '/es',
    locale: 'es_PR',
  },
};

export default function SpanishHomePage() {
  return <MarketingLanding initialLanguage="ES" />;
}
