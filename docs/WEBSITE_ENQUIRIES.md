# Website enquiry intake and management

The Portal can receive an authenticated integration submission, retain the
validated original enquiry and consent record privately, and let management
review it, identify or create a customer, record responsibility and clarification,
and convert it transactionally into an existing course-planning run. It does not
invent a customer account, accepted financial agreement, tax treatment or quote.
The public Website has not been changed or connected by this source change.

## Current Website boundary

The read-only investigation examined Website main
`2778a9be96b7d6c29ec0f11a1677c7530c602ccc`: a static Vite/React JSX site with
production Preact compatibility and React Router. Its contact page prepares a
localised `mailto` draft, including recognised training intent/course links.
GitHub Pages publishes the marketing repository's main branch. There is no
existing server-side contact-form transport in that source.
The [read-only Website source](https://github.com/Luminovia-Training-Consulting/Website/tree/2778a9be96b7d6c29ec0f11a1677c7530c602ccc)
is a separate repository and deployment boundary.

Never embed the Portal integration token, service key or another server secret
in that static site or a `VITE_` variable. Public activation is **pending** a
reviewed trusted sender/transport and a separately authorised Website change.
No new service registration, DNS change, paid component or public deployment is
introduced here. A static browser cannot safely use this server credential.

## Intake contract

The existing Supabase Edge architecture provides
`POST /functions/v1/website-enquiries`. The normal gateway's public API key/JWT
boundary remains enabled. The function additionally requires the separate
`X-Luminovia-Integration-Token` server credential. Public Supabase keys, matching
Origin, user-supplied role fields and claimed client-IP headers never authenticate
the integration. No CORS permission is issued. If Origin is present it must
exactly match the configured Website origin; server-to-server calls may omit it.

Private server configuration:

- `PORTAL_WEBSITE_ENQUIRIES_ENABLED=false` by default.
- `PORTAL_WEBSITE_ORIGIN` is an exact HTTPS origin (loopback HTTP is accepted only
  for local tests).
- `PORTAL_WEBSITE_PRIVACY_NOTICE_VERSION` must identify the reviewed current
  notice; submissions for another version reject instead of inventing consent.
- `PORTAL_WEBSITE_INTEGRATION_TOKEN` is a private 32–256-character token provisioned
  outside source control, shared only with the approved trusted sender. Generate
  it from at least 32 cryptographically random bytes rather than choosing a phrase.

The generated self-host configuration leaves the token and origin empty and the
feature disabled. Missing/weak configuration fails closed with 503. The token is
compared using fixed-size SHA-256 digests and timing-safe comparison. Its digest
identifies a sender for persisted rate limits; neither token nor digest is returned
to public callers. Credential rotation must be coordinated with the trusted sender;
rotating the token also changes its sender-scoped retry/rate namespace.

The JSON body contains:

| Field                                            | Contract                                                                                     |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `submission_id`                                  | Stable UUID reused for an uncertain retry.                                                   |
| `company_name`, `contact_name`, `email`, `phone` | Bounded, validated contact input; optional phone is an empty string.                         |
| `topic`, `message`                               | Authored training topic and requirements; literal text, no authored HTML execution.          |
| `preferred_dates`, `duration`                    | Bounded requested preferences; no implied confirmed booking.                                 |
| `delivery_type`                                  | `online`, `onsite` or `flexible`.                                                            |
| `time_zone`                                      | Intended recognised IANA time zone.                                                          |
| `locale`                                         | `de` or `en`; authored text is not translated.                                               |
| `privacy_notice_version`, `consent`              | Notice identifier and the literal boolean `true`. This is evidence, not legal certification. |
| `website`                                        | Optional empty honeypot field; non-empty values reject.                                      |

Unknown fields, malformed JSON, oversize streamed bodies, missing consent and
invalid values reject before database delivery. Bodies are bounded to 24,000
bytes. A service-only RPC independently validates the payload and serialises each
sender using a transaction advisory lock. At most 10 new submissions per minute
and 100 per rolling 24 hours are accepted for one integration sender. Retrying the
same UUID and identical validated payload returns the original record, including
after management conversion; a changed retry returns 409. A retry consumes no
additional quota and creates no duplicate history or notifications.
HTTP and SQL accept the same conventional email-address subset as the detail
consumer. Quoted local parts, leading/consecutive dots and control characters
reject before acknowledgement; an accepted address must remain readable in the
management detail projection.

The successful response is `202 {"received":true,"receipt":"<your UUID>"}` only
after a confirmed database response. It exposes no internal enquiry/customer ID,
matching directory record, private message, contact record or management state.
Safe generic failures use 400/401/403/409/413/415/429/503 without database details.
This boundary protects the authorised integration; a public browser form still
needs its own approved spam/abuse controls before activation.

## Management workflow

`/enquiries` and its detail routes require current `organisations.manage` and MFA
on every server request. Ordinary lecturers and customer accounts cannot search
or retrieve the intake, even using a guessed identifier. All intake/history/retry
tables are private and RLS-enabled; browser table writes are unavailable. The
original validated payload, including submitted identity and consent, remains
unchanged by triage. Interface text supports DE/EN and existing light/dark/system
themes. Data stays in actor-scoped memory, outside service-worker caches.
Mutations first hold the active caller's profile for share, then acquire the actor
request lock and enquiry row. Supported account changes take that profile for
update, so a decision and role/activity revocation serialize. Permissions are
checked again after the business-lock wait and before a historical receipt or
new write; a conversion retry also requires its current course capability.

Management can search the queue, assign an eligible active colleague, add an
append-only note and move Received → Under Review → Awaiting Customer or Closed.
Closed enquiries can return to review with a reason. A management email action
opens a manual local email draft; it does not send or claim delivery.

Link an existing active organisation first when appropriate. Explicitly confirming
“Create customer and contact” instead reuses the existing directory routines with
the supplied company/contact details. Its request identity and version check
ensure uncertain retries cannot create a second organisation or contact. Company
identity matching remains a human decision; the Portal does not guess membership
from an email domain or grant access based on a submitted company name.

Conversion additionally requires `courses.manage` and MFA. Management chooses an
existing course template or explicitly creates one from the enquiry, reviews exact
sessions/time zone and teaching mode, and confirms. The same transaction calls
the existing `save_course_run`, creates all sessions and marks the enquiry
Converted. Any invalid/overlapping session rolls back the template/run and enquiry
change together. Concurrent decisions use reviewed versions and row locks, yielding
one conversion. The result remains unpublished and has no job or commercial quote;
normal course/offer planning continues from there. An already converted customer
link is preserved. The separate priced client-request workflow is not silently
populated with fabricated fees.

Requirements are currently captured as text. Public file uploads are not enabled
by this endpoint; any later public attachment workflow must reuse bounded scanning
and explicit private resource permissions rather than accepting arbitrary links.

## Deployment and test evidence

The self-host router allowlist, exact Envoy route and explicit read-only worker
mount include only the reviewed `website-enquiries` endpoint. Lookalike/subpaths
remain denied. No backend ports or new services are published. Existing JWT,
production and release gates remain intact; this source does not activate the
normal or hosted endpoint.

Executed focused evidence:

- `PORTAL_DB_CONTAINER=<owned-disposable-container> node scripts/enquiries-db-tests.mjs`:
  16 real PostgreSQL groups pass, including simultaneous retries/conversions,
  sender limits, denial/MFA/revocation, customer/contact idempotency, rollback and
  preserved original records. Actual `plpgsql_check` reports zero body warnings
  or errors for all five new PL/pgSQL implementations.
  The concurrency cases use explicitly held SQL transactions and observed
  `pg_blocking_pids`, covering both revocation orderings and a capability change
  committed during an enquiry-row wait. No fixed sleep substitutes for a lock assertion.
- `npx --no-install deno test supabase/functions/website-enquiries/handler_test.ts`:
  eight request/authentication/validation/acknowledgement cases pass, including
  acknowledged addresses checked by the actual frontend Zod email validator.
- `npx --no-install deno check supabase/functions/website-enquiries/index.ts scripts/testing/enquiries-edge-http.ts`:
  both deployed and isolated HTTP adapters typecheck.
- Seven frontend unit/component tests pass for authority gating, literal original
  data, safe manual email draft, explicit pending customer creation, stale-version
  protection, DE/EN filters, denial/offline handling and DST/session conversion.
- `npm test`: all 233 tests in 50 files pass on this branch baseline. Shared
  routing/inbox integration and the combined source still require their own gates.
- `node deploy/hostinger/selfhost/validate.mjs --gateway-routing`: 14 actual
  isolated networkless Envoy route cases and configuration/security checks pass.

The canonical runner discovers `scripts/enquiries-api-check.mjs`, which starts its
own loopback Deno listener with the exact deployed environment adapter against
the owned actual Auth/REST database, and `tests/e2e/enquiries.spec.ts` for real
management/customer/course planning, foreign-account denial and desktop/mobile
DE/EN/theme/accessibility checks. Their actual outcomes must be recorded after
`./portal test` runs; authored tests do not constitute passed acceptance.
Production, real contact delivery and public Website activation remain separate.
