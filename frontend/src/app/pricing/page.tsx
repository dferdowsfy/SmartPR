"use client";

import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SmartPRLogo } from "../components/brand/SmartPRLogo";
import { PLANS, type PlanDefinition, type PlanId } from "@/lib/billing/catalog";
import styles from "./pricing.module.css";

type Period = "monthly" | "yearly";

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

  const [period, setPeriod] = useState<Period>("monthly");
  const [loadingPlan, setLoadingPlan] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cards = useMemo(() => PLANS, []);

  async function startCheckout(planId: PlanId) {
    setError(null);
    setLoadingPlan(planId);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, period }),
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
            <Link href="/#how-it-works">How it works</Link>
            <Link href="/pricing" className={styles.navActive}>
              Pricing
            </Link>
            <Link href="/#for-professionals">For professionals</Link>
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

