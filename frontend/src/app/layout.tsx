import type { Metadata } from "next";
import { headers } from "next/headers";
import localFont from "next/font/local";
import "./globals.css";
import "./validador.css";
import { AuthRecoveryRedirect } from "./components/AuthRecoveryRedirect";
import { BrandProvider } from "./components/brand/BrandProvider";
import { TopNavMount } from "./components/TopNavMount";

// Self-hosted (fonts/, from @fontsource, OFL): next/font/google downloads
// at build time and broke Railway builds when that fetch failed. The latin
// subset covers English and Spanish (á, é, ñ, ü, ¿, ¡).
const sans = localFont({
  src: [
    { path: "./fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
});

const display = localFont({
  src: [
    { path: "./fonts/newsreader-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./fonts/newsreader-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "./fonts/newsreader-latin-600-normal.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

const SITE_URL = "https://www.getsmartpr.com/";
const SITE_TITLE = "Puerto Rico Business Permits & Licensing | SmartPR";
const SITE_DESCRIPTION =
  "Starting a business in Puerto Rico? SmartPR prepares your registrations, permits, licenses, and municipal requirements.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Seed the persistent header's first paint from the request path
  // (set by middleware). The client takes over after hydration and keeps
  // the same header mounted across route changes.
  const h = await headers();
  const initialPathname = h.get("x-pathname") ?? "/";
  const initialSearch = h.get("x-search") ?? "";
  return (
    <html lang="en" className={`${sans.variable} ${display.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col"><BrandProvider><AuthRecoveryRedirect /><TopNavMount initialPathname={initialPathname} initialSearch={initialSearch} />{children}</BrandProvider></body>
    </html>
  );
}
