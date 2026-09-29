# McConnell Valdés — Security Questions

Questions McConnell's security team must answer before final SmartPR Enterprise
architecture decisions. **No answers have been assumed.** Every item is
**UNRESOLVED** until answered in writing by McConnell.

Architectural decisions already approved by SmartPR (see
`current-state-audit.md` §0): one codebase / no fork; clean enterprise database
from versioned migrations and approved reference data; Browser Use Cloud and xAI
voice telephony disabled by default; fail-closed model allowlist.

| # | Question | Architecture impact | Status |
|---|---|---|---|
| 1 | Does McConnell already have an Azure tenant/subscription strategy for vendors? | Landing zone, IaC target | UNRESOLVED |
| 2 | Must resources live in McConnell's Azure subscription? | Ownership boundary, operator access | UNRESOLVED |
| 3 | Which Azure regions/data zones are permitted? | Resource placement, model availability | UNRESOLVED |
| 4 | Must all data remain in a specific geography? | Region, backup geo-redundancy, model data zone | UNRESOLVED |
| 5 | Is Azure Database for PostgreSQL acceptable? | Database provider | UNRESOLVED |
| 6 | Is Azure Blob Storage acceptable? | Storage provider | UNRESOLVED |
| 7 | Is Microsoft Foundry / Azure-hosted model inference acceptable? | Model gateway | UNRESOLVED |
| 8 | What exactly does "zero data retention" mean in McConnell's policy? | Per-deployment retention approval | UNRESOLVED |
| 9 | Is automated abuse monitoring acceptable? | Model deployment configuration / exemptions | UNRESOLVED |
| 10 | Is human review of model prompts/completions prohibited? | Model deployment approval | UNRESOLVED |
| 11 | Must public network access be disabled for all data services? | Networking | UNRESOLVED |
| 12 | Are private endpoints required? | Networking, DNS | UNRESOLVED |
| 13 | Are customer-managed encryption keys required? | Key Vault / CMK for PG and Blob | UNRESOLVED |
| 14 | Is Entra ID SSO required? | Auth provider | UNRESOLVED |
| 15 | Is SCIM provisioning required? | Provisioning (SCIM 2.0 exists today) | UNRESOLVED |
| 16 | What MFA policy applies? | Conditional Access inheritance | UNRESOLVED |
| 17 | Which logging/SIEM system is used? | Log export | UNRESOLVED |
| 18 | What log retention period is required? | Log Analytics retention | UNRESOLVED |
| 19 | What backup retention period is required? | PG/Blob backup policy | UNRESOLVED |
| 20 | What RPO/RTO is required? | HA, geo-redundancy | UNRESOLVED |
| 21 | What vulnerability-management requirements apply? | CI scanning, patch SLAs | UNRESOLVED |
| 22 | Is penetration testing required? | Security test plan | UNRESOLVED |
| 23 | Are SOC 2, ISO 27001, cyber insurance, DPA, or vendor questionnaires required? | Contracting, compliance | UNRESOLVED |
| 24 | Which subprocessors are prohibited or require approval? | Egress (xAI, Browser Use, Stripe, email, analytics) | UNRESOLVED |
| 25 | Can SmartPR support personnel receive JIT/PIM administrative access? | Operator access model | UNRESOLVED |
| 26 | What approval is required before new model providers/models are enabled? | Model allowlist governance | UNRESOLVED |
| 27 | Are external browser-automation or voice providers permitted to receive client information? | Browser Use Cloud, xAI voice | UNRESOLVED |
| 28 | What data must be deleted at termination? | Offboarding runbook | UNRESOLVED |
| 29 | What data must be preserved for legal/audit reasons? | Retention, legal hold | UNRESOLVED |
| 30 | Who owns incident-response coordination? | IR integration | UNRESOLVED |

## Additional questions surfaced by the repository audit

| # | Question | Why | Status |
|---|---|---|---|
| 31 | Is outbound access from the enterprise environment to Puerto Rico government portals (`*.pr.gov`) permitted for filing automation? | Browser agents submit filings | UNRESOLVED |
| 32 | Which email path is acceptable for reminders/notifications (customer SMTP relay, Azure Communication Services, none)? | Current code uses Gmail SMTP / Resend | UNRESOLVED |
| 33 | Is browser analytics (e.g. Google Analytics) permitted in the enterprise deployment? | Currently enabled in Standard | UNRESOLVED |
| 34 | Who is the initial enterprise administrator group in Entra? | Explicit first-admin bootstrap | UNRESOLVED |
