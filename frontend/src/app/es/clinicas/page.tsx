import type { Metadata } from 'next';
import ClinicChecker from '../../clinics/ClinicChecker';
export const metadata: Metadata = {
  title: 'Abrir una clínica en Puerto Rico: CNC y licencias de Salud | SmartPR',
  description:
    'Consulta CNC, licencias del Departamento de Salud, Permiso Único, Hacienda y trámites municipales para abrir una clínica en Puerto Rico. Lista preliminar gratuita.',
  alternates: { canonical: '/es/clinicas', languages: { en: '/clinics', es: '/es/clinicas' } },
  openGraph: {
    title: 'Cómo abrir una clínica en Puerto Rico',
    description: 'Identifica tus próximos pasos con SmartPR.',
    url: '/es/clinicas',
    locale: 'es_PR',
  },
};
export default function Page() {
  return <ClinicChecker language="es" />;
}
