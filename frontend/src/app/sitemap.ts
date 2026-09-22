import type { MetadataRoute } from 'next';

const site = 'https://www.getsmartpr.com';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: site,
      changeFrequency: 'weekly',
      priority: 1,
      alternates: { languages: { en: site, es: `${site}/es` } },
    },
    {
      url: `${site}/es`,
      changeFrequency: 'weekly',
      priority: 1,
      alternates: { languages: { en: site, es: `${site}/es` } },
    },
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
    {
      url: `${site}/professionals`,
      changeFrequency: 'monthly',
      priority: 0.8,
      alternates: { languages: { en: `${site}/professionals`, es: `${site}/es/profesionales` } },
    },
    {
      url: `${site}/es/profesionales`,
      changeFrequency: 'monthly',
      priority: 0.8,
      alternates: { languages: { en: `${site}/professionals`, es: `${site}/es/profesionales` } },
    },
    {
      url: `${site}/about`,
      changeFrequency: 'monthly',
      priority: 0.5,
      alternates: { languages: { en: `${site}/about`, es: `${site}/es/nosotros` } },
    },
    {
      url: `${site}/es/nosotros`,
      changeFrequency: 'monthly',
      priority: 0.5,
      alternates: { languages: { en: `${site}/about`, es: `${site}/es/nosotros` } },
    },
    {
      url: `${site}/voice`,
      changeFrequency: 'monthly',
      priority: 0.7,
      alternates: { languages: { en: `${site}/voice`, es: `${site}/es/voz` } },
    },
    {
      url: `${site}/es/voz`,
      changeFrequency: 'monthly',
      priority: 0.7,
      alternates: { languages: { en: `${site}/voice`, es: `${site}/es/voz` } },
    },
  ];
}
