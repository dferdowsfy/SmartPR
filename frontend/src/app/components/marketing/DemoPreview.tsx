"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import marketingStyles from "./marketing.module.css";
import styles from "./demoPreview.module.css";
import type { Language } from "./MarketingChrome";

/**
 * Looping, silent preview of the /demo walkthrough for the landing page.
 *
 * /demo itself is untouched: the preview drives the stock demo page through
 * a same-origin iframe. Before the iframe boots we seed the demo's own
 * localStorage (step 0 + language); after load we force-mute its audio
 * elements, press its Play button, and re-press it whenever a pass ends
 * (the demo stops auto-advance on the last step, and pressing Play there
 * restarts from step 0). A transparent overlay link makes the whole card
 * open /demo.
 */

const FRAME_W = 1400;
const FRAME_H = 875;

const PLAY_LABELS = ["play", "reproducir"];
const PAUSE_LABELS = ["pause", "pausa"];

function findPlayButton(frame: HTMLIFrameElement): HTMLButtonElement | null {
  try {
    const doc = frame.contentDocument;
    if (!doc) return null;
    const buttons = doc.querySelectorAll("button");
    for (const b of Array.from(buttons)) {
      const t = (b.textContent || "").trim().toLowerCase();
      if (PLAY_LABELS.includes(t) || PAUSE_LABELS.includes(t)) return b as HTMLButtonElement;
    }
  } catch {
    // Cross-origin or not yet loaded: not drivable.
  }
  return null;
}

/** Force every media element in the demo to stay silent. */
function muteDemoMedia(frame: HTMLIFrameElement) {
  try {
    const win = frame.contentWindow as (Window & { speechSynthesis?: SpeechSynthesis }) | null;
    const doc = frame.contentDocument;
    if (!win || !doc) return;
    const proto = (win as unknown as { HTMLMediaElement?: { prototype: HTMLMediaElement } }).HTMLMediaElement
      ?.prototype as (HTMLMediaElement & { __spMuted?: boolean }) | undefined;
    if (proto && !proto.__spMuted) {
      proto.__spMuted = true;
      const origPlay = proto.play.bind(proto);
      proto.play = function (this: HTMLMediaElement, ...args: []) {
        try {
          this.muted = true;
          this.volume = 0;
        } catch {
          // Element gone mid-call: let the original play handle it.
        }
        return origPlay(...args);
      };
    }
    doc.querySelectorAll("audio,video").forEach((m) => {
      try {
        (m as HTMLMediaElement).muted = true;
        (m as HTMLMediaElement).volume = 0;
      } catch {
        // Ignore detached elements.
      }
    });
    // Belt and suspenders: the demo falls back to speech synthesis only when
    // an mp3 is missing, but never let it make a sound in the preview.
    const synth = win.speechSynthesis;
    if (synth && (synth.speaking || synth.pending)) {
      try {
        synth.cancel();
      } catch {
        // Non-fatal.
      }
    }
  } catch {
    // If we can't reach into the frame, stay silent and let it be.
  }
}

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

  // Boot the iframe (seeding step + language first), then drive the loop.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const demoLang = language === "ES" ? "es" : "en";
    try {
      localStorage.setItem("smartpr-demo-step", "0");
      localStorage.setItem("smartpr-demo-lang", demoLang);
    } catch {
      // Private mode: the demo still boots, just not from step 0.
    }
    frame.src = `/demo/?embed=1${demoLang === "es" ? "&lang=es" : ""}`;

    let stopped = false;
    const timers: number[] = [];
    let endTimer: number | null = null;
    let seenPlaying = false;

    const onLoad = () => {
      if (stopped) return;
      muteDemoMedia(frame);
      // The demo unpacks asynchronously after load; wait for its Play button.
      const waiter = window.setInterval(() => {
        if (stopped) {
          window.clearInterval(waiter);
          return;
        }
        muteDemoMedia(frame);
        const btn = findPlayButton(frame);
        if (!btn) return;
        window.clearInterval(waiter);
        btn.click(); // starts the auto-advance walkthrough from step 0
        const watcher = window.setInterval(() => {
          if (stopped) {
            window.clearInterval(watcher);
            return;
          }
          muteDemoMedia(frame);
          const b = findPlayButton(frame);
          if (!b) return;
          const t = (b.textContent || "").trim().toLowerCase();
          if (PAUSE_LABELS.includes(t)) {
            seenPlaying = true;
            return;
          }
          // Back on "Play" after a pass: the demo stopped on the last step.
          // Pressing Play there restarts from step 0, closing the loop.
          if (seenPlaying && PLAY_LABELS.includes(t) && endTimer === null) {
            endTimer = window.setTimeout(() => {
              endTimer = null;
              seenPlaying = false;
              const b2 = findPlayButton(frame);
              if (b2 && !stopped) b2.click();
            }, 4000);
          }
        }, 2000);
        timers.push(watcher);
      }, 1000);
      timers.push(waiter);
    };

    frame.addEventListener("load", onLoad);
    return () => {
      stopped = true;
      timers.forEach((t) => window.clearInterval(t));
      if (endTimer !== null) window.clearTimeout(endTimer);
      frame.removeEventListener("load", onLoad);
    };
  }, [language]);

  return (
    <>
      <div ref={cardRef} className={styles.card}>
        <div className={styles.viewport}>
          <div ref={scalerRef} className={styles.scaler}>
            <iframe ref={frameRef} title="SmartPR demo preview" loading="lazy" allow="autoplay" />
          </div>
        </div>
        <Link href="/demo" className={styles.overlay} aria-label={openLabel} />
      </div>
      <div className={styles.cta}>
        <Link href="/demo" className={marketingStyles.primary}>
          {buttonLabel}
        </Link>
        <p className={styles.caption}>{caption}</p>
      </div>
    </>
  );
}
