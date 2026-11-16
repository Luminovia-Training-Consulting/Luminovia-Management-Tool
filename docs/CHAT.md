# Chat, structured mentions and group moderation

This extends the existing member-only chat described in [CHAT_SECURITY.md](CHAT_SECURITY.md).
It uses the same PostgreSQL, Auth, Realtime, scanned file gateway and in-app inbox.
No separate application server or external notification service is introduced.

## Connected user flow

- Open an authorized person's profile and select **Nachricht / Message**. The
  existing `/chats?contact=<user-id>` route calls `create_dm` and replaces the
  destination only after the server confirms the room. This path is retained.
- In a conversation, **Personen erwähnen / Mention people** loads that room's
  current eligible members on demand. Select up to 20 people. Typed `@names`
  remain ordinary text and do not notify guessed recipients. Names render as
  escaped text in the selection and the committed message.
- Drafts retain text, selected recipients and retry identity after an uncertain
  response. A changed body, attachment or recipient list creates a new operation.
- Drop one file onto the composer or use the keyboard-accessible file picker.
  Both use the existing room-scoped scanner/upload/progress pipeline. Sending is
  disabled until a clean upload is confirmed. Rejected uploads are not attached;
  multiple-file drops are rejected without starting an upload.
- Group message deletion controls appear only when the authorized history API
  reports the actor may moderate that room. A confirmation explains the retained
  deletion notice and audit history. The existing `delete_message` API remains
  authoritative. Group membership does not grant access to another private DM.

## Persistence and public APIs

Migration `20261116080730_chat_structured_mentions.sql` is additive. All earlier
delivered migrations stay unchanged.

| API                                                                                            | Contract                                                                                                                                            |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat_mention_candidates(p_room_id)`                                                           | Current active, role-eligible room members, excluding the caller; unauthorized rooms are denied.                                                    |
| `send_message_with_mentions(p_room_id,p_body,p_client_id,p_document_id,p_mention_ids)`         | Atomic message, whole selected recipient list, first-mention notices and idempotency record; returns confirmed message UUID.                        |
| `edit_message_with_mentions(p_message_id,p_body,p_expected_version,p_client_id,p_mention_ids)` | Sender-only, current membership, existing 15 minute window, bounded rate, expected content version and exact retry binding; returns `{id,version}`. |
| `chat_messages_with_mentions(...)`                                                             | Same bounded cursor/search parameters as `chat_messages`, with `content_version`, current authorized `mentions` and `can_moderate`.                 |

Existing `send_message`, `edit_message`, `chat_messages`, reactions, reads, mute,
membership and deletion APIs remain supported for existing headless consumers.
The UI uses the additive structured APIs; it does not implement authorization in
browser metadata. Existing send limits, clean-attachment checks and membership
locks also apply to structured sends. Structured operations allow at most 20 unique,
non-null recipients and reject self, foreign, removed or role-ineligible targets.

`messages.content_version` increases on text/edit/deletion changes, including old
API edits. Private content-version records own immutable mention-version rows.
An old API edit creates a new current version with no structured mentions rather
than silently retaining recipient data from an earlier body. New edits preserve
exact operation results for retries and reject stale revisions with40001.

The private operation ledger binds caller, request key and exact normalized
parameters. Reusing an old plain-send key for a structured send is rejected.
These private records contain retry parameters and are not exposed through REST,
administrative audit projections, chat history or an administrator-wide bypass.
They follow the existing retained message-revision policy; tombstones are not a
claim that every historical private byte has been purged.

## Notification semantics

Mentions reuse **one** existing `chat_message` notification per recipient and
message UUID. No new notification kind or separate duplicate counter exists.

The first ever committed structured mention of a recipient for a given message
inserts the notice or renews the same row to unread with a fresh timestamp. This
also works when an ordinary notice for that message was already read. Explicit
mentions can override that room's mute, while the recipient's global chat
category preference and optional notification filters still apply. PostgreSQL's
BEFORE INSERT filter runs before the conflict update, including renewal.

Private version history proves whether the recipient has ever been mentioned.
The same request retry, subsequent text edits with the same recipient and
remove/re-add cycles do not renew the notice again. Mentioning while chat notices
are disabled still records the mention; enabling notices later does not turn a
remove/re-add into retroactive delivery.

After member removal, suspension, role loss or deletion, current API permission
checks and the existing inbox target resolver redact destinations/content as
appropriate. The history projection does not expose removed members through a
stale mention list. A standard administrator cannot inspect private mention
history or read another person's DM. No real email, push, typing or presence
delivery is claimed by this module.

## Actual verification and remaining acceptance

Focused local evidence during implementation:

- 11 real PostgreSQL groups passed on the explicitly owned, network-disabled M7
  scratch container, using a separate UUID database and full migration replay.
  They cover identity/version/idempotency, first-notice renewal, room mute/global
  opt-out, removal/role loss, legacy edits, tombstones, moderator/DM boundaries and
  private helper/table ACLs and a genuine competing-edit transaction race.
- 28 Vitest cases across six chat files passed after the initial UI integration,
  including eight new mention/drag/moderation scenarios and an editor revision
  retained across background refreshes. Later final source and
  full application acceptance must be recorded by the combined QA run.
- Actual Auth/MFA/REST checks and desktop/mobile browser scenarios are authored for
  canonical `./portal test`; they have not been executed for M7 at this checkpoint.

Native/browser acceptance must include a scanned dropped attachment, profile-to-DM
navigation, current-member mentions, exact read/renew behavior, permission loss,
group moderation, DE/EN, dark mode, mobile overflow and axe checks. Do not treat a
mocked component pass or the earlier M6 acceptance as these M7 results.
