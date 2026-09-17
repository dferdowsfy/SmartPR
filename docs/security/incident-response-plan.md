# Incident response plan (readiness)

Lightweight plan aligned with controls `IR-001`. Not a substitute for legal counsel or a full IR retainer.

## Severity

| Severity | Examples |
|----------|----------|
| Critical | Confirmed breach of customer confidential data; ransomware; auth bypass across tenants |
| High | Suspected unauthorized access; exposed secret in production; privilege escalation |
| Medium | Failed exploit attempt with persistence risk; malware on a non-prod system |
| Low | Policy violation without data exposure; phishing attempt blocked |

## Roles

| Role | Responsibility |
|------|----------------|
| Incident lead | Coordinates response; owns timeline in `security_incidents` |
| Engineering on-call | Containment (rotate keys, revoke sessions/grants, patch) |
| Communications | Customer/regulator notices when required — **Requires verification** of counsel process |

## Phases

1. **Detect** — monitoring, audit anomalies, customer report, CI secret hit.
2. **Triage** — assign severity; open `security_incidents` via `/api/admin/security/incidents` (superadmin).
3. **Contain** — revoke support grants / service accounts; rotate secrets; disable SSO enforcement only if it increases safety and is audited.
4. **Eradicate / recover** — patch, restore from backup if needed (**Requires verification** of restore procedure).
5. **Post-incident** — timeline, root cause, corrective actions; link evidence; close incident when complete.

## Do not

- Delete audit logs.
- Fabricate incident records for “demo” readiness.
- Communicate certification claims during an incident.
