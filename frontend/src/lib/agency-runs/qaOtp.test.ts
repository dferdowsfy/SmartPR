import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildGmailQuery,
  buildQaOtpConsentUrl,
  decodeGmailBody,
  extractOtpCode,
  fetchQaOtpCode,
  getQaOtpSpec,
  messageIsFresh,
  QA_OTP_SPECS,
  qaOtpAssistAllowed,
  qaOtpAssistConfigured,
  redactCode,
  shouldAutoAssist,
  type QaOtpSpec,
} from "./qaOtp";

const SPEC: QaOtpSpec = QA_OTP_SPECS.OGPE;

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k] as string;
  }
  try {
    fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  }
}

async function withEnvAsync(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(vars)) {
    saved[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k] as string;
  }
  try {
    await fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k] as string;
    }
  }
}

describe("buildGmailQuery", () => {
  it("includes sender, recency and subject", () => {
    const q = buildGmailQuery(SPEC);
    assert.ok(q.includes("from:DoNotReply@ddec.pr.gov"));
    assert.ok(q.includes("newer_than:10m"));
    assert.ok(q.includes("DDEC - SBP - Email Confirmation"));
  });
});

describe("decodeGmailBody", () => {
  it("decodes base64url", () => {
    const raw = "Su código es 482910. Válido por 5 minutos.";
    const encoded = Buffer.from(raw, "utf-8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    assert.equal(decodeGmailBody(encoded), raw);
  });
});

describe("extractOtpCode", () => {
  it("finds the first 6-digit code", () => {
    assert.equal(extractOtpCode("Tu código único es 482910, válido 5 minutos.", SPEC.codePattern), "482910");
  });
  it("returns null when there is no code", () => {
    assert.equal(extractOtpCode("Bienvenido al portal.", SPEC.codePattern), null);
  });
  it("does not match a 10-digit run", () => {
    assert.equal(extractOtpCode("Proyecto 2026711676 creado.", SPEC.codePattern), null);
  });
  it("prefers the code near the cue word over a project number", () => {
    const text = "Proyecto 2026-711676. Su código único es 482910, válido 5 minutos.";
    assert.equal(extractOtpCode(text, SPEC.codePattern), "482910");
  });
});

describe("messageIsFresh", () => {
  it("accepts a 2-minute-old email", () => {
    const now = 1_750_000_000_000;
    assert.equal(messageIsFresh(now - 2 * 60 * 1000, now, 4), true);
  });
  it("rejects a 5-minute-old email past the 4-minute window", () => {
    const now = 1_750_000_000_000;
    assert.equal(messageIsFresh(now - 5 * 60 * 1000, now, 4), false);
  });
  it("rejects garbage timestamps", () => {
    assert.equal(messageIsFresh(NaN, Date.now(), 4), false);
    assert.equal(messageIsFresh(0, Date.now(), 4), false);
  });
});

describe("redactCode", () => {
  it("removes every occurrence of the code", () => {
    assert.equal(redactCode("code 482910 sent 482910", "482910"), "code [redacted] sent [redacted]");
  });
  it("is a no-op without a code", () => {
    assert.equal(redactCode("nothing here", ""), "nothing here");
  });
});

describe("qaOtpAssistConfigured", () => {
  it("needs all three Gmail env vars", () => {
    withEnv(
      { QA_GOOGLE_CLIENT_ID: "id", QA_GOOGLE_CLIENT_SECRET: "s", QA_GMAIL_REFRESH_TOKEN: "rt" },
      () => assert.equal(qaOtpAssistConfigured(), true)
    );
    withEnv(
      { QA_GOOGLE_CLIENT_ID: "id", QA_GOOGLE_CLIENT_SECRET: "s", QA_GMAIL_REFRESH_TOKEN: undefined },
      () => assert.equal(qaOtpAssistConfigured(), false)
    );
  });
});

describe("qaOtpAssistAllowed", () => {
  const full = {
    QA_GOOGLE_CLIENT_ID: "id",
    QA_GOOGLE_CLIENT_SECRET: "s",
    QA_GMAIL_REFRESH_TOKEN: "rt",
    QA_OTP_ASSIST_BUSINESSES: "wftfxnkt,abc123",
  };
  it("allows an allowlisted business when configured", () => {
    withEnv(full, () => assert.equal(qaOtpAssistAllowed("wftfxnkt"), true));
  });
  it("denies a business off the allowlist", () => {
    withEnv(full, () => assert.equal(qaOtpAssistAllowed("otherbiz"), false));
  });
  it("denies when Gmail is not configured", () => {
    withEnv({ ...full, QA_GMAIL_REFRESH_TOKEN: undefined }, () =>
      assert.equal(qaOtpAssistAllowed("wftfxnkt"), false)
    );
  });
  it("denies empty business ids", () => {
    withEnv(full, () => assert.equal(qaOtpAssistAllowed(""), false));
  });
});

describe("shouldAutoAssist", () => {
  const base = {
    worker: "browser_use",
    status: "paused",
    stepKind: "mfa",
    businessId: "wftfxnkt",
    agencyId: "OGPE",
    assistInFlight: false,
  };
  const env = {
    QA_GOOGLE_CLIENT_ID: "id",
    QA_GOOGLE_CLIENT_SECRET: "s",
    QA_GMAIL_REFRESH_TOKEN: "rt",
    QA_OTP_ASSIST_BUSINESSES: "wftfxnkt",
  };
  it("fires when every gate holds", () => {
    withEnv(env, () => assert.equal(shouldAutoAssist(base), true));
  });
  it("never fires on the login step — the password stays human-only", () => {
    withEnv(env, () => assert.equal(shouldAutoAssist({ ...base, stepKind: "login" }), false));
  });
  it("never fires twice for the same pause", () => {
    withEnv(env, () => assert.equal(shouldAutoAssist({ ...base, assistInFlight: true }), false));
  });
  it("never fires for the mock worker", () => {
    withEnv(env, () => assert.equal(shouldAutoAssist({ ...base, worker: "mock" }), false));
  });
  it("never fires off the allowlist or without a spec", () => {
    withEnv(env, () => {
      assert.equal(shouldAutoAssist({ ...base, businessId: "nope" }), false);
      assert.equal(shouldAutoAssist({ ...base, agencyId: "NOPE" }), false);
    });
  });
});

describe("getQaOtpSpec", () => {
  it("returns the OGPe spec and null for unknown agencies", () => {
    assert.equal(getQaOtpSpec("OGPE")?.from, "DoNotReply@ddec.pr.gov");
    assert.equal(getQaOtpSpec("HACIENDA_SURI"), null);
    assert.equal(getQaOtpSpec(null), null);
  });
});

describe("buildQaOtpConsentUrl", () => {
  it("requests offline gmail.readonly", () => {
    const url = buildQaOtpConsentUrl("cid", "http://localhost");
    assert.ok(url.startsWith("https://accounts.google.com/o/oauth2/v2/auth?"));
    assert.ok(url.includes("gmail.readonly"));
    assert.ok(url.includes("access_type%3Doffline") || url.includes("access_type=offline"));
  });
});

// --- fetchQaOtpCode with a stubbed transport --------------------------------

type StubResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
function stubFetch(routes: Array<{ match: (url: string) => boolean; res: StubResponse }>) {
  const fn = async (url: string): Promise<StubResponse> => {
    const route = routes.find((r) => r.match(String(url)));
    if (!route) throw new Error(`unexpected fetch: ${url}`);
    return route.res;
  };
  return fn as unknown as (url: string, init?: RequestInit) => Promise<Response>;
}
const okJson = (body: unknown): StubResponse => ({
  ok: true,
  status: 200,
  json: async () => body,
});
const TOKEN = okJson({ access_token: "at" });

function otpMessageBody(code: string): string {
  return Buffer.from(`Su código único es ${code}. Válido por 5 minutos.`, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

describe("fetchQaOtpCode", () => {
  const NOW = 1_750_000_000_000;
  const noSleep = async (_ms: number) => {};
  const fastSpec: QaOtpSpec = { ...SPEC, pollAttempts: 1, pollIntervalMs: 1 };
  const gmailEnv = {
    QA_GOOGLE_CLIENT_ID: "id",
    QA_GOOGLE_CLIENT_SECRET: "s",
    QA_GMAIL_REFRESH_TOKEN: "rt",
  };

  it("returns the code from a fresh OTP email", async () => {
    await withEnvAsync(gmailEnv, async () => {
    const fetchFn = stubFetch([
      { match: (u) => u.includes("oauth2.googleapis.com"), res: TOKEN },
      {
        match: (u) => u.includes("/messages?"),
        res: okJson({ messages: [{ id: "m1" }] }),
      },
      {
        match: (u) => u.includes("/messages/m1"),
        res: okJson({
          internalDate: String(NOW - 60 * 1000),
          payload: { mimeType: "text/plain", body: { data: otpMessageBody("482910") } },
        }),
      },
    ]);
    const code = await fetchQaOtpCode(fastSpec, { fetchFn, nowMs: () => NOW, sleepMs: noSleep });
    assert.equal(code, "482910");
    });
  });

  it("ignores a stale OTP email and returns null", async () => {
    await withEnvAsync(gmailEnv, async () => {
    const fetchFn = stubFetch([
      { match: (u) => u.includes("oauth2.googleapis.com"), res: TOKEN },
      {
        match: (u) => u.includes("/messages?"),
        res: okJson({ messages: [{ id: "m1" }] }),
      },
      {
        match: (u) => u.includes("/messages/m1"),
        res: okJson({
          internalDate: String(NOW - 10 * 60 * 1000),
          payload: { mimeType: "text/plain", body: { data: otpMessageBody("111111") } },
        }),
      },
    ]);
    const code = await fetchQaOtpCode(fastSpec, { fetchFn, nowMs: () => NOW, sleepMs: noSleep });
    assert.equal(code, null);
    });
  });

  it("returns null when no OTP email exists", async () => {
    await withEnvAsync(gmailEnv, async () => {
    const fetchFn = stubFetch([
      { match: (u) => u.includes("oauth2.googleapis.com"), res: TOKEN },
      { match: (u) => u.includes("/messages?"), res: okJson({ messages: [] }) },
    ]);
    const code = await fetchQaOtpCode(fastSpec, { fetchFn, nowMs: () => NOW, sleepMs: noSleep });
    assert.equal(code, null);
    });
  });

  it("throws a code-free error when the mailbox is unreachable", async () => {
    const fetchFn = stubFetch([
      {
        match: (u) => u.includes("oauth2.googleapis.com"),
        res: { ok: false, status: 401, json: async () => ({}) },
      },
    ]);
    await assert.rejects(
      fetchQaOtpCode(fastSpec, { fetchFn, nowMs: () => NOW, sleepMs: noSleep }),
      /mailbox unreachable/
    );
  });
});
