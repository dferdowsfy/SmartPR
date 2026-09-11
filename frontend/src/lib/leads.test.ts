import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { notifyFounder, notifyNewBusiness, setMailerForTests } from "./leads.ts";

// notifyFounder sends through the Workspace mailbox via SMTP. These tests
// swap the real transport for a fake and verify the recipient, the subject,
// the failure logging, and the missing-credential behavior.
describe("notifyFounder", () => {
  let sent: Array<Record<string, unknown>> = [];
  let shouldFail = false;

  beforeEach(() => {
    sent = [];
    shouldFail = false;
    delete process.env.GMAIL_SMTP_APP_PASSWORD;
    setMailerForTests({
      sendMail: async (options: Record<string, unknown>) => {
        if (shouldFail) throw new Error("SMTP rejected");
        sent.push(options);
        return { messageId: "test-1" };
      },
    });
  });

  afterEach(() => {
    setMailerForTests(null);
    delete process.env.GMAIL_SMTP_APP_PASSWORD;
  });

  it("sends to the founder with the SmartPR subject", async () => {
    await notifyFounder("New signup", { Name: "Ayden Bermudez", Email: "ayden@example.com" });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "dferdows@gmail.com");
    assert.match(String(sent[0].subject), /\[SmartPR\] New signup/);
    assert.match(String(sent[0].text), /Ayden Bermudez/);
    assert.match(String(sent[0].from), /getsmartpr\.com/);
  });

  it("logs a delivery failure when SMTP throws", async () => {
    shouldFail = true;
    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => errors.push(String(msg));
    try {
      await notifyFounder("New signup", { Name: "Ayden Bermudez" });
    } finally {
      console.error = origError;
    }
    assert.equal(sent.length, 0);
    assert.ok(
      errors.some((m) => m.includes("delivery failed") && m.includes("SMTP rejected")),
      `expected a delivery-failed log, got: ${JSON.stringify(errors)}`
    );
  });

  it("skips loudly when no app password is configured", async () => {
    setMailerForTests(null); // no fake transport and no credential
    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => errors.push(String(msg));
    try {
      await notifyFounder("New signup", { Name: "Ayden Bermudez" });
    } finally {
      console.error = origError;
    }
    assert.ok(
      errors.some((m) => m.includes("GMAIL_SMTP_APP_PASSWORD is not set")),
      `expected a missing-credential log, got: ${JSON.stringify(errors)}`
    );
  });

  it("new-business alert carries the business details and a view link", async () => {
    await notifyNewBusiness({
      businessName: "OAFA Rubber",
      businessType: "Tire Recycling & Manufacturing",
      industry: "Manufacturing",
      municipality: "Yabucoa",
      onboardingMode: "NEW",
      publicId: "k7d2mq9x",
      ownerName: "Luis Infanzon",
      ownerEmail: "luis@example.com",
    });
    assert.equal(sent.length, 1);
    assert.match(String(sent[0].subject), /\[SmartPR\] New business started/);
    const text = String(sent[0].text);
    for (const expected of [
      "OAFA Rubber",
      "Tire Recycling & Manufacturing",
      "Yabucoa",
      "Luis Infanzon",
      "https://www.getsmartpr.com/businesses/k7d2mq9x",
    ]) {
      assert.ok(text.includes(expected), `expected alert to include "${expected}"`);
    }
  });
});
