import { GoogleAnalytics } from "@next/third-parties/google";

/**
 * Google Analytics 4 page-view tracking.
 *
 * Renders the official gtag.js snippet only when NEXT_PUBLIC_GA_MEASUREMENT_ID
 * is set (G-XXXXXXXXXX). Without the env var, nothing is loaded — the site
 * works exactly as before, so a missing measurement ID can never break a
 * build or misattribute traffic.
 *
 * SPA navigations are tracked automatically by @next/third-parties in the
 * App Router. Real-time and historical reports live in the GA4 dashboard
 * (analytics.google.com) under Realtime and Reports.
 */
export function AnalyticsMount() {
  const gaId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  if (!gaId) return null;
  return <GoogleAnalytics gaId={gaId} />;
}
