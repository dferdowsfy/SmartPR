import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { roleRank, canEditWorkspace, canManageTeam } from "./admin.ts";
import {
  newInviteToken,
  inviteUrlForToken,
  buildInviteEmailHtml,
} from "./invites.ts";

describe("workspace role hierarchy", () => {
  it("ranks OWNER > ADMIN > MEMBER > VIEWER", () => {
    assert.ok(roleRank("OWNER") > roleRank("ADMIN"));
    assert.ok(roleRank("ADMIN") > roleRank("MEMBER"));
    assert.ok(roleRank("MEMBER") > roleRank("VIEWER"));
  });

  it("unknown roles rank zero", () => {
    assert.equal(roleRank(null), 0);
    assert.equal(roleRank(undefined), 0);
    assert.equal(roleRank("SUPERUSER"), 0);
  });

  it("MEMBER+ can edit, VIEWER cannot", () => {
    assert.equal(canEditWorkspace("OWNER"), true);
    assert.equal(canEditWorkspace("ADMIN"), true);
    assert.equal(canEditWorkspace("MEMBER"), true);
    assert.equal(canEditWorkspace("VIEWER"), false);
    assert.equal(canEditWorkspace(null), false);
  });

  it("ADMIN+ can manage the team, MEMBER cannot", () => {
    assert.equal(canManageTeam("OWNER"), true);
    assert.equal(canManageTeam("ADMIN"), true);
    assert.equal(canManageTeam("MEMBER"), false);
    assert.equal(canManageTeam("VIEWER"), false);
  });
});

describe("invites", () => {
  it("tokens are unique", () => {
    assert.notEqual(newInviteToken(), newInviteToken());
  });

  it("invite URL carries the token", () => {
    const url = inviteUrlForToken("abc123");
    assert.ok(url.includes("invite=abc123"));
    assert.ok(url.includes("/signup"));
  });

  it("invite email HTML escapes user input", () => {
    const html = buildInviteEmailHtml({
      workspaceName: "<script>alert(1)</script>",
      role: "ADMIN",
      inviteUrl: "https://example.com/signup?invite=x",
      inviterEmail: "boss@company.com",
    });
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.ok(html.includes("&lt;script&gt;"));
    assert.ok(html.includes("boss@company.com"));
  });
});
