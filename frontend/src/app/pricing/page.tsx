"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SmartPRLogo } from "../components/brand/SmartPRLogo";
import { PLANS, type PlanDefinition, type PlanId } from "@/lib/billing/catalog";
import { FILING_FEE_CARD_CONSENT_EN } from "@/lib/billing/filingFeeCard";
import styles from "./pricing.module.css";

type Period = "monthly" | "yearly";
type BusinessOption = { id: string; label: string };

function formatUsd(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function displayPrice(
  plan: PlanDefinition,
  period: Period
): { amountLabel: string; periodLabel: string } {
  if (plan.contactOnly) {
    return { amountLabel: "Custom", periodLabel: "by contract" };
  }
  if (plan.id === "free") {
    return { amountLabel: "$0", periodLabel: "forever" };
  }
  const amount =
    period === "yearly" ? plan.amountUsd.yearly : plan.amountUsd.monthly;
  if (amount == null) {
    return { amountLabel: "—", periodLabel: "" };
  }
  if (period === "yearly") {
    const monthlyEquivalent = Math.round(amount / 12);
    return {
      amountLabel: formatUsd(monthlyEquivalent),
      periodLabel: "/ mo, billed yearly",
    };
  }
  return { amountLabel: formatUsd(amount), periodLabel: "/ month" };
}

function PricingPageInner() {
  const searchParams = useSearchParams();
  const success = searchParams.get("success") === "1";
  const canceled = searchParams.get("cancel") === "1";
  const cardSaved = success && searchParams.get("card") === "1";
  const requestedBusiness = searchParams.get("business");

  const [period, setPeriod] = useState<Period>("monthly");
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Filing-fee card reminder: off unless the owner turns it on.
  const [saveCard, setSaveCard] = useState(searchParams.get("saveCard") === "1");
  const [businesses, setBusinesses] = useState<BusinessOption[] | null>(null);
  const [businessId, setBusinessId] = useState<string>(requestedBusiness ?? "");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/businesses", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { businesses: [] }))
      .then((data: { businesses?: Array<{ id: string; public_id?: string | null; legal_name?: string | null; name?: string | null }> }) => {
        if (cancelled) return;
        const list = (data.businesses ?? []).map((b) => ({
          id: b.public_id || b.id,
          label: b.legal_name || b.name || "Business",
        }));
        setBusinesses(list);
        setBusinessId((cur) => (cur && (list.some((b) => b.id === cur) || cur === requestedBusiness) ? cur : list[0]?.id ?? ""));
      })
      .catch(() => {
        if (!cancelled) setBusinesses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [requestedBusiness]);

  const cards = useMemo(() => PLANS, []);

  async function startCheckout(planId: PlanId) {
    setError(null);
    if (saveCard && !businessId) {
      setError("Choose which business the filing-fee card is for, or turn the toggle off.");
      return;
    }
    setLoadingPlan(planId);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          period,
          ...(saveCard ? { saveCardForFilingFees: true, businessId } : {}),
        }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Could not start checkout.");
      }
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
      setLoadingPlan(null);
    }
  }

  function ctaFor(plan: PlanDefinition) {
    if (plan.contactOnly) {
      return (
        <a
          className={`${styles.btnGhost} ${styles.cardCta}`}
          href="mailto:hello@getsmartpr.com?subject=SmartPR%20Enterprise"
        >
          Contact
        </a>
      );
    }
    if (plan.id === "free") {
      return (
        <Link
          className={`${styles.btnPrimary} ${styles.cardCta}`}
          href="/?entry=new-business"
        >
          Start free
        </Link>
      );
    }
    const busy = loadingPlan === plan.id;
    return (
      <button
        type="button"
        className={`${styles.btnPrimary} ${styles.cardCta}`}
        disabled={busy || loadingPlan !== null}
        onClick={() => startCheckout(plan.id)}
      >
        {busy ? "Redirecting…" : "Continue"}
      </button>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.logoLink} aria-label="SmartPR home">
            <SmartPRLogo />
          </Link>
          <nav className={styles.nav} aria-label="Primary">
            <Link href="/#what-you-get">What you get</Link>
            <Link href="/#how-it-works">How it works</Link>
            <Link href="/professionals">For professionals</Link>
            <Link href="/pricing" className={styles.navActive}>
              Pricing
            </Link>
            <Link href="/#security">Security</Link>
          </nav>
          <div className={styles.headerActions}>
            <Link href="/auth/login" className={styles.loginLink}>
              Login
            </Link>
            <Link href="/?entry=new-business" className={styles.btnPrimary}>
              Sign up
            </Link>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>Plans · Puerto Rico</p>
          <h1 className={styles.headline}>
            Pick the path that matches how you file.
          </h1>
          <p className={styles.subcopy}>
            Readiness packages that help you prepare what may apply — then take
            them to the counter. Government remains the system of record.
          </p>
        </section>

        {success ? (
          <p className={styles.banner} role="status">
            Payment received. You can continue in your workspace.
            {cardSaved
              ? " Your card will appear as a reminder at Mita's filing-fee step once Stripe confirms it."
              : ""}
          </p>
        ) : null}
        {canceled ? (
          <p className={`${styles.banner} ${styles.bannerCancel}`} role="status">
            Checkout canceled. No charge was made.
          </p>
        ) : null}

        <div className={styles.toggleWrap}>
          <div className={styles.toggle} role="group" aria-label="Billing period">
            <button
              type="button"
              className={`${styles.toggleBtn} ${
                period === "monthly" ? styles.toggleBtnActive : ""
              }`}
              onClick={() => setPeriod("monthly")}
              aria-pressed={period === "monthly"}
            >
              Monthly
            </button>
            <button
              type="button"
              className={`${styles.toggleBtn} ${
                period === "yearly" ? styles.toggleBtnActive : ""
              }`}
              onClick={() => setPeriod("yearly")}
              aria-pressed={period === "yearly"}
            >
              Yearly
              <span className={styles.toggleHint}>~2 months free</span>
            </button>
          </div>
        </div>

        <section className={styles.cardOption} aria-labelledby="filing-fee-card-title">
          <label className={styles.cardOptionRow}>
            <span className={styles.switch}>
              <input
                type="checkbox"
                role="switch"
                checked={saveCard}
                onChange={(e) => setSaveCard(e.target.checked)}
                aria-describedby="filing-fee-card-desc"
                data-testid="filing-fee-card-toggle"
              />
              <span className={styles.switchTrack} aria-hidden="true" />
            </span>
            <span>
              <span id="filing-fee-card-title" className={styles.cardOptionTitle}>
                Use this card for filing fees
              </span>
              <span id="filing-fee-card-desc" className={styles.cardOptionDesc}>
                {FILING_FEE_CARD_CONSENT_EN}
              </span>
            </span>
          </label>
          {saveCard ? (
            businesses && businesses.length > 0 ? (
              <label className={styles.cardOptionBusiness}>
                <span>Save to the Business Passport of</span>
                <select
                  value={businessId}
                  onChange={(e) => setBusinessId(e.target.value)}
                  data-testid="filing-fee-card-business"
                >
                  {businessId && !businesses.some((b) => b.id === businessId) ? (
                    <option value={businessId}>This business</option>
                  ) : null}
                  {businesses.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : businesses ? (
              <p className={styles.cardOptionDesc}>
                Sign in and add a business first — the card is saved to that
                business&apos;s passport.
              </p>
            ) : null
          ) : null}
        </section>

        <div className={styles.grid}>
          {cards.map((plan) => {
            const price = displayPrice(plan, period);
            return (
              <article
                key={plan.id}
                className={`${styles.card} ${
                  plan.popular ? styles.cardPopular : ""
                }`}
              >
                {plan.popular ? (
                  <span className={styles.popularBadge}>Popular</span>
                ) : null}
                <h2 className={styles.planName}>{plan.name}</h2>
                <p className={styles.tagline}>{plan.tagline}</p>
                <div className={styles.priceRow}>
                  <span className={styles.priceAmount}>{price.amountLabel}</span>
                  {price.periodLabel ? (
                    <span className={styles.pricePeriod}>{price.periodLabel}</span>
                  ) : null}
                </div>
                <ul className={styles.features}>
                  {plan.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                {ctaFor(plan)}
              </article>
            );
          })}
        </div>

        {error ? <p className={styles.errorText}>{error}</p> : null}

        <p className={styles.footerNote}>
          SmartPR prepares readiness packages for filings that may apply.
          Government agencies remain the system of record for every submission.
        </p>
      </main>

      <footer className={styles.siteFooter}>
        <span>© {new Date().getFullYear()} SmartPR</span>
        {" · "}
        <Link href="/privacy">Privacy</Link>
        {" · "}
        <a href="mailto:hello@getsmartpr.com">hello@getsmartpr.com</a>
      </footer>
    </div>
  );
}

export default function PricingPage() {
  return (
    <Suspense
      fallback={
        <div className={styles.page}>
          <main className={styles.main}>
            <p className={styles.subcopy}>Loading plans…</p>
          </main>
        </div>
      }
    >
      <PricingPageInner />
    </Suspense>
  );
}

