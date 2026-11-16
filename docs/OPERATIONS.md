# Customers and reusable course operations

This slice extends the actual M1 organisation/template/run/session tables. It does not replace the complete product scope. The interface is available at `/clients` and `/courses`, with German/English labels, keyboard-accessible dialogs and real RPC mutations.

## Customer privacy and administration

Customers are configurable organisation records; no named customer is a required installation, course provider or privileged role. Create each actual organisation privately, reuse teaching templates across organisations, and select the relevant customer for each dated course run. Client logins require explicit current organisation memberships; knowing a catalogue code or source reference does not create that membership. Public instructions and examples use neutral wording or fictional records.

`organisations` contains business identity, industry, city, country/time zone, tags and a reversible archive timestamp. Private notes are in separate `organisation_private_details`; contact names, business email/phone and private notes are in `organisation_contacts`.

- All writes require the database capability `organisations.manage`, a currently active actor and AAL2. RLS and column/table grants prevent direct caller writes.
- Organisation identities can be visible through an authorised course. Contact and note tables have their own capability-restricted SELECT policies, including when a lecturer knows the organisation ID from a public course.
- `save_organisation(p_id,p_payload)` and `save_organisation_contact(p_id,p_organisation_id,p_payload)` create or update records atomically, with bounded text/arrays, email validation, valid time zones and audit metadata. A null ID creates a new row.
- Archiving is reversible and does not delete accepted assignments or historical course links. Contact mailto/tel actions open the user's own client; development does not send real emails.

## Course templates, runs and sessions

Reusable `course_templates` hold title, description, syllabus, prerequisites, archive state and dynamic `course_template_topics`. Actual `course_runs` hold the template/customer links, IANA time zone, delivery mode/venue, publication/archive state and `course_sessions` instants.

- Creation/editing requires `courses.manage` plus active actor/AAL2. Admins use `save_course_template` and `save_course_run`, passing validated explicit UTC/offset instants. Run session replacement is one transaction: malformed/overlapping input rolls back the whole schedule change.
- A run's schedule is protected as soon as any job references it, including a draft job. Its linked session records are not silently deleted or retimed. Templates used by published/filled jobs are also protected. The UI reports `course_locked` with a safe-copy instruction.
- `set_course_visibility` changes publication/archive state. A run with published/filled jobs cannot be archived through this workflow. Assigned lecturers retain legitimate course access through their confirmed assignment even if general publication is withdrawn.
- Lecturers browse published non-archived runs or their own assigned runs. Participants receive course data only through explicit membership of that run's participant course channel. Removing that membership revokes course reads immediately. This does not grant participants access to the commercial job/claim tables.
- Private security-definer visibility helpers are narrowly actor/resource scoped and not exposed as Data API tables. SQL wrappers use invoker security; execute grants exclude anonymous callers.

## Safe copies

`duplicate_course_template(p_id,p_title)` copies content and topic links into a new active template with the caller's explicit title. `duplicate_course_run(p_id)` creates a new unpublished run and new session identities at the original instants. The administrator reviews/edits those dates before publication.

Copies do **not** copy jobs, accepted claims, compensation/contract records, lecturer or participant accounts, calendar allocations, chat rooms/memberships or documents. The course template reference and customer identity are retained when duplicating a run; changing the customer/dates is possible while the new run has no linked job.

## Actual validation checkpoint

Executed on local Supabase with scoped fictional probe records, cleaned afterwards:

- `PORTAL_TEST_MODE=1 node scripts/operations-api-check.mjs`: **11 passed** with actual Auth-issued sessions and actual TOTP AAL2. Cases cover AAL1/lecturer denial, customer/contact/notes CRUD and privacy, invalid-input rollback, syllabus/topics, unpublished/published catalogue boundaries, safe copies, atomic overlap rollback, accepted-job schedule/terms protection, participant enrolment/revocation and recoverable archives/audit.
- `supabase db lint --schema public,private --fail-on warning`: passed after correcting a local variable/column ambiguity and an unused variable.
- Supabase security/performance advisors: no warning-level findings at this slice checkpoint.
- TypeScript and targeted ESLint: passed.
- In the second complete isolated `./portal test` run (`547a6f09`), all **4 operations browser cases passed**: read-only catalogue/private-directory denial and the full administrator mutation journey on desktop and mobile, with axe scans and no read-only horizontal overflow.

The actual complete UI mutation journey in `tests/e2e/operations.spec.ts` created temporary isolated administrator/customer/course data and passed on both viewports. It checked customer/contact persistence after reloading and reselecting the saved organisation, actual MFA, course creation, two sessions, literal safe syllabus text and an unpublished copy. The private-directory component test ensures no private query is even requested before the management permission resolves. This is operations-specific evidence: that integrated run still had six browser failures in other features, so it was not a passing whole-system result.

## Remaining broader scope

Bulk operations/export, customer document linkage, richer catalogue aliases/hierarchies, full course enrolment administration beyond explicit participant channels, attendance and richer course content/version history remain in the product plan. This slice does not alter accepted deals, provide legal review or establish production acceptance.
