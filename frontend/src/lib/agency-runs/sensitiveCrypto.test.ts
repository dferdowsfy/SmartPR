import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  __resetSensitiveKeyForTests,
  isSealedSensitiveValue,
  sealSensitiveValue,
  sensitiveValueMask,
  unsealSensitiveValue,
} from "./sensitiveCrypto";

describe("sealSensitiveValue / unsealSensitiveValue", () => {
  it("round-trips a sensitive value", async () => {
    __resetSensitiveKeyForTests();
    const sealed = await sealSensitiveValue("123-45-6789");
    assert.ok(isSealedSensitiveValue(sealed));
    assert.equal(await unsealSensitiveValue(sealed), "123-45-6789");
  });

  it("produces a different envelope on every seal (random IV)", async () => {
    __resetSensitiveKeyForTests();
    const a = await sealSensitiveValue("same-value");
    const b = await sealSensitiveValue("same-value");
    assert.notEqual(a.data, b.data);
    assert.notEqual(a.iv, b.iv);
    assert.equal(await unsealSensitiveValue(a), "same-value");
    assert.equal(await unsealSensitiveValue(b), "same-value");
  });

  it("the envelope never contains the plaintext", async () => {
    __resetSensitiveKeyForTests();
    const secret = "s3cret-p@ssw0rd!";
    const sealed = await sealSensitiveValue(secret);
    assert.ok(!JSON.stringify(sealed).includes(secret));
  });

  it("rejects empty plaintext", async () => {
    __resetSensitiveKeyForTests();
    await assert.rejects(() => sealSensitiveValue(""), /empty plaintext/);
  });

  it("fails closed on tampered ciphertext", async () => {
    __resetSensitiveKeyForTests();
    const sealed = await sealSensitiveValue("123-45-6789");
    const tampered = {
      ...sealed,
      data: sealed.data.slice(0, -4) + "AAAA",
    };
    await assert.rejects(() => unsealSensitiveValue(tampered));
  });

  it("fails closed after the session key is lost (wrong key)", async () => {
    __resetSensitiveKeyForTests();
    const sealed = await sealSensitiveValue("123-45-6789");
    __resetSensitiveKeyForTests(); // new session, new key
    await assert.rejects(() => unsealSensitiveValue(sealed));
  });

  it("rejects non-envelope input", async () => {
    __resetSensitiveKeyForTests();
    await assert.rejects(() =>
      unsealSensitiveValue({} as never)
    );
    await assert.rejects(() =>
      unsealSensitiveValue("plaintext" as never)
    );
  });
});

describe("isSealedSensitiveValue", () => {
  it("accepts real envelopes and rejects lookalikes", async () => {
    __resetSensitiveKeyForTests();
    const sealed = await sealSensitiveValue("x");
    assert.equal(isSealedSensitiveValue(sealed), true);
    assert.equal(isSealedSensitiveValue(null), false);
    assert.equal(isSealedSensitiveValue(undefined), false);
    assert.equal(isSealedSensitiveValue("x"), false);
    assert.equal(isSealedSensitiveValue({ __sealed: true }), false);
    assert.equal(
      isSealedSensitiveValue({ __sealed: true, v: 1, alg: "AES-GCM-256" }),
      false
    );
  });
});

describe("sensitiveValueMask", () => {
  it("returns a fixed mask that reveals nothing about the value", () => {
    assert.equal(sensitiveValueMask(), "••••••••");
  });
});
