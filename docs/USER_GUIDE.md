# Luminovia Portal — local development user guide

This guide covers the currently implemented local development workflows. The complete product includes further modules listed in [PRODUCT_SPEC.md](PRODUCT_SPEC.md); a missing module is not presented as a working placeholder. Local development uses fictional test accounts and records. Start the complete local application with `./portal start`; the command prints its address and local account instructions. `./portal status` reports service state, `./portal stop` stops services while retaining application data, and `./portal test` creates an isolated test stack without using your development records. No hosted production portal or real invitations are implied.

## Sign in and account security

Open the local URL printed by the development server. Use an account created for that local Supabase environment. Public self-registration is disabled. Sign in at `/login` with the invited account's email/password. Invitation/recovery links target `/auth/callback` (with `/auth/password` also available for password setup). The invitation asks for explicit acceptance, then password setup. This full journey and recovery have been verified with fictional local accounts; production uses separately approved email configuration. Production email delivery is a separate configuration and acceptance gate.

Account invitations and recovery rely on Supabase Auth. A local captured test email is not a message sent to a real lecturer. If sign-in or account setup fails, use the visible error and contact the responsible administrator; do not reuse test credentials outside local development.

At `/security`, set up/challenge the supported authenticator MFA flow. Management operations require a database-verified second factor. A role label alone does not grant access and a screen cannot override backend denial. Sign out after using a shared device.

## Language, theme and profile

Use the language control to switch German/English without translating authored course/profile text. Choose light/dark/system appearance. These non-sensitive preferences may be stored locally.

At `/profile`, edit your permitted self-service fields, bilingual biography, display zone and expertise where available, then save and wait for confirmation. A save error means the server has not confirmed the change. Verification, roles and contract status are controlled separately by authorised management; selecting expertise is not the same as a verified qualification.

## Find and claim teaching jobs

Use `/jobs` to browse published opportunities and combine the implemented filters. Open `/jobs/<id>` for the complete sessions, intended time zone, currency, rate unit, compensation and terms. Read every session and the applicable accepted terms before claiming the whole job.

Choose the claim action while online. The first eligible committed transaction wins; there is no routine administrator approval queue. Success appears only after the database confirms. A filled/conflict/eligibility/prerequisite/stale-terms error means there is no confirmed new allocation. Retry-safe requests prevent duplicate assignments. Do not assume a card movement or a temporarily displayed job proves acceptance.

After confirmation, the full block appears in your assigned calendar. The accepted compensation/currency/terms are preserved independently of later offer edits. The current allocation workflow supports one lecturer slot per job. Cancellation, replacement and reopened work must use an audited workflow when implemented; contact management rather than treating a UI edit as cancellation.

## Calendar

At `/calendar`, view your own events and confirmed assignments using the available views and explicit display time zone. Store a private appointment with precise start/end times; another lecturer or an ordinary administrator must not see it. A private appointment does not automatically become a company event. Claims check conflicts against the actual session instants.

Berlin and Brisbane can have different date/offset boundaries. Check the visible time zone when booking. An ambiguous or nonexistent Berlin daylight-saving local time must be resolved explicitly rather than guessed. Calendar display does not silently alter the original job's intended zone.

## Management job creation

Authorised management uses `/admin` after MFA verification. Create the supported customer/course/run/session/job block through the validated workflow, specify all sessions and their zone, compensation/currency/unit, terms and eligibility requirements, then publish as supported. Wait for the actual server result. Lecturer accounts cannot gain publishing privileges by changing a route, role text or browser request.

Use fictional customers, identities and commercial documents in local development. The implemented collaboration, document and commercial workflows are described below; the complete production scope remains in the persistent implementation plan.

## Management: people, expertise and access

At `/admin/people`, authorised management with verified MFA can search people and open a profile. The page shows the person's own declared expertise. Review the qualification evidence before choosing **Expertise verifizieren / Verify expertise**. An optional expiry is entered explicitly in **UTC**; leave it empty for a qualification without expiry. An expired verification does not meet a restricted job's eligibility. You can save a new expiry or revoke the verification. Lecturers can upload permitted qualification evidence at `/profile`; authorised reviewers can retrieve the protected evidence from the person’s management record. Uploading a file does not automatically verify a qualification; verification records a separate management attestation.

