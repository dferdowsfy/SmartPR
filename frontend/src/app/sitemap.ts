import type { MetadataRoute } from 'next';

const site = 'https://www.getsmartpr.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: site, changeFrequency: 'weekly', priority: 1 },
    {
      url: `${site}/restaurants`,
      changeFrequency: 'weekly',
      priority: 0.9,
      alternates: { languages: { en: `${site}/restaurants`, es: `${site}/es/restaurantes` } },
    },
    {
      url: `${site}/es/restaurantes`,
      changeFrequency: 'weekly',
      priority: 0.9,
      alternates: { languages: { en: `${site}/restaurants`, es: `${site}/es/restaurantes` } },
    },
    {
      url: `${site}/clinics`,
      changeFrequency: 'weekly',
      priority: 0.9,
      alternates: { languages: { en: `${site}/clinics`, es: `${site}/es/clinicas` } },
    },
    {
      url: `${site}/es/clinicas`,
      changeFrequency: 'weekly',
      priority: 0.9,
      alternates: { languages: { en: `${site}/clinics`, es: `${site}/es/clinicas` } },
    },
    { url: `${site}/pricing`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${site}/privacy`, changeFrequency: 'yearly', priority: 0.2 },
  ];
}
