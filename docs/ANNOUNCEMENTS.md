# Portal announcements

Announcements are authenticated, bilingual portal notices. A shell banner shows
at most three currently visible, unacknowledged revisions. The complete
`/announcements` page uses explicit server cursor pages and can open one exact
published revision from an inbox link. Neither view opens a modal or moves focus
when new content arrives.

## Administration and publication

`/admin/announcements` requires the current `announcements.manage` capability and
verified MFA. The migration grants this capability to the existing owner, admin
and management roles. Browser metadata and submitted actor IDs cannot grant it.

1. Create a German and English title and plain text body, a finite display window
   and a valid IANA time zone. Select current account roles as an optional audience;
   an empty selection means all active accounts. Marking a notice important is an
   explicit choice with a separate inbox effect.
2. **Save draft** persists a new immutable revision. It does not change the
   currently published text, audience, display window or notification target.
3. **Publish now** explicitly releases that draft. Its start must already have
   been reached, and its end must still be in the future. A future start is
   rejected with a manual-publication explanation. There is no publication
   scheduler, scheduled email worker or automatic future publication.
4. **Archive** immediately closes the current publication to new reads and ACKs.
   **Recover** restores the retained publication subject to its original audience
   and display window. It preserves revision identity, acknowledgements and notice
   identity; it does not rebroadcast or extend an expired publication.

Management search checks the latest draft and current publication's bilingual
text. Status filters distinguish draft, published and archived parents. Reads
return at most 50 records per request; the UI requests 20 and navigates through
the server's stable timestamp-plus-UUID cursor. Administrative list responses
contain summary metadata rather than all bodies or all historical revisions.

Dates are canonical instants with an IANA display zone. Unchanged time inputs
preserve original seconds and resolved offsets when another draft is saved. The
shared date utilities reject invalid or ambiguous changed local instants. Expiry
is enforced on every server read and ACK; visible cards also use one local expiry
timer, rather than a recurring timer or per-second network request.

## Revision acknowledgement and inbox

Acknowledgements bind the authenticated account to one published revision UUID.
They are persisted only after current active-account, audience and display-window
checks succeed. Exact retries return the original timestamp. An acknowledgement
hides that revision from the user's banner and marks its corresponding own inbox
notice read. It cannot acknowledge another account's copy.

A later published revision has a new UUID and is visible again. Saving a draft
alone does not reset an earlier acknowledgement or expose the draft. The ordinary
full page includes currently authorized acknowledged revisions with their read
state. Superseded, archived, expired or no-longer-authorized IDs cannot be fetched
through the exact-revision endpoint.

Only important publications insert a committed, deduplicated
`portal_announcement` inbox record, keyed by published revision UUID and recipient.
Recipients are active accounts matching actual current database roles at
publication. Information-only publications have banners and a page without an
inbox event. Accounts created or joining an audience afterward can read current
publications; no retrospective notification fanout is claimed.

Important notices count as attention during quiet hours only while that exact
publication remains currently readable. The three existing mandatory receipt
kinds retain their original attention behavior. The accepted four-category
notification preference API and public `notification_inbox` wrapper are unchanged.
The ordinary inbox retains historical records; its existing current-permission
resolver returns an empty title and destination for unavailable revisions.

## Storage, permissions and API

The additive CLI migration is
`20261116022734_portal_announcements.sql`. Earlier delivered migrations and the
separate quiet-preference migration remain unchanged.

Private RLS-enabled tables store announcement state, immutable draft revisions,
immutable publication receipts, own acknowledgements and exact operation retry
records. State points separately to the latest draft and current publication.
An index resolves current publication IDs without scanning every parent; ordinary
list queries start from current publication pointers rather than loading revision
history. No public table grants expose drafts, audiences or operation parameters.

| Public RPC                                                                     | Contract                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manage_announcement(p_id,p_action,p_expected_version,p_request_id,p_payload)` | Current MFA management; `save`, `publish`, `archive`, `recover`; exact request binding and atomic side effects. New draft creation uses null ID and expected version zero. |
| `admin_announcements(p_search,p_state,p_before_at,p_before_id,p_limit)`        | Bounded metadata pages; finite, complete tuple cursors and literal search.                                                                                                 |
| `admin_announcement(p_id)`                                                     | Current authorized draft and published snapshots for the editor.                                                                                                           |
| `announcements(p_search,p_unacknowledged,p_before_at,p_before_id,p_limit)`     | Current published, unarchived, in-window, actual-role-authorized revisions only.                                                                                           |
| `announcement(p_revision_id)`                                                  | One exact currently authorized publication; draft and historical guesses fail.                                                                                             |
| `acknowledge_announcement(p_revision_id)`                                      | Idempotent own acknowledgement and own corresponding inbox read state.                                                                                                     |

Every management mutation locks the caller's active profile before evaluating
current role/MFA permission, then locks the announcement. Account role changes
and suspension use the existing exclusive profile lock. ACKs follow the same
profile-first boundary before current audience checks and the publication lock.
This prevents a write that waited behind a completed role withdrawal from using
its earlier authorization result.

Version checks reject competing edits with exact `40001`; no accepted snapshot is
edited in place. Operation keys bind actor, action, expected version and exact
payload. Reusing a key for different parameters fails. The editor keeps the
version captured when it opened even if a background detail read refreshes, and
retains an uncertain draft and retry key until confirmation. Permission errors
hide cached private metadata and open editor content.

Publication state, immutable publication receipt, important-notice fanout, audit
and operation record commit together. A failed side effect rolls the whole
operation back. Reviewed administrative audit actions expose actor, action,
resource and time only; bodies and retry payloads are not included in the audit
viewer. Historical snapshots and retry records are retained: this module does
not claim a purge or legal retention policy.

## Actual validation and remaining acceptance

Implemented focused checks, using the explicitly owned network-disabled M7
scratch container and a separate UUID database:

- 16 real PostgreSQL groups passed, including current MFA/roles, immutable drafts,
  first publication and exact retries, private newer drafts, per-revision ACK and
  resurfacing, competing CAS transactions, archive/recover, explicit future-start
  denial, display expiry, bounded cursor pages, literal search, quiet behavior,
  private ACLs, and rollback after an intentionally failing notification trigger.
- Two of those groups observe real profile barriers through `pg_stat_activity`:
  management write and ACK wait behind role withdrawal, then fail with `42501`
  without the denied mutation or an unintended inbox read.
- 18 feature component tests and the three existing shell logout tests passed
  during integration. They cover delayed ACK, uncertainty, cache revocation,
  bilingual state, local expiry, actor change, exact-revision navigation, bounded
  pagination, draft/CAS/retry preservation and administrative permission loss.

`announcements-api-check.mjs` contains five actual Auth/MFA/REST scenarios for the
canonical disposable stack. `announcements.spec.ts` contains two workflows on
desktop and mobile, including real draft/publication separation, MFA, revision
ACK, archive/recover, manual future publication, information-only notices,
English/dark mode, overflow and axe. These native API/browser cases are authored
and listed, not yet executed for M7 at this checkpoint. The root's combined
canonical and retained-data acceptance must record the final frozen source and
actual results. No production, real email or push delivery is claimed here.
