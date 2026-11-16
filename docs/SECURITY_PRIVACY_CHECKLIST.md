# Security and privacy release checklist

Use this page to review security boundaries before a release. It describes the
maintained source and the evidence required to accept it. It does not certify a
running installation or legal compliance. Revision-specific results, failures and
stages not reached belong in [QA evidence](QA_RESULTS.md) and the
[functional acceptance matrix](FUNCTIONAL_ACCEPTANCE.md). Remaining product work
stays in the [roadmap](../ROADMAP.md) and [product specification](PRODUCT_SPEC.md).

Earlier versions of this checklist quoted the ten-migration M2 baseline and
43 tables as if they were current. Those figures are historical, not the schema
of the current application. Derive current schema, grants and RPCs from an actual
migration replay; use the [API reference](API_REFERENCE.md) and
[migration guide](MIGRATION_GUIDE.md). Do not carry old checked boxes forward as
acceptance of new source.

## Review map

| Boundary                             | Maintained source and guide                                                                                                             | Required evidence                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and account authority | `supabase/functions/accounts/`, migrations; [delegated roles](DELEGATED_ROLES_PRICING.md)                                               | Separate active/suspended accounts, subordinate-role restrictions, current MFA, invitation idempotency and rejected escalation                 |
| Database API                         | Public RPC wrappers, private implementations, RLS and explicit grants; [architecture](ARCHITECTURE.md), [API](API_REFERENCE.md)         | Fresh and retained-data replay, effective privileges, invoker boundary, direct table/column denial and actual HTTP requests                    |
| Claims and accepted agreements       | [job lifecycle](JOB_LIFECYCLE.md), [commercial security](COMMERCIAL_SECURITY.md), [replacement marketplace](REPLACEMENT_MARKETPLACE.md) | Real competing claims, complete-session atomicity, conflicts, retry identity, role-bound consent and immutable financial/session history       |
| Private resources                    | [chat security](CHAT_SECURITY.md), [files](FILES.md), [course document privacy](COURSE_DOCUMENT_PRIVACY.md)                             | Allowed and foreign actors, current membership, revocation with an existing session, exact-version bytes and direct Storage denial             |
| Qualifications and profiles          | [qualifications](QUALIFICATIONS.md), [avatars](PROFILE_AVATARS.md), [staff contact visibility](STAFF_CONTACT_VISIBILITY.md)             | Explicit evidence sharing, exact clean versions, appropriate reviewer permission and revoked access                                            |
| Calendar and availability            | [calendar](CALENDAR.md), [availability](AVAILABILITY.md), [calendar connections](CALENDAR_CONNECTIONS.md)                               | Private-event isolation, explicit publication, conflict races, scoped subscription credentials and IANA/DST checks                             |
| Knowledge and discovery              | [knowledge security](KNOWLEDGE_SECURITY.md), [job discovery](JOB_DISCOVERY.md)                                                          | Safe authored content, draft isolation, literal server-side search, pagination, safe links and immediate permission changes                    |
| Notifications and delivery           | [notifications](NOTIFICATIONS.md), [email operations](NOTIFICATION_MAIL_OPERATIONS.md), [Web Push](WEB_PUSH.md)                         | Committed events only, recipient/source recheck, preference/quiet-hour handling, deduplication and uncertain-delivery recovery                 |
| Browser identity and PWA             | `src/features/auth/`, query keys, router and service worker; [test plan](TEST_PLAN.md)                                                  | Actor-change cache reset, no private offline responses, no false offline mutation success, DE/EN and accessibility checks                      |
| Runtime, backup and recovery         | [operations](OPERATIONS.md), [update controls](HOSTINGER_AUTOMATIC_UPDATES.md), [deployment runbook](DEPLOYMENT_RUNBOOK.md)             | Owned process/data targets, migration history, retained credentials/file bytes, encrypted complete restore and rollback within its safe window |
| Contribution and supply chain        | [CI quality](CI_QUALITY.md), [dependency audit](DEPENDENCY_AUDIT.md), [GitHub rules](GITHUB_WORKFLOW.md)                                | Signed history, current-base required checks, dependency audit and separate assessment of security findings                                    |

Cancellation, reopening, capacity, directed replacements and delivery-worker
source now exist. They must be assessed through their actual feature guides and
source-specific tests; they are no longer accurately described as universally
unimplemented. Similarly, historical development backup/restore drills do not
accept a future production installation.

## Verify every changed permission boundary

- [ ] Use trusted current database roles, activity, resource membership and MFA.
      Editable Auth metadata, a hidden button or a caller-supplied role never
      authorises a request.
- [ ] Check effective table, column and function grants as well as RLS. Public
      invoker wrappers must not accidentally acquire broad execution privileges;
      private privileged routines need narrow grants and an explicit search path.
- [ ] Verify both permitted access and denial by another actor, after revocation,
      through the real API. Include bytes, search results, realtime delivery and
      repeated requests where the change reaches them.
- [ ] Preserve the absence of a blanket administrator read bypass for private
      DMs, calendar events, personal evidence, contracts and invoices.
- [ ] Keep accepted commercial/session/contract snapshots immutable. Explicit
      audited amendments or substitutions must follow their dedicated workflow.
- [ ] Keep quarantine, real scanning, exact clean versions and download
      re-authorisation. Do not substitute public buckets, permanent file URLs or
      sensitive offline caches.
- [ ] Confirm a claim only after the successful online database transaction;
      test concurrency, whole-block allocation, eligibility, conflicts and retries.

## Verify configuration and artifacts

- [ ] Public builds contain only the public Supabase URL/key configuration.
      Service-role keys, passwords, JWTs, MFA QR codes and private traces stay out
      of browser code, Git, screenshots and published artifacts.
- [ ] Test with fictional records and disposable owned resources. Preserve normal
      local/hosted data and foreign processes; raw `.local` data is private.
- [ ] Run relevant checks against the exact candidate and identify the selected
      CI profile. A documentation/standard profile or test discovery is not
      evidence of full native/browser execution.
- [ ] Review current dependency and CodeQL results. A successful scanner job is
      distinct from resolution of its findings; [historical triage](CODE_SCANNING_TRIAGE.md)
      is not the current alert inventory.
- [ ] Confirm the production CSP/HTTPS/cache headers, Auth redirects, gateway
      origins and private storage configuration on the actual approved target.
- [ ] Verify current backup coverage includes database data, Storage object bytes,
      configuration and recovery keys. Prove restore and define incident owners,
      monitoring, retention and recovery access on that target.

## Separate operational and legal acceptance

- [ ] Record the intended operators, capability owners and disclosed moderation
      policy; verify account recovery, session expiry and suspension procedures.
- [ ] Approve processor locations/agreements, lawful purposes, retention/deletion,
      data-subject handling and legal/privacy documents for the real operation.
- [ ] Approve any real SMTP/push activation and recipients separately. Worker
      source, an internal capture or SMTP acceptance does not prove inbox delivery.
- [ ] Complete manual keyboard, screen-reader, zoom, Safari/Firefox/iOS and
      physical PWA checks appropriate to the release. Automated axe and emulation
      do not certify every platform or full accessibility compliance.
- [ ] Obtain explicit approval for the concrete production release and any
      associated hosting, DNS, real-data or migration operation. A green PR and a
      merge do not publish or authorise it.

Contract receipts are acknowledgements, not an assertion of legally effective
signatures. Finance tracks assignments, invoices and payments; it does not claim
to be payroll, tax/accounting software or a bank integration.
