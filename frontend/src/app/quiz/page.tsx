import type { Metadata } from 'next';
import QuizClient from './QuizClient';

export const metadata: Metadata = {
  title: 'Chequeo de permisos — SmartPR',
  description:
    'Cinco preguntas para darte una idea clara de los asuntos que tendrías que chequear si vas a montar un negocio en Puerto Rico.',
  alternates: { canonical: '/quiz' },
  openGraph: {
    title: '¿Cuánto revolú de permisos trae tu negocio? — SmartPR',
    description: 'Chequeo de 60 segundos para negocios en Puerto Rico.',
    url: '/quiz',
    locale: 'es_PR',
  },
};

export default function Page() {
  return <QuizClient />;
}
