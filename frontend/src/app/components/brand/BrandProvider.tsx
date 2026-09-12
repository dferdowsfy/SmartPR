"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export interface WorkspaceBranding {
  company_name: string | null;
  logo_url: string | null;
  primary_color: string | null;
  tagline: string | null;
  support_email: string | null;
}

interface BrandContextValue {
  branding: WorkspaceBranding | null;
  loaded: boolean;
}

const BrandContext = createContext<BrandContextValue>({ branding: null, loaded: false });

export function useBrand() {
  return useContext(BrandContext);
}

/**
 * Loads the signed-in user's workspace branding and applies the primary
 * color as --brand-primary on the document root. Falls back to SmartPR
 * defaults when no branding is set.
 */
export function BrandProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<WorkspaceBranding | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/branding");
        const data = await res.json();
        if (cancelled) return;
        const b = (data.branding || null) as WorkspaceBranding | null;
        setBranding(b);
        if (b?.primary_color && /^#[0-9a-fA-F]{6}$/.test(b.primary_color)) {
          document.documentElement.style.setProperty("--brand-primary", b.primary_color);
        }
      } catch {
        // Non-fatal: keep SmartPR defaults.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return <BrandContext.Provider value={{ branding, loaded }}>{children}</BrandContext.Provider>;
}

/**
 * White-label-aware logo. Shows the workspace's uploaded logo when set,
 * otherwise the company name (or the SmartPR wordmark as fallback).
 */
export function BrandLogo({
  className = "",
  size,
  inverted = false,
}: {
  className?: string;
  size?: "app" | "auth" | "landing";
  inverted?: boolean;
}) {
  const { branding } = useBrand();
  const name = branding?.company_name?.trim() || "SmartPR";

  if (branding?.logo_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={branding.logo_url}
        alt={name}
        className={`max-h-9 w-auto object-contain ${className}`.trim()}
      />
    );
  }

  return (
    <span
      className={`smartpr-logo ${size ? `smartpr-logo-${size}` : ""} ${inverted ? "smartpr-logo-inverted" : ""} ${className}`.trim()}
    >
      <span className="smartpr-logo-wordmark">{name}</span>
    </span>
  );
}
