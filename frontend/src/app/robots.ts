import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin/', '/auth/', '/businesses/', '/dashboard', '/history/', '/settings', '/workspace/'],
    },
    sitemap: 'https://www.getsmartpr.com/sitemap.xml',
  };
}
