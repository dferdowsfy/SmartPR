# Backup and recovery

## Current state

| System | Backup mechanism | RPO / RTO | Status |
|--------|------------------|-----------|--------|
| Supabase PostgreSQL | Supabase-managed backups | **Requires verification** | **Requires verification** |
| Supabase Storage | **Requires verification** | **Requires verification** | **Requires verification** |
| Railway app volumes | Typically ephemeral; rely on git + external DB | N/A for app containers | Document deploy rollback via git SHA |
| Secrets / env | Host secret store | **Requires verification** | Never commit secrets |

## Evidence types (when real)

- Vendor backup configuration screenshot / export
- Successful restore test write-up (date, operator, scope)
- Record as `security_control_evidence` for `DR-BACKUP-001` — **do not invent restore dates**

## Application guidance

- Prefer point-in-time recovery from Supabase for data corruption.
- Schema migrations should be idempotent (`IF NOT EXISTS`) where practical.
- No fake backup rows are seeded by this readiness work.
