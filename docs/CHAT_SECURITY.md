# Collaboration access and verification

The chat slice uses PostgreSQL as its message history and Supabase Postgres Changes as a delivery signal. Browser caches are transient; no chat body or attachment is cached by the PWA service worker.

## Membership and roles

- `private.can_access_chat_room(uuid)` checks the authenticated active profile and a current nonremoved membership. General lecturer rooms additionally require a current lecturer/senior-lecturer role; staff topic/course rooms require a current staff role. An administrator has no implicit DM or room access.
- Staff can discover only safe contact names/IDs/role labels, not other profiles' biography, phone, rates or private evidence. Participants see contacts from their explicitly shared participant channels; authorised course management can discover participant contacts with MFA.
- DM creation serialises the canonical unordered pair, so simultaneous opposite requests create one room. Participant DMs require an explicitly available course contact.
- The assigned lecturer owns the lecturer-course discussion created during claiming. Owner-managed invitations accept staff only; participant channels use a separate course-run relation, require `courses.manage` and AAL2 to create, and do not expose the commercial job relation to participants.
- Topic owners manage their groups. Course managers can manage an existing course room only when they are a member. Group owners cannot remove themselves; changing owner/archiving is a later explicit workflow. General membership is joined only through the lecturer-role-checked RPC. DM membership is not administratively editable.
- Membership removal updates a tombstone. The removed user can read only their own membership marker so the client can clear room caches. That marker never authorises messages or files. No cross-room member list or unfiltered DELETE feed is exposed.

## Messages and audit

`send_message` rechecks membership and serialises sends per authenticated actor. The durable client UUID is unique per sender; a matching retry returns the original message ID, while reuse for another body/attachment/room fails. The maximum body is 8,000 characters and the database permits 30 new messages per actor per minute. Body is authored plain text; the UI must render it as text.

Current members can retrieve paginated messages by `(created_at,id)`, search authored text, persist a monotone read cursor and mute notifications. Reactions use the fixed emoji allowlist and idempotent per-user rows. Removing a reaction is a tombstone update rather than a realtime DELETE disclosure.

Senders can correct their own messages during a 15-minute window. Senders may delete their messages; group owners or explicitly authorised moderators may moderate only rooms they can access. DM moderation has no admin bypass. Deletes clear the visible body and attachment reference. Previous bodies are retained in `chat_message_revisions` with the same private room membership boundary; they are never written to the company-wide audit log. Ordinary administrators outside that DM cannot retrieve its revisions. This retention/audit policy must be reviewed before production; a tombstone is not a legal erasure guarantee.

Claim notifications and chat notifications are committed in the same transaction as the underlying event. Chat notification metadata contain kind/resource IDs and no message text. Retries do not add duplicate notifications.

## Attachments

`messages.document_id` integrates with the scanned private-document workflow. The chat migration starts with a deny-by-default `private.can_attach_chat_document(document_id,room_id)` adapter; the following document integration replaces it with the actual clean/current/owner/same-room/live-access check and adds the document foreign key. Unauthorised or unscanned files cannot be sent while that adapter denies. Every download must independently recheck current access, so removal also revokes attachment access.

## Realtime behavior

Only persisted message/reaction/membership INSERT/UPDATE rows are published. RLS is evaluated for each Postgres Changes record. No public broadcast of private content and no presence policy cached at join time are used.

The installed realtime-js source documents that the default `SUBSCRIBED` event can precede the actual PostgreSQL replication subscription. Chat channels set `config.postgres_changes_options.wait=true` with a 15-second server readiness timeout. This was necessary to avoid losing the first message on a cold local replication connection. The actual subscribed-member test proves delivery first, then removes/suspends that same member and proves later messages reach the owner but not that subscriber.

## Executed checks

- `node scripts/chat-db-tests.mjs`: **17 real PostgreSQL checks passed** in a disposable database, replaying all current migrations with compatible Auth helper stubs. Covers concurrent DM requests, minimal directory, admin DM isolation, durable retries/notification count, unread/mute, search/cursors, sender edits/private revision audit, reaction/tombstone semantics, lecturer general room, group-owner boundaries, revocation, participant/commercial separation, rejected file IDs/body limits/direct writes, suspended actors and 31 concurrent sends hitting the 30/minute cap.
- `node scripts/chat-api-check.mjs`: **passed** using actual local Supabase Auth, REST and WebSockets. Proves private DM races and persistence, safe names, read/reaction/edit/delete, denied administrator/outsider/participant access, denied forged table writes, actual event delivery before removal, and no later event delivery to the existing subscriber after removal or suspension. Temporary QA accounts and UUID-scoped records are removed afterwards; existing local profiles and messages are not reset.
- `supabase db lint --schema public,private --fail-on warning`: no schema errors at this checkpoint.

These checks are local evidence. Hosted realtime settings, SMTP, operational moderation/retention, load limits, typing/presence and production revocation/backup policy remain separate acceptance. This file does not claim the complete product scope or production privacy compliance.
