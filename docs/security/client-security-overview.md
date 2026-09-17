# Client security overview (verified facts only)

Conservative summary suitable for prospects. **Not a certification claim.**

## Platform security features present in product engineering

- **Authentication** via Supabase Auth with session handling in application middleware.
- **Workspace membership and RBAC**, including enterprise roles and permissions enforced in server-side APIs.
- **Optional SSO / domain enforcement controls** for enterprise workspaces (production IdP setup is customer/environment-specific).
- **SCIM provisioning** authenticated with workspace service-account credentials (hashed at rest; revoked/expired credentials rejected).
- **Time-boxed support access** for SmartPR operators: reason and duration required, read-only by default, expiry enforced, audited.
- **Append-only audit events** for sensitive enterprise and admin actions, with secret redaction helpers.
- **Service accounts** with hash-only credential storage, show-once secret, rotate/revoke, scopes, and fingerprints.

## Hosting and subprocessors

Application code references Supabase (auth/database/storage), Stripe (billing), xAI (AI), and Railway (hosting). See `subprocessors.md`. Vendor compliance reports are obtained separately and are not asserted here.

## SOC 2

SmartPR maintains SOC 2 *readiness* documentation and internal control inventory. **SmartPR does not claim SOC 2 certification in this document.**

## Contact

Security inquiries: use your SmartPR account team or the contact channel provided in your agreement. (**Requires verification** of a dedicated security@ mailbox if published externally.)
