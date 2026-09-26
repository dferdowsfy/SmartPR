"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import marketingStyles from "./marketing.module.css";
import styles from "./demoPreview.module.css";
import type { Language } from "./MarketingChrome";

/**
 * Looping, silent preview of the /demo walkthrough for the landing page.
 *
 * The demo page drives itself in embed mode (?embed=1): it starts on step 2,
 * plays with the sound off and the sound button disabled, auto-advances, and
 * loops back to step 2. Every button inside the demo is disabled in embed
 * mode, so the preview is strictly watch-only.
 *
 * Desktop: the fixed 1400x875 demo frame is scaled into the card.
 * Mobile: the demo renders natively at the card width (it carries its own
 * viewport meta), so text stays readable instead of shrinking to a thumbnail.
 * A transparent overlay link makes any tap on the preview open /demo.
 */

const FRAME_W = 1400;
const FRAME_H = 875;
const MOBILE_MAX = "(max-width: 639px)";

export default function DemoPreview({
  language,
  buttonLabel,
  caption,
  openLabel,
}: {
  language: Language;
  buttonLabel: string;
  caption: string;
  openLabel: string;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_MAX).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MAX);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Scale the fixed 1400x875 frame to the card width; recompute on resize.
  // Desktop only — mobile renders the demo natively at the card width.
  useEffect(() => {
    if (isMobile) return;
    const card = cardRef.current;
    const scaler = scalerRef.current;
    const frame = frameRef.current;
    if (!card || !scaler || !frame) return;
    const fit = () => {
      const scale = card.clientWidth / FRAME_W;
      scaler.style.width = `${FRAME_W * scale}px`;
      scaler.style.height = `${FRAME_H * scale}px`;
      frame.style.transform = `scale(${scale})`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(card);
    return () => ro.disconnect();
  }, [isMobile]);

  const src = `/demo/?embed=1${language === "ES" ? "&lang=es" : ""}`;
  const demoHref = "/demo/?step=0";

  return (
    <>
      <div ref={cardRef} className={styles.card}>
        {isMobile ? (
          <iframe src={src} title="SmartPR demo preview" loading="lazy" className={styles.mobileFrame} />
        ) : (
          <div className={styles.viewport}>
            <div ref={scalerRef} className={styles.scaler}>
              <iframe ref={frameRef} src={src} title="SmartPR demo preview" loading="lazy" />
            </div>
          </div>
        )}
        <Link href={demoHref} className={styles.overlay} aria-label={openLabel} />
      </div>
      <div className={styles.cta}>
        <Link href={demoHref} className={marketingStyles.primary}>
          {buttonLabel}
        </Link>
        <p className={styles.caption}>{caption}</p>
      </div>
    </>
  );
}
