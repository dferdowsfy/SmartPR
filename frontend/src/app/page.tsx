import MarketingLanding from "./components/marketing/MarketingLanding";
import SmartPRIntake from "./SmartPRIntake";

type HomePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SmartPRHome({ searchParams }: HomePageProps) {
  const params = await searchParams;
  const showIntake = params.entry === "new-business" || params.resume !== undefined || params.debug !== undefined;
  // Key the intake by its session identity. Client-side navigation (e.g.
  // the "Start" nav tab while already inside another business's intake)
  // reuses the mounted component otherwise, so the previous project's
  // answers and SmartPR Live numbers would linger on screen instead of
  // starting a brand-new project. A new key forces a clean remount.
  const sessionKey = ["entry", "business", "matter", "resume", "debug"]
    .map((k) => `${k}=${Array.isArray(params[k]) ? params[k][0] : params[k] ?? ""}`)
    .join("|");
  return showIntake ? <SmartPRIntake key={sessionKey} /> : <MarketingLanding />;
}
