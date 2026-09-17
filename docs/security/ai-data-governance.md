# AI data governance

SmartPR uses AI providers for regulatory assistance and optional browser automation. This document describes repository-evident practices. Vendor DPAs / training policies: **Requires verification.**

## Providers observed in repo

| Provider | Usage | Secrets |
|----------|--------|---------|
| xAI (Grok) | Server-side Responses API | `XAI_API_KEY` (server only) |
| browser-use (open-source agent) / optional Browser Use Cloud | Agency runs / workers | Worker env; **Requires verification** of production provider mode |

## Rules

1. **No service-role keys in client bundles** — Supabase service role is server/script only.
2. **Do not log raw confidential content** — use `frontend/src/lib/security/ai-logging.ts` (`logAiEvent`) for structured metadata (counts, ids, outcomes).
3. **Workspace isolation** — AI routes must continue to enforce auth and workspace access like other APIs; do not weaken gates for “assistant” UX.
4. **Customer content** — treat prompts derived from customer records as confidential; minimize what is sent; do not use customer data to train first-party models (SmartPR does not train foundation models in-repo).
5. **Provider training / retention** — xAI and other vendor terms: **Requires verification** before enterprise contracts assert specific commitments.

## Evidence hooks

- Control `AI-GOV-001` in `data/security_controls.json`
- Code review of AI route handlers + logging abstraction
- Optional: record vendor DPA location as `security_control_evidence` with a real `artifact_uri` when available
