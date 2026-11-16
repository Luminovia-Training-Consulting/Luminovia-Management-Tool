# Permanent deletion — working implementation contract

User decision on 16 November 2026: confirmed deletion is permanent; no trash or restore. Scope is deletion only. Existing create/edit/role assignment remains in place; no other PR is merged by this task (the only stated exception is already merged PR13). Companies may delete only their own jobs under current database membership. Normal or production data is never touched by tests.

## HTTP boundary

Extend the existing `accounts/v1` Edge facade, keeping credentials server-only:

- `GET /deletions/access` → `{ can_admin, kinds }`.
- `GET /deletions/operations` → `{ items: [operation] }` for currently authorised incomplete operations; recovery does not depend on browser storage.
- `GET /deletions/resources?kind=&q=&cursor=&limit=` → `{ items: [{id,kind,label,owner_label,can_delete}], next_cursor }`. Administrative metadata only; never private contract/message/calendar contents.
- `POST /deletions/preview` body `{kind,id}` → `{plan_id,kind,id,label,counts,blockers,can_confirm,expires_at}`.
- `POST /deletions/confirm` body `{plan_id,request_id,confirmation:"DELETE"}` → `{operation_id,status,kind,id}`. Recompute scope under current authority/locks; a changed preview is a conflict. This starts an irreversible operation, not an archive.
- `POST /deletions/operations/:id` with an empty object resumes/reads that confirmed operation using current authority. `status` is `pending`, `failed` or `completed`; only completed receives a deletion success message. Return202 while uploads or external cleanup are pending.

## Caller RPCs

`deletion_access()`, `deletion_operations()`, `deletion_resources(p_kind,p_query,p_cursor,p_limit)`, `deletion_preview(p_kind,p_id)`, `deletion_confirm(p_plan_id,p_request_id,p_confirmation)`, `deletion_status(p_operation_id)` and `deletion_execution(p_operation_id)` are invoker wrappers. Execution yields a short-lived permit bound internally to current actor/assurance/operation; browser-supplied actor/role values never grant authority. All plans/permits/operations are private with RLS and no direct browser grants.

Worker service-only RPCs consume the permit: `_deletion_work(p_operation_id,p_permit_id)` returns the operation projection, exact internal object manifest, `auth_user_id` if applicable, and active-upload count; `_deletion_apply(p_operation_id,p_permit_id)` removes the permitted relational scope after Storage acknowledgements; `_deletion_complete(p_operation_id,p_permit_id,p_storage_removed,p_auth_removed)` verifies target/Auth/Storage absence before reporting completed. Edge sets acknowledgement flags only after actual native API absence checks and reacquires current caller authority before privileged steps. No worker accepts arbitrary table names, object paths or user identities from the request.

Permits bind the actual executor independently of the original issuer. A currently qualified Owner/Administration can recover incomplete administrative/company business operations after issuer revocation or removal; account hierarchy and self protection still apply. Private owner/scoped operations remain with the original authorised person. An account with unfinished private operations cannot be purged into an orphaned cleanup barrier. Recovery lists contain only reduced operation IDs, kinds, target IDs and status.

## Roots and dependencies

Use a closed typed registry for managed business roots, covering accounts, documents, jobs, assignments, organisations/contacts, course templates/runs/sessions, taxonomy, wiki/forum/chat/comment/review/enrolment records, announcements/global events, contracts/invoices/payment tracking and personal saved resources. Protect current self/last administrator and existing hierarchy. Dependency conflicts must be explicit; ordinary accepted-snapshot, finance and privacy protections are never disabled. Do not treat all foreign-key attribution as ownership or blindly cascade into another organisation/shared resource.

The implemented registry addresses UUID roots. Composite-key enrolment/settings rows are dependent records, not arbitrary table or string-key deletion endpoints. Direct private-calendar/availability/saved-view deletion remains owner-only, and private room/message/financial actions retain their existing resource/capability boundaries. Full administrative business deletion is limited to current Owner/Administration, not the account-directory capability of Management alone. Every new permanent-delete action requires current AAL2. An account with protected business references can be blocked explicitly; the confirmation is unavailable until those dependencies are resolved. This feature does not override financial retention or erase another person's shared records by attributing ownership to an editor.

An account's native Auth and profile records must actually disappear. Protected business references block deletion explicitly; no inactive profile marker or restorable account substitutes for removal. Historical audit events retain a nullable cleared actor attribution, counted and fingerprinted in the preview; accepted business records remain protected. Confirming an account operation fences/deactivates the target before external cleanup so an old JWT cannot regain application access. Completion requires native identity absence, not suspension alone.

For company job roots derive one consistent organisation from stored request/commission/run relationships. Never use display names or grant global jobs.manage. Accepted/invoiced/shared dependencies outside company deletion authority produce a typed blocker; no partial success. A company-specific projection supplies own-job targets without granting staff discussion/net-fee/private-contract access. Close the former-lecturer→client historical-claim bypass in general job read channels.

## Storage and uploads

Exact all-version manifests cover portal-clean and portal-quarantine, including rejected/error/archive versions. Never purge by Storage owner or uploader prefix. Fence new reservations, promotions, database writes and metadata resurrection for confirmed targets; remove bytes only through Storage API. Use service-released upload leases. Do not report completed while any upload can still promote bytes; crashed/stalled work must remain a visible safe pending/failure state, never silently expire into success.

Shared SQL upload contract: `deletion_upload_begin(p_document_id,p_version_id)` service-only returns lease UUID after checking the document is not fenced; `deletion_upload_end(p_lease_id)` releases only server-owned lease after all awaited writes/cleanup. `_deletion_work` reports pending leases. Private document/Storage fence helpers must cover exact reserved paths; tests include a delayed promotion racing deletion and post-completion download404.

## UI and verification

An interrupted writer leaves an explicit lease and pending operation. Do not clear that lease while its request or scan can still write. An operator must first prove that the exact owned writer has stopped, review the operation's exact paths and then release only that server lease before retrying cleanup. There is no timer that converts uncertain external work into completed deletion. No production operation is authorised by this implementation document.

Reusable bilingual confirmation dialog binds current actor, target and preview. Show impact/blockers and require explicit irreversible confirmation. No optimistic removal; cancel old queries before post-acknowledgement refresh. Admin console supports typed targets; account/file/job and company-own-job contexts use the same deletion action. Existing archive/moderation actions must not be described as permanent deletion.

Verify real PostgreSQL permissions/FKs/dependencies/races; real Auth and both Storage buckets, failure/retry/old-token/old-path cases; desktop/mobile DE/EN/light/dark and confirmation/error/pending flows. Published36 migrations remain byte-identical. Exact scoped implementation and real results belong in WORKLOG/PLAN; no complete pass is inferred from this contract.
