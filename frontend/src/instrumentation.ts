// Runs once when a Next.js server instance starts (Next 16 instrumentation).
// Only job today: schedule the geo-route warm-up (src/lib/geoWarmup.ts), so
// the first visitor after a deploy does not pay for the cold start.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { scheduleGeoWarmup } = await import("./lib/geoWarmup");
    scheduleGeoWarmup();
  } catch {
    // Never block or fail server start over a warm-up.
  }
}
