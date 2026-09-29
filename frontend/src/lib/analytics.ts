import { sendGAEvent } from "@next/third-parties/google";

export type GAEventParams = Record<string, string | number | boolean>;

/**
 * Fire a GA4 event. Completely safe to call anywhere: it no-ops (with a
 * console warning from @next/third-parties) when analytics hasn't loaded,
 * and it never throws, so tracking can never break the user flow.
 *
 * Prefer GA4 recommended event names where one fits (sign_up, generate_lead)
 * so the events show up properly in GA4 reports and can be marked as
 * conversions without extra configuration.
 */
export function trackEvent(eventName: string, params?: GAEventParams) {
  try {
    sendGAEvent("event", eventName, params ?? {});
  } catch {
    // Analytics must never break the user flow.
  }
}
