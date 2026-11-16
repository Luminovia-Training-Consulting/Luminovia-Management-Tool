# Comments on templates and jobs

`ResourceComments({kind: "template" | "job", resourceId})` provides a resource-specific teaching-team discussion. Jobs use the same `private.can_read_job` check as job RLS; templates require their actual read permission and a teaching-team/management role. Course or invoice access does not give clients and course participants access to teaching-team discussions. Admin/owner accounts remain subject to the usual role, MFA and resource rules.

Records and earlier text versions are stored in unexposed private tables with RLS and no direct user grants. The server supplies the author and timestamps. The UI renders plain text, including line breaks and escaped HTML. Comments do not automatically include gross prices and do not change accepted assignment terms.

## API

| RPC                                                                   | Behaviour                                                                                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `comment_context(p_kind,p_id)`                                        | Current writing/moderation capabilities; no rows when access is denied.                                                                       |
| `resource_comments(p_kind,p_id,p_before_at,p_before_id,p_limit)`      | Newest first, complete timestamp/UUID cursor, at most 100 rows. Hidden posts are visible only to their author and authorised moderators.      |
| `add_resource_comment(p_kind,p_id,p_body,p_request_id)`               | 1–5000 characters, actual actor identity, durable resource-bound retry with the same UUID; at most 10 new posts/minute and 100/day per actor. |
| `edit_resource_comment(p_comment_id,p_body,p_version)`                | Only the actor's own accessible posts, with a checked version; no silent overwrite, author change or removal of moderation.                   |
| `withdraw_resource_comment(p_comment_id,p_version)`                   | Author withdrawal removes the text from ordinary read projections; the withdrawal notice and protected history remain.                        |
| `moderate_resource_comment(p_comment_id,p_hidden,p_reason,p_version)` | Current management capability for the resource type and MFA; reason and current version required; audited.                                    |

Archived entries remain readable to authorised people, prevent new posts/edits and still allow authors to withdraw their own posts. Hidden drafts, revoked roles and suspension are checked again on every server call. Text already read cannot be removed retrospectively from a recipient's memory; subsequent requests remain protected.

Error codes: `42501` for missing permissions, `22023` for invalid text/cursor or a changed retry, `40001` for a version conflict, and `54000` for the posting limit. An uncertain network attempt keeps the same request ID while the draft remains unchanged. Offline operation or a pending mutation never produces a false publication confirmation.

## Implementation and verification

Migration `20261115155038_resource_comments.sql`; frontend `src/features/comments`; actual SQL/API scripts `comments-db-tests.mjs` / `comments-api-check.mjs`; Playwright `comments.spec.ts`. The shared API fixture helper and `defer` cleanup contract are explained in the [developer guide](DEVELOPER_GUIDE.md).

The complete local M4-03 run passed eleven actual temporary PostgreSQL checks covering boundaries, ten concurrent identical writes producing one record, cursors, author/moderator versions, withdrawal, role revocation and suspension; three component checks covering the access gate, separate drafts and uncertain retry/server confirmation; actual Auth/TOTP/RPC calls and separate desktop/mobile browser journeys for writing, reloading, editing, moderating and withdrawing. Additional acceptance after integration with hosting code is documented separately in [QA_RESULTS](QA_RESULTS.md). The private history is not a completed statutory retention/deletion policy.

Combined hosting/application acceptance also passed in canonical04 (`4c7c897`,17:31 UTC, exit 0): all new feature SQL/API/desktop/mobile journeys plus the full regression suite. See [QA_RESULTS](QA_RESULTS.md). This is local acceptance; the [M4 hosted migration review](REVIEWED_M4_MIGRATIONS.md) remains a separate gate.
