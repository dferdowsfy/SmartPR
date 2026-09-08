import type { Metadata } from 'next';
import RestaurantChecker from '../../restaurants/RestaurantChecker';
export const metadata: Metadata = {
  title: 'Abrir un restaurante en Puerto Rico: permisos | SmartPR',
  description: 'Consulta los permisos para abrir un restaurante en Puerto Rico: Permiso Único, Registro de Comerciante y trámites municipales. Lista preliminar gratuita.',
  alternates: { canonical: '/es/restaurantes', languages: { en: '/restaurants', es: '/es/restaurantes' } },
  openGraph: { title: '¿Vas a abrir un restaurante en Puerto Rico?', description: 'Identifica tus próximos pasos con SmartPR.', url: '/es/restaurantes', locale: 'es_PR' },
};
export default function Page() { return <RestaurantChecker language="es" />; }
