# Dedicated support evidence and course-resource registries

This bounded regression tests a document that could otherwise be registered by
both the support desk and the independently delivered course learning workspace.
A personal document's ordinary RLS is not sufficient: an approved course resource
has its own `course_document_access` route for enrolled recipients.

The reviewed product change belongs to the support owner. This test-only work
started from `1ae8b2616bd237f04be145b6bf01202210c8c932` and used the owner's pending
`20261116034757_internal_support_desk.sql` as an **uncommitted test overlay** with
SHA-256 `877e00bdcf3561b14bdbb7367b87e1ec8d4c94d690af4a8ff5af9b128b57af78`.
That migration is not part of this test-only commit. Integrating these tests
requires the matching product fix; missing helpers cause a real assertion failure.
No accepted migration is renamed or rewritten by the test harness.

## Normally discovered regression

```sh
PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-extensions-20261116 \
node scripts/support-course-registry-db-tests.mjs
```

The canonical runner discovers this `*-db-tests.mjs` file normally. It needs no
PR17 branch or Git object. It creates and removes two random UUID databases in
an explicitly owned, networkless container with no published ports:

- An absent-module compatibility case replays current released source, readiness
  and the real support migration. It verifies exact owner-only helper signatures,
  effective anonymous/authenticated/service-role execution denial, fixed search
  paths, zero strict helper diagnostics and a usable internal support attachment
  while the optional lookup returns false.
- Before the support migration runs, the registry case installs a clearly
  labelled minimal private RLS table only when the real registry is absent:
  `course_resources(id, version_id REFERENCES document_versions, removed_at)`.
  It then completes the current migration history. The synthetic table proves
  only the optional registry contract; it creates no fake course API. If the
  actual registry/RPCs already exist, the same cases use those public APIs and
  their final installed implementation instead.

The absence case and **six registry groups passed**. The groups cover exact
helper signatures/grants and zero strict function/trigger diagnostics, live and
removed course history, support-first course INSERT/version UPDATE denial, and
both actual document-lock winner orders. The holder transaction reports its
backend PID; `pg_blocking_pids` proves the other operation is waiting on that
specific backend before release. There is no assumed timing-based race result.
The losing operation rolls back its registration and ticket-version changes.

## Exact committed PR17 compatibility

```sh
PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-extensions-20261116 \
PORTAL_REVIEW_PR17_COMMIT=00eaa5249a163618887f72683da362e785a5957f \
node scripts/support-course-pr17-check.mjs
```

This separately invoked file deliberately has no automatic database-test suffix.
The commit environment value is mandatory and must identify one exact locally
available commit. The harness reads immutable Git objects, compares all shared
migration bytes, and replays the combined versions in chronological order. It
never reads an uncommitted PR17 worktree or silently selects one branch's SQL
when a shared version differs.

**All six actual-PR17 groups passed** using the pinned source's
`public.course_workspace_action(uuid,text,jsonb,integer)` for `resource_share`
and `resource_remove`, and `public.course_document_access(text,uuid)` for the
independent resource gateway. An enrolled learner successfully resolved an
ordinary approved course resource while generic personal-document RLS remained
denied. Course-first registration prevented its subsequent dedication to
internal support, including after removal. Support-first registration prevented
both course sharing and changing an existing safe resource's version to the
support version; its original resource remained accessible. Both concurrent
winner orders were observed through real PostgreSQL blockers and completed with
exclusive registration.

The older committed PR17 source
`d11ab187cec22761786d82a871307b8727155f4a` was deliberately supplied as a negative
prerequisite check. It returned **exit 1**, reporting the missing real course
APIs, and cleaned up its owned database. Missing prerequisites are never reported
as a skipped-success. Conflicting shared migration bytes are also refused.

## Limits and integration boundaries

These are actual SQL/RLS/transaction and public-function checks. The isolated
fixture emulates Auth JWT claims and supplies fictional clean scanner-result
metadata. It does not establish native Auth, HTTP/Edge/scanner execution, stored
file bytes, browser behavior or production acceptance. The existing 12 support
SQL groups also passed against this product overlay.

The product hook is installed by support when the course registry already exists.
An upgrade that creates the course registry later must install the matching hook
in its owning course migration. These chronological fresh-replay results do not
claim that the later-created-registry upgrade path has been delivered by PR17.

The separately reported generic course `share_options` metadata disclosure is
outside this registry fix and remains the course owner's task. No success here
asserts that the whole course-workspace metadata projection is private. The tests
do not weaken ordinary course-resource access or substitute general document RLS
for the independent course gateway.

No public Website, live account, real customer record, outgoing email, hosting,
Draft status, merge, auto-merge, watcher or shared full-QA stack was changed.
