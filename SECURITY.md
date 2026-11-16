# Security policy

## Report privately

Use [GitHub private vulnerability reporting](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/security/advisories/new) for suspected vulnerabilities. Do not publish exploit details in an issue or PR before coordinated disclosure.

Include the affected commit/version, prerequisites, expected and observed behavior, impact and a minimal reproduction using fictional data. Redact credentials, tokens, signed URLs, customer records and private documents. Test only environments you own or are explicitly authorized to assess. If a credential is exposed, revoke or rotate it through its owner; do not include it in the report.

The project makes no fixed response-time commitment. Maintainers coordinate investigation, fixes and disclosure through the private report.

## Maintained versions

The development branch `main` is maintained. Historical milestone tags and CMS development packages identify earlier revisions; they are not separately supported release branches. Production readiness and deployment require separate acceptance and authorization.

## Security model and limits

Supabase Auth identifies the actor; current PostgreSQL roles, MFA, grants, RLS and resource membership enforce access. Browser role flags and user-editable metadata grant no authority. Job claims require online atomic confirmation, and accepted commercial snapshots remain immutable. Private DMs, calendars and contracts have no blanket administrator read bypass.

Files use private storage, quarantine/scanning and currently authorized exact-version access. Service/secret credentials must remain outside browser bundles, Git, public logs and screenshots. The PWA must not generically cache authenticated responses or private document bytes offline. An explicit opt-in [minimal own teaching schedule](docs/CALENDAR_CONNECTIONS.md) stores only the documented bounded snapshot, with expiry and account-change cleanup.

These are implementation requirements, not a certification that every vulnerability is absent. See [security/privacy boundaries and remaining acceptance](docs/SECURITY_PRIVACY_CHECKLIST.md), [backend review](docs/BACKEND_SECURITY_REVIEW.md), [CodeQL triage](docs/CODE_SCANNING_TRIAGE.md) and [test evidence](docs/QA_RESULTS.md). Current findings and actual checks must be assessed for the affected revision; a green scan alone does not establish legal compliance or production readiness.
