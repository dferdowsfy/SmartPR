import type { Metadata } from 'next';
export const metadata: Metadata = {
  title: 'Plans & Pricing | SmartPR',
  description: 'Explore SmartPR plans for preparing Puerto Rico business registrations, permits and licenses.',
  alternates: { canonical: '/pricing' },
};
export default function PricingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
