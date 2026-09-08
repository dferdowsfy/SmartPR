import type { Metadata } from 'next';
import RestaurantChecker from './RestaurantChecker';
export const metadata: Metadata = {
  title: 'Open a Restaurant in Puerto Rico: Permit Checklist | SmartPR',
  description: 'Opening a restaurant in Puerto Rico? Preview permits, licenses, Hacienda registration and municipal steps with a free restaurant preparation checklist.',
  alternates: { canonical: '/restaurants', languages: { en: '/restaurants', es: '/es/restaurantes' } },
  openGraph: { title: 'Opening a restaurant in Puerto Rico?', description: 'Find your next preparation steps with SmartPR’s free restaurant checker.', url: '/restaurants' },
};
export default function Page() { return <RestaurantChecker language="en" />; }
