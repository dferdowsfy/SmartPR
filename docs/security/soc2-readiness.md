# SOC 2 readiness overview

## Exact disclaimer

**This repository and the SmartPR security center document SOC 2 readiness work only. Nothing here asserts that SmartPR is SOC 2 certified, SOC 2 compliant, or that an independent auditor has attested to these controls. Inventory statuses reflect code and documentation evidence; production configuration, vendor reports, and operational cadence require separate verification.**

## What exists

- Control inventory: `docs/security/security-control-inventory.md`
- Machine-readable registry: `data/security_controls.json` (+ typed helpers under `frontend/src/lib/security/`)
- Evidence / incidents / risks / policies / access-review schema: `data/security_soc2_readiness.sql`
- Superadmin APIs: `/api/admin/security/**` (server-enforced `requireSuperAdmin`)
- UI: `/admin/security`, `/admin/security/access-review`
- Supporting policies under `docs/security/`

## What this is not

- A SOC 2 report or Type I/II attestation
- A numeric “SOC 2 score”
- Proof that branch protection, backups, or admin allowlists are correctly set in production

## Suggested path toward an audit

1. Close OPEN DEFAULT admin behavior in production.
2. Enable GitHub branch protection per `github-branch-protection-required.md`.
3. Apply `security_soc2_readiness.sql` and run quarterly access reviews.
4. Collect vendor SOC reports (Supabase, Stripe, Railway, xAI).
5. Engage an auditor when evidence cadence is stable — readiness ≠ audit start date claim.
