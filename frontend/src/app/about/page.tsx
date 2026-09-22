import type { Metadata } from 'next';
import AboutPage from '../components/marketing/AboutPage';

export const metadata: Metadata = {
  title: 'About SmartPR',
  description:
    "Opening and running a business in Puerto Rico shouldn't require a law degree or a gestor on retainer. How SmartPR reviews every requirement.",
  alternates: { canonical: '/about', languages: { en: '/about', es: '/es/nosotros' } },
  openGraph: {
    title: 'About SmartPR',
    description: 'Every requirement knowable, every form completable, every deadline unmissable.',
    url: '/about',
    locale: 'en_US',
  },
};

export default function Page() {
  return <AboutPage initialLanguage="EN" />;
}
