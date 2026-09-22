import type { Metadata } from 'next';
import ProfessionalsPage from '../../components/marketing/ProfessionalsPage';

export const metadata: Metadata = {
  title: 'Para profesionales: permisos y trámites de todos sus clientes | SmartPR',
  description:
    'SmartPR le da a su firma una sola plataforma para los trámites de cada cliente en Puerto Rico — de los requisitos a la preparación a la radicación.',
  alternates: { canonical: '/es/profesionales', languages: { en: '/professionals', es: '/es/profesionales' } },
  openGraph: {
    title: 'Prepare permisos y trámites para todos sus clientes en un solo lugar.',
    description: 'Un panel para cada cliente, perfiles de negocio reutilizables y un estatus de preparación visible de un vistazo.',
    url: '/es/profesionales',
    locale: 'es_PR',
  },
};

export default function Page() {
  return <ProfessionalsPage initialLanguage="ES" />;
}
