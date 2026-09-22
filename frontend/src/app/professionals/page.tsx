import type { Metadata } from 'next';
import ProfessionalsPage from '../components/marketing/ProfessionalsPage';

export const metadata: Metadata = {
  title: 'For professionals: permits and filings for every client | SmartPR',
  description:
    "SmartPR gives your firm one platform for every client's Puerto Rico filings — from requirements to readiness to submission.",
  alternates: { canonical: '/professionals', languages: { en: '/professionals', es: '/es/profesionales' } },
  openGraph: {
    title: 'Prepare permits and filings for every client in one place.',
    description: "One dashboard for every client, reusable business profiles, and readiness you can see at a glance.",
    url: '/professionals',
    locale: 'en_US',
  },
};

export default function Page() {
  return <ProfessionalsPage initialLanguage="EN" />;
}
