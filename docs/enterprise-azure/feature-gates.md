# Enterprise feature gates (third-party egress)

`frontend/src/lib/config/features.ts` decides whether integrations that send
customer data or user telemetry to an outside vendor may run.

- **Standard:** every gate is open. Behaviour is unchanged.
- **Enterprise:** every gate is closed unless the customer has approved it and
  the deployment sets `ENTERPRISE_ALLOW_<FEATURE>=true` (exactly `true`).
- **Invalid deployment config:** treated as Enterprise (fail closed).

| Feature | Approval flag | What is blocked when closed |
|---|---|---|
| `voiceTelephony` | `ENTERPRISE_ALLOW_VOICE_TELEPHONY` | xAI incoming-call webhook and the voice MCP callback return 404; incoming calls are ignored. |
| `browserUseCloud` | `ENTERPRISE_ALLOW_BROWSER_USE_CLOUD` | Browser Use Cloud is reported as not configured, even with `BROWSER_USE_API_KEY` set. |
| `browserAnalytics` | `ENTERPRISE_ALLOW_BROWSER_ANALYTICS` | Google Analytics is not rendered. |
| `billing` | `ENTERPRISE_ALLOW_BILLING` | The Stripe client refuses to initialise; the Stripe webhook returns 404. |
| `externalEmail` | `ENTERPRISE_ALLOW_EXTERNAL_EMAIL` | Reminder, invite, compliance and founder-alert emails via Gmail SMTP / Resend are skipped. |

These map to McConnell questions 24, 27, 32 and 33
(`MCCONNELL_SECURITY_QUESTIONS.md`). A flag is set only after written approval.

Not covered here (separate PRs): model inference and speech-to-text (model
router / Azure Foundry), the self-hosted browser worker's model calls, and a
distributed rate limiter.

Tests: `frontend/src/lib/config/features.test.ts` (`npm run test:config`).
