# Change / deploy log

Operational log for production changes. Prefer recording real deploys in `change_deploy_log` (see `data/security_soc2_readiness.sql`) or an external ticket system.

**No fabricated entries appear in this repository.**

## Suggested fields

| Field | Description |
|-------|-------------|
| recorded_at | When the change was deployed or config applied |
| environment | e.g. production, staging |
| change_type | deploy / config / schema / hotfix / rollback |
| git_sha | Commit SHA when applicable |
| summary | Human-readable what/why |
| actor_email | Who performed or authorized |

## Process (minimum)

1. Prefer merge via PR to `main` with CI green.
2. Deploy through the normal host pipeline (Railway — **Requires verification** of exact promote steps).
3. Record schema applies (`*.sql`) with SHA + operator email.
4. For emergencies, still open a follow-up PR and note the hotfix in the log.
