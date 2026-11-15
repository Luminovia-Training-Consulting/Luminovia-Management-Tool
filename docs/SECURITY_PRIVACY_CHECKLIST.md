# Security and privacy checklist

Checked items are evidenced **within the local M1 scope**, not a production certification. Unticked items remain pending, broader than the delivered slice, or require hosted/manual acceptance. Actual commands and limitations are in [WORKLOG.md](WORKLOG.md), [QA_RESULTS.md](QA_RESULTS.md) and [BACKEND_SECURITY_REVIEW.md](BACKEND_SECURITY_REVIEW.md).

## Current evidence

| Boundary | Local result | Remaining acceptance |
| --- | --- | --- |
| Schema/permissions | All three migrations replayed in real PostgreSQL and the full local stack; 23 public tables; warning-level lint/advisors clean | Managed-stage configuration/advisors and later modules |
| Allocation/privacy | 25 PostgreSQL tests plus actual fifty-request Auth/HTTP race: one winner, five allocations, one notification | Multi-slot/lifecycle and production operational review |
| Auth/invitations | 7 Edge handler tests, Deno check, actual AAL2 Edge/Mailpit delivery, deduplication/origin checks and browser onboarding/recovery | Hosted templates/CORS/SMTP and approved real invitations |
| Frontend | 22 source tests, 20 desktop/mobile browser workflows and 2 built-PWA checks passed; scanned screens had no axe violations | Manual/cross-browser/physical installation and full product scope |

## Scope and authority

- [x] Separate portal repository; marketing website remains read only.
- [x] Complete authoritative prompt and production approval boundary retained.
- [x] Local fixtures contain eleven fictional lecturers plus administrator/participant; no real invitations or customer data used.
- [ ] Approve managed staging/production projects, processor regions/DPAs, purposes, retention, data-subject handling and legal/privacy review.
- [ ] Record real administrator/capability owners and disclosed moderation policy before their operational workflows go live.

## Auth and privileges

- [x] Local public/anonymous signup disabled; implemented invitation/recovery callback allowlist configured.
- [x] Actual local invitation acceptance, password setup, login/logout, recovery and protected deep links verified in browser.
- [x] Privileged operations require database capability, active caller and verified AAL2; actual administrator TOTP exercised.
- [x] Roles/permissions and active status use trusted database state; editable user metadata grants no authority.
- [x] SQL/API/browser tests cover self-role escalation, forged owner IDs, direct verification/activation mutation and suspended-user denial with an existing token.
- [x] Invitation reservation precedes send; idempotency, cross-request deduplication, exact-origin POST checks and five-new-addresses-per-fifteen-minute limits tested locally.
- [x] Management attestation and account-state changes record actor/target, previous/new state and basis; self/last-admin protection and concurrent mutual suspension tested.
- [ ] Accept production Auth redirect/template/SMTP delivery and abuse limits using approved test recipients.
- [ ] Complete session-expiry, multi-device revocation/recovery and operational suspension procedures; database denial is implemented, global Auth-session revocation is a separate action.
- [ ] Accept hosted gateway CORS behaviour; local Kong modifies OPTIONS/headers, while the function rejects unapproved POST origins itself.

## Database/API

- [x] All 23 exposed application tables enable RLS with explicit table/column/function grants; anonymous private data access denied.
- [x] Own/foreign profiles, private events, claims and implemented commercial snapshots tested through actual Auth/Data API; ordinary admins cannot read private appointments.
- [x] Ownership updates include `USING` and `WITH CHECK`; safe column grants exclude identity, activation, verification and accepted deals from self-service writes.
- [x] Exposed RPC wrappers use SECURITY INVOKER; no application views or blanket administrator privacy bypass introduced.
- [x] Privileged implementations reviewed in an unexposed private schema, empty search path, fully qualified relations, restricted execution and actor/activity checks for actor-driven actions. Trusted Auth provisioning triggers remain unexposed.
- [x] Local database lint and security/performance advisors passed at warning/error threshold after findings were fixed.
- [ ] Repeat advisors and permission tests on the actual approved managed staging configuration.
- [ ] Broaden contract/CV/invoice/document privacy tests as those full modules land; M1 contract rows are prerequisite metadata, not file-lifecycle acceptance.
- [ ] Review query plans/load for the actual permission-sensitive search/scheduling workload; initial indexes are implemented.

