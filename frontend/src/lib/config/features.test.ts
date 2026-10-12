import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  EGRESS_FEATURES,
  isFeatureEnabled,
  assertFeatureEnabled,
  FeatureDisabledError,
  resetFeatureWarningsForTests,
  type EgressFeature,
} from "./features";

const ENTERPRISE = {
  DEPLOYMENT_MODE: "enterprise",
  CUSTOMER_ID: "acme",
  CLOUD_PROVIDER: "azure",
  DATABASE_PROVIDER: "azure-postgres",
  STORAGE_PROVIDER: "azure-blob",
  AUTH_PROVIDER: "entra",
  MODEL_GATEWAY: "azure-foundry",
};
const ALL = Object.keys(EGRESS_FEATURES) as EgressFeature[];

// --- resolver ---------------------------------------------------------------

test("standard: every egress feature stays enabled (unchanged behaviour)", () => {
  for (const f of ALL) assert.equal(isFeatureEnabled(f, {}), true, f);
});

test("enterprise: every egress feature is disabled by default", () => {
  for (const f of ALL) assert.equal(isFeatureEnabled(f, ENTERPRISE), false, f);
});

test("enterprise: only an explicit ENTERPRISE_ALLOW_<X>=true enables a feature", () => {
  for (const f of ALL) {
    const flag = EGRESS_FEATURES[f];
    assert.equal(isFeatureEnabled(f, { ...ENTERPRISE, [flag]: "true" }), true, f);
    assert.equal(isFeatureEnabled(f, { ...ENTERPRISE, [flag]: " TRUE " }), true, f);
    for (const v of ["1", "yes", "false", "", "on"]) {
      assert.equal(isFeatureEnabled(f, { ...ENTERPRISE, [flag]: v }), false, `${f}=${v}`);
    }
    // Approving one feature never approves another.
    for (const other of ALL.filter((o) => o !== f)) {
      assert.equal(isFeatureEnabled(other, { ...ENTERPRISE, [flag]: "true" }), false, `${flag} leaked to ${other}`);
    }
  }
});

test("invalid deployment config fails closed (features disabled)", () => {
  for (const f of ALL) {
    assert.equal(isFeatureEnabled(f, { DEPLOYMENT_MODE: "enterprise" }), false, f);
    assert.equal(isFeatureEnabled(f, { DEPLOYMENT_MODE: "bogus" }), false, f);
  }
});

test("assertFeatureEnabled throws a named error when disabled", () => {
  assert.doesNotThrow(() => assertFeatureEnabled("billing", {}));
  assert.throws(() => assertFeatureEnabled("billing", ENTERPRISE), (e: unknown) => {
    assert.ok(e instanceof FeatureDisabledError);
    assert.equal((e as FeatureDisabledError).feature, "billing");
    assert.match((e as Error).message, /ENTERPRISE_ALLOW_BILLING=true/);
    return true;
  });
});

// --- integration points (process.env driven) ---------------------------------

const saved = { ...process.env };
function useEnv(env: Record<string, string>) {
  for (const k of [...Object.keys(ENTERPRISE), ...Object.values(EGRESS_FEATURES)]) delete process.env[k];
  Object.assign(process.env, env);
  resetFeatureWarningsForTests();
}
afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
  Object.assign(process.env, saved);
});

test("Browser Use Cloud reports unconfigured in enterprise even with an API key", async () => {
  const { isBrowserUseConfigured } = await import("../agency-runs/browserUseClient");
  const { cloudBrowserConfigured } = await import("../agency-runs/teach/cloudBrowser");
  useEnv({ BROWSER_USE_API_KEY: "bu_test" });
  assert.equal(isBrowserUseConfigured(), true);
  assert.equal(cloudBrowserConfigured(), true);
  useEnv({ ...ENTERPRISE, BROWSER_USE_API_KEY: "bu_test" });
  assert.equal(isBrowserUseConfigured(), false);
  assert.equal(cloudBrowserConfigured(), false);
  useEnv({ ...ENTERPRISE, BROWSER_USE_API_KEY: "bu_test", ENTERPRISE_ALLOW_BROWSER_USE_CLOUD: "true" });
  assert.equal(isBrowserUseConfigured(), true);
});

test("xAI voice webhook and MCP callback return 404 in enterprise", async () => {
  useEnv({ ...ENTERPRISE });
  const webhook = await import("../../app/api/voice/xai-webhook/route");
  const mcp = await import("../../app/api/mcp/voice/route");
  const req = () => new Request("https://x.test/", { method: "POST", body: "{}" });
  for (const res of [await webhook.POST(req()), await mcp.POST(req())]) {
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "feature_disabled", feature: "voiceTelephony" });
  }
});

test("Stripe client refuses to initialise in enterprise", async () => {
  const { getStripe } = await import("../billing/stripe");
  useEnv({ ...ENTERPRISE, STRIPE_SECRET_KEY: "sk_test_x" });
  assert.throws(() => getStripe(), FeatureDisabledError);
});

test("Stripe webhook returns 404 in enterprise", async () => {
  useEnv({ ...ENTERPRISE });
  const { POST } = await import("../../app/api/billing/webhook/route");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await POST(new Request("https://x.test/", { method: "POST", body: "{}" }) as any);
  assert.equal(res.status, 404);
});

test("invite email is skipped in enterprise even with SMTP configured", async () => {
  const { sendInviteEmail } = await import("../invites");
  useEnv({ ...ENTERPRISE, GMAIL_SMTP_APP_PASSWORD: "app-pass" });
  assert.equal(await sendInviteEmail("a@b.test", "<p>x</p>"), false);
});

test("Google Analytics is not rendered in enterprise", async () => {
  const { AnalyticsMount } = await import("../../app/components/AnalyticsMount");
  useEnv({ NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-TEST" });
  assert.notEqual(AnalyticsMount(), null);
  useEnv({ ...ENTERPRISE, NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-TEST" });
  assert.equal(AnalyticsMount(), null);
});

test("Stripe checkout returns 404 in enterprise", async () => {
  useEnv({ ...ENTERPRISE });
  const { POST } = await import("../../app/api/billing/checkout/route");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await POST(new Request("https://x.test/", { method: "POST", body: "{}" }) as any);
  assert.equal(res.status, 404);
});

test("agency filing runs refuse instead of falling back to simulated runs in enterprise", async () => {
  const { createRun } = await import("../agency-runs/store");
  useEnv({ ...ENTERPRISE, BROWSER_USE_API_KEY: "bu_test" });
  await assert.rejects(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createRun({ business_id: "b1", filing_type: "anything" as any }),
    FeatureDisabledError
  );
});

test("reminder, compliance and founder emails are skipped in enterprise", async () => {
  const { sendComplianceEmail } = await import("../compliance-reminders");
  const { sendReminderEmail } = await import("../enterprise-reminders");
  const { notifyFounder } = await import("../leads");
  useEnv({ ...ENTERPRISE, GMAIL_SMTP_APP_PASSWORD: "app-pass", RESEND_API_KEY: "re_test" });
  const realFetch = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = (async () => {
    fetched = true;
    return new Response("{}");
  }) as typeof fetch;
  try {
    assert.equal(await sendComplianceEmail("a@b.test", "s", "t", "<p>t</p>"), false);
    assert.equal(await sendReminderEmail("a@b.test", "s", [{ label: "x", value: "y" }]), false);
    await notifyFounder("s", { a: "b" });
    assert.equal(fetched, false);
  } finally {
    globalThis.fetch = realFetch;
  }
});
