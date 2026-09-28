/**
 * Shared auth helper for the Clara portal e2e suites.
 *
 * Production middleware 307-redirects anonymous /businesses/* visitors to
 * /auth/login, so the suites need a real session before their client-side
 * API stubs (page.route) take over. This signs in through the real login
 * form with the dedicated regression-test account.
 *
 * Credentials come from E2E_TEST_EMAIL / E2E_TEST_PASSWORD — never committed.
 * Without them the suite exits 3 (blocked: no test credentials), which the
 * regression runner records as "blocked", not as a pass or a fail.
 */
export async function ensureSignedIn(page, base, path = "/businesses/b1/agency-run?demo=1") {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  await page.goto(`${base}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  if (!/\/auth\/login/.test(page.url())) return; // already have a session
  if (!email || !password) {
    console.error(
      "BLOCKED: /businesses/* requires sign-in on production. " +
        "Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD (dedicated regression-test account) to run this suite."
    );
    process.exit(3);
  }
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: "Login", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), {
    timeout: 30000,
  });
  // Land back on the run page so the suite starts from its expected URL.
  if (!page.url().includes("/agency-run")) {
    await page.goto(`${base}${path}`, {
      waitUntil: "networkidle",
      timeout: 45000,
    });
  }
}
