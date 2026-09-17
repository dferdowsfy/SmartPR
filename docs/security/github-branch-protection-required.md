# GitHub branch protection — required settings (main)

> These settings must be configured in the GitHub repository UI. This document is **not** evidence that they are enabled. Status: **Requires verification.**

## Required on `main`

1. **Restrict who can push** — no direct pushes from general contributors; prefer PR-only.
2. **Require a pull request before merging**
   - At least 1 approving review (recommend 1 until a second reviewer is available; increase when practical).
   - Dismiss stale reviews when new commits are pushed.
3. **Require status checks to pass before merging**
   - Require branches to be up to date before merging.
   - Required checks (once workflows land): `ci / lint-typecheck`, `ci / security-tests`, `ci / secret-scan` (names may vary — match actual workflow job names).
4. **Require conversation resolution before merging**
5. **Do not allow force pushes**
6. **Do not allow deletions**
7. **Restrict admin bypass** when the team is ready (optional early; recommended before external audit).

## Evidence to attach later

- Screenshot of Settings → Branches → Branch protection rule for `main`
- Link to a recent PR that was blocked until checks passed

Do not invent screenshots or dates in the evidence register.

## CI workflow file

The recommended GitHub Actions workflow lives at
`docs/security/examples/github-actions-ci.yml` (lint/typecheck, security tests,
heuristic secret scan). Copy it to `.github/workflows/ci.yml` using an account
or token with the `workflow` OAuth scope — some automation tokens cannot create
workflow files directly.

