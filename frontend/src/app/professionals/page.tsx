import type { Metadata } from 'next';
import ProfessionalsPage from '../components/marketing/ProfessionalsPage';

export const metadata: Metadata = {
  title: 'For professionals: Puerto Rico filings for every client | SmartPR',
  description:
    "SmartPR sits under your practice. One dashboard for every client's Puerto Rico filings — requirements mapped to the law, official forms filled from the profile, renewals tracked.",
  alternates: { canonical: '/professionals', languages: { en: '/professionals', es: '/es/profesionales' } },
  openGraph: {
    title: "Manage every client's Puerto Rico filings in one dashboard.",
    description: "A tool that makes the firm faster. Not a replacement for the firm.",
    url: '/professionals',
    locale: 'en_US',
  },
};

export default function Page() {
  return <ProfessionalsPage initialLanguage="EN" />;
}
