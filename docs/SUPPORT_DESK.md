# Internal support desk

The support desk adds a persisted request, reply and resolution workflow. It is
separate from private chats and commercial documents. User-authored subjects,
descriptions and replies retain their authored language; interface text is
available in German and English and uses the existing theme and responsive shell.

Ticket creation and updates hold the current caller profile while waiting for request/ticket locks. Updates recompute support authority after a profile wait, including the manager flag used for internal notes. Suspension or staff-role withdrawal that commits first prevents both a new restricted write and an otherwise successful stored-response retry.

## Access and lifecycle

Every active signed-in account can open and search its own tickets at `/support`.
Only the explicit `support.manage` capability with current MFA permits reading
other people's tickets, assigning support staff, choosing priority, adding
restricted notes or changing workflow status. The migration initially assigns
that capability to the existing Administration, Owner and Management roles.
It does not grant support-only accounts financial, contract, calendar or chat
permissions. Assignees must currently be active and have the support capability.

The normal lifecycle is Open → In Progress → Waiting for User → Resolved →
Closed. In Progress can resolve directly and Waiting for User can return to
In Progress. Each status change requires a reason. Requesters can reopen resolved
tickets and tickets closed within the preceding 30 days, with a reason; support
staff can also reopen older tickets. Replying or adding an attachment requires an
open workflow rather than silently reopening closed history. Version checks
reject stale changes and actor-scoped request keys make identical uncertain
retries safe. Replies, internal notes and events append to history.

Management can link records only when its separate resource permissions permit
the link. Requesters can initially select currently readable courses, their own
assignments and their customer organisation memberships. These references never
grant access to the underlying record; later projections recheck access.

## Confidentiality and files

Tickets, messages, events and request ledgers live in RLS-enabled private tables
without browser table privileges. Public functions are invoker wrappers around
reviewed private routines with an empty search path and current actor checks.
Internal notes and their history are removed on the server from requester
projections. They do not notify the requester. Staff-capability loss immediately
redacts retained staff UI projections while detailed permission checks refresh.

Attachments use the existing authenticated upload gateway and malware scan.
The attachment must be a new dedicated personal material upload with exactly
one clean, hash-bearing version. Existing CVs, contracts, invoices, course files,
room files and replacement histories cannot be attached as a shortcut. Linking
freezes the dedicated document and its version as evidence. The existing file
gateway rechecks ticket access and restricted-note visibility, so a guessed
document ID does not bypass ticket ownership. Internal attachments remain
restricted to support staff with MFA. Ordinary document rename, replacement or
deletion is refused for this linked evidence; no new anonymous Storage access or
reusable signed URL is introduced.
The attachment's ticket permission is authoritative even for its original
uploader: losing support authority or MFA removes restricted-evidence access.

The document gate captures the exact previously installed private permission
function in a definer-only helper and replaces the original function in place.
Existing RLS policies retain their function OID. Non-support documents delegate
to that captured policy, including a stricter qualification-evidence policy when
installed; the support module does not recreate generic certificate privileges.
The clone is not executable by anonymous, authenticated or service-role callers.
Support attachment checks remain final: a denied internal attachment never falls
back to its uploader's ordinary personal-document access.

The focused `scripts/support-replacement-access-db-tests.mjs` regression runs
eight actual SQL groups against current main plus the operational migrations and
eight against an independently tightened predecessor in separate disposable UUID
databases. It verifies predecessor body/OID preservation, effective clone grants,
certificate metadata/version isolation, and internal attachment denial after MFA
or staff-capability loss, including the original uploader. An additional exact
local commit can be replayed without editing its history:

```sh
PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-extensions-20261116 \
PORTAL_REVIEW_PR17_COMMIT=00eaa5249a163618887f72683da362e785a5957f \
node scripts/support-replacement-access-db-tests.mjs
```

All 24 SQL groups passed with that pinned PR17 source, including its actual
stricter qualification migration. The tests exercise the document/version RLS
projections used by the authenticated file gateway; they do not assert a native
HTTP download or actual Storage-byte transfer. Existing 12 support SQL groups
and strict diagnostics for 30 operational PL/pgSQL implementations also passed.

## Notifications and reporting

Committed public activity creates or refreshes one `support_update` notification
per recipient/ticket. New tickets notify currently eligible support staff; later
updates notify the requester and assignee, or the support team while unassigned.
Note contents and attachment contents never enter notification bodies.
`private.support_notification_target` resolves a current authorised ticket title
and destination for integration with the existing inbox target resolver.

The support overview groups current counts by category and shows outstanding
tickets and elapsed hours to the current resolution. This is operational support
reporting, not an employment or payroll clock. Reopening clears the current
resolution timestamp while preserving earlier reasons and transitions in history.

## API and verification

- `support_context()` returns current support capability, eligible assignees,
  authorised resource choices and manager-only category summaries.
- `support_tickets(search, status, before_at, before_id, limit)` searches only
  permitted ticket subjects/descriptions with bounded tuple pagination.
- `support_ticket(ticket_id)` returns the currently authorised detail and history.
- `create_support_ticket(payload, request_id)` creates an owned request.
- `update_support_ticket(ticket_id, action, payload, expected_version, request_id)`
  appends a reply/note/attachment or applies a reasoned workflow, assignment,
  priority or resource-link change.

Focused PostgreSQL evidence: `PORTAL_DB_CONTAINER=<owned-disposable-container>
node scripts/support-db-tests.mjs` passes 12 real groups including simultaneous
retry and stale-version races, internal-note/file secrecy, ownership, MFA,
resource forgery, immutability and revocation. Seven unit/component tests pass
for literal rendering, reviewed-version preservation, pending/denied responses,
DE/EN drafts, offline controls and retained staff-projection redaction.

`scripts/support-api-check.mjs` and `tests/e2e/support.spec.ts` are guarded real
Auth/MFA/REST/scanner/browser journeys discovered by `./portal test`. Their
execution and exact-source combined acceptance must be recorded by the integrating
session; authoring these tests is not a claim that they have passed. This source
does not enable real email, change hosted data or establish production acceptance.