Choose **Zugang sperren / Suspend access** or **Zugang aktivieren / Activate access** for another person, review the named confirmation and submit it. Wait for server confirmation. Cancellation leaves the current account status unchanged. Your own account cannot be suspended here; the server also protects the last active administrator. Suspension denies protected data and claims, preserving assignments/history and existing roles for authorised follow-up. Full session revocation is an additional administrative operation.

## Chats and course channels

At `/chats`, choose a person from **Kontakte / Contacts** to start a direct conversation, or open one of your existing rooms. An eligible lecturer can join the general lecturer room. Staff can create topic groups; authorised management can create a separate participant-facing course channel for an actual linked course. Commercial lecturer discussions and participant channels have separate membership.

Write the message and choose **Nachricht senden / Send message** while connected. A failed request leaves the draft available to retry. A message is shown as sent only after server confirmation. Search the room’s text, load earlier messages, mark it read or mute it through the available controls. Reactions use the displayed emoji choices. Your own messages can be edited within the server’s 15-minute window; deletion asks for confirmation and leaves a tombstone. Safe web links open as links; pasted HTML remains text.

Attach a supported file from the composer and wait for its security check before sending. A progress indicator is not scan approval. The group owner or an authorised course manager can add/remove permitted members. Removal closes the removed member’s active room view and removes access to later messages and protected files. Administrator status does not automatically grant private DM or group membership. Typing indicators, presence and mentions are not yet implemented.

## Files and qualification evidence

At `/files`, search your authorised documents. Choose **Datei hochladen / Upload file**, select or drop one file, and wait until upload and scanning finish. The current allowlist is PDF, PNG/JPEG/WebP, plain text and modern Office documents (`.docx`, `.xlsx`, `.pptx`), up to 10 MiB. Archives and large video uploads are not available. Unsupported, infected or unscanned files are unavailable for download; a scanner outage leaves the upload unapproved.

Use a document’s actions to download it, inspect its versions, rename it, add a new version or archive it where permitted. Image/PDF preview requires a fresh authorised download. Previous clean versions retain their own bytes and hash. Archive confirmation removes normal availability while retaining history; documents linked to retained contract/invoice snapshots have extra server retention protection. Shared storage paths do not confer access, and private files are not deliberately cached offline.

Management can attach job resources classified **Vor der Übernahme sichtbar / Visible before claiming** or **Nach der Übernahme sichtbar / Visible after claiming**. The latter requires a confirmed allocation or explicit management permission. Room files inherit active membership. At `/profile`, upload evidence through the qualification section; it stays private to the owner and authorised verification workflow.

## Wiki and forum

At `/wiki`, search by text, category and authored language. **Artikel schreiben / Write article** opens the rich text editor for eligible staff. Use paragraphs/headings/lists, safe links and labelled code blocks. Selecting a code language adds syntax highlighting without executing the code. In desktop code blocks, **Enter** inserts a new code line; **Shift+Enter** exits the code block. Automated Android-emulated Chromium checks use a profile-specific Shift+Enter input path to create their code newline because no native virtual keyboard runs in emulation. Native Android virtual-keyboard Enter behavior still requires manual acceptance on a physical device; browser emulation does not establish that behavior. A page’s German or English authored text is retained when you change interface language.

Save your draft to preserve it. Publishing and archiving require the corresponding management permission and MFA. An author’s changes to an already published page are saved as a newer draft until an authorised publisher publishes them; other readers continue seeing the previous published snapshot. The history shows permitted revisions and their editors. If another editor has saved since you opened the form, a version conflict requires reviewing the latest record rather than overwriting it silently.

At `/forum`, open a category and create a discussion or reply. The thread owner or moderator can choose an accepted answer. Subscribe to receive the supported in-app reply notification; unsubscribe to stop it. Report a post with a reason for moderator review. Authorised management can pin, lock/archive and resolve reports. A locked or archived thread blocks ordinary replies/edits; permitted moderation retains an auditable history. Deleted posts become tombstones. Knowledge access is staff-only in this slice; course participants do not automatically receive it. Wiki/forum file attachments and course-template links remain pending dedicated permission-aware integration.

## Contracts and receipt acknowledgements

At `/contracts`, lecturers see their own registered executed agreements and addenda. Each real PDF record identifies its version, effective/expiry instants and SHA-256. Download the precise registered version before acknowledging receipt. An older metadata-only record has no download or acknowledgement action until a genuine checked PDF version is registered.

