import type { Metadata } from 'next';
import RestaurantChecker from './RestaurantChecker';
export const metadata: Metadata = {
  title: 'Puerto Rico Restaurant Opening Checklist | SmartPR',
  description: 'Planning a restaurant, café or bakery in Puerto Rico? Get a free preliminary preparation checklist for your municipality and planned activities.',
  alternates: { canonical: '/restaurants', languages: { en: '/restaurants', es: '/es/restaurantes' } },
  openGraph: { title: 'Opening a restaurant in Puerto Rico?', description: 'Find your next preparation steps with SmartPR’s free restaurant checker.', url: '/restaurants' },
};
export default function Page() { return <RestaurantChecker language="en" />; }
