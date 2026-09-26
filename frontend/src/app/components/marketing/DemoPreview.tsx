"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import marketingStyles from "./marketing.module.css";
import styles from "./demoPreview.module.css";
import type { Language } from "./MarketingChrome";

/**
 * Looping, silent preview of the /demo walkthrough for the landing page.
 *
 * The demo page drives itself in embed mode (?embed=1): it starts on step 2,
 * plays with the sound off and the sound button disabled, auto-advances, and
 * loops back to step 2. The landing page only scales the fixed 1400x875 frame
 * into the card. A transparent overlay link makes the whole card open /demo.
 */

const FRAME_W = 1400;
const FRAME_H = 875;

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

  // Scale the fixed 1400x875 frame to the card width; recompute on resize.
  useEffect(() => {
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
  }, []);

  const src = `/demo/?embed=1${language === "ES" ? "&lang=es" : ""}`;
  const demoHref = "/demo/?step=0";

  return (
    <>
      <div ref={cardRef} className={styles.card}>
        <div className={styles.viewport}>
          <div ref={scalerRef} className={styles.scaler}>
            <iframe ref={frameRef} src={src} title="SmartPR demo preview" loading="lazy" />
          </div>
        </div>
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
