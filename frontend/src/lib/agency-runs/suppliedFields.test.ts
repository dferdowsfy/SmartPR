import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  askedAgainWithValues,
  fieldsAskedAgain,
  mergeSuppliedFieldIds,
  suppliedFieldIdsFrom,
} from "./pendingFields";
import {
  __resetSensitiveKeyForTests,
  sealSensitiveValue,
} from "./sensitiveCrypto";
import { createRun, peekRun, resumeRun } from "./store";
import type { AgencyPendingField } from "./types";

const field = (id: string, sensitive = false): AgencyPendingField => ({
  id,
  label: id,
  type: "text",
  sensitive,
});

describe("fieldsAskedAgain", () => {
  it("returns the pending fields the human already supplied", () => {
    const pending = [field("ssn", true), field("email"), field("phone")];
    const again = fieldsAskedAgain(pending, ["ssn", "phone"]);
    assert.deepEqual(again.map((f) => f.id), ["ssn", "phone"]);
  });

  it("returns [] when nothing was supplied before", () => {
    assert.deepEqual(fieldsAskedAgain([field("ssn", true)], []), []);
    assert.deepEqual(fieldsAskedAgain([field("ssn", true)], null), []);
    assert.deepEqual(fieldsAskedAgain([field("ssn", true)], undefined), []);
  });

  it("returns [] when there is no overlap", () => {
    assert.deepEqual(fieldsAskedAgain([field("email")], ["ssn"]), []);
  });

  it("returns [] when nothing is pending", () => {
    assert.deepEqual(fieldsAskedAgain([], ["ssn"]), []);
  });
});

describe("suppliedFieldIdsFrom", () => {
  it("keeps only ids with non-empty string values", () => {
    assert.deepEqual(
      suppliedFieldIdsFrom({ ssn: "123-45-6789", email: "  ", pin: 123, nick: "" }),
      ["ssn"]
    );
  });

  it("handles null/undefined", () => {
    assert.deepEqual(suppliedFieldIdsFrom(null), []);
    assert.deepEqual(suppliedFieldIdsFrom(undefined), []);
  });
});

describe("mergeSuppliedFieldIds", () => {
  it("appends new ids without duplicating", () => {
    assert.deepEqual(
      mergeSuppliedFieldIds(["ssn"], { ssn: "1", email: "a@b.c" }),
      ["ssn", "email"]
    );
  });

  it("is null-safe and drops empty values", () => {
    assert.deepEqual(mergeSuppliedFieldIds(null, { ssn: "  " }), []);
    assert.deepEqual(mergeSuppliedFieldIds(undefined, null), []);
  });
});

describe("supplied_field_ids on runs (ids only — never values)", () => {
  it("createRun seeds ids from pre-flight fields", async () => {
    const pub = await createRun({
      business_id: "biz-seed",
      filing_type: "SURI_REGISTER_TAXPAYER",
      fields: { ssn: "123-45-6789", entity_number: "  " },
    });
    assert.deepEqual(pub.supplied_field_ids, ["ssn"]);
    // The raw sensitive value must never leak into the public payload.
    assert.ok(!JSON.stringify(pub).includes("123-45-6789"));
  });

  it("createRun without fields starts with no supplied ids", async () => {
    const pub = await createRun({
      business_id: "biz-empty",
      filing_type: "SURI_REGISTER_TAXPAYER",
    });
    assert.deepEqual(pub.supplied_field_ids, []);
  });

  it("resumeRun appends submitted field ids and never stores values", async () => {
    const pub = await createRun({
      business_id: "biz-resume",
      filing_type: "SURI_REGISTER_TAXPAYER",
    });
    const internal = peekRun(pub.id);
    assert.ok(internal, "internal run should exist");
    // Simulate the pause the resume resolves.
    internal.status = "paused";
    internal.pause_reason = "USER_LOGIN";

    const after = await resumeRun(pub.id, {
      fields: { email: "owner@example.com", password: "s3cret!" },
    });
    assert.ok(after, "resume should return the run");
    assert.deepEqual(after.supplied_field_ids, ["email", "password"]);
    // Values stay ephemeral — neither the public payload nor the stored
    // run may carry them.
    assert.ok(!JSON.stringify(after).includes("s3cret!"));
    assert.ok(!JSON.stringify(peekRun(pub.id)).includes("s3cret!"));
    // No run event message may carry a submitted value either.
    const stored = peekRun(pub.id);
    assert.ok(stored, "stored run should exist");
    for (const e of stored.events ?? []) {
      assert.ok(
        typeof e.message !== "string" || !e.message.includes("s3cret!"),
        "event message leaked a sensitive value"
      );
    }

    // A later re-ask of the same ids is recognized as "asking again".
    const pending = [field("email"), field("password", true)];
    assert.deepEqual(
      fieldsAskedAgain(pending, after.supplied_field_ids).map((f) => f.id),
      ["email", "password"]
    );
  });
});

describe("askedAgainWithValues (banner misfire guard)", () => {
  const pending = [field("registry_number"), field("email")];

  it("returns the field only when a non-empty value was actually retained", () => {
    const again = askedAgainWithValues(pending, ["registry_number"], {
      registry_number: "482916",
    });
    assert.deepEqual(again.map((f) => f.id), ["registry_number"]);
  });

  it("returns [] when the id is supplied but no value was retained (the misfire case)", () => {
    // e.g. id seeded from pre-flight before the client ever saw the value
    assert.deepEqual(
      askedAgainWithValues(pending, ["registry_number"], {}),
      []
    );
    assert.deepEqual(
      askedAgainWithValues(pending, ["registry_number"], {
        registry_number: "   ",
      }),
      []
    );
    assert.deepEqual(askedAgainWithValues(pending, ["registry_number"], null), []);
  });

  it("ignores values for fields that are not supplied ids", () => {
    assert.deepEqual(
      askedAgainWithValues(pending, ["email"], { registry_number: "482916" }),
      []
    );
  });

  it("returns [] when nothing is pending", () => {
    assert.deepEqual(
      askedAgainWithValues([], ["registry_number"], { registry_number: "1" }),
      []
    );
  });

  it("counts a sealed sensitive envelope as a retained value (banner renders)", async () => {
    __resetSensitiveKeyForTests();
    const sealed = await sealSensitiveValue("123-45-6789");
    const again = askedAgainWithValues([field("ssn", true)], ["ssn"], {
      ssn: sealed,
    });
    assert.deepEqual(again.map((f) => f.id), ["ssn"]);
    // ...without leaking the plaintext anywhere it checks
    assert.ok(!JSON.stringify({ again }).includes("123-45-6789"));
  });
});
