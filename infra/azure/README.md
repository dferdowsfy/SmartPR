# SmartPR Azure Staging — `infra/azure/`

SmartPR-owned Azure staging environment that mirrors the planned enterprise
architecture (`docs/enterprise-azure/current-state-audit.md`). Purpose: prove
the architecture works **before any customer (McConnell Valdés) data is
involved**. No customer data goes into this environment, ever.

## What each resource is for

| Resource | Why it exists |
|---|---|
| Resource group `rg-smartpr-staging` | Single blast-radius boundary; the $200 budget is scoped to it |
| Log Analytics workspace (30-day retention) | Central log sink for every resource below |
| Key Vault (RBAC, soft-delete + purge protection, IP-locked) | Holds the generated Postgres admin password and future staging secrets |
| PostgreSQL Flexible Server 16, Burstable B1ms | Staging database. Entra auth enabled, TLS 1.2+, `require_secure_transport=on`, 7-day backups, firewall = your IP only |
| Storage account + private `evidence` container | Replaces Supabase Storage. No public blob access, shared-key auth disabled (Entra only), IP-locked |
| AI Services (AI Foundry), **no model deployments** | Placeholder for the future Azure-hosted model provider. Costs $0 while idle |
| Diagnostic settings | Ships audit/resource logs from everything above to Log Analytics |
| Budget `$200/mo`, alerts at 50% / 90% | Cost guardrail with email alerts |

## Estimated monthly cost

| Resource | ~$/mo |
|---|---|
| Postgres B1ms Burstable + 32 GB storage | ~$20–25 |
| Log Analytics (30-day retention, low ingestion) | ~$2–5 |
| Key Vault (standard) | <$1 |
| Storage (LRS, near-empty) | ~$1–2 |
| AI Services (no deployments) | $0 |
| **Total** | **~$25–35/mo** — well under the $200 budget |

## Prereqs (you do these in the browser / your terminal)

1. Azure account on your SmartPR business email, MFA on.
2. `brew install azure-cli` then `az bicep install`.
3. `az login` (you run this yourself).
4. Fill in `parameters.staging.bicepparam`: your public IP (`curl -s https://api.ipify.org`) and your alert email.
5. Pick the subscription: `az account list -o table`, then `az account set --subscription "<name-or-id>"`.

## Preview the plan (no changes made)

```bash
cd infra/azure
az deployment sub what-if \
  --name smartpr-staging \
  --location eastus2 \
  --template-file main.bicep \
  --parameters parameters.staging.bicepparam
```

Review the plan and the cost estimate. **Do NOT deploy until you say "deploy".**

## Deploy (only after you approve)

```bash
az deployment sub create \
  --name smartpr-staging \
  --location eastus2 \
  --template-file main.bicep \
  --parameters parameters.staging.bicepparam
```

## Verify after deploy

```bash
# 1. Postgres requires full TLS verification (fetch the FQDN from deployment outputs)
psql "host=<fqdn> dbname=postgres user=smartpradmin sslmode=verify-full" -c "select version();"
# 2. Storage rejects anonymous access (expect 401 / ResourceNotFound)
curl -s -o /dev/null -w "%{http_code}\n" "https://<storage-account>.blob.core.windows.net/evidence"
# 3. Key Vault holds the generated secret (name only — value never printed)
az keyvault secret list --vault-name <vault-name> -o table
```

## Teardown (deletes everything, including the database)

```bash
az group delete --name rg-smartpr-staging --yes --no-wait
```

## Notes

- The template is parameterised (`resourceGroupName`, `location`, `tags`) so the
  same files can later deploy into a customer's subscription.
- No model deployments, no private endpoints, no app connection — those are
  later steps, each needing your explicit go-ahead.
- The schema-only export from Part 1 (`~/smartpr-exports/smartpr-schema.sql`)
  is **not** committed and is **not** loaded here. Loading it is a separate,
  explicit step after you review the dump.
