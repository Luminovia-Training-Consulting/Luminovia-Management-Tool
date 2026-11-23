# Luminovia Portal · Roadmap

Open work for the internal portal and shared Premium LMS. The [implementation plan](docs/IMPLEMENTATION_PLAN.md) maps requirements to executable checks. The [work log](docs/WORKLOG.md) records completed changes and test results. Dedicated Academy delivery and commercial handoff have their own [White-Label roadmap](WHITELABEL_ROADMAP.md).

## Release gates

- [ ] **Exact release candidate · FC-55–57, LMS-T33, API-T20.** Record the source SHA, edition, OpenAPI version and successful required application and security checks for that commit.
- [ ] **Retained data and recovery · LMS-T32, LMS-T34, API-T16.** Apply a reviewed upgrade and restore a separate copy on the approved target. Compare retained identities, memberships, course activity, audit records, contracts, settlements and exact private file bytes. Rehearse rollback and record the recovery result.
- [ ] **Production operation · LMS-T34.** Verify the deployed revision, migrations, health, TLS, scanner, monitoring, scoped privacy, backup freshness and off-site retention. Record go/no-go and the rollback and incident plan before onboarding. Premium remains off until its acceptance is complete.
- [ ] **External delivery · LMS-T13, LMS-T30, API-T14.** Verify the approved SMTP sender, invitations and recovery, language, preferences, opt-out, queue revocation and deduplication. Verify signed webhook receipt, retries and revocation on the approved HTTPS receiver. Confirm each enabled channel for the applicable edition.

## Premium LMS acceptance

- [ ] **LMS-10–LMS-11.** Complete the remaining [LMS-T01–LMS-T34 checks](docs/IMPLEMENTATION_PLAN.md#lms-t01lms-t34) on the appropriate target. Verify roles, multi-company isolation, existing sessions and chat subscriptions, files and scan results, enrolment and revocation, attendance and evidence, and current notification delivery.
- [ ] **Teaching and class attendance · LMS-T24–LMS-T28, LMS-T31.** Run the teaching checklist, company meeting-link editing and class register on desktop and mobile in DE/EN. Verify exact arrival and departure, corrections, verified minutes, course scope, Premium OFF and licence grace.
- [ ] **Browser and accessibility · FC-04–05, LMS-T31.** Complete the signed-in role journeys at 390, 768, 1280 and 1920 px, in DE/EN and both themes. Check keyboard and focus, contrast, dialogs and offline transitions in Chromium and the applicable Safari/WebKit and Firefox targets.

## API and integrations

- [ ] **API-T01–API-T20.** Complete the remaining [operation and transport matrix](docs/IMPLEMENTATION_PLAN.md#api-t01api-t20) for each supported edition. Verify sign-in, token expiry, role changes, API/Swagger parity with native success and denial responses, files and exact bytes, concurrency and retries, backwards compatibility and the published quickstarts. Use the canonical unit, component, SQL/RLS, Auth/HTTP, integration and browser suites.
- [ ] **Swagger acceptance · API-T09, API-T19.** Exercise authorised and denied operations in each edition with DE/EN, both themes, keyboard and supported viewport sizes.
- [ ] **Public enquiries.** Enable and verify the approved sender and origin in the separate Website project, including a fictional enquiry that reaches the correct portal inbox.
- [ ] **Coordinated commercial amendments.** Complete signed-in cross-role browser acceptance from the original agreement through review, corrected delivery evidence and later settlement.

## Independent Academy releases

- [ ] Run the remaining [managed and self-hosted acceptance and handoff](WHITELABEL_ROADMAP.md) for approved customer targets, including licensing, support and operator acknowledgement.
