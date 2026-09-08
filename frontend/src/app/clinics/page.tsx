import type { Metadata } from 'next';
import ClinicChecker from './ClinicChecker';
export const metadata: Metadata = {
  title: 'Open a Medical Clinic in Puerto Rico: CNC & Health Licenses | SmartPR',
  description:
    'Opening a medical clinic in Puerto Rico? Preview CNC, Department of Health licenses, Permiso Único, Hacienda and municipal steps with a free clinic preparation checklist.',
  alternates: { canonical: '/clinics', languages: { en: '/clinics', es: '/es/clinicas' } },
  openGraph: {
    title: 'How to Open a Medical Clinic in Puerto Rico',
    description: 'Find your next preparation steps with SmartPR’s free clinic checker.',
    url: '/clinics',
  },
};
export default function Page() {
  return <ClinicChecker language="en" />;
}
