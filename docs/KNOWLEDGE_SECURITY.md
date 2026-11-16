# Wiki and forum access, content and verification

Knowledge is staff-only in this slice. Course participants receive no implicit wiki/forum access. Participant course-specific knowledge ACLs and document attachments need explicit later policies rather than a broad staff bypass.

## Authoring and publishing

Active staff can draft wiki pages and participate in discussions. The distinct `wiki.manage` and `forum.moderate` capabilities require AAL2 and are assigned to management/administration. Senior lecturer status does not grant publishing/moderation or private commercial access automatically.

Wiki revisions are immutable API records. A page points to its current draft and independently to its published revision. An author's correction creates a draft without replacing the published snapshot seen by other staff. Only authorised management can publish/archive. Saves require the exact current version; concurrent stale edits fail clearly rather than overwriting work. Readers see published revision history; authors and current authorised management can see the page's unpublished history. Private drafts are protected in raw-table RLS as well as RPCs. Deep links fetch the page directly rather than depending on a limited list result.

## Safe rich text

The backend validates a closed Tiptap JSON schema: document, paragraph/text, headings 1–3, lists, blockquotes, code blocks, line breaks and horizontal rules; known text marks and safe links only. It rejects raw HTML/image/custom nodes, unexpected properties/attributes, executable/relative-protocol URLs, backslashes/control characters and unsafe link attributes. Server limits include 200,000 encoded bytes, 40,000 derived text characters, 1,500 nodes and depth 16. Code is preserved as text, including literal angle brackets. Searchable text is derived server-side, not accepted from a client HTML field. The frontend renders through its matching Tiptap schema rather than arbitrary HTML insertion.

## Forum workflow

Staff create threads/replies with server-validated content. Durable client IDs deduplicate reply retries; mismatched reuse fails. Authors edit only their own unlocked posts with an exact version. Deletes are tombstones with restricted revision audit. A deleted accepted reply clears the accepted-answer pointer. Thread owners or moderators may select only an undeleted reply in that same thread as the answer.

Only MFA-authorised moderators pin, lock/archive or restore discussions and resolve reports. Locked/archived discussions reject ordinary posting/editing. Reports are visible only to their reporter and current authorised moderators. Subscriptions and metadata-only reply notifications persist, and reply retries do not duplicate notifications. Authoring/report limits are enforced server-side. List/search returns up to 200 matches; discussions are explicitly capped at 500 posts so the current complete-thread reader does not silently omit newly accepted replies. Larger-scale pagination is a future UX improvement.

Administrative audit events contain actions, IDs, versions and moderation decisions, not private DM text. Forum deleted-post revision access follows original authorship or current moderation permission. Account suspension is checked freshly for every API/RLS operation.

## Executed verification

- `node scripts/knowledge-db-tests.mjs`: **14 real PostgreSQL checks passed** in a disposable database replaying all current migrations with compatible Auth helper stubs. Covers participant/anonymous denial, draft isolation, publishing MFA, published-versus-unpublished revision separation, concurrent version conflict, unsafe JSON/link/tree limits, category permissions, forum retries/search/subscriptions, accepted answers, moderation lock/MFA, edit/tombstone audit, report privacy/resolution, archive/restore, suspension and RLS on every exposed table.
- `node scripts/knowledge-api-check.mjs`: **passed** using actual local Auth/REST and an actually enrolled/verified manager TOTP factor. The tests verify the same author/reader/moderator boundaries, exact code content, unchanged published snapshots after draft corrections, version/XSS rejection and forum moderation/report/tombstone workflows. UUID-scoped temporary accounts and records are removed; existing development profiles/content are not reset.
- Local SQL lint passed. Advisors initially identified four unwrapped Auth expressions in knowledge RLS; these were converted to init-plan subselects. Final `supabase db advisors --type all --level warn --fail-on warn` returned no issues.

Browser rich-text/accessibility tests, hosted infrastructure, retention/legal decisions, broader participant ACLs and knowledge-specific attachment sharing are separate acceptance checks. These results do not assert full production acceptance.
