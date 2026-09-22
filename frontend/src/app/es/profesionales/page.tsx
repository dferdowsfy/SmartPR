import type { Metadata } from 'next';
import ProfessionalsPage from '../../components/marketing/ProfessionalsPage';

export const metadata: Metadata = {
  title: 'Para profesionales: radicaciones de Puerto Rico de todos sus clientes | SmartPR',
  description:
    'SmartPR trabaja bajo su práctica. Un solo panel para las radicaciones de Puerto Rico de cada cliente — requisitos mapeados a la ley, formularios oficiales llenados desde el perfil, renovaciones monitoreadas.',
  alternates: { canonical: '/es/profesionales', languages: { en: '/professionals', es: '/es/profesionales' } },
  openGraph: {
    title: 'Maneje las radicaciones de Puerto Rico de todos sus clientes en un solo panel.',
    description: 'Una herramienta que hace la firma más rápida. No un reemplazo de la firma.',
    url: '/es/profesionales',
    locale: 'es_PR',
  },
};

export default function Page() {
  return <ProfessionalsPage initialLanguage="ES" />;
}