## Transactional allocation

- [x] Fifty distinct concurrent SQL actors and fifty actual Auth/HTTP requests produced one single-slot winner; complete five-session allocation/event/notification state verified.
- [x] Retry keys are actor-scoped; winner retry is idempotent, cross-job reuse rejects, and no failed result appears as a confirmed allocation.
- [x] Concurrent overlapping jobs for the same lecturer and simultaneous appointment-versus-claim races cannot double-book; transactions leave no partial session allocation.
- [x] Server checks active lecturer, publication/deadline/future sessions, verified expertise/expiry, contract prerequisites and conflicts. Local tests exercise eligibility/expiry/contract/conflict rejection.
- [x] Exact accepted terms version and immutable amount/currency/unit/total/terms/contract-reference snapshot verified against subsequent offer edits.
- [x] M1 calendar allocations, claim event, notification and lecturer-course room membership commit with the successful claim.
- [x] Filled jobs refuse silent reopening through management status changes.
- [ ] Implement audited cancellation/reopening/substitution, multi-slot capacity and full accepted-work change workflows before enabling them.
- [ ] Complete executed-contract document hashes/versioned acceptance and future file/resource grants; these are not implied by M1 metadata.

## Collaboration and uploads — future modules

- [ ] Private DMs authorise by room membership, with no implicit admin access and separate participant channels.
- [ ] Membership removal revokes database/realtime/storage access, with explicit signed-URL expiry semantics.
- [ ] Private buckets, authorised metadata and short-lived signed downloads deny guessed object paths.
- [ ] Content/type/size/rate limits, safe names, quarantine/malware scanning, preview/versioning and retention tested.
- [ ] Actual contracts, CVs, qualification evidence, invoice PDFs and chat files have horizontal-access tests.
- [ ] Rich wiki/forum content is sanitised, code remains text and unsafe URLs/executable previews are denied.

## Frontend/PWA and supply chain

- [x] Frontend accepts public configuration only; validation rejects privileged key types. Actual local server key/database URL/password scan found no match in the browser bundle or staged source.
- [x] Local test credentials are generated, ignored and permission-restricted; mutating test scripts reject hosted targets.
- [x] In-memory queries have no persister; actual built-service-worker cache inspection found public static assets only, with no Auth/API/storage/function response URLs.
- [x] Offline deep-link shell and connection notice verified; mutations require online server confirmation and show no fabricated success.
- [x] Explicit sign-out and authenticated actor changes clear private query state; protected route and account-denial paths tested.
- [x] Exact lockfile, dependency audit and patch overrides reviewed. Production audit has zero findings; full audit has four acknowledged low build-tool findings below.
- [x] Local typecheck, lint, formatting, 22 source tests and production build passed after final UI corrections.
- [x] DE/EN, language-switch form preservation, light/dark/system, desktop/Pixel 7 emulation and scanned control/error labels passed browser checks; axe found no violations on scanned screens.
- [ ] GitHub CI run acceptance remains pending until an actual remote result is recorded.
- [ ] Verify HTTPS/CSP/security/cache headers and SPA deep links on the actual approved Hostinger portal root.
- [ ] Complete manual keyboard/screen-reader/zoom assessment, broader narrow-width sweep, Safari/Firefox/iOS and physical PWA installation. Automated local axe is not a full WCAG certification.
- [ ] Review strict remote-suspension cache eviction, session expiry and all later private-data flows during release hardening.

## Operations and production

- [ ] Configure redacted monitoring/diagnostics, incident ownership and production response procedures.
- [ ] Back up PostgreSQL and actual Storage binaries with approved encryption/access/retention.
- [ ] Complete isolated restore drill, consistency checks and tested rollback on the intended operational setup.
- [ ] Have Carina review operational onboarding, permission administration and support guidance.
- [ ] Receive explicit approval for the concrete production release and its DNS/hosting/data changes.

The delivered M1 remains a local development milestone. No legal/GDPR, e-signature, hosted or production acceptance is inferred from these checks.

## Dependency scan checkpoint

`npm audit --omit=dev` reported zero findings. Full audit retains four low findings through the unpatched `deepmerge` build-tool dependency chain; this is tracked. Exact `glob@14.0.6` and `minimatch@11.0.8` overrides removed moderate findings. Recheck advisories when dependencies change and before staging/production; avoid an unreviewed forced blanket upgrade.
