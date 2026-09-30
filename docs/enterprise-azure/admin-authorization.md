# Admin Authorization: Enterprise Fail-Closed

Scope: platform super-admin checks in `frontend/src/lib/admin.ts`, which are
`isAdminEmail`, `isUserAdmin`, `userInGroup` and the functions built on them
(`isSuperAdmin`, `requireSuperAdmin`, billing, voice and enterprise gates).

## Previous risk (audit blocker E-9)

Admins were granted from `ADMIN_EMAILS` or the `admin_allowlist` table. When
**neither named any admin**, the code applied an *open default*: **every
signed-in user was treated as a platform admin**. It did the same in these
fallback paths:

- no database configured (`getPool()` returned null);
- `admin_allowlist` missing, or any database error;
- an `ADMIN_EMAILS` value with no emails in it, such as blank or `" , , "`.

A fresh enterprise environment would start in exactly that state: a clean
database and no allowlist. Its first user to sign in would get full platform
administration.

## New behavior

The open default is allowed only when `loadDeploymentConfig()` (PR #1)
succeeds **and** reports `mode === "standard"`.

| Deployment | No admins configured | DB missing or error | Explicitly listed admin | Other signed-in user |
|---|---|---|---|---|
| Standard (unset or `DEPLOYMENT_MODE=standard`, valid config) | admin (unchanged) | admin if env list empty (unchanged) | admin | denied once any admin exists (unchanged) |
| Enterprise (`DEPLOYMENT_MODE=enterprise`) | **denied** | **denied** | admin (env or DB allowlist) | **denied** |
| Invalid deployment config (any mode) | **denied** | **denied** | admin | **denied** |

- When the open default is refused, the server logs a warning once. The
  warning contains no emails or configuration values.
- The config is re-read on every check, so the open state is never cached.
- Nothing changed in Supabase Auth, the database schema, the RBAC roles, or
  workspace-level roles (`OWNER`/`ADMIN`/…).

**Tests:** `frontend/src/lib/__tests__/admin-open-default.test.ts`, run as part
of `npm run test:security`. The Enterprise tests fail against the previous
`admin.ts`. The Standard tests pass against both the old and new versions.

## First Enterprise administrator (future, not implemented here)

In enterprise mode, no user can become an administrator unless explicitly
authorized. The intended approach:

1. An approved identity configuration names the initial administrators. For
   example, a customer Entra ID security group is mapped to the SmartPR super
   admin or `org_owner` role. The mapping is supplied through IaC or
   deployment configuration, not through code, and is reviewed as part of the
   customer security approval.
2. Until that exists, an operator must set `ADMIN_EMAILS` or add
   `admin_allowlist` rows through a reviewed, audited change.

**Entra ID sign-in, group-to-role mapping, and automated admin bootstrap are
not implemented in this PR.** They belong to the later identity PRs (audit
PR sequence items 7–8).

## Remaining debt: Standard open default

Standard still has the open default. Production is safe only while
`ADMIN_EMAILS` or `admin_allowlist` is non-empty (see
`docs/security/security-control-inventory.md` and `soc2-readiness.md`, which
already track "close OPEN DEFAULT"). Recommendation: close it for Standard too
in a separate reviewed PR, after confirming production's allowlist is
populated. This PR deliberately leaves it unchanged.
