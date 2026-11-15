# Luminovia Portal — first milestone user guide

This guide covers the current development slice. The complete product includes further modules listed in [PRODUCT_SPEC.md](PRODUCT_SPEC.md); a missing module is not presented as a working placeholder. Local development contains fictional test accounts and records only. No hosted production portal or real invitations are implied.

## Sign in and account security

Open the local URL printed by the development server. Use an account created for that local Supabase environment. Public self-registration is disabled. Sign in at `/login` with the invited account's email/password. Invitation/recovery links target `/auth/callback` (with `/auth/password` also available for password setup). The invitation asks for explicit acceptance, then password setup. This full journey and recovery have been verified with fictional local accounts; production uses separately approved email configuration. Production email delivery is a separate configuration and acceptance gate.

Account invitations and recovery rely on Supabase Auth. A local captured test email is not a message sent to a real lecturer. If sign-in or account setup fails, use the visible error and contact the responsible administrator; do not reuse test credentials outside local development.

At `/security`, set up/challenge the supported authenticator MFA flow. Management operations require a database-verified second factor. A role label alone does not grant access and a screen cannot override backend denial. Sign out after using a shared device.

## Language, theme and profile

Use the language control to switch German/English without translating authored course/profile text. Choose light/dark/system appearance. These non-sensitive preferences may be stored locally.

At `/profile`, edit your permitted self-service fields, bilingual biography, display zone and expertise where available, then save and wait for confirmation. A save error means the server has not confirmed the change. Verification, roles and contract status are controlled separately by authorised management; selecting expertise is not the same as a verified qualification.

## Find and claim teaching jobs

Use `/jobs` to browse published opportunities and combine the implemented filters. Open `/jobs/<id>` for the complete sessions, intended time zone, currency, rate unit, compensation and terms. Read every session and the applicable accepted terms before claiming the whole job.

Choose the claim action while online. The first eligible committed transaction wins; there is no routine administrator approval queue. Success appears only after the database confirms. A filled/conflict/eligibility/prerequisite/stale-terms error means there is no confirmed new allocation. Retry-safe requests prevent duplicate assignments. Do not assume a card movement or a temporarily displayed job proves acceptance.

After confirmation, the full block appears in your assigned calendar. The accepted compensation/currency/terms are preserved independently of later offer edits. The first milestone supports one lecturer slot per job. Cancellation, replacement and reopened work must use an audited workflow when implemented; contact management rather than treating a UI edit as cancellation.

## Calendar

At `/calendar`, view your own events and confirmed assignments using the available views and explicit display time zone. Store a private appointment with precise start/end times; another lecturer or an ordinary administrator must not see it. A private appointment does not automatically become a company event. Claims check conflicts against the actual session instants.

Berlin and Brisbane can have different date/offset boundaries. Check the visible time zone when booking. An ambiguous or nonexistent Berlin daylight-saving local time must be resolved explicitly rather than guessed. Calendar display does not silently alter the original job's intended zone.

## Management job creation

Authorised management uses `/admin` after MFA verification. Create the supported customer/course/run/session/job block through the validated workflow, specify all sessions and their zone, compensation/currency/unit, terms and eligibility requirements, then publish as supported. Wait for the actual server result. Lecturer accounts cannot gain publishing privileges by changing a route, role text or browser request.

Do not enter real customer secrets, personal CVs or executed commercial documents into local development fixtures. The broader contact directory, document/contract lifecycle, chat, wiki/forum, invoices and complete administration remain separate required development slices.

## Management: people, expertise and access

At `/admin/people`, authorised management with verified MFA can search people and open a profile. The page shows the person's own declared expertise. Review the qualification evidence before choosing **Expertise verifizieren / Verify expertise**. An optional expiry is entered explicitly in **UTC**; leave it empty for a qualification without expiry. An expired verification does not meet a restricted job's eligibility. You can save a new expiry or revoke the verification. Qualification evidence files are currently managed outside the portal; this action records the management attestation.

Choose **Zugang sperren / Suspend access** or **Zugang aktivieren / Activate access** for another person, review the named confirmation and submit it. Wait for server confirmation. Cancellation leaves the current account status unchanged. Your own account cannot be suspended here; the server also protects the last active administrator. Suspension denies protected data and claims, preserving assignments/history and existing roles for authorised follow-up. Full session revocation is an additional administrative operation.

## Offline and support

The PWA shell may be available without a connection, but private data and sensitive files are not deliberately cached for offline use. Claims and other writes need an online server response. Reconnect and reload/refetch when appropriate; never treat offline submission as a confirmed booking. Save unsaved form content before accepting an app update when prompted.

Report the visible error, affected route, approximate local time/time zone and safe reproduction steps. Do not share passwords, access tokens, signed file URLs or private document/message contents in screenshots or support reports. Full supported-platform installation and production operating guidance will be added after actual acceptance testing.
