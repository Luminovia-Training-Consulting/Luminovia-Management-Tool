# Optional job contacts and external references

Managers can add optional information in a job's detail page under **Contact and job reference**. The successful creation form also links directly to that section. Both standalone offers and course-backed offers use this same job-scoped editor. Existing offers have empty defaults; no customer contacts or external content are imported automatically.

## Fields and audience

The reference has an optional HTTP/HTTPS URL, an authored link label and an authored description. It may explain that a job follows an external brief or advertisement. A description can also stand alone without a URL. The application renders literal text and opens validated external links with `noopener noreferrer`; it never fetches the destination on the server.

The contact has optional name, email, telephone and notes. The manager chooses **Only after a confirmed claim** (default) or explicitly shares these entered details with **authorised offer viewers**. The internal customer/contact directory stays private and unchanged. This is not a public or anonymous publication.

Only current authorised staff can read this job projection. By default a currently confirmed lecturer sees contact fields; an unassigned viewer receives only a contact-availability hint. Cancellation removes after-claim contact visibility immediately through the refreshed server projection. Role revocation, suspension and loss of job access apply even with an existing token or historical claim. Management reads/writes retain the existing current MFA/capability requirements. Archived jobs remain readable under their existing ACL and cannot be edited.

## Saving and safety

Text limits count Unicode code points like PostgreSQL, so supplementary characters remain readable and editable at the allowed boundary. All fields are optional. Saving empty values removes the visible optional information. The editor freezes its reviewed version and retains the same operation key for an unchanged retry. A concurrent edit produces a conflict; only an explicit reload replaces the draft with fresh server state. Network uncertainty never becomes optimistic success. A current access-denied response hides retained contact data and any open private draft.

The server rejects unknown payload fields, invalid types, oversized values, invalid email/control characters and URLs with unsafe schemes, missing authority, embedded credentials or impossible ports. The browser canonicalizes valid international domain names and IPv4 spellings before submitting the retry-bound request; the server independently validates ASCII DNS/IPv4 or bracketed IPv6 authority and rejects malformed hosts, backslashes and whitespace. Stored links are parsed again before rendering; a browser-parser discrepancy retains readable text and an editable repair path without producing an unsafe link. Email/telephone actions open the user's chosen client; the application sends no message.

The information is separate from the accepted financial/contractual snapshot. Updating contact logistics never changes accepted fees, currency, terms, dates or invoice history. Safe job duplication deliberately does not copy these contact/reference fields: the new job's manager reviews and adds them explicitly.

## Owning data and API

The additive migration `20261116163013_job_briefing_contacts_references.sql` creates `private.job_briefings` and `private.job_briefing_requests`, both with RLS and no direct browser grants. Public wrappers remain security invoker. Their unexposed implementations check current actor/resource authority, lock actor/request/job in a consistent order and use comparison-and-swap versions. Request identity binds actor, job, expected version and the exact original JSON payload. Only safe flags and version enter the ordinary audit event; personal contact values remain in the private rows.

- `job_briefing(p_job_id)` returns the current authorised projection and write capabilities.
- `save_job_briefing(p_job_id, p_expected_version, p_request_id, p_payload)` stores an explicit complete set and returns confirmed current state.

The actor/job-scoped `job-briefing` query is refreshed after real claims and cancellations, on current capability changes and through bounded polling. No new list/card queries, service, email delivery or production deployment is introduced.

## Validation entry points

- `src/features/jobs/briefing.test.tsx`: successful/failed saving, stable retries, conflict/reload, access denial, offline state, safe links and visibility.
- `scripts/job-briefing-db-tests.mjs`: actual PostgreSQL permissions, defaults, strict payloads, races, current role/claim visibility, immutable accepted history, safe duplication and cleanup.
- `scripts/job-briefing-api-check.mjs`: real Auth/MFA/REST and existing-token revocation in the canonical disposable stack.
- `tests/e2e/job-briefing.spec.ts`: actual management editing, lecturer claim/cancellation, DE/EN, dark theme, responsive layout and axe on desktop/mobile.

Executed results belong in WORKLOG/QA_RESULTS and the exact PR CI. Physical-device acceptance and production installation are separate and are not claimed by these checks.

## Observed browser examples

Both new browser journeys passed on96c3c5c with fictional data. The complete run still requires correction/repetition for its separate existing mobile-board failure; see QA_RESULTS.

| Layout  | Management, German/light                                                                    | Revoked contact, English/dark                                                      |
| ------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Desktop | [Saved optional details](screenshots/desktop-chromium-job-briefing-management-de-light.png) | [Contact hidden after cancellation](screenshots/desktop-chromium-job-briefing.png) |
| Mobile  | [Saved optional details](screenshots/mobile-chromium-job-briefing-management-de-light.png)  | [Contact hidden after cancellation](screenshots/mobile-chromium-job-briefing.png)  |
