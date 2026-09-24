import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  __resetSensitiveKeyForTests,
  isSealedSensitiveValue,
  sealSensitiveValue,
} from "./sensitiveCrypto";
import {
  assertNoSensitivePlaintext,
  fieldValuePresent,
  isSensitiveField,
  sealFieldEntries,
  unsealFieldEntries,
} from "./sensitiveFields";

describe("isSensitiveField", () => {
  it("matches the UI's masked-field definition", () => {
    assert.equal(
      isSensitiveField({ sensitive: true, type: "text" }),
      true
    );
    assert.equal(
      isSensitiveField({ sensitive: false, type: "password" }),
      true
    );
    assert.equal(
      isSensitiveField({ sensitive: true, type: "password" }),
      true
    );
    assert.equal(isSensitiveField({ sensitive: false, type: "text" }), false);
    assert.equal(isSensitiveField({ type: "email" }), false);
    assert.equal(isSensitiveField(null), false);
    assert.equal(isSensitiveField(undefined), false);
  });
});

describe("fieldValuePresent", () => {
  it("treats sealed envelopes as present and blank strings as absent", async () => {
    __resetSensitiveKeyForTests();
    const sealed = await sealSensitiveValue("123-45-6789");
    assert.equal(fieldValuePresent(sealed), true);
    assert.equal(fieldValuePresent("abc"), true);
    assert.equal(fieldValuePresent("  "), false);
    assert.equal(fieldValuePresent(""), false);
    assert.equal(fieldValuePresent(null), false);
    assert.equal(fieldValuePresent(undefined), false);
  });
});

describe("sealFieldEntries / unsealFieldEntries", () => {
  const isSensitiveId = (id: string) => id === "ssn" || id === "password";

  it("seals sensitive ids and passes non-sensitive through", async () => {
    __resetSensitiveKeyForTests();
    const sealed = await sealFieldEntries(
      { ssn: "123-45-6789", email: "a@b.c", empty: "   " },
      isSensitiveId
    );
    assert.ok(isSealedSensitiveValue(sealed.ssn));
    assert.equal(sealed.email, "a@b.c");
    assert.ok(!("empty" in sealed));
    assert.ok(!JSON.stringify(sealed).includes("123-45-6789"));
  });

  it("unseals transiently back to the exact plaintext map", async () => {
    __resetSensitiveKeyForTests();
    const retained = await sealFieldEntries(
      { ssn: "123-45-6789", password: "s3cret!", email: "a@b.c" },
      isSensitiveId
    );
    const plain = await unsealFieldEntries(retained);
    assert.deepEqual(plain, {
      ssn: "123-45-6789",
      password: "s3cret!",
      email: "a@b.c",
    });
  });

  it("unseal is null-safe", async () => {
    assert.deepEqual(await unsealFieldEntries(null), {});
    assert.deepEqual(await unsealFieldEntries(undefined), {});
  });
});

describe("assertNoSensitivePlaintext", () => {
  const isSensitiveId = (id: string) => id === "ssn";

  it("passes when sensitive ids are sealed or absent", async () => {
    __resetSensitiveKeyForTests();
    const sealed = await sealSensitiveValue("123-45-6789");
    assert.doesNotThrow(() =>
      assertNoSensitivePlaintext({ ssn: sealed, email: "a@b.c" }, isSensitiveId)
    );
    assert.doesNotThrow(() => assertNoSensitivePlaintext({}, isSensitiveId));
    assert.doesNotThrow(() => assertNoSensitivePlaintext(null, isSensitiveId));
  });

  it("throws naming the offending field when sensitive plaintext rests", () => {
    assert.throws(
      () => assertNoSensitivePlaintext({ ssn: "123-45-6789" }, isSensitiveId),
      /ssn/
    );
  });
});
