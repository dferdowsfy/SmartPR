import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fieldsAskedAgain,
  mergeSuppliedFieldIds,
  suppliedFieldIdsFrom,
} from "./pendingFields";
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

    // A later re-ask of the same ids is recognized as "asking again".
    const pending = [field("email"), field("password", true)];
    assert.deepEqual(
      fieldsAskedAgain(pending, after.supplied_field_ids).map((f) => f.id),
      ["email", "password"]
    );
  });
});
