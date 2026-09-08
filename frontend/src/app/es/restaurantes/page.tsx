import type { Metadata } from 'next';
import RestaurantChecker from '../../restaurants/RestaurantChecker';
export const metadata: Metadata = {
  title: 'Lista para abrir un restaurante en Puerto Rico | SmartPR',
  description: '¿Vas a abrir un restaurante, café o panadería? Obtén una lista preliminar gratuita según tu municipio y las actividades de tu negocio.',
  alternates: { canonical: '/es/restaurantes', languages: { en: '/restaurants', es: '/es/restaurantes' } },
  openGraph: { title: '¿Vas a abrir un restaurante en Puerto Rico?', description: 'Identifica tus próximos pasos con SmartPR.', url: '/es/restaurantes', locale: 'es_PR' },
};
export default function Page() { return <RestaurantChecker language="es" />; }
