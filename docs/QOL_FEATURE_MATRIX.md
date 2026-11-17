# QoL feature inventory

This checklist extracts requested actions and criteria from [the user prompt](QOL_MASTER_PROMPT.txt). “Source present” denotes inspected implementation, not end-to-end acceptance; “Partial” explicitly leaves additional scope or verification open. “Not yet assessed” does not mean absent. Isolated test results name their earlier source snapshots and do not certify later concurrent changes. PRs #37, #43 and #44 were merged into main after the initial audit; #45 and #46 need current status verification. #47 is the programme draft. No row implies production or complete acceptance.

| Module | Requested feature or criterion | Status | Evidence / tests / PR |
|---|---|---|---|
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | One-to-one direct messages | Source present; acceptance pending | `src/features/chat/manage.tsx` calls `create_dm`; `supabase/migrations/20261115121922_secure_chat_collaboration.sql` enforces contact checks. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Lecturer group chats | Source present; acceptance pending | `src/features/chat/manage.tsx`; `supabase/migrations/20261115121922_secure_chat_collaboration.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | General company-wide chat | Partial | `src/features/chat/chat.tsx` opens the lecturer lounge; its membership is lecturer-scoped, not all company roles. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Topic-based groups | Source present; acceptance pending | `src/features/chat/manage.tsx`; `supabase/migrations/20261115121922_secure_chat_collaboration.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Course-specific lecturer chats | Source present; acceptance pending | `supabase/migrations/20261115210814_job_capacity_and_board.sql`; `src/features/chat/thread.tsx`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Separate participant/course chats | Source present; acceptance pending | `src/features/chat/manage.tsx`; `supabase/migrations/20261115121922_secure_chat_collaboration.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Management groups | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Customer-specific conversations where explicitly authorised | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Private invitation-only groups | Partial | Topic-group invites require consent, but existing owner-authorized direct additions remain available; strict invitation-only setting is not implemented. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Discoverable groups where appropriate | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Create a group | Source present; acceptance pending | `src/features/chat/manage.tsx`; `supabase/migrations/20261115141620_client_commission_revenue.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Enter a group name | Source present; acceptance pending | `src/features/chat/manage.tsx`; `supabase/migrations/20261115141620_client_commission_revenue.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Add a description | Partial | `src/features/chat/group-settings.tsx` edits after creation; adding during creation not established. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Upload a group picture | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Choose a group category | Partial | `src/features/chat/manage.tsx` chooses topic or participant course; arbitrary category is not established. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Add searchable topic tags | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Select privacy/visibility settings | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Invite members | Partial; acceptance pending | Topic owners may invite active staff via `topic-invitations.tsx` and `20261117130014_chat_topic_invitations.sql`; course-group invitations and notifications are not implemented. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Search for members | Partial | `src/features/chat/manage.tsx` has a search in the DM picker, while group creation uses checkboxes. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Add multiple members | Source present; acceptance pending | `src/features/chat/manage.tsx`; `supabase/migrations/20261115141620_client_commission_revenue.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Remove members | Source present; acceptance pending | `src/features/chat/manage.tsx`; `supabase/migrations/20261115141620_client_commission_revenue.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Leave a group | Partial; isolated tests passed | `src/features/chat/group-ownership.tsx`; `supabase/migrations/20261117130004_chat_topic_ownership_and_leave.sql`; `scripts/chat-group-ownership-db-tests.mjs` 4 checks passed; topic groups only; E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Rename a group | Partial; isolated tests passed | `src/features/chat/group-settings.tsx`; `supabase/migrations/20261117130001_chat_group_settings.sql`; `scripts/chat-group-settings-db-tests.mjs` 5 checks and `src/features/chat/group-settings.test.tsx` passed in this worktree; E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Change its description | Partial; isolated tests passed | `src/features/chat/group-settings.tsx`; `supabase/migrations/20261117130001_chat_group_settings.sql`; `scripts/chat-group-settings-db-tests.mjs` 5 checks and `src/features/chat/group-settings.test.tsx` passed in this worktree; E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Change its picture | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Change group settings | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Transfer ownership | Partial; isolated tests passed | `src/features/chat/group-ownership.tsx`; `supabase/migrations/20261117130004_chat_topic_ownership_and_leave.sql`; `scripts/chat-group-ownership-db-tests.mjs` 4 checks passed; topic groups only; E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Assign moderators | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Revoke moderator rights | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Archive a group | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Delete a group where permitted | Partial | `src/features/deletions/deletions.tsx`; `supabase/migrations/20261116173902_permanent_resource_deletion.sql` provide a separate deletion workflow; contextual group flow unverified. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | View group information | Partial; isolated tests passed | `src/features/chat/group-settings.tsx`; `supabase/migrations/20261117130001_chat_group_settings.sql`; `scripts/chat-group-settings-db-tests.mjs` 5 checks and `src/features/chat/group-settings.test.tsx` passed in this worktree; E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | View group members | Source present; acceptance pending | `src/features/chat/manage.tsx`; `supabase/migrations/20261115141620_client_commission_revenue.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | View creation and relevant activity information | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | View and manage pending invitations | Partial; acceptance pending | Topic owners may list and revoke, recipients may list pending; browser acceptance remains pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Join a group when permitted | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Request membership when approval is required | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Accept or reject invitations | Partial; acceptance pending | Topic invitees accept/reject against current server authority; no access before acceptance. Desktop/mobile acceptance remains pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Withdraw membership requests | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Leave voluntarily | Partial; isolated tests passed | `src/features/chat/group-ownership.tsx`; `scripts/chat-group-ownership-db-tests.mjs` 4 checks passed; limited to topic groups. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Remove members | Source present; acceptance pending | `src/features/chat/manage.tsx`; `supabase/migrations/20261115141620_client_commission_revenue.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Ban or restrict members where justified | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Restore access when authorised | Source present; acceptance pending | `src/features/chat/manage.tsx`; `supabase/migrations/20261115141620_client_commission_revenue.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Transfer ownership | Partial; isolated tests passed | `src/features/chat/group-ownership.tsx`; `scripts/chat-group-ownership-db-tests.mjs` 4 checks passed; limited to topic groups. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Automatically update access after assignment changes | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Revoke access after lecturer replacement or account suspension | Partial | `supabase/migrations/20261116173907_deletion_smart_operations_dependencies.sql`; `supabase/migrations/20261115121922_secure_chat_collaboration.sql`; exact replacement/suspension acceptance pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Public/discoverable groups | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Private invitation-only groups | Partial | Topic-group invites require consent, but direct owner additions remain possible; no strict invitation-only setting. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | System-managed course groups | Source present; acceptance pending | `supabase/migrations/20261115210814_job_capacity_and_board.sql`; `src/features/chat/types.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Restricted management groups | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Pin conversations | Partial; component tests passed | `src/features/chat/chat.tsx`; `supabase/migrations/20261117130002_chat_personal_pins.sql`; `src/features/chat/pins.test.tsx` passed in this worktree; end-to-end pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Unpin conversations | Partial; component tests passed | `src/features/chat/chat.tsx`; `supabase/migrations/20261117130002_chat_personal_pins.sql`; `src/features/chat/pins.test.tsx` passed in this worktree; end-to-end pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Reorder pinned conversations | Partial; component tests passed | `src/features/chat/chat.tsx`; `supabase/migrations/20261117130002_chat_personal_pins.sql`; `src/features/chat/pins.test.tsx` passed in this worktree; end-to-end pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Mute conversations | Partial | `src/features/chat/thread.tsx`; `supabase/migrations/20261115121922_secure_chat_collaboration.sql`; read occurs when the visible thread is observed. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Unmute conversations | Partial | `src/features/chat/thread.tsx`; `supabase/migrations/20261115121922_secure_chat_collaboration.sql`; read occurs when the visible thread is observed. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Archive conversations | Partial; isolated tests passed | `supabase/migrations/20261117130015_chat_personal_archive.sql` and `src/features/chat/chat.tsx` support own DM/topic rooms; course/system rooms excluded. E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Unarchive conversations | Partial; isolated tests passed | `supabase/migrations/20261117130015_chat_personal_archive.sql` and `src/features/chat/chat.tsx` support own DM/topic rooms; course/system rooms excluded. E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Hide conversations from their personal list | Partial | Personal archive hides own DM/topic conversations from the active list; a distinct hide preference remains unimplemented. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Mark conversations as read | Partial | `src/features/chat/thread.tsx`; `supabase/migrations/20261115121922_secure_chat_collaboration.sql`; read occurs when the visible thread is observed. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Mark conversations as unread | Partial; isolated tests passed | `supabase/migrations/20261117130011_personal_chat_unread.sql` and `src/features/chat/room-unread.tsx`; integrated E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Search conversations | Source present; acceptance pending | `src/features/chat/chat.tsx`; `supabase/migrations/20261115121922_secure_chat_collaboration.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Filter conversations | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Display unread message counts | Source present; acceptance pending | `src/features/chat/chat.tsx`; `supabase/migrations/20261115121922_secure_chat_collaboration.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Display the last message preview | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Display the last activity timestamp | Partial; component tests passed | `src/features/chat/room-activity.tsx` displays last-message time, not every kind of group activity; `src/features/chat/room-activity.test.tsx` passed; E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Open a conversation directly from a user profile | Source present; acceptance pending | `src/features/people/people.tsx`; `src/features/chat/chat.tsx`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Open a relevant group directly from a course page | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Plain-text content | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/chat/mentions.test.tsx` includes send retry coverage. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Multiple lines | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/chat/mentions.test.tsx` includes send retry coverage. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Links and safe link previews where feasible | Partial | `src/features/chat/message.tsx` converts HTTP(S) text into safe external links; preview support not established. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Emoji | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/chat/mentions.test.tsx` includes send retry coverage. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Reactions | Source present; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261116080730_chat_structured_mentions.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Replies to individual messages | Partial; isolated tests passed | `supabase/migrations/20261117130010_chat_replies.sql`, `src/features/chat/composer.tsx`; integrated E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Optional threaded replies | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Mentions | Partial | `src/features/chat/mentions.tsx`; `src/features/chat/composer.tsx`; explicit selection rather than typed-name autocomplete. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Copying message text | Partial; component tests passed | `src/features/chat/message.tsx`; `src/features/chat/mentions.test.tsx` passed success/failure/tombstone cases; `tests/e2e/chat.spec.ts` added, execution pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Copying an authorised message link | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Editing messages | Source present; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261116080730_chat_structured_mentions.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Deleting messages | Source present; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261116080730_chat_structured_mentions.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Message attachments | Partial | `src/features/chat/composer.tsx`; `src/features/files/api.ts`; one attachment per message. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Message search | Source present; acceptance pending | `src/features/chat/thread.tsx`; `src/features/chat/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Pagination and loading older messages | Source present; acceptance pending | `src/features/chat/thread.tsx`; `src/features/chat/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Unread message indicators | Partial | `src/features/chat/chat.tsx` displays unread room counts; per-message indicator not established. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Read receipts where permitted | Partial | `src/features/chat/thread.tsx` marks own read position; recipient-visible receipts not established. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Sending indicators | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/chat/mentions.test.tsx` includes send retry coverage. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Failed-message states | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/chat/mentions.test.tsx` includes send retry coverage. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Retry functionality | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/chat/mentions.test.tsx` includes send retry coverage. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Message ordering | Source present; acceptance pending | `src/features/chat/thread.tsx`; `src/features/chat/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Automatic scroll behaviour | Source present; acceptance pending | `src/features/chat/thread.tsx`; `src/features/chat/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Scroll-to-latest controls | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / Message timestamps | Sending time | Source present; acceptance pending | `src/features/chat/message.tsx` formats server `created_at` in the profile zone and language. |
| COMPLETE CHAT & MESSAGING SYSTEM / Message timestamps | Creation date where relevant | Source present; acceptance pending | `src/features/chat/message.tsx` formats server `created_at` in the profile zone and language. |
| COMPLETE CHAT & MESSAGING SYSTEM / Message timestamps | Edited indicator when modified | Source present; acceptance pending | `src/features/chat/message.tsx` formats server `created_at` in the profile zone and language. |
| COMPLETE CHAT & MESSAGING SYSTEM / Message timestamps | Correct date separators | Partial; component tests passed | `src/features/chat/message-days.ts`; `src/features/chat/message-days.test.tsx` passed Berlin DST, Brisbane and overlapping pages; browser pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / Message timestamps | User-local time zone formatting | Source present; acceptance pending | `src/features/chat/message.tsx` formats server `created_at` in the profile zone and language. |
| COMPLETE CHAT & MESSAGING SYSTEM / Message timestamps | Appropriate DE/EN date and time formatting | Source present; acceptance pending | `src/features/chat/message.tsx` formats server `created_at` in the profile zone and language. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Hide the message from the requesting user's normal conversation view. | Partial; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261117130005_chat_personal_message_hiding.sql`; full current-head tests pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Do not remove it from another participant's view. | Partial; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261117130005_chat_personal_message_hiding.sql`; full current-head tests pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Persist the user's personal deletion preference appropriately. | Partial; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261117130005_chat_personal_message_hiding.sql`; full current-head tests pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | The authorised sender or moderator can remove the message from normal conversation views for all participants. | Source present; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261115121922_secure_chat_collaboration.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Clear its ordinary visible body and attachment references. | Source present; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261115121922_secure_chat_collaboration.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Update other connected clients through Realtime. | Partial | `src/features/chat/realtime.ts` invalidates message queries on updates; browser reconnect verification remains pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Show an appropriate deleted-message placeholder where the conversation policy calls for one. | Source present; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261115121922_secure_chat_collaboration.sql`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Prevent removed attachments from remaining accessible solely through that message. | Partial; isolated SQL passed | `supabase/migrations/20261117130003_message_scoped_attachments.sql`; `scripts/chat-message-documents-db-tests.mjs`. Earlier isolated SQL passed; HTTP/browser acceptance pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Handle users who are offline and later reconnect. | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Original author authentication | Source present; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261116080730_chat_structured_mentions.sql`; `src/features/chat/mentions.test.tsx`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Server-side permission checks | Source present; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261116080730_chat_structured_mentions.sql`; `src/features/chat/mentions.test.tsx`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Version conflict detection | Source present; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261116080730_chat_structured_mentions.sql`; `src/features/chat/mentions.test.tsx`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Edited indicator | Source present; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261116080730_chat_structured_mentions.sql`; `src/features/chat/mentions.test.tsx`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Consistent realtime updates | Partial | `src/features/chat/realtime.ts` revalidates on message updates; full connected-client acceptance pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Safe retry handling | Source present; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261116080730_chat_structured_mentions.sql`; `src/features/chat/mentions.test.tsx`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Preservation of relevant audit history | Source present; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261116080730_chat_structured_mentions.sql`; `src/features/chat/mentions.test.tsx`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Correct interaction with structured mentions | Source present; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261116080730_chat_structured_mentions.sql`; `src/features/chat/mentions.test.tsx`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | No accidental duplicate messages | Source present; acceptance pending | `src/features/chat/message.tsx`; `supabase/migrations/20261116080730_chat_structured_mentions.sql`; `src/features/chat/mentions.test.tsx`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.8 Pinned messages and announcements | Pin an authorised message in a group | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.8 Pinned messages and announcements | Unpin it | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.8 Pinned messages and announcements | View pinned messages | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.8 Pinned messages and announcements | Navigate to the original message | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.8 Pinned messages and announcements | Display pinned-message context | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.8 Pinned messages and announcements | Restrict group-wide pinning to permitted roles | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.8 Pinned messages and announcements | Prevent stale pins from exposing deleted or inaccessible messages | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | PDF files | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/files/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Word/Office documents | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/files/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Images | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/files/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Text files | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/files/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Teaching materials | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/files/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Other explicitly supported formats | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/files/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Upload button | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/files/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Drag and drop | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/files/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Upload progress | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/files/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | File-size validation | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/files/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Multiple attachments where supported | Partial | `src/features/chat/composer.tsx` handles a single selected file. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Safe previews | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Authorised downloads | Partial | `src/features/files/document-attachment.tsx`; `supabase/migrations/20261115123659_document_chat_attachment_authorization.sql`; current-head E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Filename and file-type display | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Clear scanning status | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/files/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Retry after failed upload | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/files/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Remove attachment before sending | Source present; acceptance pending | `src/features/chat/composer.tsx`; `src/features/files/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Access checks after member removal | Partial | `src/features/files/document-attachment.tsx`; `supabase/migrations/20261115123659_document_chat_attachment_authorization.sql`; current-head E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Typing indicators | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Online/offline or last-seen status with privacy settings | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Saved messages or bookmarks | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Draft preservation | Partial | `src/features/chat/composer.tsx` retains a draft on failed sends; persistence across navigation/reload not established. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Reply previews | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Mention autocomplete | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Search within an individual conversation | Source present; acceptance pending | `src/features/chat/thread.tsx`; `src/features/chat/api.ts`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Conversation information panels | Partial | `src/features/chat/group-settings.tsx`; `src/features/chat/manage.tsx`. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Keyboard shortcuts | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Message context menus | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Accessible mobile long-press alternatives | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Notification mute durations | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Group member counts | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | New member system notices | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Moderation and reporting | Partial | `src/features/chat/message.tsx` supports moderation; message-reporting flow not established. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Blocking unwanted direct contact where compatible with operational obligations | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | Search for colleagues | Source present; acceptance pending | `src/features/people/people.tsx`; `src/features/people/api.ts`. |
| CONTACTS, USERS AND PROFILES | View authorised profiles | Source present; acceptance pending | `src/features/people/people.tsx`; `src/features/people/api.ts`. |
| CONTACTS, USERS AND PROFILES | Open a direct conversation | Source present; acceptance pending | `src/features/people/people.tsx`; `src/features/chat/chat.tsx`. |
| CONTACTS, USERS AND PROFILES | Copy permitted contact information | Partial; component tests passed | `src/features/people/person-contact.tsx`; `src/features/profile/contact.test.tsx` passed 7 cases; `tests/e2e/staff-contact.spec.ts` browser execution pending. |
| CONTACTS, USERS AND PROFILES | Start an email using the user's email client | Source present; acceptance pending | `src/features/people/person-contact.tsx`; `src/features/profile/contact-api.ts`. |
| CONTACTS, USERS AND PROFILES | Call using the device's telephone application | Source present; acceptance pending | `src/features/people/person-contact.tsx`; `src/features/profile/contact-api.ts`. |
| CONTACTS, USERS AND PROFILES | View shared courses | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | View relevant expertise | Source present; acceptance pending | `src/features/people/people.tsx`; `src/features/people/api.ts`. |
| CONTACTS, USERS AND PROFILES | View availability information explicitly shared with them | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | View qualifications where authorised | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | Access appropriate CVs and attachments | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | Edit their own contact information | Source present; acceptance pending | `src/features/profile/profile.tsx`; `src/components/preferences.tsx`. |
| CONTACTS, USERS AND PROFILES | Set profile visibility preferences | Partial | `src/features/profile/contact-visibility.tsx` controls email and telephone; broader settings unverified. |
| CONTACTS, USERS AND PROFILES | Upload or change profile pictures | Source present; acceptance pending | `src/features/profile/profile.tsx`; `src/components/preferences.tsx`. |
| CONTACTS, USERS AND PROFILES | View their current role | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | Select preferred language and time zone | Source present; acceptance pending | `src/features/profile/profile.tsx`; `src/components/preferences.tsx`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | View available assignments | Source present; acceptance pending | `src/features/jobs/discovery.tsx`; `src/features/jobs/discovery-api.ts`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Search and filter assignments | Source present; acceptance pending | `src/features/jobs/discovery.tsx`; `src/features/jobs/discovery-api.ts`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Save filters | Source present; acceptance pending | `src/features/jobs/discovery.tsx`; `src/features/jobs/discovery-api.ts`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Sort by date, compensation, customer, topic and duration | Partial | Existing `src/features/jobs/discovery-api.ts`; `supabase/migrations/20261117130006_job_discovery_customer_topic_sort.sql` now include customer/topic ordering. Final acceptance remains pending. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | View detailed job information | Partial | `src/features/jobs/jobs.tsx`; `src/features/files/document-attachment.tsx`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | View attachments | Partial | `src/features/jobs/jobs.tsx`; `src/features/files/document-attachment.tsx`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Claim eligible opportunities | Source present; acceptance pending | `src/features/jobs/jobs.tsx`; `src/features/jobs/board.tsx`; transactional claims are server-confirmed. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | See immediate confirmed results | Source present; acceptance pending | `src/features/jobs/jobs.tsx`; `src/features/jobs/board.tsx`; transactional claims are server-confirmed. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | View their claimed assignments | Source present; acceptance pending | `src/features/jobs/jobs.tsx`; `src/features/jobs/board.tsx`; transactional claims are server-confirmed. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Cancel or withdraw according to the current rules | Partial; PR #37 open | `src/features/jobs/lifecycle.tsx` covers manager cancellation. [PR #37](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/37) separately adds short-notice withdrawal requests and remains open. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Request a short-notice withdrawal where required | Partial; PR #37 open | `src/features/jobs/lifecycle.tsx` covers manager cancellation. [PR #37](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/37) separately adds short-notice withdrawal requests and remains open. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | View withdrawal status | Partial; PR #37 open | `src/features/jobs/lifecycle.tsx` covers manager cancellation. [PR #37](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/37) separately adds short-notice withdrawal requests and remains open. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Receive cancellation confirmation | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | View the relevant course workspace | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Navigate to related calendar events | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Contact the authorised course coordinator | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | View the customer details relevant to delivery | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Create | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Edit | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Duplicate | Partial | `src/features/jobs/lifecycle.tsx`; `src/features/jobs/lifecycle-api.ts`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Publish | Partial | `src/features/jobs/lifecycle.tsx`; `src/features/jobs/lifecycle-api.ts`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Unpublish | Partial | `src/features/jobs/lifecycle.tsx`; `src/features/jobs/lifecycle-api.ts`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Archive | Partial | `src/features/jobs/lifecycle.tsx`; `src/features/jobs/lifecycle-api.ts`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Reopen | Partial | `src/features/jobs/lifecycle.tsx`; `src/features/jobs/lifecycle-api.ts`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Cancel | Partial | `src/features/jobs/lifecycle.tsx`; `src/features/jobs/lifecycle-api.ts`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Replace lecturers | Partial | `src/features/jobs/lifecycle-extra.tsx`; `src/features/replacements/replacements.tsx`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Manage capacities | Partial | `src/features/jobs/lifecycle.tsx`; `src/features/jobs/lifecycle-api.ts`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Manage deadlines | Partial | `src/features/jobs/lifecycle.tsx`; `src/features/jobs/lifecycle-api.ts`. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Modify eligible future assignments | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Review pending change requests | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Resolve exceptional situations | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Quick event creation | Partial | `src/features/calendar/calendar.tsx` implements personal events and month/week/day/list views. |
| CALENDAR AND AVAILABILITY QoL | Event editing | Partial | `src/features/calendar/calendar.tsx` implements personal events and month/week/day/list views. |
| CALENDAR AND AVAILABILITY QoL | Event cancellation | Partial | `src/features/calendar/calendar.tsx` implements personal events and month/week/day/list views. |
| CALENDAR AND AVAILABILITY QoL | Event duplication | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Calendar view switching | Partial | `src/features/calendar/calendar.tsx` implements personal events and month/week/day/list views. |
| CALENDAR AND AVAILABILITY QoL | Week/month/day/agenda views | Partial | `src/features/calendar/calendar.tsx` implements personal events and month/week/day/list views. |
| CALENDAR AND AVAILABILITY QoL | Availability blocks | Partial | `src/features/availability/availability.tsx`. |
| CALENDAR AND AVAILABILITY QoL | Unavailable periods | Partial | `src/features/availability/availability.tsx`. |
| CALENDAR AND AVAILABILITY QoL | Personal notes | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Event descriptions | Partial | `src/features/calendar/calendar.tsx` implements personal events and month/week/day/list views. |
| CALENDAR AND AVAILABILITY QoL | Meeting links | Partial; acceptance pending | `src/features/calendar/calendar.tsx`; `supabase/migrations/20261117130007_personal_event_details.sql` support private-event links; other event types remain unassessed. |
| CALENDAR AND AVAILABILITY QoL | Event attachments | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Event reminders | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Event search | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Event filtering | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Event colour categories | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Personal calendar preferences | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Direct navigation to associated courses | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | ICS export and subscriptions | Source present; acceptance pending | `src/features/calendar/export.tsx`; `src/features/calendar/subscriptions.tsx`. |
| CALENDAR AND AVAILABILITY QoL | Time zone selection | Partial | `src/features/calendar/calendar.tsx` implements personal events and month/week/day/list views. |
| CALENDAR AND AVAILABILITY QoL | Offline viewing where currently supported | Partial | `src/features/calendar/offline.tsx`; `src/features/calendar/offline-store.ts`; actual device acceptance pending. |
| CALENDAR AND AVAILABILITY QoL | Calendar conflict warnings | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Clear explanations of why an assignment cannot be accepted | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course creation and editing | Partial | `src/features/operations/courses.tsx`. |
| COURSES AND TEACHING WORKSPACES | Course template selection | Partial | `src/features/operations/courses.tsx`. |
| COURSES AND TEACHING WORKSPACES | Course duplication | Partial | `src/features/operations/courses.tsx`. |
| COURSES AND TEACHING WORKSPACES | Course descriptions | Partial | `src/features/operations/courses.tsx`. |
| COURSES AND TEACHING WORKSPACES | Topic/tool tags | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course resources | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Teaching links | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Customer contacts | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Assigned lecturer details | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Preparation checklist | Partial | `src/features/readiness/readiness.tsx`; `src/features/readiness/api.ts`. |
| COURSES AND TEACHING WORKSPACES | Course Readiness Centre | Partial | `src/features/readiness/readiness.tsx`; `src/features/readiness/api.ts`. |
| COURSES AND TEACHING WORKSPACES | Course announcements | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course-specific chat | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Participant information | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Session schedules | Partial | `src/features/operations/courses.tsx`. |
| COURSES AND TEACHING WORKSPACES | Attendance | Partial | `src/features/delivery/delivery.tsx`; `src/features/delivery/api.ts`. |
| COURSES AND TEACHING WORKSPACES | Proof of delivery | Partial | `src/features/delivery/delivery.tsx`; `src/features/delivery/api.ts`. |
| COURSES AND TEACHING WORKSPACES | Completion marking | Partial | `src/features/delivery/delivery.tsx`; `src/features/delivery/api.ts`. |
| COURSES AND TEACHING WORKSPACES | Feedback | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course cancellation | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course rescheduling | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Replacement workflows | Partial | `src/features/replacements/replacements.tsx`. |
| COURSES AND TEACHING WORKSPACES | Course archival | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course history | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Links to invoices and contractual records | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Open chat | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Open calendar | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | View documents | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Copy meeting link | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Contact customer | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Confirm preparation | Partial | `src/features/readiness/readiness.tsx`; `src/features/readiness/api.ts`. |
| COURSES AND TEACHING WORKSPACES | Report a problem | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Request a change | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Uploading | Partial | `src/features/files/files.tsx`; `src/features/files/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Documents | Renaming | Partial | `src/features/files/files.tsx`; `src/features/files/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Documents | Moving | Partial | `src/features/files/discovery.tsx` provides personal folders/tags; shared organisation semantics not established. |
| DOCUMENTS, WIKI AND FORUM / Documents | Categorising | Partial | `src/features/files/discovery.tsx` provides personal folders/tags; shared organisation semantics not established. |
| DOCUMENTS, WIKI AND FORUM / Documents | Tagging | Partial | `src/features/files/discovery.tsx` provides personal folders/tags; shared organisation semantics not established. |
| DOCUMENTS, WIKI AND FORUM / Documents | Searching | Partial | `src/features/files/files.tsx`; `src/features/files/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Documents | Previewing | Partial | `src/features/files/files.tsx`; `src/features/files/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Documents | Downloading | Partial | `src/features/files/files.tsx`; `src/features/files/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Documents | Replacing | Partial | `src/features/files/files.tsx`; `src/features/files/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Documents | Version viewing | Partial | `src/features/files/files.tsx`; `src/features/files/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Documents | Archiving | Partial | `src/features/files/files.tsx`; `src/features/files/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Documents | Deleting where permitted | Partial | `src/features/deletions/deletions.tsx`; file archive in `src/features/files/files.tsx`. |
| DOCUMENTS, WIKI AND FORUM / Documents | Linking files to courses/jobs/messages | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Viewing file details | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Viewing upload/scanning status | Partial | `src/features/files/files.tsx`; `src/features/files/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Wiki | Article creation | Partial | `src/features/knowledge/wiki.tsx`; `src/features/knowledge/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Wiki | Editing | Partial | `src/features/knowledge/wiki.tsx`; `src/features/knowledge/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Wiki | Draft saving | Partial | `src/features/knowledge/wiki.tsx`; `src/features/knowledge/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Wiki | Publication | Partial | `src/features/knowledge/wiki.tsx`; `src/features/knowledge/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Wiki | Version history | Partial | `src/features/knowledge/wiki.tsx`; `src/features/knowledge/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Wiki | Categories | Partial | `src/features/knowledge/wiki.tsx`; `src/features/knowledge/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Wiki | Search | Partial | `src/features/knowledge/wiki.tsx`; `src/features/knowledge/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Wiki | Attachments | Partial; acceptance pending | `supabase/migrations/20261117130008_wiki_revision_attachments.sql` introduces versioned attachment access; frontend and complete integration are not yet assessed. |
| DOCUMENTS, WIKI AND FORUM / Wiki | Internal references | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Wiki | Code blocks | Source present; acceptance pending | `src/features/knowledge/editor.tsx`; safe content handling in `src/features/knowledge/content.ts`. |
| DOCUMENTS, WIKI AND FORUM / Wiki | Permissions | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Wiki | Archiving | Partial | `src/features/knowledge/wiki.tsx`; `src/features/knowledge/api.ts`. |
| DOCUMENTS, WIKI AND FORUM / Forum | Create discussion | Partial | `src/features/knowledge/forum.tsx`; server RPC and role details require full acceptance. |
| DOCUMENTS, WIKI AND FORUM / Forum | Edit own discussion | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Forum | Reply | Partial | `src/features/knowledge/forum.tsx`; server RPC and role details require full acceptance. |
| DOCUMENTS, WIKI AND FORUM / Forum | Quote | Partial; component tests passed | `src/features/knowledge/forum.tsx`; isolated browser test prepared but not run. |
| DOCUMENTS, WIKI AND FORUM / Forum | Subscribe | Partial | `src/features/knowledge/forum.tsx`; server RPC and role details require full acceptance. |
| DOCUMENTS, WIKI AND FORUM / Forum | Unsubscribe | Partial | `src/features/knowledge/forum.tsx`; server RPC and role details require full acceptance. |
| DOCUMENTS, WIKI AND FORUM / Forum | Pin where authorised | Partial | `src/features/knowledge/forum.tsx`; server RPC and role details require full acceptance. |
| DOCUMENTS, WIKI AND FORUM / Forum | Lock where authorised | Partial | `src/features/knowledge/forum.tsx`; server RPC and role details require full acceptance. |
| DOCUMENTS, WIKI AND FORUM / Forum | Mark accepted answer | Partial | `src/features/knowledge/forum.tsx`; server RPC and role details require full acceptance. |
| DOCUMENTS, WIKI AND FORUM / Forum | Report inappropriate content | Partial | `src/features/knowledge/forum.tsx`; server RPC and role details require full acceptance. |
| DOCUMENTS, WIKI AND FORUM / Forum | Edit/delete where permitted | Partial | `src/features/knowledge/forum.tsx`; server RPC and role details require full acceptance. |
| DOCUMENTS, WIKI AND FORUM / Forum | Search and filter | Partial | `src/features/knowledge/forum.tsx`; server RPC and role details require full acceptance. |
| DOCUMENTS, WIKI AND FORUM / Forum | View recent discussions | Partial | `src/features/knowledge/forum.tsx`; server RPC and role details require full acceptance. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Invite users | Partial | `src/features/admin/invite.tsx`; actual email delivery not established. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Edit authorised roles | Partial | `src/features/accounts/accounts.tsx`; `src/features/admin/people.tsx`. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Suspend/reactivate accounts | Partial | `src/features/accounts/accounts.tsx`; `src/features/admin/people.tsx`. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Review qualifications | Partial | `src/features/qualifications/evidence.tsx`. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Manage course assignments | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Review audit history | Partial | `src/features/audit/audit.tsx`. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Inspect operational alerts | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Manage organisations | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | View appropriate support tickets | Partial | `src/features/support/support.tsx`. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Configure permitted settings | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Perform safe bulk actions | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Preview destructive operations before confirming | Partial | `src/features/deletions/deletions.tsx`; scope limited to implemented deletion workflows. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | View operation results and failure details | Partial | `src/features/deletions/deletions.tsx`; scope limited to implemented deletion workflows. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | Create and edit customer records | Partial | `src/features/operations/clients.tsx` contains customer/authorised contact forms and search; complete cross-module acceptance pending. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | Search and filter customers | Partial | `src/features/operations/clients.tsx` contains customer/authorised contact forms and search; complete cross-module acceptance pending. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | View contacts | Partial | `src/features/operations/clients.tsx` contains customer/authorised contact forms and search; complete cross-module acceptance pending. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | Link courses | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | View requests | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | Record authorised notes | Partial | `src/features/operations/clients.tsx` contains customer/authorised contact forms and search; complete cross-module acceptance pending. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | View customer-specific history | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | Archive records | Partial | `src/features/operations/clients.tsx` contains customer/authorised contact forms and search; complete cross-module acceptance pending. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | Manage customer-specific permissions | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | View own contracts | Partial | `src/features/commercial/contracts.tsx`; [PR #45](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/45) separately addresses contract-file privacy. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | Download permitted documents | Partial | `src/features/commercial/contracts.tsx`; [PR #45](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/45) separately addresses contract-file privacy. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | Inspect versions | Partial | `src/features/commercial/contracts.tsx`; [PR #45](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/45) separately addresses contract-file privacy. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | View current agreement status | Partial | `src/features/commercial/contracts.tsx`; [PR #45](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/45) separately addresses contract-file privacy. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | Receive expiration reminders | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | Review applicable assignment agreements | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | Acknowledge documents where appropriate | Partial | `src/features/commercial/contracts.tsx`; [PR #45](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/45) separately addresses contract-file privacy. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | Navigate to related assignments | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | View personal earnings | Partial | `src/features/commercial/finance.tsx`; accepted amounts remain server-derived. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | View confirmed assignments | Partial | `src/features/commercial/finance.tsx`; accepted amounts remain server-derived. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | View invoice status | Partial | `src/features/commercial/finance.tsx`; accepted amounts remain server-derived. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | Upload invoices | Partial | `src/features/commercial/finance.tsx`; accepted amounts remain server-derived. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | Download authorised statements | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | Track payments | Partial | `src/features/commercial/finance.tsx`; accepted amounts remain server-derived. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | Filter by date/customer/status | Partial | `src/features/commercial/finance.tsx` includes earnings/invoice export and status/search filters; complete requested dimensions remain unverified. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | Export permitted information | Partial | `src/features/commercial/finance.tsx` includes earnings/invoice export and status/search filters; complete requested dimensions remain unverified. |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | Inspect approved amendments | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | Resolve invoice questions | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | In-app notifications | Partial | `src/features/notifications/notifications.tsx`; `src/features/notifications/attention-settings.tsx`. |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Read/unread status | Partial | `src/features/notifications/notifications.tsx`; `src/features/notifications/attention-settings.tsx`. |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Mark all as read | Partial | `src/features/notifications/notifications.tsx`; `src/features/notifications/attention-settings.tsx`. |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Per-category preferences | Partial | `src/features/notifications/notifications.tsx`; `src/features/notifications/attention-settings.tsx`. |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Muting conversations | Source present; acceptance pending | `src/features/chat/thread.tsx`; `supabase/migrations/20261115121922_secure_chat_collaboration.sql`. |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Quiet hours | Partial | `src/features/notifications/notifications.tsx`; `src/features/notifications/attention-settings.tsx`. |
| NOTIFICATIONS AND PERSONAL PREFERENCES | New assignment notices | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Assignment confirmations | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Cancellation notices | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Group invitations | Partial | Topic invitations appear in a permission-filtered in-app inbox; email/push delivery and invitation notifications for other group kinds are not implemented. |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Mention notifications | Partial | `supabase/migrations/20261116080730_chat_structured_mentions.sql`; dispatch and delivery on the current head remain unverified. |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Direct message notifications | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Course announcements | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Calendar reminders | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Qualification expiry warnings | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Contract expiry warnings | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Support ticket updates | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Change-request decisions | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Optional supported PWA Push | Partial | `src/features/notifications/push-settings.tsx`; physical device delivery and operational worker acceptance not established. |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Create | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Save | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Edit | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Cancel | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Close | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Delete | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Undo where safe | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Duplicate | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Archive | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Restore where supported | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Search | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Filter | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Sort | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Refresh | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Retry | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Upload | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Download | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Share | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Copy | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Navigate back | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | View details | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Confirm | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Reject | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Mark read/unread | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Pin/unpin | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS | Mute/unmute | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Save drafts | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Protect unsaved changes | In progress | A local calendar guard is being integrated; history/programmatic SPA navigation and other forms remain open. |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Preserve input after validation errors | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Show clear validation messages | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Disable duplicate submissions | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Display server-confirmed outcomes | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Offer safe retry actions | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Explain permission failures | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Consistent sidebar | Partial | `src/app/shell.tsx`; universal accessibility/viewport sweep not established. |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Consistent page titles | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Breadcrumbs where useful | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Contextual navigation | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Clear back buttons | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Searchable command palette | Partial | `src/features/search/search.tsx` implements search; whether it satisfies a command palette remains unassessed. |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Favourite locations | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Mobile navigation | Partial | `src/app/shell.tsx`; universal accessibility/viewport sweep not established. |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Keyboard navigation | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Accessible dialogs and context menus | Partial | `src/components/ui/dialog.tsx` provides a shared Radix dialog; all dialogs and context menus remain unassessed. |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Data presentation | Meaningful empty states | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Data presentation | Loading skeletons | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Data presentation | Pagination | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Data presentation | Sorting | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Data presentation | Filtering | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Data presentation | Relevant status indicators | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Data presentation | Appropriate tooltips | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Data presentation | Last-updated timestamps | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Data presentation | Helpful error messages | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Data presentation | Clear ownership labels | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Data presentation | Accessible status colours | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Performance | Avoid unnecessary database requests | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Performance | Avoid excessive realtime subscriptions | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Performance | Reduce unnecessary React re-renders | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Performance | Use efficient list rendering | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Performance | Prevent long lists from freezing mobile devices | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Performance | Clean up subscriptions correctly | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Performance | Handle reconnects gracefully | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Performance | Avoid polling when an existing event-driven approach is sufficient | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Authentic brand | Paper: #F8F5EE | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Authentic brand | Surface: #FFFDF8 | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Authentic brand | Navy: #172B4B | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Authentic brand | Text: #14233B | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Authentic brand | Brand Blue: #1749B5 | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Authentic brand | Coral: #FFAE9A | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Authentic brand | Peach: #FFC68E | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Authentic brand | Yellow: #FFDB76 | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Authentic brand | Mint: #B8EDD9 | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Authentic brand | Indigo: #7D88D8 | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Authentic brand | Lilac: #DED2FA | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | German | Partial | `src/lib/i18n.ts` and feature namespaces; complete application-wide language audit remains pending. |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | English | Partial | `src/lib/i18n.ts` and feature namespaces; complete application-wide language audit remains pending. |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Buttons | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Menus | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Dialogs | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Notifications | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Validation messages | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Error messages | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Help text | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Accessibility labels | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Timestamps and date formatting | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Themes | Light | Partial | `src/components/preferences.tsx`; `src/styles.css`; full screen-by-screen contrast acceptance pending. |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Themes | Dark | Partial | `src/components/preferences.tsx`; `src/styles.css`; full screen-by-screen contrast acceptance pending. |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Themes | System preference | Partial | `src/components/preferences.tsx`; `src/styles.css`; full screen-by-screen contrast acceptance pending. |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Desktop | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Tablet | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Smartphone | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Portrait and landscape layouts where relevant | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Installable PWA | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Existing manifest and service worker | Partial | `vite.config.ts`; source only, exact-head device acceptance remains pending. |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Safe offline behaviour | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Safe reconnect behaviour | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Secure authenticated data handling | Not yet assessed | Pending |
