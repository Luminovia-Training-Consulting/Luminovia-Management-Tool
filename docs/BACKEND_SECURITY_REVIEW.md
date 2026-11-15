# Backend review — local milestone 1

Last updated: 2026-11-15. This records the implemented boundary and observed local checks, not production approval or a legal-compliance claim.

## Authorisation boundary

- Supabase Auth identifies actors. Public registration is disabled by local configuration. Auth user creation provisions a profile, **no role**. Editable `user_metadata` never grants permissions.
- `profiles.active` is checked from database state on every protected read/write/RPC. Disabling a profile therefore denies data access even while an old Auth access token remains valid. Operational suspension should additionally revoke Auth sessions.
- `user_roles` and `role_permissions` are server-managed. Administrative permissions require JWT `aal2` plus active membership. A senior lecturer receives no automatic access to other people's contracts or rates.
- All 23 application tables in `public` enable RLS. Grants are explicit per table or column. An authenticated client can edit only safe self-profile columns, its unverified expertise selection, its private calendar, and notification read state. Claim/role/activation/verification writes are not granted.
- Private appointments remain owner-only, including for admins. Assigned teaching sessions and fee snapshots are visible to the assigned lecturer and scoped management as appropriate. No messaging content tables exist yet; a chat-room membership is provisioned on claim as a foundation only.
- Privileged database implementations live in the **unexposed** `private` schema, with empty `search_path`, fully qualified relations, revoked default execution, and explicit actor checks. Exposed RPC wrappers run as invoker. `complete_invitation` is service-role-only and itself invoker.

## Management attestations and suspension

`verify_lecturer_topic(user_id, topic_id, verified, valid_until)` requires fresh `qualifications.verify` permission and AAL2, an active lecturer target, and an already self-selected expertise row. It never creates expertise on a lecturer's behalf. A verification expiry must be in the future; un-verifying clears expiry. The audit stores the actor, subject/topic, previous/new state and `management_attestation` basis. This is explicitly not a claim that a certificate file has been uploaded or reviewed.

`set_user_active(user_id, active)` requires `users.manage` and AAL2. It refuses self-deactivation and deactivation of the last active admin. A transaction-wide lock serializes activation changes, so concurrent admins cannot suspend each other and both succeed. Old/new activation state is audited. Existing-session API requests immediately lose all protected data/claim access after suspension; reactivation restores the unchanged roles. Auth session revocation is an additional operational action, not silently claimed by this routine.

## Atomic claims

`claim_job(job_id, idempotency_key, terms_version)` locks the actor using a transaction advisory lock and then locks the selected job row. The server checks active lecturer role, publication/deadline, future sessions, verified required expertise valid through the last session, effective executed-contract record when required, accepted terms version, and existing assignment/private-calendar conflicts. Uniqueness permits one confirmed claim per job. A GiST exclusion constraint independently prevents overlapping allocations for the same lecturer.

The claim, all session allocations, immutable fee/currency/terms/contract snapshot, job status, claim event, notification and room membership commit in one transaction. Retry keys are actor-scoped; reusing a key for a different job fails. Appointments use the same actor lock, closing the concurrent appointment-versus-claim race. Error results never imply a reservation.

Capacity is deliberately constrained to **one slot** in this milestone. Cancellation/reopening/substitution needs an audited workflow before it can be enabled; management status changes refuse filled jobs. Published-offer editing is not yet an application feature. Accepted snapshots cannot be rewritten, even through a service-role table update.

## Invitations

`POST /functions/v1/invite-lecturer` accepts only `email`, optional `display_name`, and UUID `idempotency_key`. It verifies Auth and then fresh database permission/MFA. It requires explicitly configured allowed origins and `PORTAL_INVITES_ENABLED=true`; the role is always lecturer. Browser code never receives service credentials.

A durable database reservation precedes email sending. Email and retry-key uniqueness prevent repeated sends, including across admins. Each actor may reserve at most five addresses per 15 minutes. The service-only completion routine assigns lecturer membership and records an audit result. An uncertain email failure is recorded and **blocked from automatic resend**. An operator must investigate failed or stuck reservations rather than editing the ledger blindly or promising delivery. Invitation sends are intentionally not automatically retried after an uncertain SMTP/network outcome.

Only local fictional mail has been authorised for testing in this work. Production/staging sending requires approved project configuration, SMTP, origins and deployment. QA verified real local Edge delivery, the captured custom Mailpit link, explicit browser acceptance, password setup, logout and subsequent new-password login. Hosted configuration still requires separate acceptance.

## Invitation link format

The SPA keeps PKCE for login and recovery. The custom bilingual invite template uses the supplied, fixed `/auth/callback` redirect plus `token_hash` and `type=invite`, rather than consuming an implicit-session fragment that the PKCE client rejects. The callback requires an explicit acceptance action and calls `verifyOtp` before password setup. Local CLI `content_path` resolves from the project workdir; local template changes require restarting Auth. Hosted projects need the invite and recovery HTML explicitly configured in the Auth email-template settings. The bilingual recovery template deliberately retains `{{ .ConfirmationURL }}` so the standard SDK PKCE challenge/verifier flow remains intact. Links and token hashes must not be copied into logs or shared artifacts; hosting should redact authentication query strings and use a no-referrer policy.

## Verification

- `node scripts/db-rpc-tests.mjs`: 25 passed against a disposable real PostgreSQL database within the local Supabase container. The suite recreates all migration files and uses real PostgreSQL roles/RLS with test `auth.uid()`/`auth.jwt()` stubs. It includes 50 independent concurrent eligible claim transactions (exactly one confirmed and 49 filled), all-or-nothing five-session allocation, notification deduplication, retry behavior, inter-job and appointment races, eligibility and contract coverage, immutable commercial snapshots, privacy, forged writes, role metadata, inactive accounts, MFA and invitation rate limits. This is not an HTTP Auth-token verification test.
- QA separately passed real local Auth/Data API tests, the real Edge invitation with exactly one Mailpit email, custom token-hash onboarding through a real browser, and PKCE password recovery. See the work log for actual commands and browser results.
- `npx --no-install supabase db lint --schema public,private --fail-on warning`: no schema errors after fixing an unused SQL variable.
- `npx --no-install supabase db advisors --type all --level warn --fail-on warn`: no warning/error issues after replacing per-row Auth policy calls with initplan subqueries. Informational advice is not covered by this threshold.
- `npx --yes deno test supabase/functions/invite-lecturer/handler_test.ts`: seven passed, covering validation, origin/auth/feature gates, reservation ordering, idempotency, rate-limit responses and uncertain failures.
- `npx --yes deno check supabase/functions/invite-lecturer/index.ts`: passed.

## Remaining acceptance

No hosted Supabase schema or production website was changed. Production advisors, token revocation/session policy, backup/restore of database and Storage objects, e-signature/legal review, private-file scanning/access expiry, granular permission administration, cancellation/substitution and final load/security review remain release prerequisites. Independent course/client CRUD, full contract/file lifecycle and collaboration modules remain later slices. Local authentication and SQL tests do not establish desktop/mobile/PWA or production acceptance.
