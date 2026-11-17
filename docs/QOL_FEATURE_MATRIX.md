# QoL feature inventory

This initial checklist extracts the requested actions and criteria from [the user prompt](QOL_MASTER_PROMPT.txt). “Not yet assessed” does not mean absent: compare source, migrations, tests and open PRs before implementation. Evidence, test outcomes, PR and merge status must be recorded as each row is assessed. No row implies a completed acceptance.

| Module | Requested feature or criterion | Status | Evidence / tests / PR |
|---|---|---|---|
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | One-to-one direct messages | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Lecturer group chats | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | General company-wide chat | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Topic-based groups | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Course-specific lecturer chats | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Separate participant/course chats | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Management groups | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Customer-specific conversations where explicitly authorised | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Private invitation-only groups | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.1 Conversation types | Discoverable groups where appropriate | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Create a group | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Enter a group name | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Add a description | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Upload a group picture | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Choose a group category | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Add searchable topic tags | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Select privacy/visibility settings | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Invite members | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Search for members | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Add multiple members | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Remove members | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Leave a group | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Rename a group | Implemented; partially tested | Isolated PostgreSQL and component tests passed; integrated E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Change its description | Implemented; partially tested | Isolated PostgreSQL and component tests passed; integrated E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Change its picture | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Change group settings | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Transfer ownership | Partial; isolated tests passed | Topic groups supported; course/system groups remain governed separately. Integrated E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Assign moderators | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Revoke moderator rights | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Archive a group | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | Delete a group where permitted | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | View group information | Implemented; partially tested | Isolated PostgreSQL and component tests passed; integrated E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | View group members | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | View creation and relevant activity information | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.2 Group creation and management | View and manage pending invitations | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Join a group when permitted | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Request membership when approval is required | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Accept or reject invitations | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Withdraw membership requests | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Leave voluntarily | Partial; isolated tests passed | Topic groups supported; course/system groups remain governed separately. Integrated E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Remove members | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Ban or restrict members where justified | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Restore access when authorised | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Transfer ownership | Partial; isolated tests passed | Topic groups supported; course/system groups remain governed separately. Integrated E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Automatically update access after assignment changes | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Revoke access after lecturer replacement or account suspension | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Public/discoverable groups | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Private invitation-only groups | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | System-managed course groups | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.3 Group membership lifecycle | Restricted management groups | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Pin conversations | Implemented; partially tested | Isolated PostgreSQL and component tests passed; integrated E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Unpin conversations | Implemented; partially tested | Isolated PostgreSQL and component tests passed; integrated E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Reorder pinned conversations | Implemented; partially tested | Isolated PostgreSQL and component tests passed; integrated E2E pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Mute conversations | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Unmute conversations | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Archive conversations | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Unarchive conversations | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Hide conversations from their personal list | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Mark conversations as read | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Mark conversations as unread | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Search conversations | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Filter conversations | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Display unread message counts | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Display the last message preview | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Display the last activity timestamp | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Open a conversation directly from a user profile | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.4 Conversation list management | Open a relevant group directly from a course page | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Plain-text content | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Multiple lines | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Links and safe link previews where feasible | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Emoji | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Reactions | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Replies to individual messages | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Optional threaded replies | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Mentions | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Copying message text | Implemented; partially tested | Component success, failure and tombstone cases pass; browser test added but not yet run on this source. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Copying an authorised message link | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Editing messages | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Deleting messages | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Message attachments | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Message search | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Pagination and loading older messages | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Unread message indicators | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Read receipts where permitted | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Sending indicators | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Failed-message states | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Retry functionality | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Message ordering | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Automatic scroll behaviour | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.5 Message functionality | Scroll-to-latest controls | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / Message timestamps | Sending time | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / Message timestamps | Creation date where relevant | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / Message timestamps | Edited indicator when modified | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / Message timestamps | Correct date separators | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / Message timestamps | User-local time zone formatting | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / Message timestamps | Appropriate DE/EN date and time formatting | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Hide the message from the requesting user's normal conversation view. | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Do not remove it from another participant's view. | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Persist the user's personal deletion preference appropriately. | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | The authorised sender or moderator can remove the message from normal conversation views for all participants. | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Clear its ordinary visible body and attachment references. | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Update other connected clients through Realtime. | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Show an appropriate deleted-message placeholder where the conversation policy calls for one. | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Prevent removed attachments from remaining accessible solely through that message. | Partial; isolated SQL passed | New message-only uploads enforce live-message access for peers; legacy shared files stay shared. HTTP/browser tests pending. |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.6 Message deletion — especially important | Handle users who are offline and later reconnect. | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Original author authentication | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Server-side permission checks | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Version conflict detection | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Edited indicator | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Consistent realtime updates | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Safe retry handling | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Preservation of relevant audit history | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | Correct interaction with structured mentions | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.7 Message editing | No accidental duplicate messages | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.8 Pinned messages and announcements | Pin an authorised message in a group | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.8 Pinned messages and announcements | Unpin it | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.8 Pinned messages and announcements | View pinned messages | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.8 Pinned messages and announcements | Navigate to the original message | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.8 Pinned messages and announcements | Display pinned-message context | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.8 Pinned messages and announcements | Restrict group-wide pinning to permitted roles | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.8 Pinned messages and announcements | Prevent stale pins from exposing deleted or inaccessible messages | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | PDF files | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Word/Office documents | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Images | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Text files | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Teaching materials | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Other explicitly supported formats | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Upload button | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Drag and drop | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Upload progress | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | File-size validation | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Multiple attachments where supported | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Safe previews | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Authorised downloads | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Filename and file-type display | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Clear scanning status | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Retry after failed upload | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Remove attachment before sending | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.9 Attachments and uploads | Access checks after member removal | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Typing indicators | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Online/offline or last-seen status with privacy settings | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Saved messages or bookmarks | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Draft preservation | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Reply previews | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Mention autocomplete | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Search within an individual conversation | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Conversation information panels | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Keyboard shortcuts | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Message context menus | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Accessible mobile long-press alternatives | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Notification mute durations | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Group member counts | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | New member system notices | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Moderation and reporting | Not yet assessed | Pending |
| COMPLETE CHAT & MESSAGING SYSTEM / 2.10 Additional chat QoL | Blocking unwanted direct contact where compatible with operational obligations | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | Search for colleagues | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | View authorised profiles | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | Open a direct conversation | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | Copy permitted contact information | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | Start an email using the user's email client | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | Call using the device's telephone application | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | View shared courses | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | View relevant expertise | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | View availability information explicitly shared with them | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | View qualifications where authorised | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | Access appropriate CVs and attachments | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | Edit their own contact information | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | Set profile visibility preferences | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | Upload or change profile pictures | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | View their current role | Not yet assessed | Pending |
| CONTACTS, USERS AND PROFILES | Select preferred language and time zone | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | View available assignments | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Search and filter assignments | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Save filters | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Sort by date, compensation, customer, topic and duration | Partial | Existing `src/features/jobs/discovery-api.ts` provides date, rates and duration; customer/topic ordering not found. |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | View detailed job information | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | View attachments | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Claim eligible opportunities | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | See immediate confirmed results | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | View their claimed assignments | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Cancel or withdraw according to the current rules | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Request a short-notice withdrawal where required | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | View withdrawal status | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Receive cancellation confirmation | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | View the relevant course workspace | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Navigate to related calendar events | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Contact the authorised course coordinator | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | View the customer details relevant to delivery | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Create | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Edit | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Duplicate | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Publish | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Unpublish | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Archive | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Reopen | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Cancel | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Replace lecturers | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Manage capacities | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Manage deadlines | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Modify eligible future assignments | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Review pending change requests | Not yet assessed | Pending |
| JOBS, KANBAN AND ASSIGNMENT MANAGEMENT | Resolve exceptional situations | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Quick event creation | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Event editing | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Event cancellation | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Event duplication | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Calendar view switching | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Week/month/day/agenda views | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Availability blocks | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Unavailable periods | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Personal notes | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Event descriptions | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Meeting links | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Event attachments | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Event reminders | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Event search | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Event filtering | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Event colour categories | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Personal calendar preferences | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Direct navigation to associated courses | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | ICS export and subscriptions | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Time zone selection | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Offline viewing where currently supported | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Calendar conflict warnings | Not yet assessed | Pending |
| CALENDAR AND AVAILABILITY QoL | Clear explanations of why an assignment cannot be accepted | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course creation and editing | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course template selection | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course duplication | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course descriptions | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Topic/tool tags | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course resources | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Teaching links | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Customer contacts | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Assigned lecturer details | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Preparation checklist | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course Readiness Centre | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course announcements | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course-specific chat | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Participant information | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Session schedules | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Attendance | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Proof of delivery | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Completion marking | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Feedback | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course cancellation | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course rescheduling | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Replacement workflows | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course archival | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Course history | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Links to invoices and contractual records | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Open chat | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Open calendar | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | View documents | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Copy meeting link | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Contact customer | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Confirm preparation | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Report a problem | Not yet assessed | Pending |
| COURSES AND TEACHING WORKSPACES | Request a change | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Uploading | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Renaming | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Moving | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Categorising | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Tagging | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Searching | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Previewing | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Downloading | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Replacing | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Version viewing | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Archiving | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Deleting where permitted | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Linking files to courses/jobs/messages | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Viewing file details | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Documents | Viewing upload/scanning status | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Wiki | Article creation | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Wiki | Editing | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Wiki | Draft saving | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Wiki | Publication | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Wiki | Version history | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Wiki | Categories | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Wiki | Search | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Wiki | Attachments | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Wiki | Internal references | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Wiki | Code blocks | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Wiki | Permissions | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Wiki | Archiving | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Forum | Create discussion | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Forum | Edit own discussion | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Forum | Reply | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Forum | Quote | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Forum | Subscribe | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Forum | Unsubscribe | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Forum | Pin where authorised | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Forum | Lock where authorised | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Forum | Mark accepted answer | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Forum | Report inappropriate content | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Forum | Edit/delete where permitted | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Forum | Search and filter | Not yet assessed | Pending |
| DOCUMENTS, WIKI AND FORUM / Forum | View recent discussions | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Invite users | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Edit authorised roles | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Suspend/reactivate accounts | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Review qualifications | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Manage course assignments | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Review audit history | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Inspect operational alerts | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Manage organisations | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | View appropriate support tickets | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Configure permitted settings | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Perform safe bulk actions | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | Preview destructive operations before confirming | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Administration | View operation results and failure details | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | Create and edit customer records | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | Search and filter customers | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | View contacts | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | Link courses | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | View requests | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | Record authorised notes | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | View customer-specific history | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | Archive records | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Customers | Manage customer-specific permissions | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | View own contracts | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | Download permitted documents | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | Inspect versions | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | View current agreement status | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | Receive expiration reminders | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | Review applicable assignment agreements | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | Acknowledge documents where appropriate | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Contracts | Navigate to related assignments | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | View personal earnings | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | View confirmed assignments | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | View invoice status | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | Upload invoices | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | Download authorised statements | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | Track payments | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | Filter by date/customer/status | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | Export permitted information | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | Inspect approved amendments | Not yet assessed | Pending |
| ADMINISTRATION, CUSTOMERS, CONTRACTS AND FINANCE / Finance | Resolve invoice questions | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | In-app notifications | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Read/unread status | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Mark all as read | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Per-category preferences | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Muting conversations | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Quiet hours | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | New assignment notices | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Assignment confirmations | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Cancellation notices | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Group invitations | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Mention notifications | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Direct message notifications | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Course announcements | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Calendar reminders | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Qualification expiry warnings | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Contract expiry warnings | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Support ticket updates | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Change-request decisions | Not yet assessed | Pending |
| NOTIFICATIONS AND PERSONAL PREFERENCES | Optional supported PWA Push | Not yet assessed | Pending |
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
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Protect unsaved changes | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Preserve input after validation errors | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Show clear validation messages | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Disable duplicate submissions | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Display server-confirmed outcomes | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Offer safe retry actions | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Forms | Explain permission failures | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Consistent sidebar | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Consistent page titles | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Breadcrumbs where useful | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Contextual navigation | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Clear back buttons | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Searchable command palette | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Favourite locations | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Mobile navigation | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Keyboard navigation | Not yet assessed | Pending |
| UNIVERSAL APPLICATION QUALITY-OF-LIFE IMPROVEMENTS / Navigation | Accessible dialogs and context menus | Not yet assessed | Pending |
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
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | German | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | English | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Buttons | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Menus | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Dialogs | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Notifications | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Validation messages | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Error messages | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Help text | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Accessibility labels | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Languages | Timestamps and date formatting | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Themes | Light | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Themes | Dark | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Themes | System preference | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Desktop | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Tablet | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Smartphone | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Portrait and landscape layouts where relevant | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Installable PWA | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Existing manifest and service worker | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Safe offline behaviour | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Safe reconnect behaviour | Not yet assessed | Pending |
| DESIGN, INTERNATIONALISATION AND PWA REQUIREMENTS / Responsive/PWA | Secure authenticated data handling | Not yet assessed | Pending |
