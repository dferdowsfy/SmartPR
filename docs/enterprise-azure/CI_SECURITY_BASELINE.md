# CI and Security Baseline

Workflow: `.github/workflows/ci.yml`. It runs on every pull request and on
every push to `main`.

CI exists to stop anything from getting **worse** before the enterprise
changes start touching the database, auth, storage and AI code. It does not
hide the defects that already exist. Every known failure still runs and still
shows up in the logs.

## Baseline recorded at `main@0da0866` (2026-09-29)

| Check | Result |
|---|---|
| TypeScript (`tsc --noEmit`) | PASS |
| Production build | PASS |
| `test:security` | 42/42 |
| `test:voice` | 126/126 |
| `test:config` | 11/11 |
| `test:regulatory-correctness` | 256/259; G13, G20 and G21 fail |
| ESLint, full repo | 168 errors, 63 warnings |
| gitleaks, full history | no leaks, after one reviewed fixture allowlist |

All suites give the same results with no AI or database credentials set. CI
receives no secrets.

## Gates

Every job below is **required**, meaning it fails the run when its condition
is not met.

| Job | Command | When it fails |
|---|---|---|
| `typecheck` | `npx tsc --noEmit` | Any type error |
| `build` | `npm run build` | The build fails |
| `tests (security / voice / config)` | `npm run test:<suite>` | Any test fails |
| `regulatory` | Runs the suite with TAP output, then `scripts/ci/regulatory-baseline.mjs` | See the Golden baseline section |
| `lint` | Full `eslint .` report, then `scripts/ci/lint-baseline.mjs` | See the lint baseline section |
| `secrets` | `gitleaks git . --redact` over the full history | Any finding not on the allowlist |

The full lint report and the full regulatory TAP log are always printed,
whether or not the job fails. When the only failures are known ones, the job
passes and GitHub shows an `::warning::` annotation naming the known debt.

## Regulatory Golden baseline

- **File:** `frontend/ci/regulatory-known-failures.json`. It records the three
  known failures (G13, G20, G21) by exact test name, and the minimum test
  count, 259.
- **How the gate reads results:** it takes the top-level `ok` / `not ok`
  results from the TAP output. The reporter is forced to TAP with
  `NODE_OPTIONS=--test-reporter=tap`.

| Situation | Result |
|---|---|
| Exactly G13, G20 and G21 fail | PASS, with a visible warning |
| Any other test fails (for example 255/259) | FAIL: regression |
| A known failure now passes (257/259 or better) | FAIL: improvement. Remove that entry from the baseline file in the same PR. |
| A known failure is missing (renamed or removed) | FAIL |
| Test count drops below 259 | FAIL |
| Any test is skipped, marked todo, or cancelled | FAIL |

**Why the known failures are not skipped, deleted or rewritten:** they are
real regulatory-correctness defects. Skipping them would make the suite report
a success that isn't true. Keeping them as named, visible exceptions means
they cannot be forgotten, and no new failure can hide behind them. An
improvement must be recorded on purpose, so a fix can't silently regress
later.

## Lint baseline (transitional)

- **File:** `frontend/ci/lint-baseline.json`. For each file, it records a
  problem count per rule and severity. It deliberately stores no line numbers,
  so moving unrelated lines doesn't trip the gate.
- **What `scripts/ci/lint-baseline.mjs` fails on:**
  1. Any count above its baseline, or a problem in a file or rule the baseline
     doesn't list. This is the regression check.
  2. Any lint problem at all in a file **added or modified** by the PR,
     compared with the PR's base commit, or with the previous `main` commit on
     a push. Touching a file means cleaning the whole file.
  3. Any count **below** its baseline. The debt went down, so the baseline
     must be lowered in the same PR. This is how the ratchet moves only toward
     zero.
- **What this PR does not do:** no rules were weakened, and no ignores were
  added. The ESLint config is unchanged.

**Plan to pay down the lint debt** (separate PRs, not started):

1. Fix the problems that `eslint --fix` can resolve automatically (unused
   disable directives and similar), one reviewed PR per area.
2. Fix the remaining errors area by area. Test-only files and admin UI come
   first; files with enterprise-critical paths (auth, db, AI) get cleaned as
   the enterprise PRs touch them, which rule 2 above enforces.
3. Once both counts reach 0, delete the baseline tooling and gate on
   `eslint --max-warnings 0`.

### Updating a baseline on purpose

```bash
cd frontend
# Lint (after a genuine reduction in debt)
npx eslint -f json -o /tmp/eslint.json . ; node scripts/ci/lint-baseline.mjs --report /tmp/eslint.json --update
# Regulatory: edit ci/regulatory-known-failures.json and remove the fixed entry.
```

A baseline change must be visible in the PR diff and explained in the PR
description. **Never raise a baseline to make CI pass.**

## Secret scanning

- **Scanner:** gitleaks v8.28.0. It is downloaded from the official release
  and its SHA-256 checksum is verified before use.
- **Scope:** the full git history (`fetch-depth: 0`).
- **Output:** `--redact` keeps matched values out of the logs. No report file
  is uploaded.
- **Allowlist:** `.gitleaksignore` lists **exact fingerprints only**
  (commit:file:rule:line). The single allowed item is a fake JWT test fixture
  in `soc2-security.test.ts:78`. Its header is `{"alg":"HS256","typ":"JWT"}`,
  its payload is `{}` and its signature is the literal text `sig`. It appears
  in three historical commits. There are no path or rule-level allowlists.
- **Why gitleaks:**
  - It runs as a plain CLI, so it needs no third-party GitHub Action and no
    license key.
  - It is fast (about 2 seconds for the whole history).
  - Its default rules cover the providers this repo uses: Stripe, Supabase
    JWTs, generic API keys, Google and more.
  - Checksum pinning guards against the downloaded binary being tampered with.

## CI security posture

- `permissions: contents: read` for the whole workflow. No write scopes.
- `persist-credentials: false` on every checkout.
- Third-party actions are pinned by commit SHA (`actions/checkout` v4.2.2,
  `actions/setup-node` v4.4.0).
- No repository secrets are referenced. No cloud credentials. **No Azure
  authentication.**
- Untrusted event data such as base SHAs is passed through `env:`, never
  written directly into `run:` scripts.
- Future Azure deployment workflows must use GitHub OIDC with Entra workload
  identity federation (`id-token: write`, scoped to that job only). They must
  never use stored client secrets. That work is out of scope here.
