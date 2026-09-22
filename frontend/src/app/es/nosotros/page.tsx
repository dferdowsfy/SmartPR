import type { Metadata } from 'next';
import AboutPage from '../../components/marketing/AboutPage';

export const metadata: Metadata = {
  title: 'Sobre SmartPR',
  description:
    'Abrir y correr un negocio en Puerto Rico no debería requerir un título de abogado ni un gestor de planta. Cómo SmartPR revisa cada requisito.',
  alternates: { canonical: '/es/nosotros', languages: { en: '/about', es: '/es/nosotros' } },
  openGraph: {
    title: 'Sobre SmartPR',
    description: 'Cada requisito conocible, cada formulario completable, ningún vencimiento pasado.',
    url: '/es/nosotros',
    locale: 'es_PR',
  },
};

export default function Page() {
  return <AboutPage initialLanguage="ES" />;
}
