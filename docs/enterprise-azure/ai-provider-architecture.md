# AI Provider Architecture

Status: enterprise PR #4. This is a refactor only: Standard still uses the same
xAI model, request and behavior as before.

## Previous architecture: direct xAI

Five core features imported `src/app/ai/xai.ts` and called xAI directly:

```
feature ──► requestXaiText() ──► POST https://api.x.ai/v1/responses
```

Each one checked `isXaiConfigured()`, reported `XAI_MODEL` back to the client,
and caught `XaiApiError`. There was no policy check, no per-use-case identity,
and nothing prevented an enterprise deployment from calling xAI directly.

## New architecture: router and provider

```
feature ──► generateText(useCase, request)        src/lib/ai/router.ts
              ├─ resolveAiRoute(useCase)            src/lib/ai/policy.ts   (deployment config, PR #1)
              ├─ provider lookup                    xai → src/lib/ai/providers/xai.ts
              │                                     azure-foundry → not implemented (PR #5)
              └─ logAiEvent(...)                    metadata only
```

| Module | Role |
|---|---|
| `lib/ai/types.ts` | `AI_USE_CASES`, `AiTextProvider`, `GenerateTextRequest`, `AiRoutingError` |
| `lib/ai/policy.ts` | Picks the provider for a use case, deterministically. It never throws for Standard defaults. |
| `lib/ai/router.ts` | `generateText`, `isAiConfigured`, `aiModelFor`, and a test seam |
| `lib/ai/providers/xai.ts` | The existing xAI client, moved here **byte-for-byte**, plus a thin `xaiProvider` adapter |
| `app/ai/xai.ts` | Compatibility re-export so existing imports keep working. STT and `XaiApiError` are imported through it. |

The provider layer contains no permitting or business logic. Prompts, parsing
and response shapes stay in the features.

### Use cases

| Use case | Caller |
|---|---|
| `document_analysis` | `api/analyze-document` |
| `intake_interpret` | `api/intake/interpret` |
| `chat` | `api/chat` |
| `passport_extract` | `api/passport/voice` (the extraction step after STT) |
| `regulatory_ingest` | `rk/ingest.ts` (admin regulatory-source extraction) |

## Standard routing (unchanged behavior)

With `DEPLOYMENT_MODE` unset or `standard`, and `MODEL_GATEWAY` unset or
`direct`, every use case goes to xAI. The request is exactly as before:

- the same endpoint (`XAI_BASE_URL`, default `https://api.x.ai/v1`) + `/responses`
- the same bearer authentication
- the same `model` (`XAI_MODEL`, default `grok-4.3`)
- the same `reasoning.effort` fallback
- the same `max_output_tokens` and `temperature`
- `store: false`

Timeouts, prompts, JSON parsing, error responses and the `ai_model` field are
unchanged. No new environment variables are needed. A unit test compares the
outgoing request byte for byte.

## Enterprise: fails closed

| Configuration | Result |
|---|---|
| `MODEL_GATEWAY=azure-foundry` (any mode) | `AiRoutingError("provider_not_implemented")`. **Never falls back to xAI.** |
| `DEPLOYMENT_MODE=enterprise` + `MODEL_GATEWAY=direct` | `AiRoutingError("policy_denied")`. Direct vendor access needs an approved deployment allowlist, which PR #5 will add together with Foundry. |
| Invalid or incomplete deployment config | `AiRoutingError("invalid_deployment_config")` |
| Unknown use case | `AiRoutingError("unknown_use_case")` |

- When a request is refused, `isAiConfigured(useCase)` returns `false` and
  logs the reason code. Each feature then returns its existing "AI not
  configured" response (HTTP 503) and **sends no data anywhere**.
- `generateText` throws `AiRoutingError` before any network call.

Like PR #3, a deployment config that fails validation turns AI off even in
Standard. No production Standard deployment sets those variables today.

## Data sent to the provider

This is unchanged from before, and only for Standard/xAI:

- **System prompt:** SmartPR instructions, the knowledge-base candidate
  catalog, and regulatory context.
- **User content:**
  - document text, up to 4,500 characters, plus the filename and business
    intake profile (document analysis);
  - the business description (intake interpretation);
  - chat messages;
  - the voice transcript (passport);
  - regulatory source sections (ingestion).
- `store: false` asks xAI not to retain the request. This is a request flag,
  not a verified retention guarantee; see `model-governance` in the audit.

## Metadata logging

`generateText` writes one `ai.generate_text` line per call through
`lib/security/ai-logging.ts`, containing:

- `provider`
- `model`
- `outcome` (`ok` / `error` / `timeout`)
- `error_code` (an error class name or routing code)
- `duration_ms`
- `meta.use_case`
- `meta.deployment_mode`

It never logs prompts, document text, responses, API keys, or tenant or
business identifiers; request IDs and tenant tagging are not wired in yet.
A test asserts that none of these reach the logger.

## Still tied directly to a vendor (out of scope)

| Path | Vendor | Notes |
|---|---|---|
| Speech-to-text, `requestXaiStt` (`api/intake/voice`, `api/passport/voice`) | xAI `/v1/stt` | Not routed. `passport/voice` is gated by `isAiConfigured("passport_extract")`, so enterprise refuses before STT. **`api/intake/voice` is not gated**; it only checks `isXaiConfigured()`. Enterprise deployments must not set `XAI_API_KEY` until STT is routed. |
| Realtime phone voice agent (`lib/voice/xaiCallManager.ts`, `xaiRealtime.ts`) | xAI realtime | Disabled by default in enterprise (principle 7) |
| Browser agents (`lib/agency-runs/browserUseClient.ts`, `workers/browser-agent`) | Browser Use Cloud / xAI | Disabled by default in enterprise (principle 7) |
| Legacy `backend/main.py` | xAI | Legacy FastAPI; not part of the Next.js app |

## Next: PR #5

PR #5 adds `lib/ai/providers/azure-foundry.ts` and registers it in the router.
It also adds an approved-deployment allowlist to the policy, so each enterprise
customer's approved Foundry deployments are the only thing that can serve a
use case. The Golden tests will then run against each approved deployment.