Tick **Ich habe diese Vertragsfassung erhalten und zur Kenntnis genommen / I have received and read this contract version**, then choose **Empfang bestätigen / Acknowledge receipt**. The server stores receipt against the exact version/hash and timestamp. This action is **not an electronic signature** or a claim of legal signature sufficiency. Use an already executed agreement and the approved external signing/legal process when required.

Authorised management with MFA can **Ausgeführten Vertrag hinterlegen / Register executed contract**: choose the lecturer, master/addendum type, parent agreement for an addendum, title and explicit-zone effective/expiry times. Upload the fictional executed PDF in local development, wait for clean scan confirmation, then save. Each registration creates an immutable version; changing the displayed status does not rewrite accepted assignment terms. New claims use the applicable valid contract version; a revoked/expired replacement cannot silently fall back to an older agreement. Automated renewal reminders and an external signing-provider integration remain pending.

## Earnings, invoices and recorded payments

At `/finance`, review accepted compensation by **Erwartet / Expected**, **Abgeschlossen / Completed**, **In Rechnung gestellt / Invoiced** and **Bezahlt / Paid**. EUR and AUD remain separate original-currency totals. Amounts represent the accepted assignment compensation; the portal does not calculate tax or convert currencies.

To submit an invoice, choose **Rechnung einreichen / Submit invoice**, enter its number, issue date and due date, select up to 50 own eligible assignments in one currency, then upload its PDF. Selecting a currency disables assignments in the other currency. The due date cannot precede the issue date. Wait for the PDF scan, then submit and wait for server confirmation. The server derives the total from the accepted assignments and prevents active double invoicing; it does not parse the PDF’s tax/grand total. A rejected/cancelled invoice releases its claims for another permitted submission.

Finance management with MFA can show all authorised lecturer records, download the exact invoice version, review it and record an approval/rejection/cancellation note. **Zahlung eintragen / Record payment** documents a payment already made; it does not initiate a bank transfer. Enter the original-currency amount, explicit-zone timestamp and reference. A partial payment leaves the invoice approved; the final payment marks it paid. Overpayment is rejected. **Zahlungsverlauf / Payment history** retains each entry; an authorised **Zahlungseintrag stornieren / Void payment record** corrects an erroneous entry with a reason and recalculates the outstanding balance without deleting its history or moving money.

Download the authorised earnings/invoice CSV from the current scope. Exports preserve original currency and neutralize spreadsheet formula prefixes in authored text. Broader accounting reports/statements and tax/payroll/banking integration are outside the current workflow.

## Search and remaining scope

The shell’s **Im Portal suchen / Search the portal** searches the supported authorised files, knowledge, messages and contact resources. Results remain scoped by the current database permissions; a search result or copied record identifier cannot grant access to a protected resource.

The complete target is larger than these implemented workflows. Remaining work includes multi-slot job capacity, cancellation/reopening/substitutes, complete availability/global-calendar publishing/reminders, richer saved job views, taxonomy administration, notification preferences/quiet hours and email delivery, knowledge attachment ACLs, file expiry/retention administration, legal/configurable documents, broader audit/administrative recovery, native PWA/platform checks and monitored hosted deployment/restore acceptance. Refer to `IMPLEMENTATION_PLAN.md` and `WORKLOG.md` for the current tested, untested and pending status. A local browser check does not constitute production or legal acceptance.

## Local verification checkpoint

The complete local command passed 42 source unit/component tests, 7 runtime safety tests, 11 Edge tests, 78 PostgreSQL checks, real API/scanner/persistence workflows, 40 desktop/mobile browser journeys and 2 built-PWA checks. A subsequent visual correction replaced the private file pickers' hidden-input styling; all 6 affected chat/commercial desktop/mobile journeys then passed in a separate fresh isolated stack. These include the actual attachment button/file chooser, security scanning, sending and a recipient download compared byte-for-byte, plus a no-horizontal-overflow assertion on populated chats. The main work log records the exact source and full CI result. These local results do not establish native Android keyboard/PWA installation, hosted production or legal acceptance.

## Offline and support

The PWA shell may be available without a connection, but private data and sensitive files are not deliberately cached for offline use. Claims and other writes need an online server response. Reconnect and reload/refetch when appropriate; never treat offline submission as a confirmed booking. Save unsaved form content before accepting an app update when prompted.

Report the visible error, affected route, approximate local time/time zone and safe reproduction steps. Do not share passwords, access tokens, signed file URLs or private document/message contents in screenshots or support reports. Full supported-platform installation and production operating guidance will be added after actual acceptance testing.
