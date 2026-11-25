# Latest workspace controls

Administration starts with course, assignment, account and customer entry points. Open a course run to associate its organisation and publish its assignment, or use the standalone assignment action. The assignment detail offers manual complete-block allocation to an eligible lecturer; all results require database confirmation. The administrative assignment board remains available under **Manage assignments**.

In account administration, **Create user account** creates a password login with the selected role. Company accounts require an organisation; converting an existing lecturer to a company account assigns that organisation with the role change. Guest accounts see only their own profile, settings and static help. Administration can set distinct regular/senior lecturer percentage defaults and optional per-person percentage or daily-rate overrides. An uncustomized profile inherits the matching offer
role percentage; the individual EUR 200/day fallback is not a universal lecturer percentage. New offers capture the applicable role/override snapshot, and confirmed historical compensation remains unchanged. Legacy offers without a private gross amount retain their original net fee.

For a commissioned assignment, enter a course-specific **Plattformanteil / Platform share** when creating or editing the offer. The preview shows what the lecturer will see and the platform's share of the confirmed budget per position. A course-specific percentage takes precedence over individual lecturer rates for that offer. Accepted assignments keep their confirmed terms.

In **Verwaltung → Unternehmen / Administration → Companies**, an active admin can turn on Premium LMS when creating a company. For an existing company, use the Premium switch in its detail view and confirm the change. Switching Premium off retains the existing learning records.

In **Verwaltung → White Label / Administration → White Label**, select the company and save its account email, brand, domain and licence parameters. The settings are restored when you reopen the company. A verified portal address links directly to the customer administration. Follow [Dedicated Academy installation](../deploy/academy/README.md) to review and sign the handoff and bootstrap the initial administrator on the customer's own system.

On an already active customer installation, open **Verwaltung → Kundeninstallation → White-Label-Einrichtung öffnen / Administration → Customer installation → Open White Label setup**. Edit the academy name, short name, accent colour and public links, then choose **Einstellungen übernehmen / Apply settings**. The active installation uses the saved settings directly. Logos and app icons remain available in the same dialog. The current address and connection protocol are shown in the form. The operator configures the actual domain, TLS and data location at the hosting layer.

Knowledge & Help includes Support. The header bell shows recent activity by category, including real invoice/payment updates; the full inbox lets you load more history. The category filter applies to the recent/loaded items indicated on screen.

Calendar **Import ICS file** opens a review before saving private appointments. Choose a recurrence window, select the file and confirm the preview. Reimporting the same UID/start identities skips duplicates. Recurrences become individual appointments; there is no continuing subscription. Floating dates use your chosen calendar time zone; IANA and UTC zones are supported, unknown zones require re-export. An invalid batch or confirmed-assignment conflict rejects the batch atomically. After a lost
connection, retry safely to distinguish existing imports from new ones.

# Guide

## Current calendar, job discovery and deletion behaviour

The latest user direction supersedes older verification/subscription instructions retained later in this consolidated guide.

- **Kalenderfunktionen / Calendar tools** groups calendar subscriptions, ICS import/export and the offline schedule in a disclosure that is collapsed initially. Calendar subscriptions remain independently operable in their nested disclosure; calendar content and its date/view controls remain visible. Customer-created course/assignment events use a light background; each account can privately select light colors for its own appointments, assignments and customer events. Customer and topic filters
  use only currently authorised course/confirmed-assignment metadata. Multiple selected topic tags match any selected topic; customer, title and event-type filters combine for events overlapping the visible period. Choose another period to find older or later appointments. Existing date instants and IANA display zones are preserved.
- Job discovery keeps optional filters and saved-view controls in one collapsed disclosure instead of a separate saved-views block. Subject checkboxes match any selected subject (OR); customer, dates, delivery and price filters still combine. Historical, delivered, expired and archived offers stay hidden unless history is explicitly enabled, and the default open list is ordered by next session start. Open a job by clicking anywhere on its card; the arrow is decorative. Filter validation errors
  reveal their controls. Assignment-management actions are separated from capacity/status information.
- A lecturer's self-declared required topics are sufficient for matching and job acceptance. Additional management verification or attestation expiry is not an eligibility gate. Current access, declared-topic matching, contract prerequisites, capacity, full-block allocation and overlap checks still apply.
- An organisation's Edit dialog offers the existing confirmed permanent-deletion action. Its preview expands directly owned course/job/session/commercial/document dependencies; reusable templates, unrelated organisations and other people's shared roots are not silently deleted.
- Lecturer deletion removes owned personal records, contracts/documents and assignment reservations in the reviewed scope. Shared jobs survive, their capacity/status is recalculated and available places reopen. Remaining members retain their shared course room; ownership transfers where appropriate. The same current-authority, fingerprinted scope, explicit impact acknowledgement and resumable exact-file cleanup protect these cascades.
- If a dependency also belongs to an unrelated root outside the reviewed scope, the dialog continues to identify that shared dependency explicitly. A stale impact plan must be refreshed before confirmation. Merely applying the software migration deletes no business records.

Consolidated reference. Source and tests remain authoritative for current behavior.

**Current authentication:** accounts use passwords. Protected actions check the active account, current database role, resource scope and RLS. MFA-specific passages in the dated implementation history below describe older revisions and are not current instructions. Hosted installation must be verified separately from source behavior.

<a id="section-user-guide"></a>

<a id="section-user-guide-luminovia-portal--user-guide"></a>

# Luminovia Portal — user guide

<a id="section-user-guide-new-operational-workflows"></a>

## New operational workflows

At `/enquiries`, authorised organisation management can review private training requests, assign responsibility, link or create the configured customer and convert reviewed dates into a course run. Requests are preferences until management confirms a plan; no commercial quote is invented. The trusted-server endpoint is disabled by default and the public marketing site is unchanged. See [website enquiries](GUIDE.md#section-website-enquiries) for configuration and remaining activation
requirements.

Open **Kursbereitschaft / Course readiness** from an assigned job or course workspace. The progress ring shows how many applicable checks are complete. Urgent teaching cover appears at the top of the normal assignment list. Old replacement links open that list. Support lives in Knowledge & Help. See [course readiness](GUIDE.md#section-course-readiness), [urgent teaching cover](GUIDE.md#section-replacement-marketplace) and [support](GUIDE.md#section-support-desk).

This guide describes current source and dated feature history, including course workspaces, request briefs, personal teaching context, finance facts, waitlists, urgent teaching cover, calendar connections, Push settings and own qualification-passport export. Participant-only accounts use their own course list, notifications and account settings. Company membership and an active Premium entitlement govern enrolment and learning access. Your current role and resource access determine which controls appear. Source availability does not prove that an installed hosted release includes each
feature or that native/device/hosting acceptance has passed.

Local development uses fictional accounts and records. `./portal start` prints the local address/account instructions; `./portal status` reports service state and `./portal stop` retains application data. `./portal test` creates an isolated complete test stack without using development records. `./portal github` and `./portal github test` operate the separate latest-main preview described in [GITHUB_LOCAL_PREVIEW](../CONTRIBUTING.md). A fixture result or captured local
mail is not a real invitation, external delivery, live timer or production approval. The full master scope remains recorded in [PRODUCT_SPEC](PRODUCT.md#section-product-spec), [SMART_OPERATIONS_SPEC](PRODUCT.md#section-smart-operations-spec) and the persistent plan.

In the internal portal, use **Konten → Rollen bearbeiten / Accounts → Edit roles** to grant several roles to one account. Select the organisation when you add the company role. Use the course workspace to enrol a participant or assign a lecturer. In either dedicated academy, open **Akademie verwalten / Academy administration** to grant the local roles and company scope.

On desktop, use the navigation control to expand or collapse the workspace rail; this visual preference is stored in the current browser. Search, notifications and sign-out are available from the rail; language and theme controls remain in the top bar. On mobile, the More menu contains all currently permitted destinations and search, while preferences and sign-out remain in the top bar.

Use `./portal check` for fast local source/coverage/build validation and `./portal test` for complete isolated acceptance. [PR preview packages](../CONTRIBUTING.md) are downloadable local runtimes after the required checks; they are not continuously hosted public PR instances.

<a id="section-user-guide-tour-and-help"></a>

## Portal tour and help

At sign-in choose **Hilfe & Anleitungen / Help & guides** for searchable bilingual instructions and troubleshooting. Signed-in users can launch **Portal-Rundgang / Portal tour**. [Usage and verification](GUIDE.md#section-tour-and-help).

Unknown URLs and unavailable administration or forum pages show the same **Seite nicht gefunden / Page not found** screen. It does not reveal whether the requested page exists or why it is unavailable. It keeps the address and offers links to the overview and public troubleshooting help. Temporary service errors retain their separate retry state.

In a long form dialog, scroll the fields below the heading. The heading and close button stay visible. During saves that disable the close button, the dialog stays open until the request returns.

<a id="section-user-guide-sign-in-and-account-security"></a>

## Sign in and account security

Open the local URL printed by the development server. Use an account created for that local Supabase environment. Public self-registration is disabled. Sign in at `/login` with the account’s verified email and password. Enter the account email in the recovery form and open the recovery link in the same browser. Existing passwords are not rewritten or constrained by the new-password minimum. Invitation/recovery links target `/auth/callback` (with `/auth/password` also available for password setup). The invitation asks for explicit acceptance, then password setup. New passwords need at least
eight characters, including uppercase and lowercase letters, a number and a symbol, matching the configured Supabase Auth policy. The isolated acceptance case covers native recovery email delivery and exchange of the returned code. Hosted email delivery is a separate gate.

Creating a login account with a temporary password requests a one-time setup email through the installation’s configured SMTP sender. The message contains the portal address and the sign-in email. If mail cannot be requested, the created account remains available and can use password recovery. Editing an existing profile leaves its access unchanged.

The same account can stay signed in on multiple devices. Signing out ends the current browser session only. Account invitations and recovery rely on Supabase Auth. A local captured test email is not a message sent to a real lecturer. If sign-in or account setup fails, use the visible error and contact the responsible administrator; do not reuse test credentials outside local development.

Account security uses password and recovery controls. Management operations require current database permissions and resource scope. A role label alone does not grant access and a screen cannot override backend denial. Sign out after using a shared device. If the portal reports a sign-out failure, the current session remains open so you can retry before leaving the device.

### Mail transport administration

Accounts with the `mail.settings.manage` capability can configure SMTP and optional IMAP under Administration > Mail transport. SMTP serves Auth messages and the notification worker through the private relay; choose a public DNS hostname, a supported port/TLS pair, and a sender address accepted by the provider. The server validates DNS destinations and TLS, stores credentials encrypted, and never returns usernames or passwords to the form after saving. Leave both credential fields blank to
retain the encrypted values; replace username and password together to rotate them.

Use **Send me a test email** to send a message through the saved SMTP transport to your confirmed portal account address. Check the inbox and spam folder after the provider accepts the message. The SMTP and IMAP connection checks only test TLS, authentication and `NOOP`. SMTP and IMAP settings are audited and versioned; a stale save must be reloaded. Local Auth messages and isolated candidate emails remain in Mailpit. The Admin connection test is unavailable when the private relay is not running, and no real-recipient delivery or production activation is implied by a successful check.

<a id="section-user-guide-language-theme-and-profile"></a>

## Language, theme and profile

Use the language control to switch German/English without translating authored course/profile text. Choose light/dark/system appearance. These non-sensitive preferences may be stored locally.

At `/profile`, edit your permitted self-service fields, bilingual biography, display zone and declared expertise, then save and wait for confirmation. The separate **Öffentliche Profilangaben / Public profile details** form records country, spoken languages, teaching experience and your own comma-separated labels. These details are visible only to authorised portal members. A save error means the server has not confirmed the change. Labels describe you; they do not grant roles, verify
qualifications or set commercial prices. Expertise verification, account roles and contract status are controlled separately by authorised management.

An active lecturer can explicitly choose **Qualifikationspass als PDF herunterladen / Download qualification passport as PDF** on their own profile and select German or English. The protected PDF separates selected expertise, recorded verification/expiry, current shared-certificate availability and known attestation history. Self-declared profile fields stay labelled as such. Unknown historical provenance is not invented. The PDF contains no certificate files, contacts, CV, contracts or fees and
is not a new verification, public profile link or legal signature. You decide whether to share the downloaded copy. Offline/unavailable access or unsupported font characters produce an error; no silent character substitution or background export is performed. See [Qualification passport](GUIDE.md#section-qualification-passport).

<a id="section-user-guide-individual-accounts-roles-and-organisation-access"></a>

## Individual accounts, roles and organisation access

Each person has an individual account, created directly by authorised administration or by invitation, and chooses their own password. The available roles are **Inhaberin / Plattformleitung / Owner**, **Administration**, **Management**, **Senior-Dozent:in / Senior lecturer**, **Dozent:in / Lecturer**, **Unternehmen / Company**, **Kursteilnehmer:in / Course participant** and **Gast / Guest**. An account may hold several roles. Company workflows require an organisation association. Participant workflows require enrolment in the relevant course. An explicit teaching role is required to personally accept an offer or submit a lecturer’s own invoice. The server checks permissions for protected operations, private chat membership and personal calendar ownership.

Signed-in portal workspaces follow the permissions of the current account. **Verwaltung / Administration** has three subpages. **Unternehmen & Personen / Companies & people** links to companies, the lecturer directory, and user accounts. Open a lecturer profile and select **Qualifikationen und Nachweise / Qualifications and evidence** to add expertise, upload that lecturer's CV and attach qualification evidence. The delegated action requires `users.manage`, `qualifications.verify` and current MFA; files use the existing private upload and scan flow. A document upload does not verify a topic. **Kursbetrieb / Course operations** groups courses and assignments, the Control Center, topics and tools, assignment changes and contracts. **Plattformbetrieb / Platform operations** groups announcements, the audit trail and platform settings. The navigation shows only the sections available with the signed-in account’s permissions. Existing direct links to assignment changes and contracts still work, including each lecturer’s own workflow. Use the profile menu for **Persönliche Einstellungen / Personal settings**, including language, appearance and notifications. Open conversations and the forum from **Chat**.

Under **Kurse / Courses**, switch between **Durchführungen / Runs** and **Vorlagen / Templates**. Search is always available. Open **Filter / Filters** for the period, company, lecturer or planning status where permitted. **Kurswerkzeuge / Course tools** contains imports, series planning and materials. On a course card, open **Weitere Aktionen / More actions** to find secondary actions such as copying, archiving and deletion.

On your first dashboard visit, **Willkommen bei Luminovia / Welcome to Luminovia** introduces permitted areas step by step. Use Next/Back, open an area, pause and resume, or skip. Progress is private to your account and saved only after online server confirmation. Open `/welcome` to restart or continue later. The guide introduces functions; it does not assign roles or upload files. Its server-confirmed progress is separate from the Portal tour's tab-session progress. See
the [welcome guide](GUIDE.md#section-welcome-guide).

In **Verwaltung → Konten & Zugänge / Administration → Accounts & access**, use **Profil bearbeiten / Edit profile** to change the display name, language and time zone of a subordinate account. For a lecturer, **Verträge verwalten / Manage contracts** opens that lecturer's contract records and preselects them on registration. **Expertise und Qualifikationen verwalten / Manage expertise and qualifications** lets staff assign topics and review or revoke qualification verification. The lecturer's **Qualifikationen und Nachweise / Qualifications and evidence** action also opens the delegated CV and scanned-evidence controls when the required permissions and MFA are current. To remove a verified topic, revoke verification first. In **Unternehmen / Companies**, staff can edit the organisation and its contacts.

In the internal Premium LMS, open a participant from your company's **Teilnehmende / Participants** list to assign them to courses, view course activity and edit the company reference. **Profil bearbeiten / Edit profile** changes the participant's display name, language and time zone. A company can edit these fields when the account has only the participant role and is associated only with that company. Authorised staff manage shared account profiles. Credentials and recovery use the usual account security controls.

Authorised administrators open `/admin/accounts` (**Konten & Zugänge / Accounts & access**) to search accounts, create a password account without email or invite a person, and edit roles through a named confirmation. An invitation is reported as sent only after server confirmation; direct account creation sends no invitation. If creation reports that the same request is still being finalized, wait briefly and retry the unchanged form; the client reuses its request identity to avoid creating a duplicate account. An administrator with the required gross-finance permission can choose a company account's existing organisation and save **Organisation zuordnen / Assign organisation**.
**Organisationszugriff entziehen / Revoke organisation access** removes that association. A company role without an active association does not grant organisation-wide access.

Open **Meine Rollen / My roles** on your own account card as an internal administrator to combine Administration, Management, Lecturer, Course participant and Company. Select an active company when adding Company. Removing Administration relinquishes its permissions immediately and requires another active administrator or owner. Active teaching assignments protect your last teaching role. Management can assign company, participant and lecturer roles to subordinate accounts and attach the selected company together with the role. A participant role enables learner access; course enrolments remain separate.

<a id="section-user-guide-permanent-deletion"></a>

## Permanent deletion

Open **Endgültig löschen / Delete permanently** from the permitted account, job, course or organisation detail with current required permissions. Archiving remains a separate action. A company account's own-job list contains only jobs linked consistently to its current organisations; names, old lecturer assignments or former membership do not grant access.

For an unpublished internal course draft with unused dates and no linked assignment or teaching records, the preview includes the dates. Review the total scope, then confirm to remove the draft and dates together. Open **Zu den Kursterminen / Go to course sessions** when the dates block deletion. If an assignment owns the schedule, follow its link in the preview. A blocked template also links to the visible runs using it.

Under **Unternehmen / Companies**, open a company and choose **Löschen / Delete** beside an individual contact under **Ansprechpersonen / Contacts**. Company managers can confirm removal when the contact is unused. If it serves as a course contact or the company's default teaching offer contact, update that setting before deleting the record.

Review the server-provided target, affected record counts and protected dependencies. If deletion is permitted, acknowledge the irreversible impact, enter `DELETE`, and confirm. There is no trash, restore or undo. A blocked preview removes nothing. Accepted/invoiced/shared dependencies can require separate resolution; administrator status does not reveal private message bodies, calendars or personal contracts.

Wait for **Die endgültige Löschung wurde vollständig bestätigt / Permanent deletion has been fully confirmed**. Pending cleanup is not success: it can be waiting for a running upload or unavailable Auth/Storage. Use **Vorgang erneut prüfen / fortsetzen / Check / resume operation**. Incomplete operations remain reachable after navigation/reload under current server permissions. A changed or expired preview requires a new unchecked review. Do not confuse suspension/archive with physical
account/file deletion. Previously downloaded copies and backup retention are outside this live application action.

<a id="section-user-guide-people-course-history-and-participant-reviews"></a>

## People, course history and participant reviews

At `/people`, search the permitted directory by name/text, declared label or topic. Open `/people/<id>` for the member's allowed biography, experience, languages, topics and upcoming/current/past teaching history. A verified topic is distinguished from a self-declared one. Private phone/email, contracts and financial terms are not part of these directory cards. **Nachricht schreiben / Message** opens the permitted direct-message workflow. Course links open `/courses?run=<id>` only when the
current person may view that run.

Participants open their enrolled courses from the learning area and see their own course reviews under **Kursbewertungen / Course reviews**. A company with Premium can invite a participant or request that an existing participant link their account. The company can enrol the participant in an eligible course after the required association is active.

<a id="section-user-guide-personal-dashboard"></a>

## Personal dashboard

**Direkt weiter / Quick links** sits immediately below the dashboard metrics. Use **Dashboard anpassen / Customize dashboard** to show/hide and reorder preview cards, then save online. Choices belong to your current account and persist across devices. A concurrent change requires loading the latest saved layout. Hiding a card changes presentation, not resource permissions. The contract preview shows up to three current receipts still awaiting your acknowledgement. The expertise tile counts your complete topic selection.

**Mein Unterrichtstag / My teaching day** lists your own current confirmed, unreleased sessions overlapping today in your saved profile zone. It offers the safe teaching link or venue, the deliberately selected course customer contact and safe email/phone actions. No first directory contact or private profile data is substituted when no contact has been selected.

For a linked active course, the same card shows shared preparation done/total, up to ten permitted exact agreed file versions and a link to the full course workspace. Additional resources are counted explicitly. Original assignment-file previews remain separate and link to the job when more files are available. Course links/downloads check current access again; a later private replacement file does not silently replace an agreed version. Cancellation, transfer, lecturer-role withdrawal or
archival removes unavailable shared context on refresh.

The materials/link/contact checkbox list below is **your private preparation**, saved against the accepted assignment only after server confirmation. It does not complete a shared customer checklist or certify operational readiness. A zero-item shared checklist is shown as absent, not as 100% ready. Refresh after a date/zone or assignment change. See [Personal dashboard](GUIDE.md#section-personal-dashboard).

The dashboard also offers permitted job suggestions, up to five upcoming own calendar entries, unread chat/notification summaries, up to five recent clean files and own outstanding contract receipts. Management follow-ups identify draft offers, expired deadlines and soon-starting unfilled blocks. Job totals come from authorised server counts, not the two-card suggestion preview. Client-only and participant-only accounts receive suitable client/course links rather than lecturer contract/job
lists.

Open a card's link for the full workflow. Use the calendar preview's refresh control to check current dates. These bounded previews do not reserve a job, download files in the background or grant access to another person's private calendar, contract or messages. A failed optional preview offers its own retry. Financial cards keep their separate role boundaries. See [Dashboard](GUIDE.md#section-dashboard).

<a id="section-user-guide-find-and-claim-teaching-jobs"></a>

## Find and claim teaching jobs

Use `/jobs` for authorized teaching opportunities. Combine literal search/customer text, all selected topics/tools/languages, delivery/status, session date range with an explicit IANA zone, total/rate/duration bounds and sorting. Choose **Filter anwenden / Apply filters**; typing alone starts no search. Money bounds/sorting require one original currency; rate comparisons also require one fee unit. Calendar-fit filtering checks your own appointments/assignments/unavailable windows and reserves
nothing. **Weitere Aufträge laden / Load more offers** loads one more server page; the displayed count is the loaded result count, not an assumed whole catalogue.

**Angewendete Filter speichern / Save applied filters** stores the current applied search under your own name, at most 20 per account. Choose, rename or remove your private views across sessions; another account or ordinary administrator cannot open them. A version conflict requires loading/reviewing the current view. Copy the search URL for a deep link. Network failure preserves a draft; an authoritative permission denial hides private view content. Open `/jobs/<id>` for exact sessions, zone,
original currency, rate unit, compensation per position, requirements and current terms, independently of list paging. See [Job discovery](GUIDE.md#section-job-discovery).

Choose **Auftrag übernehmen / Claim assignment** while online after reviewing every session and accepting the displayed terms. The first eligible committed transaction for each available position wins; there is no routine administrator approval queue. Success appears only after the database confirms every session together. Filled/conflict/eligibility/prerequisite/stale-terms errors mean no new allocation was confirmed. A card movement or an availability hint does not establish acceptance.
Retry-safe requests prevent duplicate assignments.

After confirmation, the full block appears in your assigned calendar. Your accepted compensation, currency, terms, applicable contract reference and session instants remain preserved. One person can hold one active position in a job. New explicitly priced standalone administrative offers may contain up to 20 lecturer positions; existing offers, client-originated offers and course-linked offers keep one position and their original price meaning.

To cancel your own future, uninvoiced complete assignment, open **Zuweisung stornieren / Cancel assignment**, enter a reason of 5–1000 characters and confirm. Wait for the server result. Started work or any invoice history requires separate management/financial review. A cancellation releases future calendar intervals and course-chat membership, retains accepted history, and moves the remaining vacancy to draft. Other confirmed lecturers remain confirmed. This records no payment or refund.

Management can explicitly reopen remaining future positions with a reason and an open deadline. An eligible replacement must then claim the complete block online. The same lecturer may submit a new claim after reopening; an old retry key still refers to its original cancelled history. Replacement is this audited workflow, not automatic substitute selection. See [Job lifecycle and capacity](GUIDE.md#section-job-lifecycle).

<a id="section-user-guide-waitlists-and-explicit-substitutes"></a>

## Waitlists and urgent teaching cover

On an eligible full or closed offer, join or leave your own waitlist and review your entries from `/jobs`. A reopening/availability notice expresses an opportunity to make the normal current online claim; joining never reserves a place or gives priority over another valid complete claim.

For an assigned teaching day affected by illness, report the day directly in the assignment. Other lecturers find [urgent teaching cover](GUIDE.md#section-replacement-marketplace) in the regular assignment list.

<a id="section-user-guide-calendar-and-availability"></a>

## Calendar and availability

Open **Kalenderdatei exportieren / Export calendar file**, select a month and download an ICS snapshot of your current confirmed teaching sessions. Private appointments are excluded until you explicitly choose to include them. Importing the file shares its titles/times with your selected calendar provider. Later changes/cancellations do not update an imported snapshot. Export reads the current server, requires a connection and fails explicitly above500events.
See [Calendar export](GUIDE.md#section-calendar-export).

At `/calendar`, choose month, week, day or agenda, navigate dates, and check the profile display time zone. Your private view contains your own editable events and confirmed assignments. Open a private event to edit/remove it, or use **Termin hinzufügen / Add event** to record precise start/end instants. Private appointments stay private and block overlapping new claims. A global calendar view contains explicitly published course sessions and global events, never other people's private
appointments. Published courses link to their authorised course details. Open a published global event for its plain text description, original event zone and optional HTTPS link. **Weitere Termine laden / Load more events** adds another server page for the visible calendar window (maximum 93 days). Loaded event counts exclude the separately displayed published course sessions. Private-event/assignment and course queries retain their own existing limits.

To add a private series, enter the first appointment and its time zone. Choose **Wiederholung / Repeat** and set a daily, weekly, monthly or yearly interval. Select weekdays for a weekly schedule or a calendar day or weekday position for a monthly schedule. End the series after a number of appointments or on an inclusive last date. Preview the dates, review them and then save them together. A series can contain up to 52 appointments. Individual appointments can be edited or deleted later. Use **Künftige Serientermine löschen / Delete future appointments in this series** to remove future appointments while retaining past and already started ones. The schedule uses local wall time. If any generated time is ambiguous or missing because of a clock change, adjust the rule before saving.

With current `courses.manage`, **Globale Termine verwalten / Manage global events** opens the visible-window management list. **Globalen Termin erstellen / Create global event** records title, description, start/end, IANA zone and optional HTTPS link. **Als Entwurf speichern / Save as draft** does not publish; editing a published event withdraws its publication. Review the saved draft and explicitly **Veröffentlichen / Publish**. You can unpublish, archive or **Als Entwurf wiederherstellen /
Recover as draft**; recovery never publishes automatically. If an event is moved outside the displayed period, navigate to its new period. Search is literal and pages load explicitly. Concurrent edits preserve your draft; review/reload before another attempt. A lost-response retry uses the same operation identity. Private calendars remain private; this management screen grants no appointment access. See [event invitations](GUIDE.md#section-calendar-invitations) for recipient management and replies.

The `/availability` address now redirects to `/calendar`. The standalone availability-window editor is not part of the current interface. Existing unavailable windows still block overlapping new claims through the database, and the `my_availability`/`save_lecturer_availability` RPCs remain available to authorised clients. At `/calendar`, edit your own private appointments; they are separate from availability windows and never grant access to another person’s calendar.

The historical availability-window controls and their 93-day planning limit are described in the dated section below; this is not a current UI editing flow. Removing an availability window through an authorised API does not cancel an accepted job.

Berlin and Brisbane have different date/offset boundaries. Check the displayed zone when booking. An ambiguous or nonexistent Berlin daylight-saving local time must be resolved explicitly rather than guessed. Calendar display does not change the offer's intended zone or accepted instants.

The calendar also offers an explicit fresh personal ICS download and revocable read-only subscriptions. Choose whether to include your own private appointments; that option does not grant access to anyone else's calendar. A subscription URL is a private capability: give it only to your chosen calendar application, and revoke/rotate it if shared accidentally. Its expiry and current account access still apply. Google/Outlook/installed-device subscription behaviour requires actual platform
acceptance; creating a URL alone does not prove synchronisation. The separate offline snapshot option is described below. See [Calendar connections](GUIDE.md#section-calendar-connections).

<a id="section-user-guide-management-job-creation-and-board"></a>

## Management job creation and board

Authorised management uses `/admin` with current database permissions. Specify all sessions and their IANA zone, currency/rate unit, terms, requirements, optional claim deadline and draft/publication choice. The deadline must be finite, future and no later than the first session; blank means no deadline. Scheduled publication is not yet available. Under gross-finance permission, Administration configures distinct regular-lecturer and senior-lecturer percentage defaults, plus optional individual
percentage or daily-rate overrides. Without a personal override, each new role-split offer captures the matching role percentage; 50 percent is only the fallback when no policy has been configured. An individual setting overrides that person's future quotes; the editor marks whether the shown value is inherited or customized. The EUR 200/day value is a fixed-rate fallback or explicit individual choice. Select the customer organisation and enter its full fee per unit and in total. Management
without gross-finance access cannot inspect or change these private compensation settings. A fixed-total rate and total stay synchronized. Later settings changes affect future quotes; accepted compensation remains unchanged.

For a new standalone offer, enter **Dozierendenplätze / Lecturer positions** (1–20). Each quoted fee covers the complete teaching block for one lecturer position; the maximum customer budget is positions × full fee. Three positions at EUR 100.01 each mean at most EUR 300.03. Administration's creation preview shows the configured role fees and maximum budget. Existing prices for client-originated and course-linked offers are never multiplied retroactively; those offers retain one position. Save
and wait for the complete confirmed transaction.

The **Auftragsboard / Offer board** lists the latest 500 offers in draft, published, filled and archived columns. For never-accepted offers, use the status selector or the separate drag handle (pointer, or Space/arrow keys/Space; Escape cancels). A drop requests a server-checked publication change. It never assigns a lecturer. Filled and accepted-history cards have no drag/status shortcut. Open the detail view for history, safe duplication, metadata/deadline editing, allowed capacity changes,
cancellation and reasoned reopening. New copies are unpublished and do not copy people, contracts, invoices, documents or chat membership. Dates of past work require a new course plan. Accepted fees/terms/dates cannot be silently edited.

Use fictional customers and documents locally. [Job lifecycle](GUIDE.md#section-job-lifecycle) details the safety boundaries; [course-building-block templates](GUIDE.md#section-course-building-blocks) explains source-linked course offers. The complete target remains in the persistent plan.

<a id="section-user-guide-client-portal-and-full-fee-visibility"></a>

## Client portal and full-fee visibility

In the internal portal, open **Klassen und Auftragskontakt / Classes and assignment contact** to create company classes, set their HTTPS meeting rooms and choose a standard contact. This is available with Premium off. Open an own job from the company portal and choose **Klasse bearbeiten / Edit class**. Management and administrators choose the company in the offer editor where a company move is permitted and then choose an available class. Saving the selection stores the current class room and company contact on the job. An explicit reapply copies revised defaults. Confirmed lecturers can see these details in the assigned job.

The offer editor always shows the job's company. Management and administrators can move a draft or unaccepted open job attached to its own unpublished course run, including older offers. Company requests, existing assignments, financial records and dependent course activity keep their original organisation. Company accounts open their current organisation's jobs in the company portal.

Open **Klassenfeedback / Class feedback** beside a company class to see stars and comments and add a class comment. Assigned lecturers can open the same section on their job and submit or revise a rating after their last confirmed session. If the same class is linked to the Premium course workspace, both entry points use the same rating.

For a learner account, management can choose **Kursteilnehmer:in / Participant** in **Konten & Zugänge / Accounts & access**. Search for a company with Premium LMS. Then search and choose one of that company's classes. This also works when assigning the participant role to an existing subordinate account. In the company portal, open the matching company's **Teilnehmende / Participants** to select a class when inviting someone or to change an active participant's class in their details. The participant accepts a new company link before it becomes active. Course enrolment is a separate action.

`/client` is the **Kundenportal / Client portal** for an associated client account and authorised platform management. It differs from `/clients`, the internal customer/contact directory. A client sees only its active associated organisations, their course requests and full client fees, confirmed assignment sums and assigned teachers. EUR, AUD, USD and CHF remain separate. The request volume and confirmed assignment sum are agreement values, not proof of a bank payment.

In **Unternehmen / Companies**, management can assign existing lecturer accounts to a company or RTO. Company contacts can remove links for their own company under **Eigene Dozierende / Company lecturers**. The lecturer's portal account and existing confirmed assignments remain available. Removing a link revokes eligibility for new company-only assignments.

When the selected company has active assigned lecturers, its course request offers **Nur für eigene Dozierende ausschreiben / List for company lecturers only**. The reviewed publication retains that choice. Other lecturers cannot discover or claim the offer. Company users and authorised staff retain their scoped access. New internal requests skip the pricing fields and the commission and framework contract controls at publication. Confirmed internal assignments do not become earnings or invoices in the portal.

Course and job managers can also choose **Auftrag für die Stellenbörse erstellen / Create marketplace offer** from the saved course run. Choose the company-only audience for an internal assignment, then save and open the publication review. The review reports billing and whether at least one currently eligible lecturer is available for the complete block. It does not reserve a lecturer or expose private calendar data. Saving an internal offer for one run does not restrict other independently billed offers on that run. The course list distinguishes internal publication, marketplace publication and filled positions.

Open **Auftrag ansehen / View assignment** from the course run to see the current status, company and, where your account can view the allocations, all currently confirmed lecturers at the top of the assignment. Cancelled allocations do not appear there.

When a complete course offer is first published, the internal portal queues one email with the title, description, personal fee in the original currency where available, and a direct assignment link. The general audience is active lecturers who can see the offer under the existing job board rules and have enabled both email and job updates. Calendar availability and contract status do not narrow that audience. Company-only offers go only to that company's active lecturer roster. Internal assignments have no separate fee. Drafts, existing publications and later edits do not trigger the announcement. Delivery requires the notification worker to be enabled and a working SMTP transport saved under **Verwaltung → E-Mail-Transport / Administration → Mail transport**. The worker honours quiet hours and checks access and preferences again before sending.

Choose **Kurs anfragen / Request a course**, select the organisation and enter the title and topics, delivery and every session in the intended time zone. Enter the original-currency fee for an external request. Add whole required teaching units, explicitly choose 45 or 60 minutes per unit, list required documents one per line and enter preparation instructions. Required teaching minutes must fit the actual session time; remaining time may cover breaks. Teaching units do not calculate or change the commercial price. Save and wait for
confirmation; a request does not reserve a lecturer.

Open **Unterrichtsbedarf und Unterlagen / Teaching brief and documents** on the request card to review or revise this brief. Before publication, changes use the original observed revision; a conflict retains your draft until you explicitly reload/review current state. Upload/share only your own scanned materials or reports for this organisation. Contracts, CVs, qualification evidence and invoices are excluded. The share fixes a specific clean version and can be removed before publication; later
private replacements are not automatically shared. The paged request history retains earlier briefs and publication/cancellation events. Published/cancelled requests are read-only. Cancellation of converted work follows the job lifecycle, not a request shortcut. See [Request briefs](GUIDE.md#section-client-request-briefs).

No public default percentage or freely editable per-request percentage is supplied.

Owner/Administration reviews the request and chooses **Als Lehrauftrag veröffentlichen / Publish teaching assignment**, reviews the configured confidential compensation policy and lecturer terms/contract requirement, then publishes. The eligible lecturer marketplace uses the existing first-committed whole-job claim; there is no routine lecturer approval queue. Once claimed, the client sees the assigned teacher(s) and the agreed full assignment sum. For explicit multi-position administrative
offers, the portal lists all current lecturers, counts the course once, and sums current accepted full-fee positions. Cancelled historical positions remain preserved without doubling current spend. Client-originated course requests themselves keep their original single-position total. The client view does not disclose the lecturer's compensation or the platform's share.

A lecturer sees only their currently authorised **Dozierendenhonorar / Lecturer compensation** in offer cards/detail, accepted terms, earnings and invoice preparation. Prospective role-priced compensation uses the offer's captured confidential policy and the current eligible role. Search bounds/order and dashboard suggestions use that same quote. A restricted/unavailable amount is labelled **Honorar geschützt / Compensation restricted**, rather than zero, and cannot be claimed as a fabricated
zero-price offer. Actual zero compensation, when explicitly returned by the server, remains a distinct value. Role/policy changes can invalidate an old result page; refresh and review the current quote. Consent binds the displayed amount/currency/unit/terms as well as its version.

Accepted full/net/platform snapshots cannot be repriced by a later policy/role change. Legacy deals retain their original compensation; missing historical full-price/platform data remain unknown. No public default split, tax, payroll or currency conversion is assumed.

<a id="section-user-guide-course-workspaces-customers-and-participants"></a>

## Course workspaces, customers and participants

When editing an unlocked course schedule in the portal or a dedicated Academy, choose **Wiederholung / Repeat** below the last session. Preview the dates and choose **Wiederholungen ergänzen / Add repeats**. The extra dates remain editable rows in the same course run and are saved with that run. The final row is the starting point, and existing sessions retain their identities.

For separate drafts from the same template, open **Kursserie planen / Plan a course series**. Enter a first possible start date and use **Starttage wiederholen / Repeat start dates** to fill empty date slots and add more runs, up to 12. Each run keeps its own class, delivery mode and venue. Review the final teaching dates and room/class conflicts before saving the drafts.

In the internal portal, **Kurse & Durchführungen / Courses & delivery** shows up to 24 matching runs or templates per page. Switch views above the filters. Search covers the whole accessible list. To import records, open the import dialog next to the create action in the selected view. Use the page controls to browse, or open a course directly from its existing link.

Open `/learning` and choose a currently permitted course. `/courses/:id/workspace` assembles different authorised views for current course management, confirmed assigned lecturers, enrolled/completed learners and linked customer organisations. A link is not an access grant; cancellation/removal/suspension can make a previously available page or download unavailable.

Editors can publish a numbered welcome revision with the course description, learning objectives and joining instructions. The same workspace shows course dates and authorised contacts, teachers and shared attachments. Course materials and exam PDFs go through scanning before a clean version can be shared. Anyone with current access to a published course file can download the exact scanned version. Assigned lecturers can remove shares of their own materials. In the internal edition, linked companies can remove any material or report visible to them in their courses, and course managers and administrators can remove course material and report shares in their scope. Attendance evidence follows its own workflow. Removing a share keeps the source in Files. Its owner can then use the reviewed permanent deletion flow for an unused personal material, subject to other active references and acknowledgements. Answers and marking materials stay in the authorised exam staff view. Turning off the course exam hides the student exam area and denies subsequent download requests.

### Timed exams and results

In the course workspace, open **Klausur / Exam**. Choose **Klausur planen / Schedule exam**, enter the title, announcement time, start, submission deadline and pass threshold, then save. The times use the course's time zone. Start and deadline must be on course dates. Upload and publish the scanned student PDF after saving the schedule. Already published papers from before timed exams keep their previous access until the course has a schedule. Use the existing exam setting to mark a course exam-free.

Learners can see the announcement from its scheduled time. During the exam window, they can download the paper, complete it, upload it to their account, and choose **Verbindlich abgeben / Submit exam** after scanning succeeds. After confirmation they see the receipt. Only the confirmed version is available to the lecturer for grading.

After the deadline, lecturers open **Klausurbewertungen / Exam grades** in the course's evaluations area. Enter a whole percentage from 0 to 100 per participant, then choose **Bewertungen veröffentlichen / Publish grades** and confirm. Learners see their scores, pass status and the mean of published percentages in **Klausurergebnisse / Exam results** in the learning hub. A lecturer can open the participant's result view from the grading list. Company contacts can open it from the participant profile. Their averages include the courses they are authorised to view.

Assigned lecturers can choose **Neue Kursdatei freigeben / Share a new course file** under **Materialien / Materials**. Choose the audience before submitting. If scanning finishes but sharing needs another attempt, **Freigabe erneut versuchen / Retry sharing** submits the same reviewed version and audience. Withdrawing a share removes course access to that copy and keeps the private source in the lecturer's files.

**Meine Finanzen / My finances** in the sidebar opens the lecturer's own fees, invoices, exports and analytics. **Verwaltung → Plattformfinanzen / Administration → Platform finances** contains the platform overview, invoice reviews, accounting, exports and platform analytics for authorised management and administration. Company accounts open their scoped invoices and analytics through **Unternehmensfinanzen / Company finances**. Combined roles retain separate views.

The platform revenue and accepted earnings lists scroll independently and reveal more rows in batches. Invoice cards load more cards in the main page as you scroll or select **Weitere Einträge laden / Load more entries**. Lecturer-invoice search and CSV include all authorised lecturer invoices that match the active filters, including cards outside the displayed batch. The portal retrieves lecturer invoice history in stable pages so the native response limit does not truncate the list.

In **Plattformfinanzen → Analysen / Platform finances → Analytics**, management and administration can search the company selector when the list is long, choose the year to date or last completed quarter, and focus the assignment chart on past work, upcoming work or open positions. The financial chart can show running totals and compare confirmed contract fees with lecturer compensation when both amounts are authorised. Personal and platform financial trends offer monthly and cumulative views. The all-company scenario chart accepts a 30-, 60- or 90-day window, the next calendar quarter or a selected full calendar year, with an explicit acceptance probability. Annual results use a monthly calendar axis, retaining zero months wherever the selected currency has forecast records. Charts provide a data table and keep missing amounts distinct from zero.

Under **Analysen → LMS-Analysen / Analytics → LMS analytics**, choose a reporting period, course status and optional course or class search. Reset filters clears both the applied search and any unsent edits and returns to page one. Dedicated Academies open **LMS-Analysen / LMS analytics** from the learning area. Lecturers see their assigned courses, company contacts see their company's courses, and authorised course managers can compare companies. Use **Kennzahlen je Kurs / Metrics by course** for the per-course figures and open a course to continue working there.

Use the bar chart for finished and planned courses, the line chart for enrolments and completions by course start, and the ring chart for recorded attendance. The totals include unique learners, enrolments, completions, valid completion records, scheduled hours and the share of enrolments completed. The date filter uses the first session in your profile time zone or the creation date for a course that has no scheduled sessions. Counts reflect the current enrolment and company membership. Attendance uses confirmed marks for finished sessions. The rate uses present and absent marks. Excused attendance is shown separately.

Open **Kursbewertungen / Course evaluations** in the course workspace after the final session. Learners can rate their assigned instructors and course company. Company contacts can rate the instructors. Assigned instructors can rate the difficulty, company and linked class. Check the selected role and subject when one account has several roles. The results show scores for the caller's course scope, and current recipients can open the corresponding comments. Comments appear without author names. Enter experience and practical observations without personal details.

If the connection drops during a save, reconnect and submit the same evaluation again. The server confirms the exact current revision if the first request already saved it. If another edit has changed the evaluation, use **Aktuelle Bewertung laden / Reload current evaluation** to review that version before saving again.

Use **Dozentensperren / Lecturer restrictions** in the company portal, the Academy learning hub or company administration. Choose the organisation and confirm the restriction or its removal. Company contacts can find instructors with assignment history in their organisation. Organisation managers can also restrict an eligible instructor before a first assignment. A restriction takes effect on lecturer access and future assignments. It retains existing commitments and accounting records.

For an active online course, assigned lecturers and course managers can publish an HTTPS meeting link in the course's information section. Enrolled learners can open the link from that course workspace. Clearing a custom link restores the scheduled classroom link when the course has one.

In **Willkommen im Kurs / Welcome to the course**, edit the heading, welcome message, description, learning objectives, schedule, and contact and joining instructions. Select up to 12 materials already shared with learners, preview the draft and then publish it. Management and authorised company contacts can protect the schedule, contact and joining instructions from lecturer edits. Each publication adds a revision. A concurrent edit requires reopening the latest revision. Attachments continue to use the existing private file gateway and disappear when withdrawn or when the viewer loses access.

In the internal Premium company's participant centre, open **Kurse und Teilnahme / Courses and attendance** for an active participant. The detail view lists that company's course enrolments and confirmed attendance counts. Save an optional participant reference unique within the company. Clearing the field removes the reference. An older membership version or a duplicate company reference must be resolved before saving again.

**Deutsch.** Über **Kurse zuweisen** kannst du kommende veröffentlichte Kurse nach Titel suchen und mehrere auswählen. Die Auswahl bleibt beim Suchen und Nachladen erhalten. Prüfe die Kurszeitzone und wähle **In … Kurse einschreiben**. Die Bestätigung erscheint in der Teilnahmeübersicht. Wenn ein Kurs inzwischen nicht mehr verfügbar ist, bleibt die Auswahl zur Korrektur geöffnet. In diesem Fall wird keine neue Einschreibung gespeichert.

**English.** Use **Assign courses** to search for upcoming published courses by title and select several at once. Your selection persists across searches and pages. Check each course time zone and select **Enrol in … courses**. The receipt appears in the attendance view. If any course has become unavailable, the selection stays open for review and the portal saves no new enrolments.

Open **Einladungen und Verlauf / Invitations and history** to see requests, accepted links, removal of accepted links, reference changes and new enrolment changes for the selected company. A request entry confirms receipt. The participant's consent appears as a separate event. Entries show the time and activity, with the newest first.

The course chat admits assigned lecturers and eligible enrolled learners through current room membership. Linked company contacts can read their own course group. Under **Administration → Companies → Retained data**, an administrator can provide a reason to inspect the tenant’s course chat. The system records each inspection, including when Premium is off. Personal chats and unrelated groups use their own access rules.

Use **Attach file** in a course chat to scan a file before sending it, with or without a message. The file becomes visible with the confirmed message. Members and linked company readers can download the exact shared version while their course access remains active. Audited admin inspection can retrieve retained attachments with the same company and reason. The course materials list is managed independently.

Use the attendance register to mark present, absent or excused by session, optionally recording arrival, departure and a note. Authorised staff and company contacts can see the class register, upload evidence as a protected PDF and import the session’s CSV template. Review the proposed rows before confirming the entire import. Changes after the first marking require a reason and the current version. An issued completion document must be revoked before corrections that would change its eligibility. Learners see their allowed course and completion information.

Ended-course feedback is available to eligible learners and customers. Ordinary summaries omit authors and remain withheld until three responses. The server retains the author privately for eligibility and duplicates.

A published mini quiz shows current questions and your attempt allowance. Correct answers stay server-private. Submission and pass state require online confirmation; retries cannot create a duplicate accepted attempt. Completion additionally requires completed enrolment, ended sessions, verified attendance of at least 80% per session and a passed current required published quiz. Only then can the server issue a protected completion PDF of frozen facts. Revocation retains history and constrains
reissue; the PDF is not a new official qualification or legal signature.

After a delivered course, an authorised customer can request it again with new future dates. The new request copies teaching time and requirements, with no automatic allocation. Files need new explicit sharing; learner attendance, feedback, notebooks, contracts and quiz attempts are not copied. See [Course workspace](GUIDE.md#section-course-learning-workspace).

<a id="section-user-guide-management-people-expertise-and-access"></a>

## Management: people, expertise and access

At `/admin/people`, current `qualifications.verify` can open a person's declared expertise and **Beleg und Prüfverlauf anzeigen / Show evidence and review history**. A reviewer sees only the exact certificate version the person explicitly shared for that topic. Download that version and assess it before **Mit diesem Beleg verifizieren / Verify using this evidence**. An optional expiry uses **UTC**; leave it empty for no expiry. Unchanged fields retain the original exact instant. A concurrent
review/edit conflict keeps the reviewed evidence/version rather than silently applying a newer background state; explicitly reload before reviewing the new version.

The existing **Expertise verifizieren / Verify expertise** manual management decision remains available and records its manual basis in the same protected history. Current job matching uses the lecturer’s own declared topic; expiry or withdrawal of a management attestation does not erase that declaration. You can explicitly change its expiry or revoke verification. Existing `users.manage` access to CVs remains separate; qualification permission alone does not open CVs, contracts, invoices or
every certificate/version. A history entry is not a download grant. See [Qualifications](GUIDE.md#section-qualifications).

Choose **Zugang sperren / Suspend access** or **Zugang aktivieren / Activate access** for another person, review the named confirmation and submit it. Wait for server confirmation. Cancellation leaves the current account status unchanged. Your own account cannot be suspended here; the server also protects the last active administrator. Suspension denies protected data and claims, preserving assignments/history and existing roles for authorised follow-up. Full session revocation is an additional
administrative operation.

<a id="section-user-guide-shared-topics-tools-and-programming-languages"></a>

## Shared topics, tools and programming languages

Open `/topics` to search German/English catalogue labels and aliases or filter by kind. Related course-template links appear only when your account may read them. Profiles, templates and job requirements reference the same catalogue identities; a self-selected label still does not verify expertise.

With `taxonomy.manage`, use **Eintrag erstellen / Create entry** or **Bearbeiten / Edit** to enter both labels/descriptions, kind, up to 20 aliases and an optional parent. Save online and wait for confirmation. Cycles and archived parents are refused. A concurrent-edit conflict preserves your draft; **Aktuellen Stand laden / Load current state** reloads the current version for review.

Archive rather than deleting a used identity. Active children must be archived first. Existing references and verified expertise remain intact, but archived entries cannot be newly selected for profiles/templates/jobs. Authorised management can include archived results and restore them under an active parent. See [Taxonomy](GUIDE.md#section-taxonomy).

<a id="section-user-guide-chats-and-course-channels"></a>

## Chats and course channels

At `/chats`, choose a person from **Kontakte / Contacts** to start a direct conversation, or open one of your existing rooms. Active owners, administrators and lecturers can open **Dozierenden-Lounge / Lecturer lounge** and join the shared room. Staff can create topic groups; authorised management can create a separate participant-facing course channel for an actual linked course. Commercial lecturer discussions and participant channels have separate membership.

Open **Kurschats ohne Nachrichten / Course chats without messages** to show empty course rooms. Search and direct links from courses can also open these rooms. Chats with activity and pinned chats appear directly in their usual list.

Use **Filtern nach / Filter by** to show conversations by company, staff member, course or lecturer. Choose a specific entry when available. Text search matches names and course or company labels from your accessible rooms. The filters work in both the active list and the archive. On mobile, use the back arrow in a conversation to return to the same filtered list.

Write the message and choose **Nachricht senden / Send message** while connected. A failed request leaves the draft available to retry. A message is shown as sent only after server confirmation. Search the room’s text, load earlier messages, mark it read or mute it through the available controls. Reactions use the displayed emoji choices. Your own messages can be edited within the server’s 15-minute window; deletion asks for confirmation and leaves a tombstone. Safe web links open as links;
pasted HTML remains text.

Use the trash icon next to a chat and confirm **Chat für mich löschen / Delete chat for me** to clear your view of the entire conversation and remove it from your list. Other members retain their history. A new message brings the chat back with the new history.

Attach or drop one supported file onto the composer and wait for its clean scan before sending; progress is not scan approval. **Personen erwähnen / Mention people** loads current eligible room members on demand. Select up to 20 explicitly; typed `@names` alone are text. The first committed structured mention can renew that message's one notice for a recipient. Exact retries, ordinary edits and remove/re-add cycles do not repeatedly renew it. A mention can override room mute while the global
chat-category preference still applies. Quiet hours affect attention counts, not message delivery.

The group owner or authorized course manager can add/remove permitted members; room-scoped moderators use the disclosed group deletion control. Removal closes the member's active room view and later protected access. Administrator status gives no private DM or group membership. Topic-group creation loads no course catalogue. For a participant channel, current `courses.manage` opens a purpose-scoped course search: **Auswahl durchsuchen / Search choices**, **Weitere Auswahlmöglichkeiten laden /
Load more choices**, then choose the real run by title, organization, first date/zone and short reference. Several offers for one run produce one course choice. Internal job text and fees are absent; the final create action still checks membership and one-channel-per-run rules. Typing/presence remain pending. See [Chat](GUIDE.md#section-chat) and [Scoped choices](GUIDE.md#section-job-pickers).

<a id="section-user-guide-files-and-qualification-evidence"></a>

## Files and qualification evidence

At `/files`, search authorized documents with literal filename, owner/kind/job and own tag/folder filters. Archive and refresh controls sit beside the search. The server returns 40 per page; load further matches explicitly. **Persönlich organisieren / Organise for me** stores your own tags/virtual folder for that currently accessible file. Another account can organize a shared file differently; these fields do not move bytes, rename the shared file or grant access. A stale-edit conflict preserves your draft until you explicitly reload.
See [Files](GUIDE.md#section-files). Choose **Datei hochladen / Upload file**, select or drop one file, and wait until upload and scanning finish. The current allowlist is PDF, PNG/JPEG/WebP, plain text and modern Office documents (`.docx`, `.xlsx`, `.pptx`), up to 100 MiB per file, subject to the environment's configured owner/global quotas. Archives and large video uploads are not available. This file limit does not establish production capacity acceptance. Unsupported, infected or unscanned
files are unavailable for download; a scanner outage leaves the upload unapproved.

Use a document’s actions to download it, inspect its versions, rename it, add a new version or archive it where permitted. Image/PDF preview requires a fresh authorised download. Previous clean versions retain their own bytes and hash. Archive confirmation removes normal availability while retaining history; documents linked to retained contract/invoice snapshots have extra server retention protection. Shared storage paths do not confer access, and private files are not deliberately cached
offline.
Closing a preview aborts the browser request and prevents late responses from creating an object URL; aborting the browser request cannot guarantee that already-started server work stops.

Management with current `jobs.manage` can attach **Vor der Übernahme sichtbar / Visible before claiming** or **Nach der Übernahme sichtbar / Visible after claiming** material. Opening a nonpersonal upload scope starts the bounded offer picker; ordinary browsing/personal uploads do not. Apply a literal search, load another page if needed and choose the offer. The uploader appears after the server confirms that exact selection. This does not claim a job, expose financial fields or authorize a
different task. After-claim resources require a current confirmed allocation or explicit management permission; room files inherit current membership. See [Scoped choices](GUIDE.md#section-job-pickers).

At `/profile`, upload a personal certificate and wait for its scan. In **Qualifikationsbelege / Qualification evidence**, choose an already selected expertise topic, then **Zertifikatsversion auswählen / Choose certificate version**. Review the filename, version and hash, tick the explicit sharing consent and choose **Version freigeben / Share version**. Only that exact clean own version is shared for that topic; uploading/replacing a file does not automatically share its newer version or verify
the qualification.

**Freigabe zurückziehen / Withdraw access**, sharing a replacement, archiving the document or deselecting the expertise topic ends the old download grant. Re-adding the topic does not restore it. Withdrawal/replacement does not revoke an existing verification or cancel accepted assignments; a necessary eligibility change is a separate management decision. Protected history records sharing and review events without granting access to withdrawn bytes. Errors, role withdrawal or suspension hide
unavailable evidence; reconnect/reload through the permitted workflow. See [Qualifications](GUIDE.md#section-qualifications).

<a id="section-user-guide-wiki-and-forum"></a>

## Forum: discussions and articles

Open **Kommunikation → Forum → Fachartikel / Communication → Forum → Articles** and search by text, category and authored language. **Artikel schreiben / Write article** opens the rich text editor for eligible staff. Use paragraphs/headings/lists, safe links and labelled code blocks. Selecting a code language adds syntax highlighting without executing the code. In desktop code blocks, **Enter** inserts a new code line; **Shift+Enter** exits the code block. Automated Android-emulated Chromium checks use a profile-specific Shift+Enter input path to create their code
newline because no native virtual keyboard runs in emulation. Native Android virtual-keyboard Enter behavior still requires manual acceptance on a physical device; browser emulation does not establish that behavior. A page’s German or English authored text is retained when you change interface language.

Save your draft to preserve it. Publishing and archiving require the corresponding management permission. An author’s changes to an already published page are saved as a newer draft until an authorised publisher publishes them; other readers continue seeing the previous published snapshot. The history shows permitted revisions and their editors. If another editor has saved since you opened the form, a version conflict requires reviewing the latest record rather than overwriting it silently.

Choose **Diskussionen / Discussions** in the same forum, then open a category and create a discussion or reply. The thread owner or moderator can choose an accepted answer. Subscribe to receive the supported in-app reply notification; unsubscribe to stop it. Report a post with a reason for moderator review. Authorised management can pin, lock/archive and resolve reports. A locked or archived thread blocks ordinary replies/edits; permitted moderation retains an auditable history. Deleted posts become tombstones. Knowledge access is staff-only
in this slice; course participants do not automatically receive it. Article attachments and revision-bound course-template references now have dedicated permission-aware source implementations. Full native database, API, and browser acceptance remains pending; forum attachments and participant access are still outside this slice.

<a id="section-user-guide-contracts-and-receipt-acknowledgements"></a>

## Contracts and receipt acknowledgements

At `/contracts`, lecturers upload their own executed PDF and see their own registered agreements and addenda. Wait for the security scan to complete; a failed upload is not registered, and can be retried after checking the PDF, connection and scanner availability. Contract file contents and versions are available to their lecturer owner; an authorized staff uploader can read only the exact personal-contract versions they uploaded on that lecturer's behalf while retaining `contracts.manage`.
Other staff, unrelated account records and legacy owner-only documents remain private. Each real PDF record identifies its version, effective/expiry instants and SHA-256. Download the precise registered version before acknowledging receipt. An older metadata-only record has no download or acknowledgement action until a genuine checked PDF version is registered.

Tick **Ich habe diese Vertragsfassung erhalten und zur Kenntnis genommen / I have received and read this contract version**, then choose **Empfang bestätigen / Acknowledge receipt**. The server stores receipt against the exact version/hash and timestamp. This action is **not an electronic signature** or a claim of legal signature sufficiency. Use an already executed agreement and the approved external signing/legal process when required.

Under **Administration → Communities & People → Lecturers**, management and administrators with current contract permission can register an executed contract directly from that lecturer's actions. The selected lecturer is fixed; choose the master/addendum type, parent agreement for an addendum, title and explicit-zone effective/expiry times. Select a clean PDF previously uploaded by that lecturer or click/drag an already executed PDF into the same form. Staff uploads retain the lecturer as owner and record the uploader; only that uploader's current contract permission grants byte
access. The candidate picker exposes only filenames and exact version identifiers; seeing a candidate does not grant access to its bytes. In local development use fictional PDFs. Each registration creates an immutable version; changing the displayed status does not rewrite accepted assignment terms. New claims use the applicable valid contract version; a revoked/expired replacement cannot silently fall back to an older agreement. Receipt acknowledgement is not an electronic signature. An
available-contract notification links to your own contract. The inbox can explicitly check due expiry reminders; external scheduled delivery depends on its separately activated worker. Protected assignment-confirmation PDFs are available from the permitted time/finance workflow and retain accepted terms. External signing-provider integration remains separate work.

In the administrative **Unternehmen / Companies** directory, open a company and choose **Unternehmensverträge / Company contracts**. Upload the executed PDF and wait for the scan before it appears in the list. The list and downloads require both company and contract management permissions. Closing the dossier cancels a browser download that is still in progress; the server may already have completed its work. A download that completed before closing is saved normally. Company contacts do not see these private files. Existing PDFs remain available to authorised staff after the company is archived, but new uploads are disabled. Filing a PDF does not create a lecturer agreement or change any assignment, invoice or existing contract.

<a id="section-user-guide-earnings-invoices-and-recorded-payments"></a>

## Earnings, invoices and recorded payments

At `/finance`, lecturers review only their own accepted compensation by **Erwartet / Expected**, **Prüfung erforderlich / Review required**, **Abgeschlossen / Completed**, **In Rechnung gestellt / Invoiced** and **Bezahlt / Paid**. EUR, AUD, USD and CHF remain separate original-currency totals. Amounts represent the accepted assignment compensation; the portal does not calculate tax or convert currencies.

To submit an invoice, choose **Rechnung einreichen / Submit invoice**, enter its number, issue date and due date, select up to 50 own eligible assignments in one currency, then upload its PDF. An assignment becomes invoice-eligible only after its last scheduled accepted-block session ends; attendance and quizzes are not prerequisites. The server defaults a missing due date to issue date plus 30 days and preserves an explicit valid due date. A cancelled or partially released/inconsistent block is
excluded from direct submission and shown in the separate review flow; recording a review note does not create or approve an invoice. Selecting a currency disables assignments in other currencies. Wait for the PDF scan, then submit and wait for server confirmation. The server derives the total from the accepted assignments and prevents active double invoicing; it does not parse the PDF’s tax/grand total. A rejected/cancelled invoice releases its claims for another permitted submission.

Owner/Administration with current gross-finance permission additionally sees the protected full-fee/net/platform report. It separates offered volume from accepted agreement values, keeps EUR, AUD, USD and CHF separate and identifies legacy records whose historical full price is unknown. Lecturer costs from those legacy accepted deals are still included; known full-fee subtotals do not fabricate missing amounts. Financial dashboard cards follow the same role boundaries.

Finance management with current finance permission can show all authorised lecturer records, download the exact invoice version, review it and record an approval/rejection/cancellation note. **Zahlung eintragen / Record payment** documents a payment already made; it does not initiate a bank transfer. Enter the original-currency amount, explicit-zone timestamp and reference. A partial payment leaves the invoice approved; the final payment marks it paid. Overpayment is rejected.

In an invoicing exception review, open the settlement worksheet and enter the evidence for each agreed teaching day, separate assessment or qualifying non-teaching course day. Use the rate in the accepted assignment. The worksheet distinguishes fully delivered units, valid timely cancellation, unauthorised short notice, independent customer cancellation, excused unfunded absence and remuneration actually received for a non-teaching day. It deducts credited amounts and prevents counting the same calendar date as both a non-teaching day and a teaching or assessment date. A partly delivered individual unit, disputed case or individual variation requires a separate review. After checking the result, finance staff may attach the lecturer's totals to the shared resolution note. Customer fee inputs remain in the worksheet. The worksheet does not change the agreed fee, submit an invoice or record a payment. If the standard framework applies, **Zahlungsfristen berechnen / Calculate payment deadlines** shows the interim, final and applicable receipt or cancellation deadlines from verified dates. It calculates each customer receipt separately and does not save the planning dates.

**Deutsch.** Bei einer prüfbaren Ausnahme öffnet die Finanzverwaltung den Vorgang und bestätigt die geltende Vertragsfassung, den geprüften Betrag und die vereinbarte Fälligkeit. Die dozierende Person findet die Freigabe im eigenen Finanzbereich und reicht ihre gescannte Schlussrechnung ein. Die Anwendung übernimmt Betrag, Währung und Frist aus der Freigabe. Im Bereich **Ausnahmerechnungen zur Einreichung freigegeben** kann die Finanzverwaltung die Freigabe vor der Abgabe mit Begründung widerrufen.

**English.** Finance reviews an eligible exception and confirms the applicable contract version, reviewed amount and agreed due date. The lecturer finds the approval in their finance area and submits their scanned final invoice. The portal uses the amount, currency and due date on the approval. Under **Exceptional invoices awaiting submission**, finance can revoke the approval with a reason before the invoice is submitted.

**Deutsch.** Öffne unter Honorare & Rechnungen beim Auftrag die Rechnungsserie. Die Finanzverwaltung wählt die ausgeführte Vertragsfassung, prüft den Abschlag und erfasst die vereinbarte Fälligkeit. Die Lehrkraft reicht die geprüfte PDF über die bestätigte Freigabe ein. Ein weiterer Abschlag setzt den Abschluss des vorherigen Eintrags voraus. Für die Schlussrechnung gibt die Finanzverwaltung den geprüften Gesamtanspruch ein. Das Portal zieht die tatsächlich erfassten Abschlagszahlungen ab und verknüpft deren Belege. Beträgt der Rest null, schließt die Prüfung den Vorgang als vollständig verrechnet ab.

**English.** Open the invoice series for the assignment under Earnings & invoices. Finance selects the executed contract version, reviews the instalment and enters its agreed due date. The lecturer submits the scanned PDF against the confirmed approval. The preceding entry must be settled before another interim invoice is approved. For the final invoice, finance enters the full reviewed entitlement. The portal credits the recorded interim payments and links those receipts. If the balance is zero, invoice review closes it as fully credited.

**Zahlungsverlauf / Payment history** retains each entry; an authorised **Zahlungseintrag stornieren / Void payment record** corrects an erroneous entry with a reason and recalculates the outstanding balance without deleting its history or moving money.

Use **Rechnungslabels bearbeiten / Edit invoice labels** to classify an authorised invoice with up to 10 comma-separated labels of 50 characters each. The owner or authorised finance manager can save these metadata labels without changing its accepted amounts, document or payment history. Profile labels and invoice labels are separate. Search invoices by number/person/note and combine status, currency and label filters. The invoice CSV exports the current authorised filtered result. Earnings and
protected platform reports have their own exports. All exports preserve original currency and neutralize spreadsheet formula prefixes in authored text. Protected period statements and scenario projections are available through the time/finance workflow below; further report formats remain separate scope. Tax/payroll/banking integration is outside this invoice-tracking scope.

## Accounting and exports

Open **Finanzen → Buchhaltung und Exporte / Finance → Accounting and exports** to select up to 100 authorised invoices and download a confirmed CSV or versioned JSON snapshot. Lecturer exports use accepted compensation. Company exports use the recorded invoice total and payment history in the original currency. Finance managers can export authorised lecturer invoices, and company contacts can export their own company invoices. The export preserves rounding, reversals and outstanding totals. Tax fields remain empty when the source record does not provide a verified breakdown.

With current gross-finance permission, choose **Record an external invoice to a company** to register an already issued invoice. Select the accepted assignments for one organisation and currency, enter the number, dates and exact total, then upload a dedicated PDF and wait for the scan. Review the entries against that PDF before confirming. An invoice that differs from the accepted charge requires an explanation, and the accepted amount stays in the original record. Record incoming payments and correct entries through a reasoned reversal. The CSV and JSON are portal interchange formats.

**Deutsch.** Öffne **Kundengutschriften** an der Originalrechnung, um einen bereits ausgestellten Beleg zu erfassen. Trage Nummer, Ausstellungsdatum, Betrag und Grund ein. Prüfe die Angaben gegen das gescannte PDF und bestätige die Erfassung. Berechtigte Finanzmitarbeitende können die genaue PDF-Version später herunterladen. Zahlungen, offene Beträge und Rechnungs-Exporte werden separat geführt.

**English.** Open **Customer credit notes** on the original invoice to record a credit note already issued. Enter its number, issue date, amount and reason. Check the details against the scanned PDF and confirm the evidence. Authorised finance staff can later download the exact PDF version. Payments, outstanding amounts and invoice exports are handled separately.

The internal OpenAPI explorer and download describe accounting permissions, eligible agreements, invoice pagination, customer invoice registration, payment entries and reversals, and immutable export creation and retrieval. Use exact decimal strings in the original currency. Pass both parts of the cursor from the last invoice for the next page. Customer-scoped results omit gross agreement values and claim identities. Reading a saved export checks current access to every included invoice and its original disclosure scope.

**Deutsch.** Öffne das **Abrechnungsjournal** in **Buchhaltung und Exporte**. Wähle einen Zeitraum und bei Bedarf Buchungsart, Währung und Buchungsstatus. Die Ansicht, das Detail-CSV, das Summen-CSV und das JSON berücksichtigen diese Auswahl und deine aktuellen Finanzrechte. Das Journal führt angerechnete Kundengutschriften, Kundenerstattungen und Rückzahlungen von Dozierenden. Im Summen-CSV stehen Buchungen, Gegenbuchungen und der Saldo je Buchungsart und Originalwährung. Eine Gegenbuchung erscheint an ihrem eigenen Datum und verweist im Detailauszug auf den ursprünglichen Eintrag.

**English.** Open the **Settlement journal** in **Accounting and exports**. Choose a period and optionally filter by entry type, currency and posting status. The preview, detail CSV, totals CSV and JSON follow that selection and your current finance access. The journal covers applied customer credits, customer refunds and lecturer repayments. The totals CSV gives entries, reversals and the net per entry type and original currency. Reversals appear on their own dates and the detail exports link them to the original movement.

The inclusive reporting dates use UTC for timestamps. A period can span up to 366 days and must contain at most 5,000 movements. Narrow the period if the server rejects a larger result. The report uses `luminovia.settlement-journal/1`. The existing invoice snapshot remains available as `luminovia.accounting/1`.

<a id="section-user-guide-workbench-favourites-and-reusable-workflows"></a>

## Workbench, favourites and reusable workflows

The former `/workbench` route now redirects to the dashboard. Private work-task RPCs remain in the source, but the separate task editor described in the dated feature section is not a current page. Current dashboards and course workspaces show only the tasks and operational controls they actually expose.

The chat task action links a new private task to a currently accessible message without automatically copying its body. Losing the source message/room access also removes access to that task/history. A generic task is not a support ticket or permission to read a private DM. Use the task's history action for permitted before/after state.

Select up to 50 current task revisions for a bulk state change. One denied/stale item rolls back the complete batch; do not assume partial success. Save a reusable template with explicit rows and day offsets, then apply a selected revision to create new private tasks. Retries reuse their operation identity and later template edits do not rewrite existing tasks.

Add currently permitted customer/topic favourites and review explainable recommendations. Favourites are private references and disappear from usable projections when destination access ends. Saved job filter views remain in `/jobs`; they do not automatically become saved filters for every module. See [Workbench](GUIDE.md#section-workbench).

<a id="section-user-guide-timesheets-protected-statements-and-control-center"></a>

## Timesheets, protected statements and Control Center

The former `/timesheets` route now redirects to `/finance`; the separate time-record editor is retired from the current interface. Versioned timesheet RPCs and retained records remain in the backend, but an API client must still obey current assignment, finance and version checks. Recorded time does not reprice accepted compensation.

Choose a finite period using its displayed zone and exclusive end date, at most 93 days. Your protected period statement contains own accepted compensation, invoice state and approved minutes in original currencies; an assignment confirmation preserves its accepted terms. Export errors or changed/revoked facts do not produce a successful PDF. These are printable facts, not bank transfers, tax calculations or legal signatures.

Current finance management can use probability-labelled forecast scenarios for 30, 60 or 90 days, the next calendar quarter or a selected full calendar year (up to 367 days). Accepted figures, known and unknown customer gross, pipeline positions and recorded lecturer invoice payments remain separate. Role-priced pipeline cost without a known role mix is reported as unknown positions rather than a guessed rate or zero. The annual monthly axis retains empty months for currencies represented by at least one forecast row. Download the applied scenario as CSV to retain the selected dates, probability, original currencies and separate amount columns. Unknown amounts stay blank and their counts are included. Gross and margin columns require current authority. Treat scenario totals as forecasts, not bookings or payment commitments.

The company portal can download monthly accepted fees as CSV for the selected company filter. The report uses the company-local twelve-month window, keeps original currencies and reads the currently authorised projection before saving.

The forecast's **Bekannte Plattformmarge / Known platform margin** shows confirmed contract fees less lecturer compensation, including negative months. The weighted scenario adds a separate total for identifiable margin on priced open positions (legacy fixed rates or explicit offer-level splits). Positions with unknown margin are counted but not priced, and unpublished requests do not contribute to margin. Neither total is a payment forecast or profit after taxes and overhead.

In the private lecturer profile, **Meine nächsten 90 Tage / My next 90 days** shows the actor's confirmed assignments, scheduled teaching hours and fees per currency. **Meine Finanzen → Analysen / My Finances → Analytics** has a separate chart for recorded receipts and lets you add a planning amount per full future month and currency. These assumptions are not saved and do not change contracts or payment records.

`/control-center` requires current `jobs.manage`. Use its date-filtered exception links for unstaffed offers, missing teaching files, cancellations/handovers, readable overdue tasks, customer requests and separately permitted contract/qualification expiry or course preparation/quality. Each list is bounded; narrow the period when needed. It does not open private tasks, notebooks, DMs or contracts through a general administration bypass.
See [Finance operations](GUIDE.md#section-timesheets-finance-control-center).

<a id="section-user-guide-notifications-and-preferences"></a>

## Notifications and preferences

Use the shell bell for the latest eight personal notices and the total unread count, or open `/notifications` for the full inbox. **Weitere Meldungen laden / Load more notifications** retrieves another page. Mark individual notices read/unread, or choose **Alle bisher eingegangenen Meldungen lesen / Read all notifications received so far** for the previously fetched time boundary. Newer arrivals remain unread. Read state changes only after server confirmation. Resource titles/links are checked
against current access; a removed chat or inaccessible record is not opened by an old notice.

At `/settings`, choose future optional chat, forum, job-update and reminder notifications. Save online. Concurrent changes require reloading and reviewing the current version; switching language preserves the form. Existing messages are not deleted. Confirmations/cancellations and available-contract receipts remain delivered independently of optional switches. Administrator status does not open another person's inbox.

**Fällige Erinnerungen prüfen / Check due reminders** checks your confirmed, unreleased assignment sessions within24hours and own active contracts expiring within30days, at most once a minute unless preferences change. New notices appear in-app. At `/settings`, the separate email form lets you opt into additional email alerts and choose quiet hours in your intended IANA zone. Quiet hours delay email; they do not hide in-app notices. Changes are server-confirmed and version protected. The
server's separately activated finite mail worker also refreshes due reminders for email-opted-in accounts. Email is not active merely because the form exists: private server configuration, timer activation and provider acceptance remain required. Web Push has a separate explicit device opt-in at `/settings`. If browser/provider support is available, grant permission, register your own labelled device and wait for server confirmation. Review/remove your own devices; another account cannot take
over the same subscription. Refusal/unavailability is shown honestly. A registered device, headless test or provider fixture does not prove a visible desktop/mobile notification. Real browser/installed-PWA permission and delivery plus worker/VAPID activation require separate evidence. Digests remain separate work. See [Web Push](GUIDE.md#section-web-push), [Notifications](GUIDE.md#section-notifications) and [Mail operations](../deploy/hostinger/README.md).

<a id="section-user-guide-voluntary-staff-contact-sharing"></a>

## Voluntary staff contact sharing

Under `/profile`, the separate contact-sharing form previews your saved account email/profile phone. Both sharing choices start off. Active staff can explicitly share either value with other active staff, then save online. Other members open the person's profile to use the permitted email/phone action. Pure client/participant accounts receive no staff contact details through this feature, and administrator status does not override a person's choice. Revoke sharing in the same form. This does not
change the existing private management profile or general directory projection. See [Staff contact visibility](GUIDE.md#section-staff-contact-visibility).

The separate **Ruhezeiten / Quiet hours** form at `/settings` stores a daily start/end and IANA zone, including overnight windows. During quiet hours the bell emphasizes committed booking/cancellation/available-contract receipts and currently authorized important announcements. The full unread count and inbox records remain; nothing is deleted, deferred or marked read automatically. The four category switches have their independent version/settings contract. Save online and review conflicts; an
unsaved DE/EN form survives a language change. Quiet attention uses the existing periodic inbox refresh, so a boundary is not claimed to update instantly. See [Notifications](GUIDE.md#section-notifications).

<a id="section-user-guide-portal-announcements"></a>

## Portal announcements

At `/announcements`, read current, unarchived publications for your actual account roles and display window. The shell shows up to three unacknowledged revisions without moving focus. **Gelesen, ausblenden / Read and dismiss** records only your receipt of that published revision and marks its corresponding own notice read. A new published revision requires its own acknowledgement; this is not a signature. An inaccessible/expired old link does not reveal a draft or history.

Current `announcements.manage` opens `/admin/announcements`. Save DE/EN title/body, audience roles and a finite display window as a new draft; ordinary readers keep seeing the previous publication. Explicit publication must be due now; future starts require later manual publication. Important publication creates a committed deduplicated inbox notice. Archive closes reads/ACKs; recovery preserves the old publication/ACK identity and original audience/window without rebroadcast or automatic
extension. No scheduler, real email or push is implied. See [Announcements](GUIDE.md#section-announcements).

<a id="section-user-guide-administrative-audit-reader"></a>

## Administrative audit reader

At `/admin/audit`, Owner, Administration and Management with current `audit.read` can inspect the administrative log. Dedicated Academy admins open **Administrationsprotokoll / Administration audit trail** from **Verwaltung / Administration**. Choose an inclusive local date range (at most 93 days), IANA time zone, an allowed action and/or literal text search, then **Filter anwenden / Apply filters**. Search covers actor display name, action identifier and resource UUID. Pages contain at most 40 events; use **Ältere Seite / Older page**, **Neuere Seite / Newer page** and **Aktualisieren / Refresh**.

The view covers reviewed setup changes, temporary support grants, customer enquiries, administrative account changes, deletions, approved file transfers and payment events. File receipts record the action and resource identifier. Payment amounts require the corresponding finance authority. Private messages, file contents, secrets and bank references remain outside the view.

The log records structured activity such as account creation, invitations, access email requests, mail, push and webhook delivery outcomes for courses and accounting, successful spreadsheet imports, changes to courses and enrolments, attendance, support ticket administration, teaching assignments, billing and company settings. Entries expire from the view after 30 days and the scheduled database cleanup removes expired rows. In the internal installation, an active Owner or Administrator can use **Protokoll leeren / Clear audit trail** and confirm permanent removal of the operational entries. Accounting records and workflow receipts have their own lifecycles. A resource UUID is not a link or permission grant. See [Administration audit](GUIDE.md#section-admin-audit).

<a id="section-user-guide-search-and-remaining-scope"></a>

## Search and remaining scope

The shell's **Im Portal suchen / Search the portal** uses server-authorised cursor search across jobs, clean files, permitted wiki/forum/chat, people, courses, client/task and authorised commercial metadata. Enter at least two characters; load another page when available. Private drafts, message/task source access and commercial capabilities remain enforced, and the destination checks access again. A copied UUID, favourite or old notification never becomes a grant.

The full target remains larger than this source. Remaining work includes broader module-specific bulk/recovery and saved filters, partial/started/invoiced replacement amendments, richer quality follow-up, global-event files/invitations, knowledge attachments, and general contract-renewal/retention administration. Computed readiness, open/emergency whole-block replacement, personal calendar subscriptions and teaching delivery already have connected workflows; consult their guides for limits.
Existing management/course/resource lists retain their documented bounds. Already implemented time/statement/PDF/Push/calendar-source workflows are not relabelled as missing merely because their current full native/device/hosted gate is pending. The [complete feature map](PRODUCT.md#section-smart-operations-spec), [roadmap](FEATURES.md) and QA results separate source, tested, untested and external acceptance.

<a id="section-user-guide-offline-and-support"></a>

## Offline and support

The installed shell can show an offline page. At `/calendar`, you may additionally opt into saving a minimal own next-30-day teaching schedule on that device. The snapshot stores only titles, instants and zones, displays saved/expiry time, expires after seven days and is cleared on sign-out/account change. It excludes private events, contacts, contracts, messages, files and quiz data. A dated offline snapshot can be stale after a remote change; reconnect and refresh before acting. Offline
mutation is neither queued nor confirmed.

Installing on a shared device means consciously choosing whether this minimal snapshot should be stored there; remove it when no longer needed. Real installed desktop/mobile/browser behavior requires its own acceptance. Other authenticated API responses and private file bytes are not broadly cached by the service worker. See [Calendar connections](GUIDE.md#section-calendar-connections).

Use `/help` and the responsible administrator for account or access problems, supplying the visible error and non-sensitive record reference. Do not send passwords, tokens, private calendar URLs, contracts or unrelated people's data as troubleshooting material. Open `/support` for operational tickets, the course workspace for preparation, and `/delivery` for teaching evidence and corrections. `/readiness` remains available to authorised users.
See [Support](GUIDE.md#section-support-desk), [readiness](GUIDE.md#section-course-readiness) and [delivery](GUIDE.md#section-teaching-delivery).

<a id="section-user-guide-course-building-blocks-profile-pictures-and-comments"></a>

## Course building blocks, profile pictures and comments

**Durchführungen / Runs** lists scheduled courses and their marketplace status. **Vorlagen / Templates** holds reusable content, including building blocks and their suggested durations.

For example, use **Kurs anlegen / Create course** to save the shell, file permissions and exercises for a Linux practice day as a template. Start a run from that template for a Friday from 9 am to 4 pm, and save it as a draft while planning. When you need a lecturer, prepare the linked teaching offer and publish it in the marketplace. The run shows the status of that offer.

Under **Courses → Templates**, find the 22 subject templates derived from the 24 supplied PDF versions. Search by short code or content and open the description. Source references show the exact version with filename, revision, pages and an expandable checksum; original files are not publicly hosted. Both versions remain visible for LPC3/LPC4.

Under **Kurse → Kurs anlegen / Courses → Create course**, enter reusable course content or select an existing template. Choose **Als Vorlage speichern / Save as template** to keep only title, description, syllabus, prerequisites and topics. Enter a company, delivery details and sessions when needed for a run, then choose **Entwurf speichern / Save draft** or **Speichern und zum Auftrag / Save and open offer form**. You can publish a saved offer or withdraw an eligible unassigned offer from the course editor. If the server saves new reusable content but does not confirm the run, the dialog reports that state and uses the same template on retry.

As authorised management, choose **Plan course run**, assign the client and adjust delivery mode, location/link, time zone and sessions. The scheduling template can distribute the ten teaching days over weekdays; review holidays, breaks and actual teaching times yourself. A new run does not copy other people's personal data, contracts or allocations.

In the course card's **Stellenbörse / Marketplace** section, choose **Auftrag für die Stellenbörse erstellen / Create marketplace offer**. If the card has no active company, use **Unternehmen für Ausschreibung zuordnen / Assign a company for the offer**, choose a company and select **Speichern und zum Auftrag / Save and open offer form**. Edit the listing title, description and fee terms in the offer form. The company and dates come from the saved run. Choose **Als Entwurf speichern / Save as draft** or **In der Stellenbörse veröffentlichen / Publish in the marketplace**. A published offer appears in the marketplace for eligible lecturers. Open a saved draft from the card and use **Unangenommenen Auftrag bearbeiten / Edit unaccepted offer** to revise it.

Under **My profile**, choose a PNG, JPEG or WebP profile picture. The editor explains the square centre crop. The new picture becomes selected only after confirmed processing and storage; a rejected image does not replace the existing one. **Remove profile picture** clears the current selection. Authorised team/course contacts can see the selected image; it is not published as a public Internet file. Initials appear offline and editing is disabled.

Templates and individual jobs have **Comments & teaching notes** for the authorised teaching team. Write a question or teaching note, edit your own posts or withdraw them with confirmation. Management can hide/restore posts with MFA and a reason. A version conflict signals an intervening change; review the current post before continuing. Comments do not change accepted fees or assignment terms and remain separate from client/participant accounts.

<a id="section-user-guide-withdrawing-from-a-claimed-teaching-block"></a>

## Withdrawing from a claimed teaching block

Open the assigned job and choose **Withdraw from this assignment**. At least
seven days before its first session, confirm a direct withdrawal. With less than
seven days, explain the reason and submit the application. The assignment remains
binding while pending or after rejection. Administration or Management reviews
the request from its inbox link and supplies a decision note. The lecturer sees
the outcome in the personal inbox and job detail. Approval releases the complete
block, and Management explicitly reopens the vacancy. Started/invoiced work needs
separate review. [Detailed workflow](GUIDE.md#section-assignment-withdrawals).

<a id="section-user-guide-optional-contacts-and-job-references"></a>

## Optional contacts and job references

Open a job and use **Contact and job reference** to add an optional external brief/link and contact details. The creation confirmation also links directly to this section. Contact details default to confirmed assignees; management can deliberately release the entered details to authorised offer viewers. Private customer-directory entries are not shared automatically. Editing requires current management MFA; an explicit reload resolves a version conflict. [Details](GUIDE.md#section-job-briefing).

<a id="section-tour-and-help"></a>

<a id="section-tour-and-help-guided-exploration-and-help"></a>

# Guided exploration and help

Public help is available from sign-in without an account.

<a id="section-tour-and-help-use-the-authenticated-portal-tour"></a>

## Use the authenticated portal tour

The authenticated **Portal tour** (**Portal-Rundgang**) navigates only after your explicit choice and uses current account roles/permissions to select relevant destinations. It explains real workflows and their next steps without executing business actions. Real controls still require their normal checks and online server confirmation.

Only the tour step/status is kept in this browser's session storage, separately for each account. Pause/resume works across page navigation and reloads within the same browser session. This is not a server-synchronised or cross-account completion record. Storage denial falls back to in-memory operation.

<a id="section-tour-and-help-open-help-and-guides"></a>

## Open help and guides

Open **Help & guides** (**Hilfe & Anleitungen**) at `/help` for searchable step-by-step instructions, common problems and practical recovery steps in both languages. Deep links such as `/help?topic=jobs` select a module, and `/help?topic=files` opens file guidance. `/help?topic=troubleshooting` explains connection problems, missing permissions, unconfirmed actions and safe issue reporting. General error displays link there.

Interface instructions are authored in German and English; real authored customer/course content is never translated by this feature.

<a id="section-tour-and-help-implementation-and-operating-boundary"></a>

## Implementation and operating boundary

- `src/features/help/catalog.ts` owns bilingual instructions for actual portal modules. Changes to live workflows should update that catalogue and tests together.
- Public help contains authored documentation only.
- The live tour is presentation/navigation only. It never grants permissions, imitates a real session, invokes mutation APIs or confirms a real claim. Administrative and commercial stops follow the current shell's role/permission predicates; both permissions remain necessary for qualification administration.
- Public routes expose no private records. Existing PostgreSQL, Storage, Auth, MFA and API policies are unchanged. No database migration, new dependency, service registration or hosting configuration is required.
- Public help can be included in the existing PWA shell cache.
- This PR does not certify every remaining master-specification feature or deploy to production. The usual successful CI release gates still apply to authorised development updates.

<a id="section-tour-and-help-verification"></a>

## Verification

`npm test`, `npm run test:coverage`, `npm run typecheck`, `npm run lint`, `npm run format:check` and `node scripts/code-integrity.mjs --exports` cover source quality and regression checks. `npx playwright test --config scripts/public-help-playwright.config.ts` runs public desktop/mobile browser checks against a separate frontend with synthetic configuration, without a database. It aborts and fails attempted backend calls in fresh public sessions. The same browser specification also runs inside
the ordinary complete `./portal test` CI workflow, which separately verifies real authenticated business behavior and retained data. Actual outcomes are recorded in the relevant pull request checks; this command list is not itself a pass record.

Follow-up functional/dead-code review and concrete regression evidence: GUIDED_EXPERIENCE_AUDIT.

The separate account-specific `/welcome` checklist persists its own progress through server-confirmed writes. Automatic welcome content is shown only while the live Portal tour is inactive. On `/welcome` and `/welcome/`, the live tour keeps its stored step but hides its controls so the two walkthroughs do not compete. Neither walkthrough advances or completes the other's state; the manual welcome route is deliberately not a live-tour stop.

<a id="section-welcome-guide"></a>

<a id="section-welcome-guide-personal-welcome-guide"></a>

# Personal welcome guide

The dashboard presents a sequential DE/EN introduction for each active account. Next and Back navigate the explanation; Open this area opens the feature currently explained. The dedicated `/welcome` route and navigation entry remain available for review. Invited accounts first complete their existing password flow; the guide never replaces password setup, MFA, contract prerequisites or other authorisation checks.

Steps describe the profile, security, relevant jobs/availability and company area, calendar, collaboration, files, applicable contracts, notifications and permitted account administration. Current server-returned roles and permissions select the steps. Revoking a role removes its explanation; a saved step that no longer applies falls back to the starting explanation. No commercial percentages or other accounts' rates occur in the guide.

Progress belongs to the authenticated account in `private.welcome_progress`. The table has RLS, no direct client grants, and no administrator-wide access policy. Public invoker RPCs call narrow private implementations with an empty search path. Neither RPC accepts a target account ID. Active-account checks occur on every read/write. A missing record yields the first step without a write. Next, Back, pause, resume, skip, completion and restart all require confirmed online writes. The version
condition refuses stale-tab overwrites, including concurrent first writes. This is presentation state and cannot grant a role, accept a contract or make a booking.

Paused progress is offered on the dashboard. Completed/skipped introductions stop appearing there but remain available at `/welcome`; Restart explicitly begins again. Steps and status are stored independently of interface language. A failed save keeps the prior step and offers an explicit server reload. Progress is not stored in local storage, a service worker or user-editable Auth metadata.

Focused verification: `npx vitest run src/features/onboarding/welcome.test.tsx src/app/shell.test.tsx` passed 10 cases. `PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-m7 node scripts/welcome-db-tests.mjs` passed six real PostgreSQL groups on a disposable database. `scripts/welcome-api-check.mjs` and `tests/e2e/welcome-guide.spec.ts` are wired into full isolated acceptance; their actual combined execution is recorded by the QA results after the run. Browser checks cover a new real Auth
account, both languages, feature navigation, reload/pause/resume, offline controls, completion, restart, skip and axe on desktop/mobile.

Database access follows the current [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security). The [changelog](https://supabase.com/changelog) and installed CLI help were checked before generating the migration; no hosted project is used by this implementation or its focused tests.

<a id="section-dashboard"></a>

<a id="section-dashboard-personal-dashboard-overview"></a>

# Personal dashboard overview

The dashboard connects the existing job, calendar and earnings cards with personal previews. The large brand area remains at the entry point. Data comes from existing authorised APIs; no new database permissions or additional server-side data copy are introduced.

<a id="section-dashboard-content-by-account-and-permission"></a>

## Content by account and permission

| Area                               | Content and boundary                                                                                                                                                                                                                                                                                   |
|------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Suggested jobs                     | Published jobs with a claim deadline that remains valid. Verified, unexpired expertise prioritises matching requirements. Authoritative eligibility, contract and conflict checks still occur on the server during the actual claim.                                                                   |
| Calendar                           | The actor's own private events in the next 30 days and own confirmed assignment sessions, sorted together by start. The preview shows at most five entries. Administrative permissions do not extend this query to other people's private appointments.                                                |
| Messages and notifications         | Unread messages from the actor's own permitted chat rooms, the unread notification count and at most three recent notices. Full contents and currently checked links remain in chat or the inbox.                                                                                                      |
| Personal contract acknowledgements | Only the actor's own currently effective active contracts with a document version/hash and an outstanding receipt acknowledgement. Acknowledged, expired or future-effective contracts do not appear as outstanding tasks. This remains receipt acknowledgement, with no claimed electronic signature. |
| Recent files                       | At most five recently added, clean, unarchived file metadata records that the current actor may read. The filename opens the filtered file centre; file contents are not downloaded in the background.                                                                                                 |
| Management follow-ups              | Only with a currently returned `jobs.manage` capability: drafts, open jobs past their claim deadline and unfilled jobs with at least one session beginning in the next 14 days. The source is already authorised job rows, with no additional access to other people's calendars or gross fees.        |

Client-only and participant-only accounts do not load lecturer job, allocation, expertise or contract lists for the dashboard. Their entry point leads to the client portal or course overview. Personal appointments, accessible files and permitted messages remain available. Multiple-role behaviour follows actual roles and capabilities; a display label alone cannot expand database permissions.

Existing finance cards retain their own permission checks: platform revenue, client spend or personal net compensation is returned according to role as before. Role-priced job projections expose only the current lecturer's applicable quote; management without gross-finance permission receives no monetary values for those offers. The preview cards request no additional gross-revenue or other-person contract list. Private policy percentages are not dashboard defaults.
See [delegated roles and private compensation](GUIDE.md#section-delegated-roles-pricing).

The dashboard can also show the permission-aware [welcome guide](GUIDE.md#section-welcome-guide). Its progress is private to the account and changes only after online server confirmation. Opening guidance grants no role, completes no business action and exposes no other account's data.

<a id="section-dashboard-freshness-without-extra-history-queries"></a>

## Freshness without extra history queries

The notification preview uses exactly the same actor key and API as the shell. Only the shell runs the 30-second interval; the dashboard observer creates no second polling timer. The room preview also loads neither message history nor an additional three-second interval. Focus and reconnect use normal stale-data revalidation.

File and private-calendar queries are limited to five metadata records and have no polling interval. Their keys use the existing `documents` and `events` invalidation prefixes, so own file mutations and calendar changes continue to update the preview. The calendar preview also has a labelled refresh button. Published content or additional notices may appear at the next normal revalidation; the preview does not claim immediate synchronisation of all data.

All previews remain in the existing in-memory cache. A failed optional area offers its own retry without hiding other dashboard sections. Retained old preview values are not displayed after an error. Switching accounts uses different actor keys; the existing Auth boundary also clears the cache and resets private local state.

<a id="section-dashboard-presentation-and-verification"></a>

## Presentation and verification

The new cards use existing brand colours, responsive grids, semantic lists and named regions. Dates and times follow the profile time zone; `Europe/Berlin` is used if the profile zone is invalid. The interface supports DE/EN throughout; personal titles and filenames retain their authored language.

The ten component tests verify actual query calls and DOM behaviour: account/role boundaries, personal contract filters, bounded clean file metadata, calendar-error isolation, hiding old metadata after access errors or actor changes, management capability, expertise/deadline suggestions, one shared notification interval and language changes without additional requests.

```bash
npx vitest run src/features/dashboard/dashboard.test.tsx
```

Two additional browser journeys in `tests/e2e/dashboard.spec.ts` use only the canonical disposable test data. They cover actual own/other calendars, a real DM with unread counters, an actually scanned upload and its file-centre link, DE/EN/dark mode, mobile width/axe and MFA management access. Authored scenarios and actually passed browser runs are documented separately in the relevant pull request checks.

<a id="section-personal-dashboard"></a>

<a id="section-personal-dashboard-personal-dashboard-and-teaching-day"></a>

# Personal dashboard and teaching day

The existing preview cards can be hidden, shown and ordered for the current account using labelled up/down controls. The five saved areas are teaching day, activity, own contract receipts, recent files and follow-ups. Current role/resource permissions still determine which areas may load data; presentation preferences never grant access. The greeting, navigation, financial overview, offer suggestions and calendar remain separate areas.

The dashboard now presents the existing metrics, financial cards, offer suggestions, calendar preview and readiness widget in a compact workspace layout. It removes the oversized introductory hero from the authenticated dashboard; the sign-in/onboarding experience remains the branded welcome surface. This is presentation-only and does not change the dashboard query or its permission boundaries.

`private.dashboard_preferences` is accessed through current-identity `dashboard_preferences` and `save_dashboard_preferences` RPCs. No administrator can edit another account's layout. CAS versions prevent silent overwrites; failed saves retain the draft and explicit reload lets the user review current state. The UI confirms the layout only after the server response.

<a id="mein-unterrichtstag"></a>

<a id="section-personal-dashboard-my-teaching-day"></a>

## My teaching day

`teaching_day` returns only the active current lecturer's own confirmed, unreleased assignment sessions overlapping today in the profile's IANA time zone. Both day boundaries are calculated independently, preserving DST transitions. The preview is bounded to 100 sessions; the day/zone and a refresh control are visible. Role withdrawal, cancellation and transferred/released intervals remove the session and its shared context on the next read. A safe HTTPS teaching link or venue and the original
assignment details remain available.

The additive `20261116091027_teaching_day_course_workspace.sql` extends this existing RPC without changing the released `20261116091009` source or its public wrapper/grants. For a linked nonarchived course, each session additionally includes:

- The actual course-run ID and link to `/courses/:id/workspace`.
- Only the deliberately selected `course_workspace_settings.contact_id`, from the exact course organisation, with name/email/phone. Archived contacts/organisations are excluded. No first-contact fallback, internal notes, personal-profile contact or general customer-directory grant is introduced. The UI uses the existing safe mailto/tel helpers.
- Current shared preparation done/total counts from `course_preparation_items`. Zero items is labelled as no shared checklist, not as readiness or 100% complete.
- Up to ten currently permitted, clean, hash-bearing exact `course_resources` versions and an accurate permitted total. A later private current-version replacement never silently replaces the agreed shared version. Removed shares stop appearing. Each preview links to the existing protected workspace, where download still requires its own current authorization/hash check. No Storage path or reusable download token is returned.

The original job-material preview remains separately labelled and bounded to 20 rows, with a link to remaining assignment files when needed. Its existing file permissions remain authoritative. Course-resource preview access uses the existing `course_resource_allowed` helper; this change creates no new table or file grant.

The three versioned `teaching_preparation` checkboxes remain the current claimant's private notes: materials prepared, link/room checked and contact checked. They do not change the shared checklist, client progress or computed operational readiness. Shared status is read-only in this preview; editing follows the owning workspace's permissions. The separate PR24 Readiness Centre, when integrated, is a staff operational calculation and does not supply the explicitly selected contact or replace
this private checklist.

<a id="section-personal-dashboard-payload-and-compatibility"></a>

## Payload and compatibility

The DTO validates UUIDs, instants, the IANA zone, hashes and preview bounds. Missing shared fields in an older payload become null/empty unavailable context. They do not manufacture a course, contact or completed shared checklist. Original fixture/checklist behavior remains supported. The query is account-keyed, and no offline mutation is treated as confirmed.

<a id="section-personal-dashboard-evidence-and-acceptance-boundary"></a>

## Evidence and acceptance boundary

Actual focused checks for this extension: five disposable PostgreSQL groups passed, covering explicit same-organisation contact selection, foreign/archived contact denial, exact old reviewed versions versus private replacements, bounded resource totals, unchanged personal-file RLS, course archival and role/cancellation/transfer revocation. Six dashboard component cases and five existing contact cases passed, including DE/EN links, real shared counts versus private checkbox state and honest
legacy-payload defaults. The existing nine personal-dashboard SQL groups are an additional regression entry point.

`scripts/dashboard-personal-api-check.mjs` now asserts the real Auth/RPC shared contact/resource/count projection and exact scoped cleanup. `tests/e2e/dashboard-personal.spec.ts` now asserts the actual course contact, safe actions, shared progress, resource workspace link and absence of internal notes, alongside persisted private checklist/layout, reload, DE/EN, mobile/desktop and axe checks. These native cases are authored; their combined execution is owned by the current complete
`./portal test` run. Reviewed-version metadata fixtures do not claim a new object transfer; the existing course workspace suite separately exercises real quarantine/ClamAV/Storage/exact-byte downloads.

No hosted service, production record, private mailbox or external recipient is changed by this source extension. Current combined/retained-data/platform and activation outcomes belong in the relevant pull request checks.

<a id="section-job-discovery"></a>

<a id="section-job-discovery-find-jobs-and-save-private-views"></a>

# Find jobs and save private views

The `/jobs` marketplace searches on the server and loads 50 results at a time. **Load more jobs** fetches the next page. It does not collect a complete catalogue in the background or raise the global 1,000-row Data API limit. The interface shows the number actually loaded; it calls the current search complete only when no next page remains.

The former `jobsQuery` loaded an unpaginated table and then filtered in the browser. `supabase/config.toml` limits those responses to 1,000 rows. The native API check reproduces that limit with 1,057 owned offers before reading the same authorised inventory completely through the new API. Authored checks and actual native acceptance are documented separately in the relevant pull request checks.

<a id="section-job-discovery-using-and-understanding-filters"></a>

## Using and understanding filters

Enter the desired values and choose **Apply filters**. Typing alone does not trigger another job query. Filters remain copyable as URL parameters and can be reopened through normal browser navigation.

- Search and customer text are compared literally and case-insensitively. `%`, `_` and brackets are text, not search operators. Search also covers labels/aliases of linked expertise topics.
- Multiple topics, tools or programming languages mean that an offer must require all selected identifiers. Existing archived selections remain recognisable; new selections use active catalogue entries.
- Calendar dates use the explicitly chosen IANA zone. At least one actual session must overlap a selected local calendar day. An unscheduled gap between day 1 and day 10 does not match. A session crossing midnight can match both actually occupied days. Day boundaries are calculated by zone rather than as fixed 24-hour intervals.
- Teaching duration is the sum of actual session intervals, including fractional minutes. It is not the elapsed period from the first to the last course day.
- Money bounds and sorting require an original currency. Unit prices also require a fee unit. Different currencies or hourly/daily rates are not silently compared or converted. Returned amounts describe the current actor's authorised prospective compensation per position, not raw public-table sentinels or a gross/platform projection.
- **No conflicts in my calendar** checks only the actor's own private events, active allocations and blocked periods. Free published future positions with an open claim deadline must also exist. A positive result reserves nothing. Qualification, contract, terms and all current conflicts are still checked only by the atomic claim.

Sorting supports newest/oldest creation in the inventory, next start, title, teaching duration and explicitly comparable total/unit fees. Every sort uses the job UUID as its unique second key. Equal timestamps or amounts therefore do not produce an indeterminate page order.

<a id="section-job-discovery-current-role-priced-quotes-and-consent"></a>

## Current individual lecturer quotes and consent

New commissioned offers use the current lecturer's individual compensation setting and a recipient-specific quote version. Discovery, exact detail and dashboard suggestions share the same authorised amount, total and quoted terms version. Legacy net-only offers retain their existing amounts. Changing a personal setting advances future consent; none of these reads or changes rewrites an accepted assignment. The [current pricing contract](../API_REFERENCE.md#recent-settings-and-action-contracts)
and [historical role-policy section](GUIDE.md#section-delegated-roles-pricing) explain the transition.

Raw `jobs.amount` and `jobs.total_amount` zero sentinels are not authoritative prospective quotes for commissioned offers. The authorised projection can return `null` for nonlecturer management or when the recipient-specific rate is unavailable, including a currency or gross-budget mismatch. The strict [discovery DTO](../src/features/jobs/discovery-api.ts) preserves that absence without numeric coercion. Cards and detail display restricted compensation, and an unpriced claim is disabled. An
explicitly returned numeric zero remains a real quote rather than a missing value. The projection exposes neither gross amounts, policy percentages nor another tier's quote.

Price filters and monetary sorting use the same actor-specific quote shown in the result. Unknown amounts do not match price bounds, including a minimum of zero. Monetary sorts place unknowns last in either direction; their internal cursor-order sentinel is never returned as compensation. Original-currency and fee-unit requirements still apply.

The detail checkbox binds consent to the exact displayed job identifier, quoted version, amount, total, currency, fee unit and terms. A refreshed quote cannot reuse consent for different displayed values. The claim sends the quoted terms version and idempotency key to the existing server transaction; the browser supplies no recipient role or accepted price authority. Existing own claims continue displaying their immutable accepted snapshots. A retry remains subject to current access checks and
refers to its original claim identity and current status, not a newly confirmed allocation.

Observed role changes reset the infinite-page query key. Independently, the server binds cursor fingerprints to the current actor/tier and global policy version as well as the canonical filters. A cursor captured under a different quote context is rejected and requires a fresh search. A policy-context change invalidates the old cursor without rewriting an existing offer's captured quote. These checks do not make several HTTP pages a frozen snapshot.

<a id="section-job-discovery-private-saved-views"></a>

## Private saved views

**Save applied filters** stores the currently applied URL search under a chosen name. Unapplied form inputs are not silently included. Select a saved view to load its filters and sorting into the URL and form. **Rename view** changes its name; **Remove view** removes only that personal filter selection.

Views persist in PostgreSQL, at most 20 per account. Reloading or signing in again does not remove them. Other accounts and ordinary administrative permissions do not open another person's views. A version conflict remains visible and cannot overwrite a newer state. Reload the current view list and review the selection again. An identical creation retry after a lost response uses the same UUID and creates no second view. These writes are disabled offline.

Filters are stored as closed, type-checked JSON. Browser roles, user identifiers, unknown fields or alternative gross amounts provide no additional filtering permissions. A saved filter expands neither job nor calendar access. Current roles/account suspension are checked on every API request; client-only/participant-only accounts do not load lecturer jobs or saved lecturer views here.

<a id="section-job-discovery-connections-and-preserved-interfaces"></a>

## Connections and preserved interfaces

The detail view queries exactly the requested permitted UUID through [jobDetailQuery](../src/features/jobs/discovery-api.ts) and the `/jobs/:id` route. An older job therefore remains accessible through its link even if absent from the former unpaginated 1,000-row response. Atomic claiming, idempotency, capacity and cancellation/reopening history remain authoritative, with current role-priced consent as described above. The quote replacement is additive; it does not rewrite earlier migration bodies
or accepted records.

The dashboard receives complete authorised counts and at most two job suggestions through [jobDashboardQuery](../src/features/jobs/discovery-api.ts) and its own aggregate RPC. It does not confuse a small preview with the total count. Own allocation counts and at most five upcoming-session metadata records also come from that query. Management counts are returned only with current management permission. The dashboard does not request a lecturer overview for client-only/participant-only accounts.
Suggestions use the same private item helper and nullable quote schema as discovery and detail; they do not calculate a price from the raw job table.

The calendar fetches only permitted titles for the actor's own confirmed allocations. Without own allocations, it starts no job-title query. It does not load the marketplace to label old sessions. This grants neither foreign titles nor private calendar entries, including to administrators. Global courses and private-event editing remain separate existing workflows.

The file/chat job selectors use a [dedicated purpose-bound paginated search](GUIDE.md#section-job-pickers). It uses actual upload or course-chat permission and loads no full marketplace records. Revision-specific native acceptance belongs in the relevant pull request checks; this documentation change does not rerun it. The administrative M6 Kanban remains explicitly limited to the newest 500 offers and discloses that limit; older permitted offers can be edited through search and details.

<a id="section-job-discovery-api-and-database"></a>

## API and database

The original API, public invoker wrappers, saved-view table and discovery indexes come from [20261116080735_job_discovery_and_saved_views.sql](../supabase/migrations/20261116080735_job_discovery_and_saved_views.sql). The later [20261116080748_role_aware_job_discovery.sql](../supabase/migrations/20261116080748_role_aware_job_discovery.sql) owns the current private quote/context helpers and replaces `job_discovery_candidates`, `job_discovery_item` and `job_discovery`. It preserves the public signatures
and saved-view operations. Existing `job_detail` and `job_dashboard` implementations call the replaced item helper, so their prices and consent versions follow the same projection.

[The marketplace candidate migration](../supabase/migrations/20261124164736_optimize_job_discovery_candidates.sql) applies the active-offer and filter conditions before checking visibility and pricing. It looks up the first session for the open or earliest-start view and calculates total teaching time only when the sort or filters require it. The public response, cursor format and existing visibility and pricing rules are preserved.

| Public RPC                                                | Purpose                                                                                                     |
|-----------------------------------------------------------|-------------------------------------------------------------------------------------------------------------|
| `job_discovery(p_filters,p_cursor,p_limit)`               | Up to 100 authorised offers, `has_more`, next-page cursor and canonical filters in a bounded JSON response. |
| `job_detail(p_job_id)`                                    | One permitted job with sessions, requirements and aggregate position counts.                                |
| `job_dashboard()`                                         | Authorised counts, two suggestions and bounded own upcoming allocations.                                    |
| `assignment_job_titles(p_job_ids)`                        | Only titles of own confirmed allocations, at most 1,000 requested identifiers.                              |
| `saved_job_views()`                                       | At most 20 own versioned views.                                                                             |
| `save_job_view(p_id,p_name,p_filters,p_expected_version)` | Creation with a stable UUID/version 0 or update of an observed own version.                                 |
| `remove_job_view(p_id,p_expected_version)`                | Removal of an observed own version.                                                                         |

Public invoker entry points call restricted private implementations with an empty search path. Internal filter/projection helpers have no execution grants for PUBLIC/anon/authenticated. The private views table has RLS and no direct browser grants. Job access uses the existing `can_read_job` boundary; discovery neither resets accepted compensation nor introduces administrator access to other people's private calendars.

Cursors contain sort value, UUID and a fingerprint of the canonical filters plus current server-derived quote context. Cursors from a different search, actor/eligibility-tier context or global policy revision, nonfinite values and invalid page sizes are rejected. A page is a currently authorised query, not a database snapshot frozen across multiple HTTP requests. New or reordered offers may require reloading the search. The new quote/context helpers have no direct execution grants for PUBLIC,
anon, authenticated or service-role callers; discovery grants no additional access to private policies.

<a id="section-job-discovery-verification"></a>

## Verification

Focused commands:

```bash
npx vitest run src/features/jobs src/features/dashboard/dashboard.test.tsx src/features/calendar/calendar.test.tsx
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/job-discovery-db-tests.mjs
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/api-surface-db-tests.mjs
./portal test
```

The SQL suite uses only owned temporary UUID databases. It checks more than 1,000 records sharing timestamps, complete stable pages, exact older detail identifiers, original currencies/units, actual session gaps/zones, own calendar conflicts, private views/quotas, concurrent CAS changes and role/account revocation. The generic API check continues validating all actual public references, RLS, invoker boundaries, absence of anonymous grants and empty definer search paths.

`job-discovery-api-check.mjs` adds actual Auth/REST acceptance, including the old 1,000-row limit and signing in through a new session. `job-discovery.spec.ts` covers desktop/mobile, actual subsequent pages, saved views surviving reload, private account boundaries, DE/EN, dark mode and axe. Existing claim/lifecycle browser tests retain actual booking and snapshot checks; their detail refresh now waits for the precise new detail API. Authored tests alone do not constitute passed native
acceptance.

Current compensation is configured per lecturer and remains independent of role changes. The [job-discovery SQL suite](../scripts/job-discovery-db-tests.mjs), [delegated-pricing SQL suite](../scripts/delegated-pricing-db-tests.mjs), and [replacement handover SQL suite](../scripts/replacement-directed-handover-db-tests.mjs) cover current pricing, authorised discovery, quote privacy, replacements and immutable accepted snapshots. The
older [role-percentage probes](../scripts/role-aware-job-discovery.archived.mjs) are historical references only. The [DTO](../src/features/jobs/discovery-api.test.ts), [card](../src/features/jobs/card.test.tsx), [detail](../src/features/jobs/jobs.test.tsx) and [discovery](../src/features/jobs/discovery.test.tsx) component regressions cover nullable values without coercion, genuine numeric zero, restricted rendering, changed-quote consent and resetting observed pages.

<a id="section-job-lifecycle"></a>

<a id="section-job-lifecycle-jobs-lifecycle-lecturer-positions-and-board"></a>

# Jobs: lifecycle, lecturer positions and board

This module connects publication, whole-block acceptance, cancellation, reopening,
commercial reporting and course-chat membership. PostgreSQL authorizes every
change. A browser drag, selection or pending HTTP request never confirms a teaching
assignment.

<a id="section-job-lifecycle-offer-and-assignment-states"></a>

## Offer and assignment states

An offer has `draft`, `published`, `filled` or `archived` status. Each accepted
lecturer position has a separate immutable `job_claims` snapshot and one
`assignment_sessions` row per session. The offer status describes remaining
vacancies; it does not revoke the other confirmed lecturers.

- Management with `jobs.manage` and verified MFA can create/publish/unpublish,
  edit and archive offers before any acceptance. Edits use the reviewed lifecycle
  version; a concurrent update rejects the stale request with `40001`.
- Metadata editing covers title, description, location, terms and claim deadline.
  Term changes use the existing terms-version trigger and require fresh consent.
  Session/date restructuring belongs to course planning or a new offer. No API
  silently rewrites accepted dates, currency, fees or contract/terms snapshots.
- A safe duplicate creates a new unpublished course run and fresh sessions,
  copying the source building-block reference and required qualifications.
  It copies no claims, documents, invoices, contracts or chat members. Copying
  course-backed jobs requires `courses.manage`; copying a gross-priced offer
  additionally requires gross-finance access. Past dates require a new plan.
- Offer creation/edit/reopening has an optional finite future claim deadline,
  no later than the first session, interpreted in the displayed IANA time zone.
  Empty means no claim deadline. When editing or reopening, an unchanged local
  deadline preserves its exact stored instant, including an instant in a repeated
  daylight-saving hour. A newly entered or changed local time must resolve to one
  instant; nonexistent spring-forward times and ambiguous fall-back times are
  rejected instead of silently selecting an offset. There is no
  scheduled-publication worker.

<a id="section-job-lifecycle-explicit-per-position-pricing"></a>

## Explicit per-position pricing

New standalone administrator offers support **1–20 lecturer positions**. Each
quoted rate and total applies to one lecturer for the entire offered block. For
example, gross EUR 100.01 with three positions has maximum customer budget
EUR 300.03. At the default 50% platform share, the existing platform-first cent
rounding produces EUR 50.01 platform / EUR 50.00 lecturer for each accepted
position. Accepted rows retain their own exact rounded amounts.

`capacity_basis='per_position'` records this explicit meaning. All existing offers,
customer requests and course-originated offers retain
`capacity_basis='single_position'`, capacity one, and their original budget.
Existing customer totals are never multiplied retroactively. A new standalone
one-position offer also uses the explicit per-position basis.

Capacity can be changed with a version check only on explicit per-position offers
that have never been accepted. Fees remain per position; the maximum budget
preview changes. Financial reporting counts each course once, sums the active
accepted ledger rows, and lists all currently assigned lecturers. Historic
cancelled ledger rows remain immutable and are excluded from current assignment
spend. Original currencies are kept separate.

<a id="section-job-lifecycle-atomic-acceptance"></a>

## Atomic acceptance

`claim_job` keeps its existing arguments and default single-position behavior.
Under an active profile shared lock and per-lecturer advisory lock, it locks the
job, checks remaining capacity, expertise/verification validity, required personal
contract, accepted terms version and every session. Existing personal appointments,
unavailable windows and active assignments block overlaps; management has no
private-calendar bypass.

A lecturer can hold at most one active position in a job. Every session is
reserved in one transaction or none is. A unique partial index protects the
job/lecturer pair, a capacity guard serializes accepted rows, and a partial
PostgreSQL exclusion constraint protects active calendar intervals. The offer
stays published until the last position is accepted. New attempts after it fills
return `filled`; attempts by an already assigned lecturer while positions remain
return `already_assigned`.

Idempotency keys belong to an operation. Retrying a previously confirmed key after
cancellation returns that cancelled historical claim, never a new confirmation.
The UI retires a successful claim key and derives confirmation from actual current
claims, allowing a new claim after an explicit reopening without a page reload.
A lost-response retry retains its original key.

<a id="section-job-lifecycle-cancellation-and-replacement"></a>

## Cancellation and replacement

A lecturer uses **Withdraw from this assignment** in the job detail. At least
seven days (168 elapsed hours) before the first session, the server confirms a
direct whole-block withdrawal; a reason is optional. With less than 168 hours
remaining, a 5–1000-character reason is mandatory and creates a pending application.
Exactly seven days belongs to the direct path. The server checks the actual first
start instant again when submitting, independent of browser time or display zone.

Administration or Management with current `jobs.manage` and verified MFA reviews
the application from its inbox link to the job. Both approval and rejection require
a 5–1000-character decision note. The author cannot review their own request, even
with a management role. A pending or rejected request retains every confirmed
session and course-chat membership. Approval releases the complete assignment;
rejection keeps it binding and the lecturer may submit a new reasoned application.
The lecturer receives the decision in their personal inbox and sees the reason in
the job detail. Request reasons stay in private storage, accessible only to the
author and current authorized job managers, and are absent from notice payloads.

A manager can still perform reasoned administrative cancellation of another
lecturer's assignment. The legacy cancellation RPC also enforces the short-notice
rule for an actor's own assignment, so a direct API call cannot bypass review.
Started blocks and **any** invoice-item history are refused and require separate
financial review. These workflows record no bank payment, refund or credit note.
For sickness that affects a specific teaching day, use [urgent teaching cover](GUIDE.md#section-replacement-marketplace). See [withdrawal operations](GUIDE.md#section-assignment-withdrawals) for ordinary withdrawal, retry and migration boundaries.

Cancellation:

1. Marks the claim cancelled without changing its accepted money/terms snapshot.
2. Retains session rows and sets `released_at`, removing those intervals from
   future conflict checks and calendar allocations.
3. Moves the vacancy to draft. Other confirmed positions remain confirmed.
4. Removes the cancelled lecturer's course-chat membership. If they owned the
   room, another active, non-revoked confirmed member becomes owner; otherwise ownership is empty. A separately assigned management owner remains unchanged.
5. Records the cancellation reason in the audit log, a claim event and an in-app
   notification. The actor/request ledger makes exact retries idempotent.

Management explicitly reopens the remaining future position(s) with a reason and,
if needed, a refreshed/cleared deadline. A qualified replacement must claim online
under the same all-or-none checks. Each genuine audited reopening renews the single
optional in-app notice for previously cancelled lecturers: it becomes unread with a
fresh timestamp. Retrying that same completed request does not renew it again;
disabling optional job updates suppresses renewal. There is no automatic substitute selection or
administrator drag-to-confirm shortcut. Accepted resource/history read access
remains according to existing job policies; cancellation is not a general erasure
of legitimately accepted records. Private contracts/messages/calendar entries do
not gain broader administrator access.

Invoice submission now takes the same lecturer advisory lock before checking
confirmed claims and inserting invoice items. This closes the demonstrated race
where an invoice and cancellation could both commit against the same assignment.

<a id="section-job-lifecycle-board-and-api-integration"></a>

## Board and API integration

The administrator board uses pinned `@dnd-kit/react` and `@dnd-kit/dom` 0.5.3,
localized announcements/instructions, pointer and keyboard controls, and a normal
status selector. Only never-accepted offers register as draggable. `filled` is a
read-only column. All changes call the versioned publication RPC; accepted and
cancelled history must be managed in the detail view.

`job_board()` fetches one bounded batch (latest 500), including title, status,
version and authorized aggregate position counts. Cards make no independent
requests and add no polling. Job mutations invalidate affected query families,
not every profile/document/wiki query in the application.

Public RPCs use authenticated invoker wrappers; the scoped private implementations
have an empty search path and explicit execution grants. Authentication comes from
`auth.uid()` and database permissions, never a caller-supplied role/user ID.

| RPC                                                                                           | Purpose                                                                                                                                           |
|-----------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| `job_lifecycle(p_job_id)`                                                                     | Authorized version, actions, position counts and own/managed claim history. Other lecturers' identities are not exposed through aggregate counts. |
| `manage_job_offer(p_job_id,p_action,p_expected_version,p_request_id,p_payload)`               | Versioned `draft`, `published`, `archived`, `edit`, `duplicate`, `reopen`; reopening requires `reason`.                                           |
| `cancel_job_assignment(p_claim_id,p_reason,p_request_id)`                                     | Audited own/authorized whole-block cancellation.                                                                                                  |
| `create_capacity_job(p_payload,p_capacity,p_request_id,p_organisation_id,p_platform_percent)` | Explicit new per-position standalone offer; the UI defaults to one position and the API platform share defaults to 50%.                           |
| `set_job_capacity(p_job_id,p_capacity,p_expected_version,p_request_id)`                       | Change explicit new offer capacity before acceptance.                                                                                             |
| `job_board()`                                                                                 | MFA-protected management board batch.                                                                                                             |

The legacy `set_job_status` remains for compatible never-accepted publication
changes. It cannot reopen cancelled work or bypass immutable history.
`commission_report` appends capacity; `client_requests` appends the
`assigned_lecturers` array while preserving the original first-lecturer scalar
fields for old API consumers.

<a id="section-job-lifecycle-migration-and-verification"></a>

## Migration and verification

The additive migrations are `20261115203956_job_lifecycle_audit.sql` and
`20261115210814_job_capacity_and_board.sql`. Delivered earlier migrations are
unchanged. They replace the active assignment exclusion constraint, single-slot
claim index and scoped RPC projections. An operator must review migration effects
and backups before any separately authorized hosted rollout. No production data
or hosted configuration was changed by this implementation.

Focused checks actually passed in a disposable PostgreSQL 17 database:

- `PORTAL_DB_CONTAINER=<owned-test-container> node scripts/jobs-lifecycle-db-tests.mjs`:
  12 groups, including repeated-reopening notification renewal/retry/preferences,
  a 50-way reopened single-position race, immutable accepted
  snapshots, exact idempotency, resource release, deadline/CAS and controlled
  invoice-vs-cancellation interleavings in both orders.
- `PORTAL_DB_CONTAINER=<owned-test-container> node scripts/jobs-capacity-db-tests.mjs`:
  8 groups, including usable owner re-election/management-owner retention and 50 concurrent requests for three positions (three distinct
  lecturers / six session allocations), duplicate-actor protection, private
  conflicts, budget/course counting and retained replacement ledgers.
- `npx vitest run src/features/jobs/lifecycle.test.tsx src/features/jobs/board.test.tsx src/features/commercial/commission-api.test.ts`:
  14 unit/component tests for server confirmation, failed-response keys,
  reviewed versions, translations, offline controls and per-position totals.

The SQL invoice fixture verifies transaction behavior using fictional clean PDF
metadata; it does not claim to scan actual bytes. The canonical commercial API
suite owns real upload/scanner acceptance.

`jobs-lifecycle-api-check.mjs`, `jobs-capacity-api-check.mjs` and Playwright
`job-lifecycle.spec.ts` / `job-capacity.spec.ts` are wired into the canonical
isolated suite. Their actual native/browser result is recorded by the combined
acceptance run in QA results; authored tests alone are not acceptance evidence.
The browser cases cover a lecturer page staying mounted through cancellation and
reopening, actual board input controls, partial capacity, DE/EN, dark mode and
mobile/desktop accessibility. Run the supported `./portal test` entry point for
complete native Auth/API/browser validation; do not point fixtures at development
or production data.

This module
does not declare saved marketplace filters, automatic substitute selection,
scheduled publication, complete advanced marketplace filtering or all platform
production acceptance complete.

<a id="section-job-pickers"></a>

<a id="section-job-pickers-purpose-scoped-offer-and-course-choices"></a>

# Purpose-scoped offer and course choices

The file upload and participant-channel dialogs use one bounded, server-side
picker. They no longer load the first 1,000 complete jobs, sessions and
requirements. The marketplace has its own separate discovery contract; its
lecturer eligibility is not the authority for an administrative file/course task.

<a id="section-job-pickers-connected-ui-behavior"></a>

## Connected UI behavior

- Ordinary file browsing and personal uploads start no privileged picker query.
  With current `jobs.manage`/MFA, choosing before-/after-claim material opens the
  offer picker. Search applies explicitly; **Load more choices** requests one more
  page. The existing file uploader appears only after the server resolves the
  exact selected job in the authorized response. MIME checks, quarantine, actual
  scanning, clean bytes, quotas, retry identity and download policy remain in the
  existing [file pipeline](GUIDE.md#section-files).
- Creating a topic chat starts no offer query. Switching to a participant channel
  with current `courses.manage`/MFA opens the course picker. Each linked course run
  appears once even if it has several historical offers. Labels use authorized
  course-template title, run organization, first course session and explicit
  IANA zone, with a short run reference. An unscheduled run is labeled honestly.
  Hidden job descriptions, customer quote fields and fees are not projected or
  searched by this purpose. The representative value remains a real job UUID for
  the existing `create_chat_group(p_job_id)` API; the resulting participant room
  has the real `course_run_id` and no commercial `job_id` link.
- A search preserves an already selected permitted value explicitly outside its
  result page. It does not silently select the first match. Exact selection is
  resolved in the same request, without a separate RPC per option. An older job
  binding for a run does not produce a second course choice.
- A `42501` response hides the options and connected operation immediately and
  stays hidden through later network failures until an authorized refresh succeeds.
  Ordinary transport errors preserve an existing operation draft. No private
  picker data are persisted in browser storage. Upload/group mutations still
  revalidate their own current permissions and report success only after commit.

Pure client/learner accounts have no privileged picker query. A separate explicit
capability can authorize a purpose without granting lecturer-marketplace access;
this does not grant job detail, fee or private-room access. Existing actual action
constraints, including eligible group members and one participant channel per run,
remain authoritative. Selection does not reserve an offer or alter a claim.

<a id="section-job-pickers-api-and-database"></a>

## API and database

The additive CLI-created migration is
`20261116080741_scoped_administrative_job_pickers.sql`. All previous 29 migration
sources are preserved. Other M8 feature migrations remain separate.

`job_picker(p_purpose,p_search,p_cursor,p_limit,p_selected_id)` returns:

```json
{
  "items": [
    {
      "id": "real-job-uuid",
      "title": "Authorized offer or course title",
      "customer_name": "Authorized customer or run organization",
      "course_run_id": "course-run-uuid-or-null",
      "starts_at": "first-session-instant-or-null",
      "time_zone": "Europe/Berlin"
    }
  ],
  "has_more": true,
  "next_cursor": {
    "at": "timestamp",
    "id": "sort-uuid",
    "fingerprint": "hash"
  },
  "selected": null
}
```

This is an illustrative shape; actual UUIDs/instants are validated. Closed purpose
`job_attachment` requires `jobs.manage`/MFA and includes existing jobs independently
of lecturer claim eligibility or publication state, matching upload registration.
`participant_course` requires `courses.manage`/MFA and includes only runs with a
real job binding. It returns course metadata, not a commercial job DTO. It adds
no silent published/nonarchived filter that the existing channel action lacks.

Search is literal, case-insensitive and at most 160 characters. `%`/`_` are text.
The UI requests 40 rows; the API permits 1–100. Cursor fingerprints bind purpose
and search. Stable order is job `(created_at,id)` descending for file choices,
course-run `(created_at,id)` descending for course choices. The earliest existing
job provides the latter's compatibility binding; later duplicate offers do not
create more course rows. Each page rechecks current rights and is not a frozen
multi-request database snapshot.

Indexes support job/run cursors, representative job lookup and first course
session lookup. Schedule projection is limited to returned choices and one
selected item; whole session lists are not returned. Public invoker RPC calls a
scoped private implementation with empty search path and explicit authenticated
execution grants. The internal candidate helper revokes PUBLIC/anon/authenticated
execution. Browser actor IDs and editable metadata confer no authority. Existing
`reserve_document`, `create_chat_group`, marketplace discovery and online whole-
block claim interfaces are unchanged. The unused legacy `jobsQuery` export was
removed after its final two production callers were replaced.

The administrative Kanban remains independently limited to its newest 500 offers,
with its existing DE/EN notice. It still needs its own paging/status-transition
model; this picker does not add per-card queries or claim through drag-and-drop.

<a id="section-job-pickers-verification-and-remaining-acceptance"></a>

## Verification and remaining acceptance

Focused executed checks use separate UUID databases in the explicitly owned,
network-disabled scratch container. Six PostgreSQL groups passed, including
1,062 equal-timestamp jobs, 1,057 distinct course runs, representative selection,
literal/cursor bounds, strict purpose permissions/MFA, no commercial projection,
first-session/IANA metadata, existing upload/channel API binding, duplicate-channel
refusal, current suspension/role withdrawal and private helper/anonymous ACLs.
Nine picker component/API-contract cases and the combined 55-case picker/file/chat
focused run passed. The generic API-surface suite also passed all six checks,
including actual frontend RPC binding, RLS, anonymous grants and empty definer
search paths. Final native combined acceptance belongs to the root QA record.

`scripts/job-picker-api-check.mjs` authors actual Auth/MFA/REST cap and purpose
checks, selected upload reservation and participant channel creation. A reservation
is quarantined metadata, not a claim that bytes were scanned. The two discovered
desktop/mobile cases in `tests/e2e/job-pickers.spec.ts` additionally author a real
scanned upload, paging, course deduplication, DE/EN, dark mode, axe, viewport fit
and ordinary-account query exclusion. These native API/browser cases have not yet
run for M8. Existing M7 acceptance does not cover this migration. Record the final
canonical and retained-data results in the relevant pull request checks and
QA results; no production or external delivery is claimed here.

<a id="section-assignment-handover"></a>

<a id="section-assignment-handover-assignment-waitlists-and-consented-substitution"></a>

# Assignment waitlists

Migration `20261116091012_assignment_waitlist_and_substitution.sql` adds private, permissioned workflow data without rewriting existing migration history or accepted deals.

Lecturers can join or leave a full future offer's waitlist. Duplicate joins create one row and allocate no teaching time. A lecturer who loses the first-come claim race can still open the known job URL and join its waitlist; their own waitlisted jobs also appear on the jobs page. Explicit audited reopening notifies currently eligible, opted-in waiters after the final transaction state is known. A notification reserves no place: the existing online atomic claim still decides the successful
booking. Leaving removes the corresponding availability notice.

Waitlist interest grants no enduring read access to private job metadata. If an interested offer later becomes an unreadable draft or archived job, its own-interest entry uses a generic unavailable label and no job-detail link; the current private title is not returned. The owner can still remove that interest. Published/filled offers retain their existing reduced marketplace projection, and an ordinary current job-read permission remains authoritative.

Withdrawal rechecks current account activation after the profile lock. A suspended request cannot mutate a waitlist using an earlier pre-lock permission result. Joining additionally requires current lecturer authority; an active former lecturer may still withdraw their own prior interest. Every successful leave receipt has an empty title. A caller without own interest receives the same idempotent, metadata-free receipt for a private or missing non-null UUID before any foreign job lookup or row
lock; withdrawal is not an existence or title oracle. Null IDs are denied. The additive corrections are [current post-lock authority](../supabase/migrations/20261116091534_waitlist_current_authority_after_profile_lock.sql) and [private withdrawal receipts](../supabase/migrations/20261116100136_waitlist_private_withdrawal_receipts.sql); earlier SQL files and public API/grant identities remain unchanged.

The current waitlist APIs are `job_waitlist`, `my_job_waitlist` and `set_job_waitlist`. Availability notifications use `job_waitlist_available`, subject to the optional job update preference. See [urgent teaching cover](GUIDE.md#section-replacement-marketplace) for illness affecting an accepted teaching day.

<a id="section-assignment-handover-evidence"></a>

## Waitlist verification

The [waitlist browser regression](../tests/e2e/job-waitlist.spec.ts) exercises joining, reloading and leaving a real full offer without creating an allocation. The older native handover fixtures record the transactional behavior of the former substitution flow.

<a id="section-assignment-withdrawals"></a>

<a id="section-assignment-withdrawals-assignment-withdrawal-requests"></a>

# Assignment withdrawal requests

This implements the later product instruction that lecturer withdrawals with less
than seven days' notice need review. Ordinary job claims remain immediately
confirmed, first-come, first-served; this adds no claim approval queue.

<a id="section-assignment-withdrawals-lecturer-and-management-flow"></a>

## Lecturer and management flow

Open the confirmed job and choose **Withdraw from this assignment**. The displayed
window comes from PostgreSQL. At least seven days (168 elapsed hours) before the
first session, a direct withdrawal can be confirmed; its reason is optional. At
less than seven days, the dialog requires a 5–1000-character reason and submits a
pending application. It never removes calendar sessions or chat access while the
application is waiting. The submission transaction checks the time again, so an
old browser dialog cannot bypass the boundary.

Administration or Management opens the inbox notice, follows the job link, reads
the application and chooses approval or rejection with a decision note. Current
`jobs.manage` and AAL2 are required. A requester cannot approve their own work.
Approval cancels the entire claimed block atomically. Rejection leaves the
assignment confirmed. The lecturer receives the outcome in the inbox and sees the
note in the job. A rejection can be followed by a new application. If administrative
cancellation or substitution overtakes the application, it is closed as superseded.

Direct withdrawal or approval retains accepted fees, currency, terms, source and
contract snapshots, releases every session, removes assignment-only course-chat
membership and returns the vacancy to draft. Explicit participant-room membership,
other confirmed assignments and current enrolments retain access. Management explicitly reopens it.
Started or invoiced assignments require separate operational/financial review;
this feature does not create refunds, payments or accounting records.

Participant-room memberships created before source tracking are deliberately
unknown. If no other confirmed assignment or enrolment proves access, release
stops atomically until an authorized room manager uses **Resolve access basis**
to record independent access or a current assignment/enrolment basis. The former
survives release; the latter is removed once its last supporting source ends.
The same explicit decision is required before removing an enrolment when its remaining legacy chat membership has no recorded origin. A room owner is not silently removed. An authorized manager may explicitly remove
an unneeded member once no assignment or enrolment retains access. These decisions
are recorded in the audit trail. Existing ambiguous rows are never auto-classified.

<a id="section-assignment-withdrawals-api-and-privacy"></a>

## API and privacy

| RPC                                                                             | Result and scope                                                                                                                                     |
|---------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------|
| `resolve_participant_chat_origin(p_room,p_user,p_independent)`                  | A current authorized room manager explicitly records the basis of a participant-room membership.                                                     |
| `assignment_withdrawals(p_job_id)`                                              | Current actor's confirmed claims and own applications, or current authorized management applications. Null job selects a bounded cross-job snapshot. |
| `request_assignment_withdrawal(p_claim_id,p_reason,p_request_id)`               | Own confirmed future assignment only; returns application ID and current status.                                                                     |
| `review_assignment_withdrawal(p_withdrawal_id,p_approve,p_reason,p_request_id)` | Current management capability, MFA and non-author check; approves or rejects a pending application once.                                             |

Public wrappers are security invoker, private implementations have an empty
search path and explicit authenticated grants. Private application/command tables
have RLS and no client table grants. Reasons are plain authored text in private
application storage. Inbox rows contain only a kind and resource ID; link targets
are reauthorized when read. No private calendar, contract or DM administrator
bypass is added. No real email delivery is activated by implementing these notices.

Mutations require online confirmation. Actor-scoped UI caches refresh after a
confirmed response; uncertain responses retain the same request UUID for retry.
The command ledger binds actor, operation and payload; a changed payload cannot
reuse an old command. A rejected application needs a fresh explicit operation.
The existing lecturer/job/claim locks also serialize invoices, substitutions and
competing decisions. The old cancellation RPC refuses own short-notice attempts,
including actors who also have a management role. See [urgent teaching cover](GUIDE.md#section-replacement-marketplace) for reporting a specific teaching day affected by illness.

<a id="section-assignment-withdrawals-migration-and-operations"></a>

## Migration and operations

Apply `20261116170334_assignment_withdrawal_requests.sql` and the following
`20261117120000_participant_chat_membership_origins.sql` only through the existing
reviewed migration/update procedure. It adds private workflow tables, a cancellation
trigger and scoped RPCs; published prior migrations stay unchanged. Existing claims
and commercial rows are preserved, with no invented historical applications.
This code change does not install the migration in any hosted or ordinary database.

Revert application code through the existing recovery procedure if necessary;
do not drop application records or rewrite accepted history to roll back. Pending
applications require an authorized operational decision. Preserve workflow tables
in backups with the rest of the database. PR and QA records describe checks actually
executed; source/component tests alone do not prove native Auth, HTTP, retained data
or production readiness.

<a id="section-replacement-marketplace"></a>

# Urgent teaching cover

Open your confirmed assignment and select **Für einen Unterrichtstag krankmelden / Report sick for a teaching day**. Pick the day in the assignment's time zone and confirm. Its upcoming sessions appear together as **Notfall / Urgent cover** at the top of the regular **Assignments** list. Sessions that have already started and the other teaching days keep their existing allocation. The form requires only the teaching day.

Another available lecturer can accept the offer through the usual terms confirmation. The first database-confirmed claim reserves the released sessions. A company restriction removes the offer from the restricted lecturer's list and prevents a direct claim. An assignment with an existing invoice or a reserved invoice series requires course management review.

The old replacement link redirects to **Assignments**. Completed handovers are retained in the assignment history.

<a id="section-course-building-blocks"></a>

<a id="section-course-building-blocks-course-building-blocks-source-references-and-teaching-offers"></a>

# Course building blocks, source references and teaching offers

The approved curriculum catalogue contains **22 distinct building blocks from 24 supplied PDF versions**. Every block already has one reusable course template after the additive migration runs. Startup does not need OneDrive, Poppler or the original PDFs, and does not reset edited templates.

<a id="section-course-building-blocks-customer-independent-operation"></a>

## Customer-independent operation

A building block describes reusable teaching content, not a customer account. Source provenance does not assign an organisation, user membership, contract or commercial agreement. Create the actual customer under **Customers**, select that organisation when planning each course run, and reuse the same teaching template for other customers as needed.

Administration may invite client users and grant explicit organisation memberships. The server checks current membership and permissions for organisation requests and financial projections; client access is not a general catalogue, private-contact or teaching-discussion entitlement. This describes the existing organisation-scoped model, not a claim that every product module has a separate tenant workspace. See [customer/course operations](../deploy/hostinger/README.md) and client access.

Public documentation, examples and screenshots must use neutral descriptions or fictional organisations. Actual customer names, contacts and other business records are configured privately in the application and are not included as public provenance or product branding. Historical migration versions remain immutable; review the source hashes in the M4 review rather than rewriting installed history.

<a id="section-course-building-blocks-daily-workflow"></a>

## Daily workflow

1. Open **Courses → Templates**, search by code, title or curriculum and inspect the source. The detail shows the source filename, document revision/creation dates, content pages and complete SHA-256 fingerprint. Original PDFs are not publicly hosted and filenames are not broken download links.
2. Choose **Aus Vorlage erstellen / Create from template**. The source template is preselected. Select the actual customer, display time zone, delivery/venue and dates. The explicit weekday planner suggests the source's ten teaching days with editable daily times. It skips weekends; holidays, breaks and exceptions remain a planning decision. Save validates each actual time instant and DST ambiguity rather than silently shifting it.
3. In the course card's **Stellenbörse / Marketplace** section, choose **Auftrag für die Stellenbörse erstellen / Create marketplace offer** or assign an active company first. Adjust the proposed listing title and description, enter the financial terms, and save a draft or publish to the marketplace.
4. Administration enters the full customer fee under the privately configured compensation policy. Management without gross permission enters only the permitted lecturer compensation. The database binds the resulting job to the reviewed course version and takes the company and session references from that course.
5. A lecturer sees only their compensation and the source reference. Claiming reserves every actual session immediately through the existing atomic claim transaction. Gross offers appear in the appropriate client's request/spend list; net-only offers retain unknown gross and do not fabricate customer quotes.

Open **Courses → Edit** to update venue and access link. Publish the linked teaching offer to list it for eligible lecturers. If a sole linked offer has an editable future schedule, saving dates updates the course and the offer together. Eligible linked drafts also offer selectors for template, organisation, time zone and delivery mode. Changing the display time zone preserves the scheduled instants. For confirmed work, **Propose schedule change** opens the amendment form for the selected assignment and uses the existing approval workflow.

Use **Auftrag ansehen / View assignment** in the course card’s action row to open an existing offer, including filled and closed offers. Open **Kurs ansehen / View course** to reach the course editor. Course management can filter by confirmed lecturer and see their names in the offer status.

Next to **Kursarbeitsraum öffnen / Open course workspace**, choose **Auftrag bearbeiten / Edit assignment** to open the listing editor. They can change the title and description of a filled listing and open its class, assignment, contact and reference controls. Eligible unaccepted offers support direct date and authorised price changes. For a confirmed assignment, use the date fields in the same editor to draft a schedule proposal when the assignment is eligible. The proposal opens for review after saving. The amended terms take effect through the consent workflow. Linked template, company, delivery mode and time-zone changes follow the existing linked-draft rules.

A saved job contact takes precedence over the course's selected contact. With both fields empty, the assignment shows the company's newest active contact. Inherited details are available to current managers and confirmed lecturers. They remain separate from the editable job contact. Clearing the course selection restores automatic company contact selection for linked assignments.

To replace a lecturer, open **Dozent:in wechseln / Replace lecturer** beside their confirmed claim and select an eligible replacement. The entire future unbilled block transfers in one transaction. A conflict keeps the original assignment in place. On confirmation, the former lecturer sees that another lecturer is taking over and the replacement receives an assignment confirmation. The original accepted terms remain in the claim history.

Building-block/template discussions are attached to the actual reusable template, so teaching notes persist across runs of that template. Job discussions remain attached to the individual job. These are teaching-team discussions; clients/learners do not receive their bodies. Course enrolment, invoices and private commercial/DM/calendar boundaries remain independent and enforced.

<a id="section-course-building-blocks-source-identity-and-editorial-decisions"></a>

## Source identity and editorial decisions

The record's **Kurzzeichen** determines identity. The supplied `Bausteinbeschreibung-LPIC3.pdf` and `Bausteinbeschreibung_LPC3.pdf` both identify **LPC3** and contain the same curriculum after layout whitespace is normalised. The equivalent LPIC4/LPC4 pair identifies **LPC4**. Their PDF bytes differ and both versions are retained, rather than creating duplicate courses or pretending the files are identical. The LPIC-named variants have document revision 09 September 2026; the underscore LPC
variants have 05 September 2025. The newer version is the primary catalogue reference.

The maintained course naming is authoritative: LPC3 and LPC4 are module codes which together prepare for LPIC-1 102-500 after already completed 101-500 content, with LPC4 following LPC3. That project instruction is recorded in prerequisites/notes. Historical source titles and curriculum, including old certification identifiers, are preserved visibly; this import does not certify that those documents match current external exam requirements.

All other supplied codes remain separate: BVMM1, CIS2–CIS5, COS1–COS2, DLO2, EAA1–EAA2, GLCC, GRDB, ITE1, KIE1, LPC1–LPC4, MASL1–MASL2 and PTE1–PTE2. No CIS1 file was supplied and no missing course is invented. Source authors, book prices, ISBNs and room-preparation sections are not imported as curriculum. Wrapped lines and the repeated adjacent DLO2 bullet are normalised for reading; course content is otherwise left in its authored language.

<a id="section-course-building-blocks-data-and-authority"></a>

## Data and authority

| Owning entity                                                | Purpose                                                                                                                                      |
|--------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| `data/course-building-blocks.json`                           | Reviewed import artifact with 22 source-derived curriculum definitions and 24 exact-byte source versions; no PDFs or absolute personal paths |
| `building_blocks`                                            | Curated source curriculum, identity, stated duration, notes and default reusable template                                                    |
| `building_block_sources`                                     | Immutable filename/hash/page/date versions; only the primary-selector flag can change                                                        |
| `course_templates`                                           | Editable teaching content derived from the source, with a matching building-block/source foreign-key pair                                    |
| `course_runs` / `course_sessions`                            | Actual customer/delivery/time-zone and precise dates; reused directly by a job                                                               |
| `private.course_run_job_requests`                            | Actor/request UUID binding for durable retries of both financial modes; never exposed in lecturer APIs                                       |
| Existing private commission/request/accepted-revenue records | Real gross agreement and client linkage when known; accepted snapshots and old net semantics remain unchanged                                |

Source curriculum and editable teaching templates intentionally have different responsibilities. Editing a template does not rewrite the original catalogue definition. A template copy retains its exact source link, while run duplication continues to omit jobs, contracts, learners and chat members. Published offers, accepted assignments and protected course activity keep their linked source lineage. Eligible, unaccepted drafts can select another active template through the audited course editor. New source editions require an additive reviewed source and template version; accepted work does not
follow a mutable “latest document” pointer.

Staff may browse the approved source catalogue. Management writes require `courses.manage` and verified MFA; the new offer API also requires `jobs.manage`. Clients do not gain a general curriculum browse permission. Learners can read the source associated with their actual enrolled/completed course, and lose it upon revocation. No content import grants verified expertise, eligibility, a contract, attendance or a review automatically.

<a id="section-course-building-blocks-developer-apis-and-invariants"></a>

## Developer APIs and invariants

- `course_run_job_defaults(p_course_run_id uuid)` returns the trusted run/template/source/customer/delivery/topic/session DTO with a `source_revision`. Exact source session IDs are named `source_course_session_id` in this preview and stored as `job_sessions.course_session_id`.
- `create_course_run_job(p_course_run_id uuid, p_payload jsonb, p_platform_percent numeric default null, p_client_id uuid)` returns one job UUID. `p_client_id` is a required fresh request/idempotency UUID, retained unchanged for retries; it is not an organisation or client-account ID. The closed payload contains `source_revision`, currency, fee unit, optional terms, contract requirement, draft/published status and optional explicit deadline; amounts are either gross amounts for authorised admin/owner or
  net amounts for management. Source identity, customer, title, location and dates cannot be injected.
- The source fingerprint covers trusted curriculum/context/topic values and exact session IDs/epoch instants. It is independent of the SQL display time zone and excludes financial values. It is checked after course/template/organisation locks. A source changed after preview yields `course_run_source_changed`; the app preserves the entered financial draft and asks the user to inspect/reopen the latest course.
- The actor/request lock is acquired before the run lock. A matching retry returns the original UUID and changed request parameters conflict. A course run has at most one active marketplace draft. Open or publish that draft before creating another offer. For older duplicate drafts, the most recently created draft stays active and earlier drafts are available as archived offers. Each offer covers the whole schedule and can have 1–20 lecturer positions. Duplicate the course run in course planning for a separate cohort with its own schedule.
- The run needs an active actual customer (`course_run_customer_required`). Missing, past, nonfinite or overlapping sessions and deadlines after the first session are rejected without partial writes. Creating the job copies existing source session IDs and requirements without creating another organisation, template or run.
- Gross calculation delegates to the existing authoritative commission function inside the transaction; the lecturer job/claim/invoice remains net-only. The immutable claim/revenue transaction, qualifications, contract prerequisites and overlap protections are reused unchanged.
- `job_building_block_reference(p_job_id uuid)` returns only authorised source identifiers. It uses the same current job-access predicate as the marketplace/comments. `JobBuildingBlockReference` and `BuildingBlockReference` share the source display component; no second source-of-truth UI is maintained.

The typed frontend contract is `src/features/operations/building-blocks-api.ts`. Native catalogue queries live beside the existing operations queries; server wrappers are security invokers and privileged implementations stay unexposed. Every new exposed table has RLS, direct authenticated writes are denied, and source/schema/provenance guards also protect against accidental privileged edits.

<a id="section-course-building-blocks-reproduce-and-maintain-the-import"></a>

## Reproduce and maintain the import

```bash
node scripts/course-catalogue.mjs
node scripts/course-catalogue.mjs --source-dir "/path/to/the/provided/Building Blocks"
```

The second command reads originals with system Poppler `pdftotext`, checks every PDF hash and curriculum mapping and compares the reviewed artifact. It does not change a PDF or database. `--write` explicitly rewrites the catalogue artifact only after a human-readable diff review. `--sql` emits the deterministic current insert-only DML; a regression checks it against the forward migration's generated section. After an applied release, preserve old migration files and introduce a new migration for
additional/changed sources. Updating an existing code to a different curriculum deliberately requires manual version review, not silent alias dedupe. Changing the primary source for a used template requires a new template version.

The current sources are `scripts/course-catalogue.mjs`, `data/course-building-blocks.json` and the [customer-neutral forward migration](../supabase/migrations/20261116032005_customer_neutral_course_catalogue.sql). Historical migration `20261115155208` in [the migration directory](../supabase/migrations) remains byte-identical. The catalogue has no dependency on the user's absolute filesystem path at runtime. Its deterministic insert-only import is safe to reapply to missing initial rows and never
replaces user-authored template text. Original files remain in the user's existing folder.

<a id="section-course-building-blocks-customer-neutral-correction-and-installation-boundary"></a>

## Customer-neutral correction and installation boundary

The forward migration removes the original single-provider restriction and uses a bounded catalogue namespace independent of customer organisations. It neutralises only exact original catalogue labels and pristine default templates with no course runs, authored edits, topic changes, archive state or save-audit record. Historical used/edited templates, all source revision identifiers and accepted job/financial records remain unchanged. The same reviewed source can be reused for different customer
organisations without creating another course identity.

The five actual PostgreSQL upgrade groups verify two independent customer organisations sharing one template, scoped offers and an accepted claim before the change, exact retained records, edited templates and another neutral catalogue namespace. The existing 16 catalogue SQL groups and six catalogue unit checks also pass. Eight historical branded screenshots have been removed from public documentation. Exact PR23 CI passed the HTTP/SQL and persistence stages but failed two mobile pointer
actions (82/84 browsers). Strict pointer readiness and safe geometry diagnostics were added; the next complete outcome is recorded on PR23. The initial local canonical command had refused another checkout's shared QA lock. The historical results below describe their recorded source revisions only.

This migration replaces a constraint and includes bounded data changes, so it retains the existing operator-review gate. A source change or these local checks do not install it on any hosted instance. Do not rewrite historical migration files or bypass that gate.

<a id="section-course-building-blocks-verification-status"></a>

## Verification status

The complete canonical application run 03 passed in `.local/tests/0260b044/RESULT.txt`, completed **2026-11-15T16:43:20.241Z** (16 November Australia/Brisbane). It included all 16 course-building-block PostgreSQL cases and the actual `course-building-blocks-api-check.mjs` Auth/TOTP/REST journey, followed by both complete course-building-block browser journeys (desktop 7.8s, mobile 7.8s). The entire integrated run passed 52/52 browser cases, production build, 2/2 built-PWA cases and checked
isolated cleanup. Root the relevant pull request checks own the full aggregate source/runtime/Edge/SQL/API counts and exact submitted-revision CI status.

The course-building-block browser flow exercised catalogue search, DE/EN switching without losing the filter, dark/light rendering, exact source versions/checksum, literal template comments, generated ten-session run, authoritative financial-only offer, reused customer/template/run/source-session IDs, hidden customer gross and a real ten-session lecturer claim. Automated axe and document overflow assertions passed. Final desktop/mobile fictional screenshots were visually inspected: source
metadata is styled/readable, the intended palette accent is visible and desktop compensation stays beside the first content. No original PDF, real person, credential or MFA QR was captured.

Visual review of run 02 found that a direct lecturer job route did not load source-card CSS from the lazy course page. Shared `building-blocks.css` now loads from its actual shared component; source/planner rules were moved rather than duplicated. An undefined brand variable was corrected to the real palette token. Run 03's direct-navigation source-border and catalogue-accent assertions passed on desktop/mobile. The prior 02 screenshots are not final style evidence.

Five Node catalogue/provenance/reproducibility checks and three schedule tests passed incrementally. The catalogue SQL-generator guard was strengthened during run 03's already frozen application snapshot to reject both nested SQL dollar delimiters in future supplied source content. The new synthetic case first reproduced the missing exception, then all 5 Node checks passed; read-only original-source verification again matched 24 PDFs/22 blocks and the generated migration/data reproducibility
case passed. Only the import utility/test changed after that snapshot: no application, schema, reviewed JSON or embedded migration changed. Root records this narrow targeted correction separately, and exact submitted-revision CI runs the full current command.

All mutating API/browser checks use the random disposable stack and checked scoped cleanup. Normal/hosted data and original PDFs are untouched. Local Chromium/axe/source metadata acceptance does not assert current external exam requirements, hosted release readiness or a complete manual accessibility assessment.

Combined hosting/application acceptance also passed in canonical04 (`4c7c897`,17:31 UTC, exit 0): all new feature SQL/API/desktop/mobile journeys plus the full regression suite. See the relevant pull request checks. This is local acceptance; the M4 hosted migration review remains a separate gate.

<a id="section-course-learning-workspace"></a>

<a id="section-course-learning-workspace-course-workspaces-preparation-and-learning-evidence"></a>

# Course workspaces, preparation and learning evidence

The `/learning` hub and `/courses/:id/workspace` connect an actual course run to its assigned lecturers, current client-organisation members and explicitly enrolled participants. The course catalogue detail and client portal link to these workspaces. An unrelated lecturer, another client organisation, removed enrolment or inactive account does not gain access by guessing the URL. Course-management capabilities retain their current MFA requirement. Prospective lecturers browse live offers in the marketplace. Confirmed teaching allocation grants access to the course workspace.

<a id="section-course-learning-workspace-delivered-workflows"></a>

## Delivered workflows

- Management creates shared preparation items. Assigned teaching staff record progress with optimistic version checks; clients see only explicitly client-visible items. These are shared course tasks, separate from the existing lecturer's personal preparation list.
- Management explicitly selects one current contact from the course's own organisation. Course members see only the selected name/business email/phone, never internal contact notes or an unrestricted customer directory.
- Management shares a particular clean, scanned material version with staff, clients, participants or all authorised members and classifies it as material/report. Receipts reference that exact shared version. Replacing the underlying document does not silently replace the agreed file. Withdrawal and membership removal prevent subsequent downloads. The existing document/contract RLS is unchanged: course sharing does not grant general file-centre access.
- Enrolled participants can self-report attendance only around the actual session window. A self-report is labelled unverified. Assigned staff verify an ended session's state and actual minutes, with a required reason. Every correction retains before/after evidence, actor and time in a private audit ledger and rejects stale versions. Clients receive the authorised course attendance report; staff alone see correction reasons/history.
- Course Q&A is shared only among enrolled participants and assigned teaching staff. Personal course notebooks remain owner-only, including against general management access. Notebook conflicts retain the draft and provide explicit reload.
- After the course ends, enrolled participants and the linked client can submit versioned course feedback. The server retains the author privately for eligibility and duplicate prevention. Ordinary summaries disclose no names/IDs/timestamps and release average/comments only after three responses. The UI explains this policy and warns that free text can identify its author; it does not claim true anonymous collection.
- Teaching staff author/publish a mini quiz with immutable revisions, 2–6 options per question, pass threshold and maximum attempts. Learners never receive correct-answer fields. Attempts require current enrolment and a started course, serialize per learner, enforce the current revision/attempt cap and preserve accepted retry IDs. A new published revision has its own evidence and limit.
- A participant can issue a completion record only after the course ends, management has marked their enrolment completed, at least 80% attendance has been verified in every session, and any published quiz is passed. The record preserves issued name/course/timezone/session/attendance/quiz facts. Its PDF is generated on the server from these stored facts, with a stable record ID; it makes no legal-signature or external-certification claim. Assigned staff must explicitly revoke an active record
  before correcting its attendance evidence. Reissue requires a new staff attendance verification after revocation and all eligibility checks; the old record remains historical and its PDF is unavailable.
- A linked client can repeat a previously delivered request with new future dates. Topic, scope and quoted original-currency budget become a **new submitted request** through the existing validated/idempotent request workflow. No accepted assignment, rate snapshot or calendar allocation is copied or confirmed by this action.

All UI labels and explanatory notices are DE/EN; authored syllabus, questions, answers and notes stay in their authored language. Online writes wait for database confirmation. The open workspace refreshes periodically, on reconnection and on explicit refresh. The browser hides the learning workspace when offline and closes it if the server withdraws access.

<a id="section-course-learning-workspace-database-and-protected-documents"></a>

## Database and protected documents

Migration `20261116091015_course_learning_workspace.sql` adds private RLS tables for course settings, preparation, exact resource shares/receipts, attendance/corrections, Q&A, owner notebooks, protected feedback, quiz versions/attempts and immutable completion facts with auditable revocation. Direct browser table access is revoked. Public functions remain invoker wrappers around checked private implementations:

| RPC                                                                       | Purpose                                                                                                |
|---------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| `my_course_workspaces()`                                                  | Bounded list of current authorised course runs                                                         |
| `course_workspace(p_run_id)`                                              | Permission-scoped course projection, exact file versions and current action flags                      |
| `course_workspace_action(p_run_id,p_action,p_payload,p_expected_version)` | Explicit checked preparation/contact/resource/notebook/Q&A/feedback/attendance/quiz/completion actions |
| `repeat_client_request(p_request_id,p_sessions,p_client_id)`              | New idempotent client request from a delivered original                                                |
| `course_document_access(p_kind,p_id)`                                     | Current authorised exact resource-version or stored completion/report facts                            |

The `course-documents` Edge endpoint supports exact shared resource bytes, course completion/attendance PDFs, and the separately owned reviewed financial statement/assignment-confirmation RPCs. It checks actual Auth plus current active database permissions before and after storage/rendering; changed or revoked facts fail closed. Reviewed resource bytes must match their stored SHA-256. Responses are attachments with private/no-store headers and no public signed-link bypass. Browser downloads
recheck the current actor before releasing a blob.

The PDF/font libraries are pinned and bundled locally with integrity lock and license notices; the licensed DejaVu font is explicitly included through CLI `static_files` and selfhost `staticPatterns`. The exact selfhost worker has a read-only source mount, writable temporary cache and 512 MiB ceiling. Fonts support German accents and Greek/Cyrillic; unsupported characters return an explicit error rather than silently changing
names. [Asset provenance and reproduction](../supabase/functions/course-documents/assets/README.md).

Selfhost routing allows only the exact `course-documents` endpoint. The separately implemented `calendar-feed` capability endpoint is also explicitly registered: only its exact GET skips the router's ordinary JWT check; its own handler verifies owner-issued revocable capabilities. Other methods, suffixes and workers retain normal authentication. Caddy/Envoy access logging remains disabled. An actual upstream transport-error probe demonstrated that Caddy error logging still retained query
capabilities: its default runtime logger now strips every query from URI/URL fields and removes Referer. The new real 502 regression verifies calendar tokens, recovery token hashes and arbitrary private query values are absent while status/error diagnostics remain available. Runtime unexpected-error logging also records only fixed event, allowlisted error class and optional UUID reference; error messages/objects/stacks containing request URLs are not serialized.

<a id="section-course-learning-workspace-actual-evidence-and-remaining-acceptance"></a>

## Actual evidence and remaining acceptance

Executed on 16 November 2026 against disposable local resources:

- Eleven real PostgreSQL groups passed, including foreign/member/MFA denial, shared CAS updates, scoped contact, exact reviewed material without widened RLS, notebook/Q&A isolation, check-in versus verified audited correction, three-response feedback threshold, revisioned capped/idempotent quiz, eligibility/immutable completion/revocation/reverification, repeat-request idempotency and current revocation.
- Five meaningful React tests passed for permission-adapted UI, confirmed notebook/preparation persistence, stale-private-data removal and answer-only quiz submission/DE–EN state.
- Eleven Edge tests passed: six HTTP/Auth/hash/revocation cases, three real PDF/font/determinism/pagination cases and two capability-log privacy regressions. German/Greek/Cyrillic completion output was rendered with Poppler and visually inspected; no clipping or missing glyphs remained after word wrapping was corrected.
- An actual container using the configured **Edge Runtime 1.79.1 digest** passed a read-only, no-network, 512 MiB **user worker** PDF rehearsal. Its first run correctly exposed the missing static-font packaging; the owning CLI/selfhost configurations were fixed and the fresh rehearsal passed. Temporary labelled containers and files were cleaned.
- Sixteen actual isolated Envoy route cases and the full selfhost configuration validator passed. The central six-group database/API surface guard passed with 157 literal frontend RPC references. TypeScript/ESLint and source formatting passed at the integrated checkpoint.
- All eleven actual Caddy HTTP groups passed after the transport-error privacy correction, preserving public/API routing, headers, private path denial, maintenance fencing and atomic release behaviour. Owned fixture containers/network were removed.
- A real release-archive regression preserved all fourteen selected PDF runtime/font/lock/license assets with exact manifest hashes and extracted tar bytes. This verifies packaging completeness in a synthetic release fixture; it does not create or approve a production release.

`scripts/course-workspace-api-check.mjs` is authored for the canonical actual Auth/MFA/REST/ClamAV/Storage/Edge flow, including changed underlying file versions and deterministic protected completion bytes. `tests/e2e/course-workspace.spec.ts` supplies two workflows per desktop/mobile target, including client shared preparation/material download and learner notes/Q&A/quiz/feedback/completion PDF, DE/EN/dark/axe and screenshots. Those native suites count as passed only when the root's complete
command actually executes them; QA results owns final combined/CI evidence.

No real learner records, production course data, real email recipients, hosting or service settings were changed by this work. Existing fictional course-building-block catalogue references can be used with these workflows; the module does not fabricate attendance, quiz passes, signed certificates or legal acceptance.

<a id="section-course-readiness"></a>

<a id="section-course-readiness-course-readiness-centre"></a>

# Course Readiness Centre

The preparation centre extends existing course runs, confirmed assignments, contract versions, qualification attestations, scanned files and customer records. `/readiness` lists accessible preparations; `/readiness/:id` shows the checklist, authorised documents, meeting or venue, instructions and tasks. The dashboard widget reads the same server projection. It complements personal teaching preparation and does not replace that separate private workflow.

Readiness writes lock the current caller profile before waiting for the course gate. Management permissions, active status and assigned-lecturer/task authority are read after any profile wait and remain protected through the mutation or retained request reply. A role/status change that commits first prevents a stale browser request from confirming preparation.

<a id="section-course-readiness-authoritative-calculation"></a>

## Authoritative calculation

The course-start panel and Control Center use the same preparation checks. A course manager can assign a responsible course manager and an optional backup. Scheduled courses without an owner appear in the Control Center. The effective deadline is the earlier of the configured preparation deadline and 24 hours before the first session. The installed PostgreSQL scheduler sends in-app reminders to the responsible office up to 24 hours before that deadline and escalates overdue incomplete courses to the configured backup or current management. Draft-only plans are excluded from scheduled alerts. Check the scheduler on the target installation.

No percentage or readiness state can be edited. PostgreSQL recalculates applicable checks from current records for every response. The percentage is the number of complete applicable checks divided by applicable checks, rounded to a whole percentage. Customer organisation and contact are distinct checks so missing contact information is visible.

The checks cover every course session and every required lecturer position, an applicable documented agreement, verified qualifications covering the assignment, clean current teaching materials available to each assigned lecturer, HTTPS meeting or physical venue, active customer/contact records, explicit confirmation of the current schedule, acknowledgements of the current instruction version and required preparation tasks. Mandatory job contract prerequisites cannot be waived in preparation
settings. An incomplete course never reaches 100% or Ready.

Management selects requirements for internal/external courses, materials and instructions. Unconfigured courses default to requiring materials, a customer/contact and a documented agreement. Online courses always require a meeting URL; physical courses always require a venue. Agreement and qualification coverage use each assignment's interval, preserving independently allocated portions of a course. Schedule confirmation stores a source fingerprint; changing source session identifiers or
intervals invalidates that confirmation automatically. Missing lecturer, agreement, qualification, venue or schedule confirmation blocks readiness; other missing requirements require attention and become blocking when their deadline passes.

Preparation completed means every applicable check passes and the scheduled course end lies in the past. This is explicitly labelled as preparation, **not teaching delivery**. Attendance and proof-of-delivery use a separate auditable workflow.

<a id="section-course-readiness-responsibility-instructions-and-history"></a>

## Responsibility, instructions and history

Management with current `courses.manage` and MFA configures preparation, confirms schedules and creates/edits/archives tasks. A task can be assigned to the acting manager or a currently assigned active lecturer. Assigned lecturers can acknowledge only their own current instructions and complete or revoke completion of their own tasks. Management can document completion too. Changing task title or responsible person clears the current completion and preserves its previous value in private
history. Archiving retains the row and history.

Instruction receipts bind the exact numbered version. Editing instructions or changing their acknowledgement requirement advances that version, retaining older receipts. A new assigned lecturer does not inherit another lecturer's receipt. All writes use optimistic versions and request UUIDs. Matching uncertain retries return the original result; changed payloads cannot reuse the same request. The UI retains a request UUID while retrying an unchanged form. No mutation reports success before the
online server response.

<a id="section-course-readiness-privacy-and-integration"></a>

## Privacy and integration

Preparation is accessible only to current course managers with MFA or currently confirmed assigned lecturers. The existing broad visibility of published courses is deliberately insufficient. Participants, unrelated lecturers and customer memberships do not grant preparation access. Suspension/cancellation is checked on every read and write. Private tables have RLS enabled and no browser table grants; public RPC wrappers use invoker security and narrowly granted private implementations fix an
empty search path.

The lecturer projection exposes agreement/qualification validity rather than other people's contract identifiers, documents or prices. Customer contact existence is evaluated without returning private email, telephone or notes. Teaching documents must have a clean current version and be available through job scope or a current lecturer-course room membership. Personal CVs, contracts and manager-only files cannot satisfy teaching-material readiness. Rendering reuses the authenticated file
attachment/download boundary; no reusable signed Storage URL or offline cache is introduced. Existing authorisation still governs the linked course, calendar, profile, job and file screens.

Queries refresh on focus/reconnect and every 30 seconds while the centre is open. The dashboard shares the same cache without another timer. A denied refresh removes retained preparation content. Mutation handlers invalidate readiness only after server success; database recomputation remains authoritative regardless of browser invalidation. The implementation preserves DE/EN interface strings, authored content, intended IANA time zones, system/light/dark tokens and responsive layouts.

<a id="section-course-readiness-api-and-schema"></a>

## API and schema

The additive `20261116121554_course_readiness.sql` migration creates five private RLS-enabled ledgers: settings, tasks, instruction receipts, request idempotency and preparation events. Historical migrations are unchanged. These public authenticated functions form the API:

| RPC                                                                         | Purpose                                                                                                                                                                      |
|-----------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `course_readiness(p_course_run_id?)`                                        | Authorised current snapshots; an explicit inaccessible ID fails closed. The overview bounds results to 250 nonarchived courses, excluding those ended more than 30 days ago. |
| `save_readiness_settings(run, payload, expected_version, request_id)`       | Versioned applicability, instructions, meeting and deadline.                                                                                                                 |
| `confirm_course_sessions(run, expected_version, request_id)`                | Confirm the current source schedule fingerprint.                                                                                                                             |
| `save_readiness_task(run, task_id?, payload, expected_version, request_id)` | Create/edit/archive a responsible task.                                                                                                                                      |
| `complete_readiness_task(task, completed, expected_version, request_id)`    | Record or revoke completion with history.                                                                                                                                    |
| `acknowledge_course_instructions(run, instruction_version, request_id)`     | Own exact-version instruction receipt.                                                                                                                                       |

Preparation events keep detailed before/after records privately. Company-wide audit rows contain only safe action and course identifiers, without authored instructions or private contract content. The general audit viewer's reviewed action allowlist is a separate integration boundary.

<a id="section-course-readiness-verification-status"></a>

## Verification status

Executed focused evidence at the initial source checkpoint: 16 actual PostgreSQL groups in an owned networkless disposable fixture; 13 unit/component/API-adapter cases; whole-project TypeScript; focused ESLint. These cover incomplete courses, applicability, agreement/qualification revocation, clean/current material and membership rules, exact scheduling, stale/concurrent settings, idempotent retries, instruction versioning, task permissions/corrections, customer contact privacy,
suspension/cancellation, private-ledger/anonymous denial, literal authored content, offline mutations, server failures, DE/EN draft preservation and untrusted links.

`scripts/readiness-api-check.mjs` additionally exercises actual native Auth/MFA/REST, a real Edge/ClamAV/Storage material upload, instruction/task flows and immediate suspension. `tests/e2e/readiness.spec.ts` exercises actual management and lecturer UI, outsider denial, DE/EN, light/dark, responsive overflow, axe checks and offline refusal on desktop/mobile. These are canonical native/browser acceptance entry points; consult the source-bound QA results for their actual execution rather than
inferring a pass from their presence. The whole regression, native upgrade/retention, PWA and deployment status is recorded separately in the PR and QA results, not inferred from these focused checks.

No hosted database, real customer, production service, SMTP recipient or public marketing website was changed for this feature. X-platform installation and legal acceptance are not claimed.

<a id="section-teaching-delivery"></a>

<a id="section-teaching-delivery-attendance-and-proof-of-teaching-delivery"></a>

# Attendance and proof of teaching delivery

## Premium course session register

### Spreadsheet imports

Use the import panel in the owning workspace. Each panel provides a UTF-8 CSV and native XLSX template. Replace fictional examples with your own values, keep the headers and use one visible worksheet. Administrative spreadsheet imports also accept semicolon-separated CSV. Review the preview before confirming. Each spreadsheet supports up to 200 records.

- **Companies** creates new company records. Open a company to import its contact directory entries.
- **Courses** imports reusable templates or unpublished course drafts with one session per row. Drafts use the exact title of an existing template and, optionally, the exact name of a company. Enter the session start and end in local time using the zone in that row.
- **Course enrolment** uses the Luminovia IDs of eligible existing participants. This does not create new user accounts.
- **Topics** imports top-level topics, tools and languages. Use `topic`, `tool` or `language` in the kind column.
- **Personal calendar** imports private appointments atomically, using explicit offsets and an IANA display zone. Repeating the same appointment skips it.
- **Attendance** uses the selected session’s roster, reviewed and saved as a batch.

Other administrative imports commit each confirmed row through its ordinary write operation. They stop on the first server failure. Inspect the reported row and existing records before retrying.

In **Courses**, open an authorised Premium course and choose a session in the attendance register. Download its CSV or XLSX template to get the current roster identifiers and column order. The register accepts UTF-8 CSV and XLSX with one visible worksheet. Keep the headings and identifiers, fill `present`, `absent` or `excused`, and leave the status and optional cells empty for rows that should stay unchanged. Use literal values and enter optional arrival and departure instants as text with a UTC offset, for example `2026-11-20T09:20+01:00`. A change to an existing attendance record requires a correction reason. Each import supports up to 200 rows.

Select the file to preview the changes. The file stays in the browser and the names in the preview come from the current course roster. Confirm the preview to submit the versioned rows as a single operation. If an imported participant is removed or a reviewed record changes before submission, reload the register and review the file again. Scanned PDF evidence uses the separate attachment action.

## Teaching delivery record

The teaching evidence workflow uses the retained records from `20261116121600_attendance_delivery.sql`. The current interface is available through **Leistungsnachweise und Korrekturen / Delivery evidence and corrections** from assignment changes and through notification links. The [functional acceptance contract](../CONTRIBUTING.md) explains the isolated checks for the workflow.

<a id="section-teaching-delivery-daily-workflow"></a>

## Daily workflow

At `/delivery`, a lecturer opens an assigned session, records actual start/finish instants in its intended IANA time zone, selects complete, partial, cancelled or interrupted delivery and saves a draft. Partial delivery, cancellation and interruption require explanatory notes. A cancelled session has no delivered interval. Actual intervals must be finite, ordered and no longer than 24 hours. The frontend rejects ambiguous/nonexistent DST wall times; the database requires explicit offsets and
retains the intended zone.

The lecturer reviews the saved draft and explicitly submits it. Unsaved form edits disable submission so the screen cannot submit a different previously saved value without notice. Completed/partial/interrupted evidence cannot be submitted before its scheduled session begins or with an actual finish in the future. A cancellation may be reported before the scheduled date. No offline mutation is queued or displayed as successful.

Management selects its management overview to see missing and submitted evidence across assignments and compare scheduled with delivered minutes. A current course/finance manager with MFA can confirm, dispute or request correction. The reviewer cannot approve their own teaching evidence. Disputes/correction requests require explanations. Lecturer corrections carry a new reason and create a new immutable revision on submission. Prior submissions, review events and customer acknowledgements remain
available in history.

An explicitly assigned customer representative may choose the customer confirmation view and confirm the latest management-confirmed revision for their organisation. Their projection omits draft fields, lecturer notes, correction explanations, internal review notes and invoice identifiers. A removed organisation membership or an unconfirmed newer correction removes that customer access immediately on the next server read. Confirmation of an old revision never automatically confirms the
replacement revision.

<a id="section-teaching-delivery-data-and-permissions"></a>

## Data and permissions

The additive `attendance_delivery` migration creates four RLS-enabled private tables with no browser table grants:

| Record                         | Purpose                                                                                                      |
|--------------------------------|--------------------------------------------------------------------------------------------------------------|
| `private.delivery_records`     | Session identity, current workflow state, CAS version and editable unsubmitted draft                         |
| `private.delivery_submissions` | Immutable lecturer-authored numbered evidence, actual interval/zone and original scheduled interval snapshot |
| `private.delivery_events`      | Immutable submission/review/customer events, actor and timestamp with appropriate explanations               |
| `private.delivery_operations`  | Immutable actor/request receipts for exact idempotent retries                                                |

The existing `assignment_sessions → job_claims → jobs → course_runs` relationships determine ownership and customer scope. Browser-supplied user or role IDs never establish authority. A first submission requires a current confirmed allocation. If an allocation has been released, its lecturer can correct an existing submission only after an independent reviewer reopens that revision. The prior evidence and scheduled interval remain in history. Revoked or suspended actors cannot read or mutate delivery records. Current `courses.manage` or `finance.manage` and
AAL2 determine management access; support permissions confer no such access.

All writes lock the claim and session and compare the expected record version. Concurrent first drafts/reviews have one winner. Idempotent response-loss retries return their original result, while a request key reused for different values is refused. Current authority is checked before returning a stored receipt. Immutable-evidence triggers prevent replacement or deletion of prior submissions/events/receipts even by ordinary direct SQL writes. New business operations never disable those
triggers.

<a id="section-teaching-delivery-sql-api"></a>

## SQL API

| RPC                                                                                 | Behavior                                                                                                 |
|-------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------|
| `delivery_sessions(p_scope, p_before_at, p_before_id, p_limit)`                     | Cursor-paged own, MFA management or organisation-scoped customer projection; explicit `has_more`         |
| `delivery_session(p_session_id)`                                                    | Exact currently authorized detail, including older notification deep links                               |
| `delivery_history(p_session_id)`                                                    | Revision and event history, redacted for customer representatives                                        |
| `save_delivery_draft(p_session_id, p_expected_version, p_payload, p_request_id)`    | Validated draft; payload contains outcome, actual_start, actual_end, time_zone, notes, correction_reason |
| `submit_delivery(p_session_id, p_expected_version, p_request_id)`                   | Freeze current saved draft in a new numbered submission                                                  |
| `review_delivery(p_session_id, p_expected_version, p_action, p_note, p_request_id)` | Independent confirm, dispute or request_correction decision                                              |
| `confirm_customer_delivery(p_session_id, p_expected_version, p_request_id)`         | Explicit confirmation of current management-confirmed submission                                         |

Public RPCs are invokers around isolated, empty-search-path private authority functions. Anonymous execution is revoked. Invalid inputs, transitions and mismatched retries return HTTP 400. Denied access returns HTTP 403 for authenticated accounts. A stale version returns HTTP 409. The interface supports German and English.

<a id="section-teaching-delivery-cross-module-integration"></a>

## Cross-module integration

The delivery feature does not generate invoices or modify accepted fees, original currency, tax, claim terms, invoice PDFs or payment history. An invoiced claim can retain additional corrected delivery evidence while its accepted invoice stays byte-identical. Any financial amendment remains the explicit commercial workflow's responsibility.

Submitted and reviewed evidence creates minimal committed inbox notifications and audit entries without copying private notes. `private.delivery_notification_target()` resolves event destinations under current permissions; the shared notification resolver must include it. SMTP delivery remains subject to the separately owned notification-outbox/provider setup, never inferred from insertion of an inbox row.

Use **Diese Seite als CSV herunterladen / Download this page as CSV** in the delivery overview. The server refreshes the selected page under the current account and view before the download. The formula-safe file contains the returned sessions, original timestamps and time zones, scheduled and reported minutes, and stable outcome, status and revision codes. Missing submissions have blank evidence columns. Use the paging controls to export another page. Drafts, notes, correction reasons and invoice identifiers are excluded from the download.

<a id="section-teaching-delivery-acceptance-and-continuation"></a>

## Acceptance and continuation

```bash
npx vitest run src/features/changes/delivery.test.tsx
./portal test --phase system
./portal test --phase browser
```

`scripts/delivery-db-tests.mjs` covers the authority, versioning and evidence rules. `scripts/delivery-api-check.mjs` exercises actual fictional Auth/MFA/REST submission, concurrent review, customer redaction, correction history and inactive-token denial. `tests/e2e/delivery-correction.spec.ts` follows notification links through review and revision, checks a downloaded CSV and tests access by an unrelated lecturer in both Chromium projects. The work log records which revisions passed the checks. The canonical runner's shared lock protects independent stacks.

Remaining gates: exact combined `./portal test`, actual native retained-data/security CI, independent review, eligible merge and merged-source verification. Physical PWA platforms, other browsers and manual accessibility acceptance remain separate product-wide checks. Evidence identifies freelance teaching delivery; it does not assert employment, tax treatment or legal signature sufficiency.

<a id="section-client-request-briefs"></a>

<a id="section-client-request-briefs-customer-request-teaching-briefs"></a>

# Customer request teaching briefs

Customer requests now contain explicitly required whole teaching units, a 45- or 60-minute unit length, preparation instructions and a list of required documents. Teaching minutes must fit within the actual planned session duration. Breaks may occupy the remaining session time; none of these fields derives or changes an agreed commercial price.

The additive CLI migration `20261116091023_client_request_brief_and_history.sql` stores private versioned briefs and append-only request snapshots. Initial creation is atomic with the existing validated request creation. A repeated client key must match the same normalized initial brief. Edits use an expected version and the exact request row lock used by publication and cancellation. Only submitted requests with no linked published job may change. Existing older requests are explicitly recorded
as a baseline, not invented prior history. The UI pages through all retained revisions in groups of 25.

`create_client_request_with_brief`, `save_client_request_brief`, `client_request_brief`, `client_request_history` and `client_request_document_access` check the active database identity and exact current organisation membership. Existing gross-finance capability requires current MFA. Participants, unrelated customers and lecturers gain no new request access. Private tables have RLS and no direct authenticated write grants; history has no update/delete API. Database-owner maintenance and exact
fictional fixture cleanup remain possible.

The request card offers an explicit upload/share action through the existing file quarantine and malware scanner. It accepts only the uploader’s own clean personal `material` document versions, categorized as material or report. Contracts, CVs, qualifications/evidence and invoices cannot be attached, even by an administrator. An already shared version may be retained by another current member of the same organisation. Ordinary document/Storage RLS is unchanged. The `request_resource` kind in the
existing course-documents Edge function authorizes the exact request/version, verifies downloaded SHA-256 and rechecks both actual Auth and current request rights before returning bytes. Later private replacement versions do not silently replace agreed bytes; removed shares or memberships stop subsequent downloads.

Repeat booking copies teaching units, unit length, instructions and document requirements, then validates them against the newly chosen sessions. Attachments must be explicitly shared again. No enrolments, attendance, notebook, feedback, quiz attempt or completion record is copied.

<a id="section-client-request-briefs-verification"></a>

## Verification

Focused actual checks: nine PostgreSQL groups passed using disposable migration replay, including invalid-creation rollback, organisation/MFA isolation, real concurrent CAS, exact clean-version restrictions, unchanged private-file RLS, replacement/removal, immutable paged history, publication lock, repeat booking and membership/account revocation. Four component tests passed for retained conflict drafts, pending confirmation, teaching-time validation and read-only protected downloads in DE/EN.
The protected Edge suite includes request/version dispatch and authorization rechecks.

`scripts/client-request-brief-api-check.mjs` exercises actual Auth/REST, the existing scanner, exact uploaded/downloaded bytes, replacement, CAS, history and revocation. `tests/e2e/client-request-brief.spec.ts` exercises real initial UI submission, revision, scanned upload, exact byte download, reload/history and DE/EN accessibility on both configured browser sizes. These are authored canonical acceptance cases; their actual combined execution belongs to the root-owned complete QA run. They are
not presented as already passed here.

<a id="section-support-desk"></a>

<a id="section-support-desk-internal-support-desk"></a>

# Internal support desk

The support desk adds a persisted request, reply and resolution workflow. It is
separate from private chats and commercial documents. User-authored subjects,
descriptions and replies retain their authored language; interface text is
available in German and English and uses the existing theme and responsive shell.

Ticket creation and updates hold the current caller profile while waiting for request/ticket locks. Updates recompute support authority after a profile wait, including the manager flag used for internal notes. Suspension or staff-role withdrawal that commits first prevents both a new restricted write and an otherwise successful stored-response retry.

<a id="section-support-desk-access-and-lifecycle"></a>

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

<a id="section-support-desk-confidentiality-and-files"></a>

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

<a id="section-support-desk-notifications-and-reporting"></a>

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

<a id="section-support-desk-api-and-verification"></a>

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

<a id="section-workbench"></a>

<a id="section-workbench-private-workbench-and-reusable-workflows"></a>

# Private workbench and reusable workflows

`/workbench` provides own tasks, authorised shared operations tasks, workflow templates, private topic/customer favourites and explainable job recommendations. All UI is German/English; authored task/template text remains unchanged. The chat action creates a task linked to the selected message without copying its body. Such tasks are always private and disappear, including history, after current message/room access is revoked.

Creation retains one request identity across unconfirmed retries. Edits require an exact server revision. Bulk completion/reopening submits at most50 exact ID/revision pairs; one denied/stale entry rolls back the complete transaction. No success or new state is shown before the server confirms. Foreign private tasks remain unavailable even to administrators. Operations delegation and shared-template editing require current management permission/MFA; assignees can update state without rewriting
another creator's task details. Private tasks cannot be silently promoted into shared ones. Reassignment renews its committed task-assigned notice only for a new real reassignment.

Workflow templates use explicit add/remove task rows with0–365-day offsets, not delimiter parsing. Applying a specific revision produces new private tasks and preserves existing tasks when the template later changes. Retrying an unconfirmed application uses the same request identity. Templates can be archived; their creator must retain the required sharing capability before the UI offers shared editing.

Task pages use bounded stable creation-time/UUID cursors and state filters. History records before/after versions and is current-permission checked. The page shows authorised before/after title/state; the underlying authorised snapshots retain the complete saved fields. The server supplies operation capabilities and eligible assignees. Favourite customer choices remain limited to currently visible directory/course relationships; inaccessible/archived resources are omitted. Recommendations show
verified requirement counts and favourite reasons, exclude current qualification expiry and known schedule conflicts, and never substitute for a fresh atomic assignment claim.

Executed focused checks:11real PostgreSQL groups cover private/admin isolation, stable creation retries, concurrent revision conflicts/history, atomic bulk rollback, current-MFA delegation, immutable/private chat source with revocation, workflow application retries, favourite visibility and recommendation expiry/conflicts/cursors. Ten workbench component tests cover non-optimistic conflicts, exact bulk revisions, private message drafts, invalid DST rejection, structured rows, stable application
retries and offline blocking; six existing chat presentation/edit tests still pass. Whole TypeScript and focused ESLint passed at this checkpoint. Guarded Auth/REST and desktop/mobile DE/EN/axe/reload/offline fixtures are authored; their actual execution belongs to the combined QA report, not these focused passes.

Private task/template/history references deliberately restrict account deletion. Test-only cleanup removes exact fictional owners' dependent private rows in the canonical disposable project before deleting Auth identities; production deletion/retention is not implemented by that fixture. This source does not itself activate mail/push, create tasks for real people or certify a production release.

Notification/search deep links use `?task=UUID` and the exact current-permission-checked `work_task_detail` lookup, so a target beyond the first50rows opens without scanning every page. A dedicated regression places55newer rows ahead of an existing task and checks peer/admin/source-revocation refusal. The editor retains its original version even if a background detail refetch arrives, preserving draft/CAS behavior. Direct links also expose the authorised history action. Migration20261116091022
is an additive forward change; previous migrations are unchanged by this lookup.

<a id="section-timesheets-finance-control-center"></a>

<a id="section-timesheets-finance-control-center-actual-teaching-time-financial-facts-and-control-center"></a>

# Actual teaching time, financial facts and Control Center

Migration `20261116091017_timesheets_finance_and_control_center.sql` adds a private teaching-time ledger, printable financial facts and capability-scoped operational projections. The frontend routes are `/timesheets` and `/control-center`; every string supports German and English. Author-written notes and agreement text retain their authored language.

<a id="section-timesheets-finance-control-center-teaching-time-workflow"></a>

## Teaching-time workflow

Lecturers record completed actual teaching intervals inside their own confirmed, unreleased assignment sessions. Times are explicit instants, interpreted in the displayed account IANA zone; nonexistent or ambiguous local DST times are rejected in the form. Break minutes are integral and leave positive net teaching time. A session has one timesheet and active time intervals cannot overlap, including across assignments. Actual time never reprices an accepted compensation snapshot.

Saving uses a client-generated UUID and expected version, with identical lost-response creation retries handled idempotently. The lecturer submits a draft. Financial review requires current `finance.manage` plus MFA and may approve or reject a submitted version. Submitted and approved versions cannot be directly edited. An approved correction requires an explicit financial-review action and reason; the earlier approval remains in append-only history before the owner creates a corrected draft.
Any invoice-item history freezes further time changes, including cancelled/inactive invoice history. The existing lecturer mutex serializes this with invoice creation.

The UI preserves conflicting input, offers an explicit refresh, waits for server confirmation and disables writes/downloads offline. The history view shows recorded before/after states and review notes. Fresh authorised CSV downloads use the existing formula-safe exporter. Assignment-confirmation and earnings-statement PDFs use the protected document Edge function, with a current-identity check before download; they are not browser print placeholders. Approved time is supporting invoice
evidence. Invoice preparation continues to use the unchanged accepted compensation.

The public APIs are:

- `timesheets(p_from date, p_until date, p_all boolean default false)` → `{time_zone, can_review, items, sessions}`. Own scope is the default; all-lecturer scope requires current financial permission and MFA.
- `save_timesheet(p_id uuid, p_payload jsonb, p_expected_version integer default 0)` → the confirmed row. Exact payload: `{session_id, starts_at, ends_at, break_minutes, note}`; actor and state fields are rejected.
- `manage_timesheet(p_id uuid, p_action text, p_expected_version integer, p_request_id uuid, p_reason text default '')` → the confirmed row. Actions: `submit`, `approve`, `reject`, `request_correction`.
- `timesheet_history(p_id uuid)` → owned or currently authorised financial history.

All periods use `[from, until)` in the current account zone and are finite, with a maximum of 93 calendar days. Oversized time/statement results fail explicitly and require a shorter period; financial totals are not silently truncated. Direct private-table access is revoked and RLS is enabled as defence in depth. No user-editable metadata confers financial permission.

<a id="section-timesheets-finance-control-center-printable-facts-and-financial-scenarios"></a>

## Printable facts and financial scenarios

`assignment_confirmation(p_claim_id uuid)` and `finance_statement(p_from date, p_until date, p_all boolean default false)` return `{data, hash}`. The SHA-256 hash covers deterministic canonical JSON facts, excluding changing generation timestamps. Assignment facts include the exact accepted original-currency compensation/terms and retained sessions/status. Own financial statements contain only the caller's accepted net deals, current invoice status, approved minutes and currency-separated
totals. The statement period selects assignments by their first session; payments are the current recorded amounts associated with those assignments, not a fabricated period cashbook.

Recorded invoice payments are allocated across their claim items in exact original-currency cents using a deterministic largest-remainder allocation. The allocation totals match the actual payment ledger without independent-rounding drift. They do not represent customer receipts into Luminovia's bank account.

`finance_forecast(p_from date, p_until date, p_pipeline_probability numeric default 0)` requires current financial permission and MFA. Its exclusive date range is limited to 367 days, separate from the 93-day statement/timesheet APIs. Its monthly buckets include empty calendar months for currencies with forecast rows and separate accepted lecturer costs, known accepted gross/margin, unknown gross claims, probability-weighted open offer costs/gross and recorded lecturer invoice payments. Gross values, margins and unconverted customer-request amounts require the additional current `finance.gross.read` capability. The probability is an explicit scenario
assumption from zero to one, not a company commission rule or a booking commitment. Original currencies are never silently converted; legacy gross values are not invented.

<a id="section-timesheets-finance-control-center-operational-projection"></a>

## Operational projection

`control_center(p_from date, p_until date)` requires current `jobs.manage` plus MFA. It returns bounded, date-filtered lists of unstaffed offers, missing clean teaching materials, recent cancellations/handovers, currently readable overdue tasks and customer-request metadata. Contract and qualification expiry data require their separate explicit capabilities. Course preparation and aggregate quality require course management; averages stay hidden below three feedback responses. Private tasks and
revoked/private message-derived tasks remain protected by the task's current owning authorisation helper.

The UI includes actionable links to jobs, tasks/history, contracts, qualification profiles, course workspaces and the administrative audit. Each operational list displays at most 200 records and asks users to narrow the period when necessary. Financial scenarios use an accessible table and explicit probability control; privileged gross columns are omitted when not authorised.

The review notification kind is `timesheet_reviewed`, under reminder preferences. `private.timesheet_notification_target(uuid)` resolves only an owned or explicitly financial-authorised row and creates a date-scoped internal `/timesheets` link in the recipient's current IANA zone. External delivery stays generic.

<a id="section-timesheets-finance-control-center-evidence"></a>

## Evidence

Fourteen native PostgreSQL groups passed for exact own-session fields, real concurrent CAS, idempotent submission, MFA review, protected approval/correction history, invoice-history freeze, unchanged compensation, stable owned facts/hashes, exact-cent payment allocation, independent no-overlap enforcement, probability-weighted future costs, three-response quality thresholds, gross/currency separation and Control Center private-task isolation. Seven meaningful frontend cases passed for real
confirmation timing, protected submitted state, conflicting review input, owned PDF requests, scenario controls, permission gating and period validation. The actual REST/MFA suite and desktop/mobile DE/EN/axe/PDF workflow are defined in `scripts/timesheets-finance-api-check.mjs` and `tests/e2e/timesheets-finance.spec.ts`; their full isolated execution is a separate acceptance gate. No production installation, real mail, accounting/tax certification or bank integration is implied by source
checks.

<a id="section-calendar"></a>

<a id="section-calendar-calendar-private-events-assignments-and-published-global-events"></a>

# Calendar: private events, assignments and published global events

`/calendar` offers month, week, day and list views in the personal IANA time zone. Own private events remain editable; confirmed allocations link to the specific job. The title query loads only the actor's own confirmed job identifiers. Availability and blocked periods remain a separate connected workflow at `/availability`.

<a id="section-calendar-shared-calendar"></a>

## Shared calendar

**Global events** shows explicitly published, unarchived global events and the still-authorised published course runs. Private appointments are not copied into this calendar. The display uses the profile time zone; event details additionally show the stored event zone, description and, where present, an explicitly clickable HTTPS link. Descriptions are plain text. From the details, download an individual ICS file with the title and exact times. The description and related link stay in the portal.

Global events are queried only for the actually visible FullCalendar range. The start is inclusive and the end exclusive; an event must actually overlap the range. Switching month/week/day or navigating backwards/forwards changes the query through `datesSet` without remounting the calendar. A window is limited to 93 days. Pages of 50 results, an explicit **Load more events** action and `(updated_at,id)` as a unique descending cursor prevent a silent full-catalogue fetch or the former confusion
of the global 1,000-row REST limit with a complete inventory. The displayed number counts loaded global events, excluding separately displayed course sessions.

The existing course-run/template query retains its own resource authorisation and integration. It has not also been converted into a new paginated course API here. Own private events and confirmed allocations keep their existing queries. There is no automatic background loop over other calendar ranges.

<a id="section-calendar-manage-global-events"></a>

## Manage global events

Accounts with **current `courses.manage` permission** see management controls for the visible global-calendar range. They can:

- Create a draft with title, description, start/end, IANA zone and optional HTTPS link.
- Edit an observed draft and explicitly publish it.
- Withdraw publication.
- Archive an event and recover it as an unpublished draft.
- Search literally by title/description within the time window and load subsequent pages.

**Saving explicitly creates a draft.** Editing a published event withdraws its publication. Only another click on **Publish** makes the saved version visible. Archiving preserves the UUID and its version/request history. Recovery publishes nothing automatically. This intentionally differs from the separate unpublished-revision model for announcements. The interface explains this workflow before saving. An event saved outside the visible time window appears after navigating to its window.

Every change uses an observed version and a stable request UUID. An unchanged retry after a lost response returns the same confirmed server state. Different content with the same request UUID is rejected; concurrent versions do not overwrite one another. A version conflict preserves the draft for review. Authoritative access revocation immediately hides the private list and dialog, including during subsequent network failures. Only a successful authorised refresh opens a clean view again. Writes
are not confirmed offline.

<a id="section-calendar-invitations"></a>

## Global event invitations

In the internal portal, open **Einladungen verwalten / Manage invitations** on a published global event. Search by name and confirm the Luminovia User ID shown next to the person, or enter their known Luminovia User ID directly. Choose **Einladen / Invite**. An event version supports up to 100 recipients. The panel lists replies and lets you withdraw an invitation.

The notification opens the recipient's exact invitation. They can accept, accept tentatively or decline. The recipient sees their own reply. Calendar managers see the roster. Publishing an edited event gives it a new version and requires fresh invitations. Delivery is in-app.

<a id="section-calendar-time-and-links"></a>

## Time and links

Set your account default under **Profil → Zeitzone / Profile → Time zone**. Choose an IANA zone from the dropdown and save the profile. The dropdown lists common zones first and groups the other available zones below. The calendar, dashboard schedule and notification timestamps use this zone where they show times in your personal view. When creating a private event, you can choose the time zone in which you entered its local times.

Set the interface under **Profil → Standardsprache / Profile → Default language**. Use the adjacent account settings to change your email address or open the password form. On narrow displays, the cards stack. The account restores the saved language when you sign in, including on another device. **Deutsch (Schweiz)** uses Swiss spelling for translated interface text and Swiss date and number formats. Existing text authored by users keeps its spelling. Changing the language keeps the original currency on financial records.

Use **Kalenderanzeige in / Show calendar in** to change how the calendar displays appointments in the current view. **Profilzeitzone / Profile time zone** restores the account default. A zone change keeps the selected calendar date and leaves stored events and their original zones intact. In a repeated hour the calendar labels the UTC offsets. Global event details show both the original event times and the displayed times when the zones differ.

Database values are finite absolute instants with a stored IANA zone. New API payloads contain an explicit UTC/offset component and four-digit years. Form input is converted according to its zone. Nonexistent local times during the DST jump and ambiguous new local times during the fallback are rejected. Unchanged existing time fields retain their exact seconds and already unambiguously stored DST offsets during text-only edits.

Optional links accept only `https://` with ASCII DNS names or a complete IPv4 address and a valid optional port. Credentials, whitespace/control characters, backslashes, invalid hosts/ports and other protocols are rejected server-side and client-side. The browser opens links with `noopener noreferrer`. The platform does not fetch the destination server-side or claim to check its availability or external content.

<a id="section-calendar-api-and-permissions"></a>

## API and permissions

Additive migration created with the actually pinned Supabase CLI: `20261116080743_global_calendar_publications.sql`. Existing `global_events` rows and IDs remain; description, link, archive state and version/update metadata are added.

| RPC                                                                                     | Purpose                                                                                                                                                    |
|-----------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `global_calendar_events(p_from,p_to,p_manage,p_search,p_before_at,p_before_id,p_limit)` | Authorised overlap within a bounded range; at most 100 records, `has_more` and a tuple cursor. `p_manage=true` requires current management permission/MFA. |
| `manage_global_event(p_id,p_action,p_expected_version,p_request_id,p_payload)`          | Versioned/idempotent `save`, `publish`, `unpublish`, `archive`, `recover` actions. New drafts use `p_id=null`, version 0.                                  |

Public functions are invoker entry points into private implementations with an empty search path. Internal helpers are not executable by PUBLIC/anon/authenticated. Private request history has RLS and no browser table grants. Ordinary active client/participant/lecturer accounts may read only current publications. Direct table queries remain RLS-bound. A `p_manage` flag, foreign UUIDs or editable JWT user metadata grant no permissions.

Writes first lock the actor's profile `FOR SHARE`. The explicitly VOLATILE implementation then checks current roles, activation and MFA in a separate statement before acquiring request/event locks. Existing role management locks the same profile `FOR UPDATE`; an already-running role revocation therefore wins before a waiting write. There is no administrative bypass into other people's private calendars.

The audit projection adds exactly `calendar.global_save`, `calendar.global_publish`, `calendar.global_unpublish`, `calendar.global_archive`, `calendar.global_recover` and preserves the existing allowlist, including announcements. The viewer still returns only actor name, action, resource UUID and timestamp; descriptions, URLs and JSON details are not disclosed.

<a id="section-calendar-checks-and-boundaries"></a>

## Checks and boundaries

Actually executed focused checks: **11 RTL/unit cases**, **9 PostgreSQL groups** in owned temporary UUID databases and **6 generic API-surface groups**. Coverage includes more than 1,000 equal sort values, complete pages, permissions/MFA, actual concurrent CAS updates, controlled public role revocation against a waiting write, safe links, finite bounds, archive/publication workflow, private-calendar boundaries and safe audit filters. Frontend cases check preserved DE/EN/CAS drafts, lost
responses, revocation, DST and range changes without remounting the calendar.

```bash
npx vitest run src/features/calendar
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/calendar-global-db-tests.mjs
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/api-surface-db-tests.mjs
./portal test
```

`calendar-global-api-check.mjs` is authored for actual Auth/MFA/REST checks; `calendar-global.spec.ts` adds desktop/mobile, publication/draft, description/link, DE/EN, offline write prevention, dark mode and axe. These native scenarios were **not executed** during focused implementation. Their acceptance and combined PWA/persistence/CI results are documented separately by the later complete run in `the relevant pull request checks.md`.

This does not mark global-event attachments, invitations, background reminders, SMTP/push delivery, automatic publication, ICS subscriptions or private-event drag editing complete. They remain in the full master-prompt plan. Production services, real people and the public website were not changed.

<a id="section-calendar-export"></a>

<a id="section-calendar-export-personal-calendar-files"></a>

# Personal calendar files

The calendar page provides a deliberate monthly ICS download, suitable for import into calendar applications. Each click reads current authorised database records through `export_my_calendar`; it does not export stale calendar UI/query-cache data. The invoker RPC retains RLS and additionally fixes all ownership to the current active identity. No actor ID can be passed. Only confirmed, unreleased teaching sessions are included by default. Own private events require an explicit checkbox.
Administrators do not receive another person's private calendar through this endpoint.

The request has exact overlapping instant boundaries, a finite maximum of 93 days and a ceiling of 500 events. Overflow raises SQLSTATE 54000 rather than silently omitting events. The current UI selects one month in the profile's IANA zone. The file includes event identity, title, start/end and intended zone metadata; no fees, terms, participant lists, contacts, documents or signed URLs. UTC DTSTART/DTEND preserve repeated Berlin DST instants and Brisbane times without floating-time ambiguity.
RFC 5545 text escaping and75 octet Unicode-aware folding prevent authored titles becoming additional calendar properties.

The file is a snapshot. Later cancellations/changes do not update an already imported calendar. It is not an active subscription or proof of Google/Outlook/Apple import acceptance. Files leave the portal's controls when saved/imported; the UI explains the selected calendar provider will receive their contents. No private schedule cache or service-worker rule is added. Offline export is disabled.

Verification source: `src/features/calendar/ical.test.ts`, `scripts/calendar-export-db-tests.mjs`, `scripts/calendar-export-api-check.mjs`, `tests/e2e/calendar-export.spec.ts`. The first native run passed four SQL groups and three serializer tests. Current complete-command outcomes belong in the relevant pull request checks; authored API/browser cases alone are not a passed result.

<a id="section-calendar-connections"></a>

<a id="section-calendar-connections-calendar-subscriptions-and-explicit-offline-teaching-preview"></a>

# Calendar subscriptions and explicit offline teaching preview

The personal calendar now includes a read-only subscription section and an explicitly saved offline teaching preview. Both are available on desktop/mobile; the offline card remains reachable even when ordinary calendar queries are pending or failed. There is no automatic private-data caching or subscription creation.

<a id="section-calendar-connections-read-only-capability-feed"></a>

## Read-only capability feed

Each account can create up to20 calendar subscriptions. A browser generates32random bytes/64hex characters; the database retains only their SHA-256 hash. The complete provider URL exists only in the current browser session and is masked in the UI. Private personal events are excluded by default and require their own explicit checkbox. A subscription expires after90days; the user can renew/rotate or revoke it with an exact current revision. The old URL stops resolving after rotation. Creation and
immediate rotation retries use stable request identities, with changed payload/stale/revoked retries refused.

Anyone holding a feed URL has read capability for that chosen calendar scope; the UI explains this before creation. Copy it only to the intended calendar provider. The database list never returns a token/hash, and admin roles do not provide another account's subscription list or personal events. Calendar clients control refresh timing, so a provider may display an older snapshot after a cancellation until its next refresh. Revocation cannot erase calendar copies already made by a provider.

The exact public GET `/functions/v1/calendar-feed?token=…` hashes the capability, checks current active ownership/expiry/revocation, renders a bounded private UTC ICS and rechecks immediately before responding. It exports confirmed unreleased assignments, plus private events only for an opted-in feed, in a finite window and maximum2000events. It includes no fees, customer contacts, private file URLs or messages. Invalid, unknown, revoked or unavailable capabilities get the same generic404.
Responses use private/no-store, no-referrer and nosniff; the handler emits no cookie or redirect. Secret query values also need the owning proxy/runtime's access-log redaction before hosted activation.

<a id="section-calendar-connections-explicit-offline-preview"></a>

## Explicit offline preview

Saving offline fetches a fresh current-account calendar snapshot online after verifying the actual Auth user. It explicitly requests no private events and whitelists only confirmed teaching titles, start/end instants and intended IANA zones. Links, contacts, private events, IDs for jobs/assignments, files, commercial figures and messages are omitted. The selected horizon is the next30days; expiry is seven days after saving. The UI shows saved time/expiry and explains that later
changes/cancellations may be missing and that this is not a current assignment confirmation. Claims and business changes still require online server confirmation.

The opt-in snapshot is stored in a separate IndexedDB record scoped to the current account. No record means no opt-in/cache; opening the page alone performs no snapshot save. Same-account reload can retain a valid snapshot. Logout/account transitions synchronously change the cache identity/generation **before Auth state is exposed**, abort requests and transactions, and queue deletion. Read/write/open callbacks check account/generation, preventing late old-account responses or pending database
opens from repopulating the next account. The delete button is available offline and can cancel a pending save. Expired/invalid/foreign snapshots are unreadable and are cleared when checked; foreground expiry also clears the displayed snapshot. Closed browsers do not promise physical background deletion at an exact wall-clock instant.

The app shell remains the existing Workbox PWA. No API/private-file runtime cache is added. A cold offline page with a retained native SDK session can display only the explicitly saved own teaching snapshot when the current profile query is pending/paused or fails; the protected route outlet, announcements and tour remain unmounted. The fallback opens the snapshot directly, labels freshness timestamps with their display zone (UTC if the profile zone is unavailable), preserves each event's
recorded IANA zone and allows local deletion. It exposes no online-save or assignment action. A profile already known to be inactive or missing suppresses and clears the snapshot. Cold offline use still requires the previously installed/cached shell and a retained local authenticated session: existing SDK expiry/sign-out behavior is preserved. Seven days is the maximum snapshot age, not a promise that access survives logout or an expired session. Browser storage/device protections and
operating-system clock remain local-device boundaries.

<a id="section-calendar-connections-actual-validation"></a>

## Actual validation

Executed native PostgreSQL suite covers hash-only storage, owner/admin/peer isolation, exact create retries, private opt-in and foreign exclusion, service-only snapshots, rotation/old-token refusal, stale revision, explicit revocation, suspension and expiry. Its first run reproduced the rotation retry40001 problem; the owning unmerged migration was corrected and the same regression now passes. Nine tests with actual fake-indexeddb transactions exercise minimal whitelisting, private-event
rejection, server-verified identity, HTTP/account-switch cancellation, logout, expiry, explicit deletion, and an IDB open delayed until after account transition. Four component tests check private-default-off, confirmation-before-URL/masking, stable retries, unmount abort and offline controls. Whole TypeScript/focused ESLint and the existing three actor-boundary/six chat regressions pass at this checkpoint.

`calendar-subscriptions-api-check.mjs` is a guarded actual Auth/REST/native-HTTP fixture for unauthenticated feed GET, private/no-store/no-referrer/no-cookie headers, generic refusal, explicit private opt-in, rotation and revocation. `calendar-connected.spec.ts` exercises real desktop/mobile subscription UI, RAM-only secret display, current confirmed teaching export/minimal IndexedDB contents, offline warning/control state and logout deletion. Those authored fixtures await combined-run
execution; their existence is not a passing acceptance claim. The Edge handler's separate five Deno tests were already executed by the owning root task. No hosted token/provider subscription or production data was created by this source checkpoint.

The cold-start regression in `tests/e2e/pwa.spec.ts` belongs to the built-preview phase, separately from same-page offline checks. It saves a real fictional confirmed assignment online, closes the page (discarding all React/query memory), boots a fresh page offline through the registered service worker, checks only the whitelisted snapshot, verifies unchanged same-origin public caches, then confirms logout deletion and another signed-in account's empty cold-offline view. Five component
regressions use actual paused/error queries and IndexedDB for the fallback, known inactive/missing-profile purge, and normal online loading. Their focused checks do not replace the required canonical built-preview browser execution.

<a id="section-availability"></a>

<a id="section-availability-availability-and-blocked-periods"></a>

# Availability and blocked periods

Historical availability workflow: `/availability` now redirects to `/calendar`; the separate editor described below is not a current page.
At `/availability`, lecturers, management and administration accounts manage their own time windows. The private calendar links to this view. **Available** is a planning hint; **Unavailable** prevents new overlapping job allocations. A blocked period does not alter existing confirmed assignments: a conflicting new blocked period is rejected instead.

Windows have precise instants, an IANA time zone, a private note and an explicit management-sharing choice. Sharing is off by default. Language changes preserve the form draft. Nonexistent or ambiguous local DST times are not silently normalised; when time fields remain unchanged during an edit, the original seconds and already determined offsets are preserved.

<a id="section-availability-privacy-and-management"></a>

## Privacy and management

Even administrators cannot read other people's windows or notes directly from the table. The own-record RLS policy uses the current active account. The separate management view requires `availability.read_shared` and verified MFA. It returns only explicitly shared periods, status, time zone and the display name of a still-active lecturer account. It reads neither private appointments nor private notes. Withdrawing sharing affects subsequent server requests; the view offers an explicit refresh
action.

The interface limits a view to 93 local calendar days and returns at most 500 own or 1,000 shared windows. Server-side time bounds are also finite and limited; a small UTC allowance accommodates the DST fallback. The own-record API additionally allows up to 366 days per request. Availability is not a binding course commitment; only the existing atomic job claim confirms an assignment.

<a id="section-availability-transactions-and-preserved-history"></a>

## Transactions and preserved history

The additive migration `20261115210134_lecturer_availability.sql` follows the introduction of released historical allocations. Availability changes and active allocations use exactly the same lock order as job claims: the profile row with `FOR SHARE`, followed by the existing user-specific transaction advisory lock. Upgrading to `FOR UPDATE` within allocation would risk a deadlock and is avoided.

A new allocation trigger rejects overlapping **Unavailable** windows with `23P01`. The existing claim error path therefore rolls back the entire multi-day block, including earlier partial allocations. Conversely, the window trigger rejects blocked periods over confirmed, unreleased allocations. Cancelled and released intervals remain in history and do not block a new period. A release exits the trigger before new profile locks and adds no occupied time. Private calendar appointments are neither
duplicated nor converted.

Creation uses a UUID retained in the form. An identical retry after a lost response does not create a second record. Editing and removal check a version number; foreign identifiers, stale changes and existing sessions of suspended accounts remain rejected. There is no optimistic booking confirmation.

<a id="section-availability-api-and-tests"></a>

## API and tests

- `my_availability(p_from, p_to)` reads only the actor's own windows.
- `shared_availability(p_from, p_to)` returns the reduced opt-in management projection.
- `save_lecturer_availability(p_id, p_payload, p_version)` creates with version `0` or edits an observed version. The payload contains only `kind`, explicitly offset `starts_at`/`ends_at`, `time_zone`, `notes` and `share_with_management`.
- `remove_lecturer_availability(p_id, p_version)` removes the actor's own observed version.

Public RPCs are invoker functions; privileged operations are in the private schema with an empty search path and explicit execution grants. Direct client write grants are not provided.

Eight actual temporary PostgreSQL test groups include concurrent job claiming against blocked-period creation, rollback of a multi-day block that fails only at its final session, adjacent intervals, cancellation history, MFA/foreign-access/note protection, versions, retries and suspension with existing tokens. Component and date tests add DST, exact unchanged instants, draft preservation and actual pending save responses. `scripts/availability-api-check.mjs` and `tests/e2e/availability.spec.ts`
are intended for the isolated complete command; claim actual native/API/browser acceptance only from the relevant pull request checks.

<a id="section-taxonomy"></a>

<a id="section-taxonomy-shared-topic-and-tool-catalogue"></a>

# Shared topic and tool catalogue

The catalogue at `/topics` connects the same topic identifiers to profile expertise, course templates and job requirements. The three kinds are topic, tool and programming language; spoken profile languages remain a separate field. Entries have German and English labels and descriptions, up to 20 search aliases and an optional parent. Related course templates appear only when the current account may actually read them; links open the existing template details.

Active authenticated accounts can search and read. Search covers both labels and aliases, treats search characters literally and returns at most 500 entries. The interface waits 200 ms after text input and aborts superseded requests. Actor-bound query keys prevent reuse of another account's catalogue cache. The unfiltered list and parent selector share the same request.

<a id="section-taxonomy-management-and-history"></a>

## Management and history

`taxonomy.manage` is assigned to the existing `owner`, `admin` and `management` roles. Changes require this current database permission and verified MFA (`aal2`). Browser roles and editable Auth metadata do not authorise access. Even an MFA administrator receives no direct write grants on `topics`.

Creation and editing use the complete form data. Changes and archive transitions check the observed version number; stale edits cannot overwrite newer information. The form draft remains visible on conflict. The explicit **Reload current version** action reloads data and closes the draft; the current version can then be opened. An error or pending request is never displayed as a successful save.

A short global write lock on the small catalogue prevents two apparently valid concurrent parent moves from jointly creating a cycle. Self-references and descendants as parents are rejected. The migration validates existing hierarchies and aborts atomically for legacy cycles; it does not rewrite historical relationships.

Archiving preserves the identifier, existing course/job links and existing expertise with verification status and expiry. Active children must be archived first. New associations of an archived entry are blocked at the database boundary for profile expertise, course templates and jobs. Restoration requires an active parent. Archiving is not a confidentiality level: existing references may continue displaying their label.

<a id="section-taxonomy-api-and-checks"></a>

## API and checks

Public functions are invoker-only entry points into restricted private functions with an empty search path and explicit execution grants:

- `taxonomy_catalogue(p_search, p_kind, p_include_archived)` returns catalogue entries and permitted course templates. Archived search results require management permission.
- `save_taxonomy_topic(p_id, p_payload, p_version)` creates with `p_id = null` and version `0`, or updates an observed active version.
- `set_taxonomy_topic_archived(p_id, p_archived, p_version)` archives or restores an observed version.

Sources are in `src/features/taxonomy/` and the additive migration `20261115203718_taxonomy_catalogue_management.sql`. Existing migrations are not replaced. The meaning and scope of database permissions are documented in [ARCHITECTURE](../CONTRIBUTING.md).

Focused checks:

```bash
npx vitest run src/features/taxonomy
PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-m6 node scripts/taxonomy-db-tests.mjs
```

The SQL check creates and removes only its own temporary databases inside the local test container. Ten actual PostgreSQL groups cover MFA/roles, structured validation, literal search, opposing concurrent parent changes, course/participant access and revocation, legacy qualifications, stale versions, all three archived-association boundaries and atomic refusal of an invalid legacy hierarchy. An actually failing test found the original UPDATE name-resolution defect; acceptance checks passed only
after its correction.

`scripts/taxonomy-api-check.mjs` adds actual Auth, TOTP and REST checks in the explicitly isolated combined project. `tests/e2e/taxonomy.spec.ts` contains real desktop/mobile journeys covering DE/EN draft preservation, archive/restore, a read-only account, offline operation and axe. These checks must run only through the isolated complete command. An authored browser/API test alone is not a passed run; actual acceptance status is in the relevant pull request checks.

<a id="section-profiles-reviews"></a>

<a id="section-profiles-reviews-profiles-personal-labels-course-history-and-reviews"></a>

# Profiles, personal labels, course history and reviews

This module is an intentional internal staff directory with resource-scoped client/participant visibility, not an anonymous public directory. It supplies actual JSON RPC APIs and connected React routes. All actors need an active account; role information is read from trusted database rows.

<a id="section-profiles-reviews-api-contract"></a>

## API contract

| RPC                       | Parameters and result                                                                                                                                                                                                                                                    |
|---------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `people_directory`        | Optional `p_search` (100 chars), `p_label` (40 chars), `p_topic_id` UUID. Returns up to 200 safe profile summaries with authored biography, country/languages/labels/topics and permission-scoped average/count.                                                         |
| `person_profile`          | `p_user_id`. Returns the intentional profile projection plus teaching experience and `can_moderate`. No email, phone, CV, rates or financial fields.                                                                                                                     |
| `profile_courses`         | `p_user_id`. Returns confirmed taught course blocks grouped by actual assignment instants: `current`, `upcoming`, `past`, with course ID/title/timezone/topic IDs and `can_open` matching full-course read permission. No rates, terms or private customer contact data. |
| `own_profile_details`     | No parameters. Returns own country/languages/teaching experience/labels.                                                                                                                                                                                                 |
| `save_profile_details`    | `p_payload` containing the complete replacement of country/languages/teaching_experience/labels. Labels: at most 20 × 40 chars; languages: 15 × 50. Caller identity always comes from Auth; unknown fields reject.                                                       |
| `enrolment_candidates`    | Management capability + MFA; up to 500 active eligible participant/admin/owner names/IDs.                                                                                                                                                                                |
| `course_enrolments`       | `p_course_run_id`; management + MFA. Safe names/statuses for that run.                                                                                                                                                                                                   |
| `manage_course_enrolment` | `p_course_run_id`, `p_user_id`, `p_status` (`enrolled`, `completed`, `removed`). Management + MFA; completed requires an actually ended course. Audits every change.                                                                                                     |
| `reviewable_courses`      | Own completed attendance only, actual assigned lecturers, no self-review. Includes own existing versioned review for editing.                                                                                                                                            |
| `submit_course_review`    | `p_course_run_id`, `p_lecturer_id`, `p_rating` (integer 1–5), `p_comment` (2000 chars), `p_version` (0 for new). Returns review UUID; stale/concurrent versions reject.                                                                                                  |
| `delete_course_review`    | `p_review_id`, `p_version`. Author-owned versioned tombstone clears authored comment and removes it from profile views.                                                                                                                                                  |
| `lecturer_reviews`        | `p_user_id`; up to 100 recent review projections under resource authorisation. Other lecturers/clients do not receive reviewer IDs or names. Author/moderator can see own/relevant moderation status.                                                                    |
| `moderate_course_review`  | `p_review_id`, `p_hidden`, `p_reason` (mandatory, max 1000). `reviews.manage` + MFA; audited hide/restore. Authors cannot unhide by editing or withdrawing/re-submitting.                                                                                                |

These public functions are SECURITY INVOKER wrappers around narrowly permissioned private implementations with an empty search path. Direct writes to profile detail, attendance and review tables are denied. Every exposed new table has RLS. Details table is owner-only; the directory is the deliberate minimal sharing boundary. Detailed reviewer table rows are restricted to the author or an authorised MFA moderator.

<a id="section-profiles-reviews-visibility-and-data-integrity"></a>

## Visibility and data integrity

Staff can read staff profiles. A client sees only lecturers actually assigned to their currently linked organisation and only the corresponding course/review history. A participant sees only lecturers and history for their active/completed enrolments. Revocation removes those reads immediately; a revoked enrolment cannot submit another review. Administrators do not bypass real enrolment, actual completion, assigned lecturer or no-self-review rules.

Profile labels are authored descriptions, never verified qualifications, permissions or role grants. Actual topic verification remains separately managed. Ratings are one per course/lecturer/reviewer, serialize concurrent creation, and use optimistic versions. Public average/count calculations use the same authorisation and exclude withdrawn, moderated or non-completed-enrolment records. Reviewer identity remains omitted from ordinary projections. Comments render as text, including literal
code/HTML characters.

Course detail URLs `/courses?run=<id>` open the real authorised course dialog and management enrolment controls. Profile course links use this actual route only when the actor may open full course details; otherwise the permitted minimal history remains text. Closing the dialog clears its URL selection. `/people`, `/people/:id`, `/my-reviews` and the own-profile details widget are central integration points. The profile direct-message action appears only for a contact returned by the actual chat
contact API.

<a id="section-profiles-reviews-executed-evidence"></a>

## Executed evidence

- `node scripts/profiles-db-tests.mjs`: **14 real disposable PostgreSQL checks passed**, replaying the complete migration set. Covers labels/limits, profile privacy, real current/upcoming/past blocks, client scope, mandatory MFA, explicit completed attendance, no self/fake/cross-course review, concurrent creation, anonymisation, stale versions, moderation, revocation, withdrawal/recovery and suspension/anonymous denial.
- Two label-boundary unit checks passed; feature formatting, ESLint and current integrated TypeScript passed.
- `scripts/profiles-api-check.mjs`: **passed in the isolated canonical run `m3-test-04`**, using actual Auth/TOTP/REST. Covers persisted labels and safe directory, completed-course enrolment, restricted history, author-versioned anonymous reviews, MFA moderation, cross-participant denial and immediate revocation/suspension with existing sessions.
- `tests/e2e/people.spec.ts`: **passed on desktop Chromium (11.6 s) and mobile Chromium (10.7 s) in `m3-test-04`**. The actual browser journey saved/reloaded own details, searched and filtered the directory, opened and closed the authorised course deep link, enrolled a completed participant through an MFA management session, submitted a real review, verified anonymous escaped output, moderated the review, and verified its removal from the lecturer view and moderation notice for its author. Each
  actor uses an independent browser context.
- Profile and participant-review pages passed the configured axe WCAG 2 A/AA, 2.1 AA and 2.2 AA checks and horizontal-overflow assertions on both browser targets. Desktop/mobile profile screenshots were visually inspected: readable stacked/mobile and two-column/desktop layouts, visible labels/course periods, anonymous rating and literal escaped HTML. These automated checks do not establish every accessibility requirement or real-device acceptance.
- The complete canonical command passed all 46 application browser scenarios and two built-PWA scenarios, then cleaned up the isolated services. Local report and screenshots: `.local/tests/b1c83645/RESULT.txt` and `.local/tests/b1c83645/screenshots/*-person-profile.png`.

No production records, real attendance or real learner evaluations were used. QA results owns the final integrated outcome and remaining acceptance. Course participants remain optional: no enrolment is created merely because someone has a participant role.

<a id="section-qualifications"></a>

<a id="section-qualifications-qualification-evidence-and-verification"></a>

# Qualification evidence and verification

The M8 source adds explicit sharing of a **specific own certificate version for a selected topic** to the existing manual management attestation. The evidence picker searches server-side with actual page cursors (20 entries, at most 50). Upload and quarantine remain in the existing Files/ClamAV pipeline. A file, upload or sharing grant alone does not verify a qualification.

In your own profile, select a topic, choose a clean certificate version, confirm the sharing text and save. Management opens the evidence/review-history view for that topic, downloads exactly that version if needed and confirms verification with an optional future UTC expiry. The existing manual review path remains available. A new upload/file replacement does not change an existing sharing grant. Replacing or withdrawing evidence changes neither an existing verification nor accepted
assignments. A professionally required revocation is an explicit management decision; its validity continues to affect future claims through the final course end.

<a id="section-qualifications-permissions-and-file-versions"></a>

## Permissions and file versions

`qualifications.verify` with current MFA authorises the targeted evidence workflow, no longer blanket reading of other people's certificates. The new Files action `qualification_evidence_download` requires the current binding ID. It checks permission, owner, personal certificate type, clean exact version, size and SHA-256 before downloading and rechecks the sharing grant after Storage retrieval. It creates neither general document/version rights nor a reusable Storage URL. Revocation or an error
hides cached evidence details in the interface; private files are not retained offline.

Existing separate permissions remain: `users.manage` with MFA can still read other people's CVs; contract/finance permissions retain their previous scope. The qualification feature adds no CV, contract or invoice access. Management and administration can upload a certificate for an active subordinate lecturer when their current permissions allow it. The selected lecturer owns the file. The uploader can consult that file while their delegated authority remains active. Other private certificates remain available to reviewers only through an explicit topic share.

Withdrawal, replacement, document archiving or removal of a topic ends the former evidence download grant. Adding a topic again does not restore an old grant. Review history contains decision/basis and events; a historical entry grants no historical download access. Existing verifications are not assigned invented retrospective history.

<a id="section-qualifications-database-and-apis"></a>

## Database and APIs

New CLI migration: `20261116080746_qualification_evidence_and_attestation_history.sql`. Existing migrations remain unchanged. Private tables `qualification_states`, `qualification_evidence`, `qualification_events` and `qualification_requests` have RLS and no browser table grants. Current topic selections remain in `lecturer_topics`; the new core does not alter underlying job claims, accepted terms or calendar allocations.

| RPC                              | Contract                                                                                             |
|----------------------------------|------------------------------------------------------------------------------------------------------|
| `own_qualification_certificates` | Only own clean personal certificate versions, literal search and a bounded cursor.                   |
| `qualification_review`           | Current topic state, CAS version and only currently shared version metadata.                         |
| `save_qualification_evidence`    | Own explicit binding; `p_version_id=null` withdraws access; CAS and request ID required.             |
| `attest_qualification`           | Current management permission/MFA, CAS/request ID, optional exact current binding.                   |
| `verify_lecturer_topic`          | Unchanged legacy signature; delegates manual attestation to the same internal decision/history core. |
| `qualification_history`          | Bounded history with a cursor for the owner or a currently authorised reviewer.                      |
| `qualification_evidence_access`  | Current narrowly scoped version for the authenticated download adapter, never a storage path.        |

Mutations first lock the active acting profile, then check its current role/permission. Role management and suspension use the same profile lock. Waiting calls cannot bypass an already committed role revocation with an old JWT. Topic/CAS state and evidence are then locked consistently. Reusing a request ID with a changed payload is rejected; confirmed retries write no additional decision and return the **currently sanitised state**, excluding revoked private metadata. At most 30 new changes per
actor/minute; retries consume no second change.

History is immutable to browsers. Only privileged server-side cleanup can delete it: owner/account deletion cascades own private data, deleting a reviewer account removes its personal reference, and server-side version purge removes affected evidence references and their events. Normal startup, profile changes, soft archiving and the UI perform no such purge. This controlled boundary also supports existing UUID-scoped test-fixture cleanup; it is not a delivered retention interface.

<a id="section-qualifications-verification-and-boundaries"></a>

## Verification and boundaries

Focused executable checks:

```bash
PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-m7 node scripts/qualifications-db-tests.mjs
node_modules/.bin/deno test --allow-env supabase/functions/files/qualification-download_test.ts
npx vitest run src/features/qualifications/evidence.test.tsx src/features/admin/people.test.tsx
```

Executed in the M8 working source: **16 actual PostgreSQL groups**, **22 component cases** (16 new and six People cases), **four Edge download tests**, Edge typecheck/lint, TypeScript and scoped ESLint passed. All six API-surface groups also passed after actual replay of the current migrations.

SQL cases use an owned random temporary database in the authorised local scratch container. They check actual lock barriers for role revocation through both old and new decision paths, CAS/retry/rollback, only explicitly shared versions, topic removal, MFA and controlled cleanup. Edge tests exercise the actual download logic, including version/hash/owner mismatches and withdrawal during object retrieval. Component cases check explicit consent, lost responses, expiry, cache disposal and targeted
queries.

`qualifications-api-check.mjs` and `tests/e2e/qualifications.spec.ts` are intended for the canonical isolated `./portal test` environment. Their existence is not yet executed Auth/scanner/browser evidence. Root documents complete native acceptance after the actual run. No external issuer authenticity check, signature validation, automatic email or legal-compliance certification is claimed.

<a id="section-qualification-passport"></a>

<a id="section-qualification-passport-personal-qualification-passport"></a>

# Personal qualification passport

The own profile offers an explicit German/English PDF download for an active lecturer account (including the existing functional admin/owner lecturer role). The export reads only the current authenticated subject. It has no subject-ID parameter, management export mode, public link, automatic sharing or certificate-byte attachment.

The structured projection lists selected expertise with separate verified, unverified and expired states. Current certificate availability is independent of the last recorded attestation basis/date and exact historical evidence hash. A withdrawn binding does not silently revoke an existing qualification decision. Legacy verified rows without recorded attestation history state that the date/basis is unknown. No education history, certificate status or new verification is invented. Optional
country, language and teaching-experience fields remain explicitly labelled unverified self-declarations; contact details, CV contents, private storage paths, contracts and fees are excluded.

`own_qualification_passport(p_locale,p_as_of)` uses the actual current active lecturer identity, an empty private search path and restricted execution grants. The new additive migration leaves all earlier source bytes unchanged. Its bounded timestamp labels the snapshot; current expiry is evaluated against server time. The protected document gateway creates one server timestamp for both reads, renders reviewed fields using the existing pinned Unicode PDF/font runtime, then checks actual Auth and
exact facts again. Changed qualifications, evidence availability, exported profile facts or access prevent byte release. The SHA-256 fact hash is a reproducibility/integrity reference, not a signature or external certification. Download responses are private/no-store; browser unmount/account change aborts late downloads and Blob URLs are revoked by the existing shared downloader.

The export supports at most 250 selected expertise records and returns an explicit error instead of silently truncating them. Unsupported font characters are reported to the user. It does not cache private PDF responses for offline use.

Focused evidence: five actual isolated PostgreSQL groups cover states, hashes, legacy provenance, owner/admin/participant boundaries, withdrawal, rejected proof and suspension; four component checks cover explicit consent, DE/EN, offline refusal and abort. Thirteen Edge checks include the actual deterministic Unicode PDF renderer and long-report pagination. Fictional German/English PDFs were rendered and both languages' pages visually inspected for clipping, margins and legibility; English text
was also extracted and checked. The guarded Auth/REST/Edge API and browser download scenarios are authored separately and require execution in the canonical combined acceptance before claiming a native end-to-end pass.

<a id="section-profile-avatars"></a>

<a id="section-profile-avatars-profile-pictures-and-their-permission-boundary"></a>

# Profile pictures and their permission boundary

This feature extends the existing real private document/ClamAV pipeline. It does not publish pictures on the internet or make a personal-document bucket readable to peers. Original teaching materials and unrelated local pictures are not imported.

<a id="section-profile-avatars-data-and-api"></a>

## Data and API

- `profile_avatars` stores one selected immutable `document_versions.id` for each user. Its direct RLS grants only the active owner a read; clients do not directly write selections. The version foreign key is indexed.
- `set_profile_avatar(p_version_id uuid default null)` selects an owned, clean, nonarchived personal document of kind `avatar`, or removes the current selection when passed null. Metadata, bytes and ownership remain separate. Repeating the same selection does not create another audit event. A failed new upload leaves the previous selection unchanged.
- `profile_avatar(p_user_id uuid)` returns only `{version_id, updated_at}` or null for a permitted profile with no available image. It reuses `private.can_read_person`: current staff peers see intentional staff profiles; clients and enrolled learners see only their actual assigned teacher. Existing private contact/evidence/contract/calendar/DM boundaries remain intact. Suspended actors or inaccessible people receive a permission error.
- `POST /functions/v1/files` with JSON `{ "action": "avatar", "user_id": "…", "version_id": "…" }` uses the caller's actual Auth identity, active account and selected-profile RPC. The optional version binds bytes to the browser's selected image; the server rejects stale versions before metadata or Storage reads and confirms the returned version in `X-Avatar-Version`. Older callers may omit the version and receive the current permitted clean selection. Current visibility and selection are rechecked after Storage before returning PNG bytes. Headers include `no-store, private`, `nosniff`, no-referrer and a restrictive content policy. No public/signed URL is produced. Generic `action: download` retains its existing personal-document rules,
  including for administrators.

<a id="section-profile-avatars-image-safety-and-privacy"></a>

## Image safety and privacy

The profile editor accepts PNG/JPEG/WebP input up to 10 MiB, checks encoded dimensions before browser decoding (edge ≤8192 and ≤16 million pixels), centre-crops a square, resizes to at most 512 px and creates a new PNG. Original filenames, EXIF/GPS data, comments and compressed colour-profile metadata are not copied. This is a normal rasterisation step; it is not a promise to remove information visibly present in the image itself.

API callers upload this **canonical PNG** through the normal multipart document endpoint with `scope=personal`, `kind=avatar`, a fresh `client_id` and file field. The stored output is ≤2 MiB, ≤512 px per edge, 8-bit RGB/RGBA, noninterlaced PNG. The server validates PNG signature, CRCs, chunk order, complete bounded zlib scanlines/filter bytes and permits only image data, colour intent and pixel-density chunks. It rejects textual/EXIF/ICC chunks, oversized images, malformed/truncated/trailing
data and inflation bombs. Database guards independently enforce personal ownership, canonical MIME and byte-size limits; actual bytes additionally require normal quarantine and a real clean ClamAV result. Original general-file formats and access rules are unchanged.

Replacement selects a new exact clean version. Selecting another image or removing it does not silently delete retained old private document objects; retention/purge remains the documented platform follow-up. Archiving a selected underlying image makes the picture unavailable. Ordinary readers cannot request old avatar versions through the picture action.

<a id="section-profile-avatars-browser-lifecycle-and-design"></a>

## Browser lifecycle and design

The same `Avatar` component appears in the navigation, lecturer directory, lecturer profile and own profile editor. Initials provide a readable branded fallback when no image is selected, retrieval is denied/unavailable, or the browser is offline. Queries include both actor and target identity and are memory-only with zero idle retention. Picture responses are not service-worker cached. Every object URL is revoked on version/identity changes, offline transition or unmount; a late previous-actor
response cannot replace the current image. Current metadata is periodically/refocus revalidated, while the gateway authorises every new byte request. Previously viewed pixels cannot be retrospectively erased from another device.

The editor explains centre crop/visibility, offers accessible file-picker/removal controls, reports actual scan/save status and handles invalid images without false success. German/English and light/dark use existing brand tokens. The shell additionally now catches rejected sign-out SDK promises; failures preserve the current workspace/query cache and allow retry, while pending state prevents duplicate submission and success waits for server acknowledgement.

<a id="section-profile-avatars-executed-evidence-and-acceptance"></a>

## Executed evidence and acceptance

Incremental checks passed: 10 real disposable PostgreSQL cases; 6 Deno PNG/gateway-boundary tests and the actual files entry-point typecheck; 8 Vitest cases (3 shell logout, 2 source-dimension and 3 Blob-lifecycle/offline cases); targeted ESLint and the complete current TypeScript check. Gateway units explicitly verify replacement/removal or membership revocation during Storage retrieval denies the old response. The PostgreSQL fixtures explicitly do not claim real bytes or Auth; separate actual
API and browser suites cover those boundaries.

The following integration suites passed in the canonical guarded `./portal test` project and cannot mutate normal development:

- `scripts/avatars-api-check.mjs` uses the shared actual Auth/MFA fixture/cleanup helper, real PNG/ClamAV/private Storage/hash bytes, invalid-format/metadata/dimensions, generic download/Storage/signed-URL denial, separate client/enrolment visibility/revocation, replacement/removal and suspension.
- `tests/e2e/avatars.spec.ts` uses actual distinct browser identities, real JPEG input containing fictional source metadata, browser crop/resize, scan/save/reload, exact clean PNG/no EXIF, safe invalid-source retention, permitted peer display, removal, English/dark axe/overflow checks and fictional screenshots.

Complete local acceptance is recorded below. Physical-device image picking, browser implementations beyond the tested engine and deployed hosting/security remain separate acceptance gates. See `the relevant pull request checks.md` for the exact submitted-revision CI and broader product evidence.

<a id="section-profile-avatars-m4-02-integration-checkpoint"></a>

### M4-02 integration checkpoint

The canonical `./portal test` run `6bb8adbe` passed the actual avatar API suite with real Auth/MFA, ClamAV, private Storage/hash/bytes and scoped revocation/cleanup. Both full avatar browser journeys passed: desktop 4.9 seconds and mobile 5.2 seconds, including actual source EXIF, 512 px crop/rasterisation, scan/save/reload, peer visibility, metadata stripping, malformed-source retention, removal and English/dark axe/overflow assertions. Their retained fictional screenshots were visually
inspected for readable controls, helper/error text and layout. The blue circle is an intentionally flat-colour image fixture, not an absent picture.

That whole invocation failed two pre-existing global-offline browser cases because the avatar editor unnecessarily repeated the application-wide offline status. The duplicate local notice and unused translation were removed; controls still disable offline and the global connection banner remains the single source for connectivity feedback. A new focused regression and the other avatar/shell source checks passed 8/8. The unchanged actual global-offline browser regression and the complete
build/PWA/cleanup gates await the next canonical invocation; no complete passing command is inferred from this partial checkpoint.

<a id="section-profile-avatars-m4-03-final-local-acceptance"></a>

### M4-03 final local acceptance

The complete canonical command passed in `.local/tests/0260b044/RESULT.txt`, completed at 2026-11-15T16:43:20.241Z (16 November Australia/Brisbane). It repeated the actual avatar API/SQL/Edge checks and passed both avatar browser journeys: desktop 5.0 seconds and mobile 5.1 seconds. The unchanged global-profile offline regression passed on both layouts at 2.4 seconds each after removing the redundant notice. All 52 application browser workflows, the production build and both built-PWA checks
passed, followed by owned-project cleanup. The final desktop profile screenshot was visually reviewed again; the prior mobile review and unchanged avatar layout remain consistent with the passing final mobile assertions.

This establishes the tested local workflow and permission boundaries, not a claim that every production platform or every possible failure has been certified. No further avatar application/test source changed after this accepted snapshot. GitHub integration and release status belong to the root delivery record.

Combined hosting/application acceptance also passed in canonical04 (`4c7c897`,17:31 UTC, exit 0): all new feature SQL/API/desktop/mobile journeys plus the full regression suite. See the relevant pull request checks. This is local acceptance; the M4 hosted migration review remains a separate gate.

<a id="section-staff-contact-visibility"></a>

# Voluntary contact sharing within the teaching team

At `/profile`, each active team account can independently share its saved email address and telephone number on its internal team profile. Both choices are off by default. The preview shows the values actually saved in Auth and the personal profile; an unsaved telephone draft is not confirmed as the shared value. The setting persists after a reload. The contact profile offers safe email and telephone actions when the saved value is suitable.

The existing `people_directory` and `person_profile` projections retain their previous scope without an email address or telephone number. A separate, narrowly scoped `person_contact(p_user_id)` function checks the active account identity, both people's current trusted team roles, profile access and the target person's explicit sharing choices on every request. Client-only and participant-only accounts do not receive staff contact details even when they can access a course profile.
Administrative rank does not bypass consent. Existing separate account-management permissions remain in effect; the profile interface explains this boundary.

Preferences are stored in `private.staff_contact_visibility`, protected by RLS without direct browser grants. `contact_visibility_preferences()` reads only the current user's settings. `save_contact_visibility_preferences(p_payload,p_expected_version)` accepts only two Boolean choices and the matching version; the user's identity and contact details come from the server. A stale or concurrent save cannot overwrite a newer version. A conflict preserves the draft and offers an explicit reload.
Non-team accounts cannot enable sharing.

Shared contact details are read from the current saved sources on each request, rather than maintained as a directory copy. Disabling sharing, losing a role or suspending an account prevents subsequent disclosure. Information already read by another person cannot be recalled. The interface revalidates normally stale data on focus or reconnect; an open profile requires a reload to show a visibility change immediately. A failed access check does not display retained contact details. New query keys
contain both account identities, and the existing authentication boundary clears the private cache when accounts change.

Contact values are rendered as text. Email links encode the complete address so its characters cannot inject additional mail headers. Telephone links accept only simple phone numbers and typical separators; executable or parameterized content is not linked. No message is sent and no call is made automatically.

## Focused checks performed on 16 November 2026

- Eight isolated PostgreSQL test groups passed: private defaults, active team roles, exactly selected fields, client/participant/administrator boundaries, real concurrent version conflicts, manipulated input, current stored values, unchanged minimal profiles, revocation, role loss and suspension.
- Five component tests passed: safe contact actions, confirmed saving without a foreign browser-supplied ID, conflict with explicit reload, hiding retained values after denied access, hostile values and DE/EN switching.
- `scripts/staff-contact-api-check.mjs` and `tests/e2e/staff-contact.spec.ts` were created for the canonical disposable full test run. They count as passed only after actual execution; the relevant pull request checks record integrated results.

```bash
node scripts/staff-contact-db-tests.mjs
npx vitest run src/features/profile/contact.test.tsx
```

No real contact details, production records or email credentials were used.

<a id="section-chat"></a>

<a id="section-chat-chat-structured-mentions-and-group-moderation"></a>

# Chat, structured mentions and group moderation

This extends the existing member-only chat described in CHAT_SECURITY.md.
It uses the same PostgreSQL, Auth, Realtime, scanned file gateway and in-app inbox.
No separate application server or external notification service is introduced.

<a id="section-chat-connected-user-flow"></a>

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

<a id="section-chat-persistence-and-public-apis"></a>

## Persistence and public APIs

Migration `20261116080730_chat_structured_mentions.sql` is additive. All earlier
delivered migrations stay unchanged.

| API                                                                                            | Contract                                                                                                                                            |
|------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|
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

<a id="section-chat-notification-semantics"></a>

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

<a id="section-chat-actual-verification-and-remaining-acceptance"></a>

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

<a id="section-files"></a>

<a id="section-files-file-centre-search-personal-tags-and-virtual-folders"></a>

# File centre: search, personal tags and virtual folders

The file centre at `/files` searches server-side across all documents the current account may actually read. The previous workflow first loaded a list and then searched only in the browser. Because local and self-hosted REST queries are intentionally limited to 1,000 rows, older files remained invisible. A component probe that failed before the correction reproduced exactly this empty state with 1,001 metadata rows. The limit remains; the new search filters before the page boundary.

<a id="section-files-search-and-loading"></a>

## Search and loading

`document_discovery` uses literal filename search, optional owner/category/job filters and personal tag/folder filters. `%` and `_` are ordinary search characters. The interface waits 250 ms after input, aborts superseded transports and preserves input focus. The existing `/files?q=…` entry point, for example from the dashboard, remains available.

A page contains 40 rows; the API permits at most 100. The cursor contains `created_at` **and** the document UUID. Equal timestamps therefore do not lose or duplicate entries. **Load more files** actually loads the next server page and merges IDs without duplicates. There is no invented global result total; the display counts loaded files. Every fetch rechecks `private.can_access_document` and the current active account. An empty job/owner filter grants no additional access.

The discovery query loads no file contents and does not periodically poll every loaded page. Focus, reconnect, explicit refresh and existing document mutations revalidate results. The attachment job catalogue is requested only when upload is open in an authorised job context. Existing subject/job views and attachments retain their metadata/scan/version queries; this document does not claim new pagination for every embedded legacy view.

<a id="section-files-my-organisation-only"></a>

## My organisation only

Each account can give a **currently accessible** document up to 20 personal tags of 60 characters each and a personal virtual-folder label of up to 80 characters, independently of other readers. Tags are normalised with the existing label validator and stored without case-insensitive duplicates. One tag per input line preserves commas within a label. An empty folder means unfiled; the special filter option finds exactly those files.

The association is a private account/document pair in `private.document_organisation`. Another lecturer or administrator receives neither these tags nor the folder. Two accounts can organise the same shared file differently. Filters apply across all currently accessible files, not only pages already loaded. Tag/folder filters compare complete labels case-insensitively.

A virtual folder is a personal label, not a Storage directory or hierarchical folder manager. It moves no bytes, changes neither ownership nor sharing and claims neither security classification nor DLP. Private contract/invoice/chat/profile files receive no new administrative grant.

`save_document_organisation` derives the account only from `auth.uid()`. The API accepts only document identifier, `tags`, `folder` and expected version. Version `0` represents an absent own association. Concurrent changes have exactly one winner; a stale version is rejected with `40001`. The draft remains visible. **Reload current organisation and close draft** explicitly discards it and reloads current metadata before another edit.

Archiving, revoked room/job permissions or account suspension prevent the association from acting as substitute permission. Hidden documents also disappear from searches through personal tags and cannot be organised further. A current server error stops displaying retained discovery data. The existing Auth account switch additionally clears the in-memory cache; query keys include the account. There is no persistent offline cache.

<a id="section-files-stable-dialogs-and-current-resource-access"></a>

## Stable dialogs and current resource access

A pending filter fetch replaces result rows but preserves an already open archive/version/edit dialog and personal organisation drafts. New results use their own rows; data from other filters or accounts is not adopted. A legitimate empty filter result does not end a started operation.

Only actually opened targets receive a bounded exact-metadata check through the existing `documentQuery`. Account, document identifier, successful list observation and focus generation separate this check from old responses. Writes remain disabled while a check is unresolved. `null`, deleted/wrong target identifiers and permission errors discard the affected modal and its protected drafts. This also covers individual room-access revocation where the list response succeeds but is empty.
Subject/job file lists use the same protection.

A previously blocked filename must not reappear from an old search cache or a merely appended page. Only an actually new complete response from the current observer can renew this quarantine. Network and version conflicts preserve permitted drafts; `42501` discards the original target. Late successes or failures from an old operation do not close a different draft opened in the meantime. There are neither per-result-row queries nor an additional polling loop.

After an acknowledged rename/archive write, the file lists explicitly cancel reads started before that acknowledgement and then fetch current results. Invalidation alone can reuse an initial filter request with no cached data, allowing an older pre-archive snapshot to restore a deleted row. A deterministic held-response regression reproduced this and now proves the old request is aborted, exactly one write occurs and a new post-commit read determines the empty result. The independent
exact-resource ACL query is not cancelled. All 51 focused discovery/version/polling cases pass on this correction; its complete current-head native results are recorded separately.

This correction was reproduced first and checked by **47 passing file-component cases** with controlled transport barriers, cache/paging/focus transitions and exact write counts. Native complete acceptance remains separately recorded in the relevant pull request checks.

<a id="section-files-preserved-file-pipeline"></a>

## Preserved file pipeline

Upload, byte/MIME/size validation, quarantine and actual ClamAV scanning, private Storage, version history, preview Blob lifetime, rename and archive remain connected. Downloads continue using the existing authenticated file gateway with current resource checks and the selected version; tags or folders provide neither a public URL nor a Storage bypass. A metadata row is not evidence of an existing scanned file.

The additive CLI-generated migration is `20261116080732_file_discovery_personal_organisation.sql`. The previous 24 migrations are not replaced. The new table has RLS, no client write grants and no admin exception. Public RPCs remain invoker entry points into restricted private implementations with an empty search path and explicit execution grants. A timestamp/UUID index supports discovery pages and an account-bound folder index supports private filters.

<a id="section-files-verification-and-continuation"></a>

## Verification and continuation

```bash
npx vitest run src/features/files
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/files-discovery-db-tests.mjs
```

Before combined M7 acceptance, focused checks passed 18 file component/unit cases, six actual discovery PostgreSQL groups and six generic API-surface groups. The API-surface run found no anonymously executable application functions; this does not claim actual native Auth/REST/browser acceptance. TypeScript, scoped ESLint/format checks and script syntax also passed.

Focused SQL checks use owned temporary UUID databases. They show the old 1,000-row problem and check more than 1,000 accessible metadata records, literal search, complete pagination with equal timestamps and concurrent records, foreign/admin access, private shared-file associations, CAS races, invalid payloads, archiving, revoked permissions and existing suspended token identities. Component checks cover deep links, focus during a pending response, actual cursor forwarding, DE/EN drafts, pending
saves, conflicts, offline operation and hiding old data. Existing scan-polling, version and exact-download checks remain.

`scripts/files-discovery-api-check.mjs` reproduces the actual REST row cap with more than 1,000 fictional metadata records and checks the new API with actual Auth accounts. `tests/e2e/file-discovery.spec.ts` adds desktop/mobile, actual pages, a real scanned upload and byte-identical download after organisation, role boundaries, DE/EN, dark mode, offline operation, archive and axe. Authored native API/browser cases are **not** passed runs. The combined checks actually executed are documented in
QA results.

Independent course/organisation file contexts, hierarchical shared folders, expiring sharing links, restricted archive formats and retention/purge tools remain further master-prompt work. This change creates no external storage, public sharing or new infrastructure.

<a id="section-resource-comments"></a>

<a id="section-resource-comments-comments-on-templates-and-jobs"></a>

# Comments on templates and jobs

`ResourceComments({kind: "template" | "job", resourceId})` provides a resource-specific teaching-team discussion. Jobs use the same `private.can_read_job` check as job RLS; templates require their actual read permission and a teaching-team/management role. Course or invoice access does not give clients and course participants access to teaching-team discussions. Admin/owner accounts remain subject to the usual role, MFA and resource rules.

Records and earlier text versions are stored in unexposed private tables with RLS and no direct user grants. The server supplies the author and timestamps. The UI renders plain text, including line breaks and escaped HTML. Comments do not automatically include gross prices and do not change accepted assignment terms.

<a id="section-resource-comments-api"></a>

## API

| RPC                                                                   | Behaviour                                                                                                                                     |
|-----------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| `comment_context(p_kind,p_id)`                                        | Current writing/moderation capabilities; no rows when access is denied.                                                                       |
| `resource_comments(p_kind,p_id,p_before_at,p_before_id,p_limit)`      | Newest first, complete timestamp/UUID cursor, at most 100 rows. Hidden posts are visible only to their author and authorised moderators.      |
| `add_resource_comment(p_kind,p_id,p_body,p_request_id)`               | 1–5000 characters, actual actor identity, durable resource-bound retry with the same UUID; at most 10 new posts/minute and 100/day per actor. |
| `edit_resource_comment(p_comment_id,p_body,p_version)`                | Only the actor's own accessible posts, with a checked version; no silent overwrite, author change or removal of moderation.                   |
| `withdraw_resource_comment(p_comment_id,p_version)`                   | Author withdrawal removes the text from ordinary read projections; the withdrawal notice and protected history remain.                        |
| `moderate_resource_comment(p_comment_id,p_hidden,p_reason,p_version)` | Current management capability for the resource type and MFA; reason and current version required; audited.                                    |

Archived entries remain readable to authorised people, prevent new posts/edits and still allow authors to withdraw their own posts. Hidden drafts, revoked roles and suspension are checked again on every server call. Text already read cannot be removed retrospectively from a recipient's memory; subsequent requests remain protected.

Error codes: `42501` for missing permissions, `22023` for invalid text/cursor or a changed retry, `40001` for a version conflict, and `54000` for the posting limit. An uncertain network attempt keeps the same request ID while the draft remains unchanged. Offline operation or a pending mutation never produces a false publication confirmation.

<a id="section-resource-comments-implementation-and-verification"></a>

## Implementation and verification

Migration `20261115155038_resource_comments.sql`; frontend `src/features/comments`; actual SQL/API scripts `comments-db-tests.mjs` / `comments-api-check.mjs`; Playwright `comments.spec.ts`. The shared API fixture helper and `defer` cleanup contract are explained in the [developer guide](../CONTRIBUTING.md).

The complete local M4-03 run passed eleven actual temporary PostgreSQL checks covering boundaries, ten concurrent identical writes producing one record, cursors, author/moderator versions, withdrawal, role revocation and suspension; three component checks covering the access gate, separate drafts and uncertain retry/server confirmation; actual Auth/TOTP/RPC calls and separate desktop/mobile browser journeys for writing, reloading, editing, moderating and withdrawing. Additional acceptance after
integration with hosting code is documented separately in the relevant pull request checks. The private history is not a completed statutory retention/deletion policy.

Combined hosting/application acceptance also passed in canonical04 (`4c7c897`,17:31 UTC, exit 0): all new feature SQL/API/desktop/mobile journeys plus the full regression suite. See the relevant pull request checks. This is local acceptance; the M4 hosted migration review remains a separate gate.

<a id="section-announcements"></a>

<a id="section-announcements-portal-announcements"></a>

# Portal announcements

Announcements are authenticated, bilingual portal notices. A shell banner shows
at most three currently visible, unacknowledged revisions. The complete
`/announcements` page uses explicit server cursor pages and can open one exact
published revision from an inbox link. Neither view opens a modal or moves focus
when new content arrives.

<a id="section-announcements-administration-and-publication"></a>

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
4. **Archive** immediately closes the current publication to new reads and ACKs. **Recover** restores the retained publication subject to its original audience
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

<a id="section-announcements-revision-acknowledgement-and-inbox"></a>

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

<a id="section-announcements-storage-permissions-and-api"></a>

## Storage, permissions and API

The additive CLI migration is
`20261116080739_portal_announcements.sql`. Earlier delivered migrations and the
separate quiet-preference migration remain unchanged.

Private RLS-enabled tables store announcement state, immutable draft revisions,
immutable publication receipts, own acknowledgements and exact operation retry
records. State points separately to the latest draft and current publication.
An index resolves current publication IDs without scanning every parent; ordinary
list queries start from current publication pointers rather than loading revision
history. No public table grants expose drafts, audiences or operation parameters.

| Public RPC                                                                     | Contract                                                                                                                                                                   |
|--------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
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

<a id="section-announcements-actual-validation-and-remaining-acceptance"></a>

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

<a id="section-notifications"></a>

<a id="section-notifications-notifications-and-preferences"></a>

# Notifications and preferences

The bell, dashboard and `/notifications` use the same account-bound source. The preview shows eight entries and the actual count of all unread notifications. On request, the inbox loads another 40 notifications using a stable timestamp/UUID cursor. Read/unread changes and bulk acknowledgement appear only after a successful server response. Bulk acknowledgement applies only through the previously fetched timestamp; newly arriving notifications remain unread.

`/settings` offers German/English language, light/dark colour scheme and four notification preferences: chat, forum, matching/reopened jobs and reminders. These four switches are stored server-side per account with a version number. A concurrent save does not overwrite a newer version; the draft remains available and can be explicitly reloaded. Language changes preserve the draft. Writes are disabled offline.

<a id="section-notifications-security-and-data-flow"></a>

## Security and data flow

The additive migration `20261115204354_notification_inbox_and_preferences.sql` extends the existing notification table. Public invoker RPCs delegate to private definer functions with an empty search path, explicit execution grants and checks of the current active account identity. Administrative permissions do not open another person's inbox. Mixed own/foreign ID batches are rejected in full. The preferences table is private and permits no direct browser writes.

The API resolves resource links and titles against current resource permissions. After chat membership is revoked or a resource is removed, neither its old title nor a still-usable link is returned. The frontend validates the response structure; links must be internal paths. Authored text is rendered as text. A failed fetch does not continue displaying a previously cached private preview. Query keys contain account identity; requests support abort signals. Only the small preview polls every 30
seconds; dashboard and inbox create no further background polling cycle.

Optional new notifications respect preferences at insertion time. Turning a preference off does not delete existing notifications. Confirmation and cancellation of a binding allocation continue to be recorded independently of these switches.

Matching jobs are determined after the publication transaction completes, using the final topic/qualification set. Archived/expired offers, past sessions and inactive accounts are excluded; qualifications must remain valid through the final session. A notification is a hint and does not replace renewed contract, calendar, qualification and capacity checks during a binding claim.

<a id="section-notifications-reminders-and-boundaries"></a>

## Reminders and boundaries

The explicit reminder-refresh action creates idempotent notices for the actor's own confirmed, unreleased sessions within 24 hours and own active contracts expiring within 30 days. A server-side limit prevents repeated calculation within one minute. A changed preference permits immediate recalculation. Released historical allocations and revoked contracts do not produce current reminders.

The [email extension](../deploy/hostinger/README.md) adds explicit per-account consent, IANA-zone quiet hours and a transactional outbox. The versioned settings are stored server-side. The [finite Hostinger mail worker](../deploy/hostinger/README.md) generates due reminders for opted-in active accounts and processes newly queued events; manual reminder refresh can also queue a new email. Existing inbox history is never replayed.

[Web Push](GUIDE.md#section-web-push) adds explicit per-device consent, private subscriptions and a finite encrypted delivery worker. The in-app attention settings below remain independent of external delivery quiet hours. Committed task, assignment, course, finance and qualification events resolve their current resource permissions again before dispatch. Generic external payloads contain no private message bodies or document links.

Worker templates and timers ship disabled; source changes do not install or activate them. Real SMTP authentication, external delivery and physical desktop/mobile push acceptance require their separate operational evidence. Digests remain pending. In-app notices and mandatory receipts remain available independently of external channels. Combined verification of the integrated M7 and connected operations source is recorded only when actually executed in the relevant pull request checks.

<a id="section-notifications-personal-in-app-quiet-hours"></a>

## Personal in-app quiet hours

The second form at `/settings` stores an own daily quiet period with an enable switch, start, end and IANA zone. Language changes preserve its draft. Its separate save button is **Save quiet hours**; the four existing category switches and their original API/version contract remain independent.

Quiet hours affect only the attention shown by the **bell counter**. During the active window, it continues counting unread binding booking, cancellation and new-contract notices. The connected announcements module additionally includes explicitly important, currently authorised portal announcements; archived, expired or no-longer-authorised revisions do not count. The inbox and its preview still contain every authorised notification; nothing is deleted, discarded, moved or automatically marked
read. For example, 17 optional notifications plus three important receipts remain 20 unread notifications, while the bell counts three important notices. Its accessible label also states the active quiet period and complete unread count. Disabling quiet hours returns the bell to the full count. Only an explicit read/unread action changes read state.

The start is inclusive and the end exclusive. Different endpoints may span midnight. Actual local clock minutes in the selected IANA zone govern the rule: skipped DST minutes do not occur; both occurrences of a repeated minute use the same quiet-hours rule. No server or browser clock is changed. A saved quiet period retains its explicitly selected zone. Before anything is saved, the default uses the current own profile zone with a disabled 22:00–07:00 window.

The server calculates `quiet_active` from its current time when the inbox is fetched. `attention_count` is added only during an active window. The complete `unread_count` remains unchanged. The shell uses its existing 30-second interval and normal revalidation; the interface claims neither millisecond-precise transitions nor additional delivery technology. This feature is **not** SMTP, email, push or background-delivery scheduling.

The additive migration `20261116080737_notification_attention_preferences.sql` creates a separate private preferences table. `attention_preferences()` reads only the current active account. Before the first save, the own version is 0 without creating a row. `save_attention_preferences(p_payload, p_expected_version)` accepts exactly `enabled`, `start_time`, `end_time` and `time_zone`; the account comes from `auth.uid()`. An account-bound transaction lock also serialises concurrent first saves.
Stale versions are rejected with `40001`; the draft remains until explicitly reloaded. Unknown fields, invalid times/zones and equal endpoints are rejected. Ordinary accounts, administrators and existing suspended sessions receive no other person's quiet hours. Direct table access and anonymous function execution are not granted.

`scripts/attention-db-tests.mjs` checks SQL boundaries, including actual IANA/DST cases. The additional **authored** scenarios `scripts/attention-api-check.mjs` and `tests/e2e/attention.spec.ts` cover actual Auth/REST accounts, initial and subsequent version conflicts, unchanged category preferences, 17 optional plus three important notices, account/admin/suspension boundaries and explicit read state. Browser cases include UI save/reload, DE/EN drafts, offline operation, dark mode, mobile width
and axe. Actual native execution and results still belong in the relevant pull request checks; the existence of these files does not claim a passed run.

<a id="section-notifications-api-and-verification"></a>

## API and verification

The existing inbox/category contract comprises the five public functions `notification_inbox`, `mark_notifications`, `notification_preferences`, `save_notification_preferences` and `refresh_my_notifications`. The two attention RPCs described above extend this contract. Complete parameters are in [API_REFERENCE](../API_REFERENCE.md). Focused checks:

```bash
npx vitest run src/features/notifications
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/notifications-db-tests.mjs
./portal test
```

The SQL groups cover ownership, atomic batches, version conflicts, cursor limits, current resource permissions, mandatory notices, reminder windows, released allocations and qualification expiry. `scripts/notifications-api-check.mjs` verifies actual Auth/MFA/REST calls. `tests/e2e/notifications.spec.ts` covers desktop/mobile, a paginated inbox, settings surviving reload, language, dark mode, offline operation and axe. Authored tests do not constitute passed acceptance; combined checks actually
executed are recorded in the relevant pull request checks.

<a id="section-web-push"></a>

<a id="section-web-push-web-push-on-desktop-and-mobile"></a>

# Web Push on desktop and mobile

This vertical adds opt-in push for supported desktop browsers and mobile installed web apps. Both platforms remain in scope. Unsupported/blocked browsers keep the in-app inbox and optional email channel. There is no automatic permission prompt when opening the portal. The settings page explains installation, denied browser/OS permission and per-device removal in German and English. On iPhone/iPad, the UI explains the supported Home Screen web-app route (iOS/iPadOS16.4+); on desktop/Android it
explains installation through the browser. Browser/OS permission and actual platform support still control delivery.

Primary references checked16November2026: [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API), [WebKit mobile Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers), [web-push library](https://github.com/web-push-libs/web-push), [Supabase functions](https://supabase.com/docs/guides/database/functions)
and [Workbox generateSW](https://developer.chrome.com/docs/workbox/modules/workbox-build). The existing Supabase3.1CLI is used with its current local-default semantics; unrelated changelog breaking changes do not require an application rewrite.

<a id="section-web-push-data-and-consent"></a>

## Data and consent

Migration20261116091013 adds private RLS-protected configuration, device subscriptions and committed-event outbox. Authenticated browser RPCs derive the owner from current `auth.uid()` and an active profile: `my_push_devices`, `register_push_device`, `remove_push_device`. A browser supplies no authorising role/user ID. Admin rights do not expose foreign devices, provider endpoints or encryption keys. Each owner has at most five active devices, with a90-day consent lease. Removing a device
prevents new delivery; a provider may already hold a generic message with a300-second TTL.

Subscription URLs are restricted to exact HTTPS origins `fcm.googleapis.com`, `updates.push.services.mozilla.com` and `web.push.apple.com`, with no credentials/custom port/query/fragment. Other provider endpoints are refused, rather than treated as arbitrary server fetch destinations. Native P-256/auth keys are validated; ownership of an existing endpoint cannot be reassigned to another account. Configuration/key changes are service-only; rotating the public application key revokes existing
registrations, requiring renewed device registration.

In the service worker, a push is shown only if its opaque per-device token matches the current browser binding. The binding database contains only the account identifier and an opaque random token; it stores no authentication token, message/file content or private schedule. Logout/actor transitions clear the binding, unsubscribe the browser and close displayed notifications. Reloading the same account preserves consent. The most recent account transition in this browser origin controls its one
push binding; private cross-account notifications are never retained as a fallback.

`public/push-sw.js` is imported by the existing Workbox `generateSW`, preserving the existing precache/offline/update behavior. It accepts only a bounded generic payload identity/locale/token and shows a fixed German/English portal update. It ignores payload-supplied text or destinations. Clicking always opens same-origin `/notifications`, where normal authentication and current-resource authorisation apply. No signed/private link is delivered, and no API/private-file runtime cache is
introduced.

<a id="section-web-push-server-delivery"></a>

## Server delivery

The Node worker `scripts/notification-push-worker.mjs` is finite and disabled by default. Exact-pinned `web-push4.0.0` produces standard AES128GCM encrypted requests and ES256 VAPID authentication. VAPID private keys and service-role keys remain only in server-private configuration, never `VITE_` variables, bundles, database rows or repository files. The public application key is not a secret.

New notifications enqueue only after their transaction commits and only to active current devices. Category selection delegates to the same `private.email_category_enabled` hook as email, including forward-added task/waitlist/substitution kinds. There is no replay of historical inbox records. Push inherits the account's IANA quiet-hour pair from delivery preferences, independently of email opt-in. `refresh_push_reminders` creates bounded15-minute session/contract reminders for active push-only
accounts; a final shared task producer can extend this same hook.

Service-only APIs are `configure_web_push`, `refresh_push_reminders`, `lease_notification_push`, `prepare_notification_push`, `finish_notification_push`. Leases use `SKIP LOCKED`, fresh tokens, attempt limits and300-second fences. Preparation rechecks active account/device, expiry, configured channel and category/quiet hours. The worker sends no resource title, course/contract terms or chat body.

Before HTTPS, the worker checks the exact provider host, rejects private/reserved DNS results and pins the validated resolution to that request. TLS hostname/certificate verification stays enabled; redirects are never followed. Provider response bodies are discarded and never logged. HTTP2xx means provider acceptance, not device display/read.404/410 deactivates the subscription;429/5xx uses bounded backoff with bounded Retry-After. Ambiguous post-request network failure is `uncertain`, never a
blind resend. Expired sending leases are also terminal uncertain. Logs contain only fixed aggregate status counts. The finite run has a240-second cancellation signal with15-second API/provider operations and an outer300-second systemd bound. Shared maintenance locking prevents crossing the existing backup/update exclusive boundary.

<a id="section-web-push-activation"></a>

## Activation

Templates under `deploy/hostinger/notification-push/` are disabled and are not installed by a source build. Root-owned0600 server configuration outside `www` supplies:

- `PORTAL_PUSH_ENABLED=true` only for reviewed activation.
- `PORTAL_PUSH_API_URL` with the actual private Supabase gateway.
- `PORTAL_PUSH_SERVICE_KEY`, server-only.
- `PORTAL_PUSH_VAPID_SUBJECT=mailto:info@luminovia.org`.
- Matching generated `PORTAL_PUSH_VAPID_PUBLIC_KEY` and `PORTAL_PUSH_VAPID_PRIVATE_KEY`.

Generate a keypair privately with the pinned library and retain it in the approved recovery secret store; never print or commit the private key. Apply reviewed source migrations, set the same public key through `configure_web_push`, verify private environment and actual Node path, then install/start the finite service/timer under the reviewed target's operational procedure. No-flags execution performs zero network calls; `--run` and literal enabled=true are both required. An activated server
does not grant browser permission or register devices automatically. A desktop and a mobile user must each explicitly consent in their supported browser/PWA.

<a id="section-web-push-actual-checks-and-remaining-platform-evidence"></a>

## Actual checks and remaining platform evidence

Executed focused source checks: real disposable PostgreSQL consent/ownership/defaults/endpoint rejection/rollback/50-worker race/fencing/idempotency/410/queued-removal checks; eight Node crypto/provider/worker/service-worker checks, including actual AES128GCM decrypt and ES256 signature verification; fourteen component/platform checks, including desktop, Android, iPhone install flow, installed iPadOS PWA and permission denial. Relevant ESLint and TypeScript passed before another agent's
in-progress course source was added. Synthetic production build passed with58 public precache entries/2638.50KiB and the actual imported push worker. The uninstalled systemd templates pass `systemd-analyze verify`.

A real isolated built-PWA native probe used secure loopback6391, a synthetic backend, a fresh browser context and an ephemeral public VAPID key. The actual worker was active and PushManager existed, but this headless Chromium returned Notification.permission=denied and subscribe aborted with AbortError. No subscription or external push was created. This is a recorded platform limitation, not proof of desktop/mobile provider delivery. The owned preview was stopped.

`web-push-api-check.mjs` connects actual disposable Auth/PostgREST to the real worker and standard encryption without contacting an external provider. `tests/e2e/push.spec.ts` checks real own/foreign device separation, server-confirmed removal, DE/EN, reload and offline behavior on desktop/mobile. Their authored source is not a passed full run; exact execution belongs to the combined QA results. Real visible notifications on both a supported desktop and installed mobile PWA remain a separate
native acceptance step when a permission-capable device is available. No claim of such delivery, live VAPID activation, installed timer or physical mobile acceptance is made by this source checkpoint.

<a id="section-web-push-immutable-worker-distribution"></a>

## Immutable worker distribution

The release packager now builds `deploy/hostinger/notification-push/worker.mjs` from the exact tracked source/lock using locked Rolldown1.2.19. Its only external imports are Node builtins and it has no dynamic/runtime npm imports. The unused `https-proxy-agent` branch is replaced only in this constrained build by a fail-closed proxy-disabled shim; the worker has no proxy option and standard web-push crypto/VAPID/request generation stays unchanged. Actual used package versions, npm integrity
strings, module/source hashes, build-tool identity and bundle hash are retained in `provenance.json`, alongside complete dependency license notices. The absent http_ece npm license is supplied from its exact upstream v1.2.1 MIT license, pinned by SHA-256.

The archive also carries disabled service/timer/environment templates and maps the original stdlib Python worker to `deploy/hostinger/notification-mail/worker.py`. Both service ExecStart paths point to those delivered artifacts. No node_modules, server package install or worker source is placed in the public site. Host activation still needs a supported Node executable (the inspected VPS initially had none), private environment, actual systemd installation and browser consent.

Fourteen package checks pass, including actual extracted Python/Node dry runs outside node_modules, all eight existing crypto/provider/service-worker contracts repeated against the extracted standalone bundle, exact source/lock/hash/license provenance, and negative wrong-lock/license/local-import/known-short-secret cases. Source/bundle provider checks now verify both Node DNS lookup callback forms (`all=true` and single address), temporary pre-write DNS/connect retry, and post-write uncertain
acceptance. This is standards/transport-contract evidence, not a successful external desktop/mobile delivery claim.

<a id="section-admin-audit"></a>

<a id="section-admin-audit-administrative-audit-log"></a>

# Administrative audit log

Open **Administration → Administration log** at `/admin/audit`. Dedicated Academy installations use `/administration/audit`. Current administrators and management can read the operational log. Management has a separate read permission and cannot clear the log. Administrators and owners can clear it after explicit confirmation. Dedicated editions require an active licence for the clear operation and allow reading during the grace period.

<a id="section-admin-audit-deliberately-reduced-projection"></a>

## Captured activity and privacy

The log combines reviewed workflow events with committed changes to selected business tables. It covers accounts and invitations, roles, organisations and contacts, courses and schedules, assignments, learning activity, shared documents, invoices and payment activity, support, announcements, imports, and selected settings. Each event shows a timestamp, an action and an optional resource ID. A display name is the acting account's current display name. Automated events can have no named account.

Mail events distinguish account-mail requests, notification queue outcomes and self-hosted Auth relay outcomes. An accepted SMTP submission means the next server accepted the message. An uncertain outcome is shown separately from a failure. The selected Auth log actions and relay reports carry no email addresses, SMTP content, passwords, token values or private IP details. The log also excludes private messages, personal calendar entries, file contents and protected document payloads. Amount and currency on payment receipts require the corresponding current finance permission.

<a id="section-admin-audit-queries-and-interface"></a>

## Filters and retention

The date, action and text filters keep their meaning across pages. Text search covers display names, action IDs and resource IDs. The API uses a timestamp and an ID cursor, with 40 results per page in the portal. Operational entries are hidden after 720 hours and removed by a scheduled database job every 15 minutes. The online API returns only entries in this window, even if physical cleanup is temporarily delayed.

**Clear log** removes the entire operational history after confirmation, regardless of the filters. Committed actions continue to create new entries after a clear. The confirmed `clear_administration_activity(p_confirm: true)` call returns the number of removed entries. Durable business, accounting and deletion receipts remain available to the workflows that use them. Database backups have their own configured retention.

<a id="section-admin-audit-verification"></a>

## Verification

Use `scripts/admin-audit-db-tests.mjs` in the owned SQL fixture for access, expiry, pagination, mail and metadata protection, and confirmed clears. `scripts/admin-audit-api-check.mjs` checks the native HTTP path. `tests/e2e/admin-audit.spec.ts` covers the role-aware portal view in Chromium.

<a id="section-website-enquiries"></a>

<a id="section-website-enquiries-website-enquiry-intake-and-management"></a>

# Website enquiry intake and management

<a id="section-website-enquiries-published-source-boundary"></a>

## Published source boundary

PR25 merged as main `4f7f6c0`, publishing `20261116143242_website_enquiry_intake.sql` after the unchanged 68-file history. The repository now contains 69 published migration sources, all immutable. Source integration does not establish hosted installation or public Website activation.

The enquiry helper is discovered by main's existing owner-only notification resolver. The obsolete resolver rename/wrapper and authenticated EXECUTE grant are removed before publication, preserving the accepted resolver's identity, fallback branches and restricted ACL. Current SQL tests exercise the actual inbox projection and denied direct helper calls. HTTP fixtures must validate either the canonical disposable backend or the exact ownership-checked native candidate, including its private TLS
trust; ordinary services remain excluded. The native fixture issues an explicit CA:FALSE server leaf so Deno/rustls and Node/OpenSSL both validate it. Tests retain certificate and hostname checks.

The Portal can receive an authenticated integration submission, retain the
validated original enquiry and consent record privately, and let management
review it, identify or create a customer, record responsibility and clarification,
and convert it transactionally into an existing course-planning run. It does not
invent a customer account, accepted financial agreement, tax treatment or quote.
The public Website has not been changed or connected by this source change.

<a id="section-website-enquiries-current-website-boundary"></a>

## Current Website boundary

The separate public Website uses a static Vite/React build on GitHub Pages. Its optional bilingual enquiry form posts to a server-side relay, which validates a Turnstile challenge for the configured Website hostname and submission ID. Only that relay holds the separately provisioned intake token. The regular email contact remains available.

Use the [Website relay instructions](https://github.com/Luminovia-Training-Consulting/Website/tree/main/integrations/portal-enquiry) to configure the public build, the intended relay route and the Portal intake. The tested source supports this integration with an exact confirmation receipt. Public activation requires a reviewed privacy notice and approved Website, challenge, relay and Portal configuration. The Portal's server token is stored outside the static build.

To rehearse both checkouts locally, install their locked dependencies, have Chromium installed for Portal Playwright and run:

```sh
node scripts/website-enquiry-rehearsal.mjs /absolute/path/to/Website
```

The command builds the actual Website and exercises its form in German and English with keyboard submission. It checks the real relay code, Portal Edge intake, authenticated management inbox, notification and lecturer denial on a fresh loopback-only Supabase stack. A fictional challenge provider allows a rejected challenge and a deliberately unconfirmed acknowledgement to be repeated. The receipt records source revisions, dirty working trees and check names. The stack is removed after the rehearsal. The configured public Worker, Turnstile widget and production intake need their own activation and proof.

<a id="section-website-enquiries-intake-contract"></a>

## Intake contract

The existing Supabase Edge architecture provides
`POST /functions/v1/website-enquiries`. The normal gateway's public API key/JWT
boundary remains enabled. The function additionally requires the separate
`X-Luminovia-Integration-Token` server credential. Public Supabase keys, matching
Origin, user-supplied role fields and claimed client-IP headers never authenticate
the integration. No CORS permission is issued. If Origin is present it must
exactly match the configured Website origin; server-to-server calls may omit it.

Private server configuration:

- `PORTAL_WEBSITE_ENQUIRIES_ENABLED=false` by default.
- `PORTAL_WEBSITE_ORIGIN` is an exact HTTPS origin (loopback HTTP is accepted only
  for local tests).
- `PORTAL_WEBSITE_PRIVACY_NOTICE_VERSION` must identify the reviewed current
  notice; submissions for another version reject instead of inventing consent.
- `PORTAL_WEBSITE_INTEGRATION_TOKEN` is a private 32–256-character token provisioned
  outside source control, shared only with the approved trusted sender. Generate
  it from at least 32 cryptographically random bytes rather than choosing a phrase.

The generated self-host configuration leaves the token and origin empty and the
feature disabled. Missing/weak configuration fails closed with 503. The token is
compared using fixed-size SHA-256 digests and timing-safe comparison. Its digest
identifies a sender for persisted rate limits; neither token nor digest is returned
to public callers. Credential rotation must be coordinated with the trusted sender;
rotating the token also changes its sender-scoped retry/rate namespace.

The JSON body contains:

| Field                                            | Contract                                                                                     |
|--------------------------------------------------|----------------------------------------------------------------------------------------------|
| `submission_id`                                  | Stable UUID reused for an uncertain retry.                                                   |
| `company_name`, `contact_name`, `email`, `phone` | Bounded, validated contact input; optional phone is an empty string.                         |
| `topic`, `message`                               | Authored training topic and requirements; literal text, no authored HTML execution.          |
| `preferred_dates`, `duration`                    | Bounded requested preferences; no implied confirmed booking.                                 |
| `delivery_type`                                  | `online`, `onsite` or `flexible`.                                                            |
| `time_zone`                                      | Intended recognised IANA time zone.                                                          |
| `locale`                                         | `de` or `en`; authored text is not translated.                                               |
| `privacy_notice_version`, `consent`              | Notice identifier and the literal boolean `true`. This is evidence, not legal certification. |
| `website`                                        | Optional empty honeypot field; non-empty values reject.                                      |

Unknown fields, malformed JSON, oversize streamed bodies, missing consent and
invalid values reject before database delivery. Bodies are bounded to 24,000
bytes. A service-only RPC independently validates the payload and serialises each
sender using a transaction advisory lock. At most 10 new submissions per minute
and 100 per rolling 24 hours are accepted for one integration sender. Retrying the
same UUID and identical validated payload returns the original record, including
after management conversion; a changed retry returns 409. A retry consumes no
additional quota and creates no duplicate history or notifications.
HTTP and SQL accept the same conventional email-address subset as the detail
consumer. Quoted local parts, leading/consecutive dots and control characters
reject before acknowledgement; an accepted address must remain readable in the
management detail projection.

The successful response is `202 {"received":true,"receipt":"<your UUID>"}` only
after a confirmed database response. It exposes no internal enquiry/customer ID,
matching directory record, private message, contact record or management state.
Safe generic failures use 400/401/403/409/413/415/429/503 without database details.
This boundary protects the authorised integration; a public browser form still
needs its own approved spam/abuse controls before activation.

<a id="section-website-enquiries-management-workflow"></a>

## Management workflow

`/enquiries` and its detail routes require current `organisations.manage` and MFA
on every server request. Ordinary lecturers and customer accounts cannot search
or retrieve the intake, even using a guessed identifier. All intake/history/retry
tables are private and RLS-enabled; browser table writes are unavailable. The
original validated payload, including submitted identity and consent, remains
unchanged by triage. Interface text supports DE/EN and existing light/dark/system
themes. Data stays in actor-scoped memory, outside service-worker caches.
Mutations first hold the active caller's profile for share, then acquire the actor
request lock and enquiry row. Supported account changes take that profile for
update, so a decision and role/activity revocation serialize. Permissions are
checked again after the business-lock wait and before a historical receipt or
new write; a conversion retry also requires its current course capability.

Management can search the queue, assign an eligible active colleague, add an
append-only note and move Received → Under Review → Awaiting Customer or Closed.
Closed enquiries can return to review with a reason. A management email action
opens a manual local email draft; it does not send or claim delivery.

Link an existing active organisation first when appropriate. Explicitly confirming
“Create customer and contact” instead reuses the existing directory routines with
the supplied company/contact details. Its request identity and version check
ensure uncertain retries cannot create a second organisation or contact. Company
identity matching remains a human decision; the Portal does not guess membership
from an email domain or grant access based on a submitted company name.

Conversion additionally requires `courses.manage` and MFA. Management chooses an
existing course template or reviews the suggested title and description for a new
company-owned template. The original enquiry stays private and unchanged. It
then reviews exact sessions, time zone and teaching mode and confirms. The same transaction calls
the existing `save_course_run`, creates all sessions and marks the enquiry
Converted. Any invalid/overlapping session rolls back the template/run and enquiry
change together. Concurrent decisions use reviewed versions and row locks, yielding
one conversion. The result remains unpublished and has no job or commercial quote;
the enquiry opens that exact run directly for further planning. An already converted customer
link is preserved. The separate priced client-request workflow is not silently
populated with fabricated fees.

Requirements are currently captured as text. Public file uploads are not enabled
by this endpoint; any later public attachment workflow must reuse bounded scanning
and explicit private resource permissions rather than accepting arbitrary links.

<a id="section-website-enquiries-deployment-and-test-evidence"></a>

## Deployment and test evidence

The self-host router allowlist, exact Envoy route and explicit read-only worker
mount include only the reviewed `website-enquiries` endpoint. Lookalike/subpaths
remain denied. No backend ports or new services are published. Existing JWT,
production and release gates remain intact; this source does not activate the
normal or hosted endpoint.

Executed focused evidence:

- `PORTAL_DB_CONTAINER=<owned-disposable-container> node scripts/enquiries-db-tests.mjs`:
  16 real PostgreSQL groups pass, including simultaneous retries/conversions,
  sender limits, denial/MFA/revocation, customer/contact idempotency, rollback and
  preserved original records. Actual `plpgsql_check` reports zero body warnings
  or errors for all five new PL/pgSQL implementations.
  The concurrency cases use explicitly held SQL transactions and observed
  `pg_blocking_pids`, covering both revocation orderings and a capability change
  committed during an enquiry-row wait. No fixed sleep substitutes for a lock assertion.
- `npx --no-install deno test supabase/functions/website-enquiries/handler_test.ts`:
  eight request/authentication/validation/acknowledgement cases pass, including
  acknowledged addresses checked by the actual frontend Zod email validator.
- `npx --no-install deno check supabase/functions/website-enquiries/index.ts scripts/testing/enquiries-edge-http.ts`:
  both deployed and isolated HTTP adapters typecheck.
- Seven frontend unit/component tests pass for authority gating, literal original
  data, safe manual email draft, explicit pending customer creation, stale-version
  protection, DE/EN filters, denial/offline handling and DST/session conversion.
- `npm test`: all 233 tests in 50 files pass on this branch baseline. Shared
  routing/inbox integration and the combined source still require their own gates.
- `node deploy/hostinger/selfhost/validate.mjs --gateway-routing`: 14 actual
  isolated networkless Envoy route cases and configuration/security checks pass.

The canonical runner discovers `scripts/enquiries-api-check.mjs`, which starts its
own loopback Deno listener with the exact deployed environment adapter against
the owned actual Auth/REST database, and `tests/e2e/enquiries.spec.ts` for real
management/customer/course planning, foreign-account denial and desktop/mobile
DE/EN/theme/accessibility checks. Their actual outcomes must be recorded after
`./portal test` runs; authored tests do not constitute passed acceptance.
Production, real contact delivery and public Website activation remain separate.

<a id="section-delegated-roles-pricing"></a>

<a id="section-delegated-roles-pricing-delegated-roles-and-private-compensation"></a>

# Delegated roles and private compensation

The current user requirement supersedes the earlier freely editable per-offer commission default. Real commercial percentages are private operational configuration. This public repository contains no initial production policy and never guesses one. A fresh install requires an administrator with verified MFA to set the intended policy in the administration interface before publishing a commissioned offer. The acceptance-only fixtures use clearly fictional settings, gated to the owned disposable
test stack.

<a id="section-delegated-roles-pricing-delegation-boundary"></a>

## Delegation boundary

The server reads current database roles. The role catalogue and account directory expose the roles and target actions the caller can manage. The internal self-service editor lets an administrator change their own administration, management, lecturer, participant and company roles while preserving any protected roles. Account activation and permanent deletion use their separate rules. The last active administrative account and active teaching assignments are protected.

An organisation grant is a separate record. The role edit can atomically add the Company role and an active organisation to a manageable account. Removing the role revokes active memberships and keeps historical references. Learner enrolments and organisation memberships keep their own authorisation when roles are combined.

<a id="section-delegated-roles-pricing-private-policy-and-offer-snapshots"></a>

## Private policy and offer snapshots

`private.compensation_policy` is an RLS-enabled, unexposed singleton with no seed row. `configure_compensation_policy` requires administrative gross-finance permission, MFA and the expected current version. Concurrent edits use a shared policy lock and reject stale versions. Audit records contain the new version, without rates.

`commission_access` exposes policy percentages and version only to a current administrative MFA session. Other roles receive capability flags and whether setup is complete. `commission_offer_policy` gives that administrator the captured policy for one offer, so a newer global policy cannot mislabel an existing quote.

Every new commissioned offer captures its own policy version and both percentages in the private offer ledger. Later global changes affect future offers. An explicit administrative reprice is allowed only before any claim history and advances the offer consent version. Original gross currency/unit, residual-conserving cents and the accepted private revenue ledger remain intact.

On upgrade, offers with no claim history move to the role-dependent model and their consent version advances. Their old public rate columns become zero sentinels. Initial policy setup enables their still-empty private policy snapshots. Offers with accepted or cancelled claim history retain their historical pricing model, and every accepted claim/revenue row remains unchanged. No database migration writes a real production policy.

<a id="section-delegated-roles-pricing-quote-and-claim-confidentiality"></a>

## Quote and claim confidentiality

The paginated marketplace (`job_discovery`), exact detail (`job_detail`) and dashboard suggestions (`job_dashboard`) share the current actor's authorised prospective quote. The earlier `job_offers()` interface remains supported with the same pricing boundary. An eligible lecturer sees only their current applicable net amount, derived from the private offer snapshot and actual server role. The current lecturer-actor predicate also includes administrator and owner roles; management alone does not
qualify and receives `null` monetary values for role-dependent offers. An account with additional eligible roles follows the current server predicate, not its visible navigation label. The directly queryable `jobs` table stores no default or alternate lecturer rate for those offers. Company projections expose only their authorised organisations' gross amounts. Revenue and captured-policy RPCs remain administrative.

The displayed `terms_version` of a role-dependent quote is a composite of the base consent version and a role discriminator. The discriminator carries no percentage. Claiming locks the actor profile, validates the current quote token, then delegates to the existing atomic capacity/conflict/contract transaction. Role mutations take the matching profile lock. A stale quote after a role change or reprice returns `terms_changed`; claiming cannot silently accept a different amount. Claim and revenue
triggers independently calculate and validate the accepted net and conserved private revenue. Accepted claims retain the base document/terms version and an immutable compensation snapshot.

Same-request retries first pass the current active-actor and lecturer-eligibility checks. An allowed retry for the same job returns the existing claim identity and its current status, preserving the original accepted terms and amounts. It does not create a fresh confirmed allocation after cancellation, and an old request key grants no retry access after suspension or loss of eligibility. A later senior promotion, global policy edit, cancellation or new quote never rewrites an accepted deal.
Offline/optimistic confirmation remains prohibited.

<a id="section-delegated-roles-pricing-reading-monetary-values-correctly"></a>

## Reading monetary values correctly

Three different states must remain distinct:

| Value and source                                                                     | Meaning                                                                                                                                           | Required handling                                                                                                                  |
|--------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------|
| Numeric `0` in the directly readable job columns for a role-dependent offer          | A storage sentinel; it is not the current actor's quote.                                                                                          | Read the authorised discovery/detail projection or supported `job_offers()` interface instead of calculating a fee from the table. |
| `null` in an authorised prospective quote                                            | No applicable monetary quote is available to that actor, including nonlecturer management or an offer whose private policy is not yet configured. | Preserve `null`, show restricted compensation and disable an unpriced claim. Never coerce absence to zero.                         |
| A numeric amount, including a genuine numeric zero, returned by the authorised quote | The actor's applicable prospective compensation under that offer's captured policy.                                                               | Display the returned value without treating all numeric zeros as missing. The server still decides whether a claim is eligible.    |

The nullable monetary fields belong to the prospective `Job` DTO. Accepted `Claim` amounts are separate immutable snapshots, not placeholders to recompute from a later role or policy. The detail page uses an existing own claim for its accepted terms display.

Consent is more than a checked boolean or the base job version. The current detail page records the displayed job ID, quoted terms version, amount, total, currency, rate unit and terms as one consent fingerprint. A refreshed display cannot reuse consent for different values. The request sends the quoted version and idempotency key to `claim_job`; it sends neither an asserted lecturer role nor a client-calculated accepted price. The server locks and rechecks the actor before accepting the current
quote, and stores the accepted base terms version with the actual immutable compensation snapshot.

Management budgets are another projection. For role-priced offers, `job_lifecycle` returns `max_net_budget` only with current `finance.gross.read` and MFA: it uses the rounded captured senior-tier total per position multiplied by capacity. A legacy offer retains its stored net total multiplied by capacity. This is not the requesting manager's personal quote multiplied by capacity. An explicit `null` budget remains protected and must not fall back to a cached personal price. The UI separately
handles an absent field for compatibility with an older backend. None of these values gives access to a different lecturer's accepted contracts, invoices or private calendar.

<a id="section-delegated-roles-pricing-current-source-ownership"></a>

## Current source ownership

This guide describes the current 36-migration main source, including the merged discovery and role-quote bridge. The relevant reading path is:

| Source                                                                                                                       | Owning contract                                                                                                                                                                                 |
|------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [Private role-pricing migration](../supabase/migrations/20261116020953_delegated_roles_and_private_role_pricing.sql)            | Current policy/offer snapshots, `job_offers`, role-specific quote versions, claim checks/triggers and the role-aware lifecycle budget. Read its later definitions after the earlier migrations. |
| [Discovery and saved-view migration](../supabase/migrations/20261116080735_job_discovery_and_saved_views.sql)                   | Introduces the public discovery/detail/dashboard and own saved-view interfaces. Later private definitions below govern their current quote projection.                                          |
| [Role-aware discovery bridge](../supabase/migrations/20261116080748_role_aware_job_discovery.sql)                               | Owns the current private quote/context helpers and replacement candidate/item/page implementations, including price filters, sorting and cursor context.                                        |
| [Discovery API and DTOs](../src/features/jobs/discovery-api.ts)                                                                 | Calls the bounded discovery, exact-detail and dashboard RPCs; validates nullable numeric quotes without coercion and includes observed role context in page keys.                               |
| [Shared DTOs](../src/lib/types.ts)                                                                                              | Prospective `Job.amount` and `Job.total_amount` are nullable; accepted `Claim` amounts remain separate numeric snapshots.                                                                       |
| [Marketplace](../src/features/jobs/discovery.tsx), [cards](../src/features/jobs/card.tsx) and [detail](../src/features/jobs/jobs.tsx) | Server filters, private saved views and explicit next pages; restricted-price rendering, the full displayed-consent fingerprint and the online claim request.                                   |
| [Lifecycle API](../src/features/jobs/lifecycle-api.ts) and [lifecycle UI](../src/features/jobs/lifecycle.tsx)                      | Read the server budget, preserve an explicitly protected `null` and perform versioned lifecycle actions.                                                                                        |
| [Commercial pricing UI](../src/features/commercial/pricing.tsx)                                                                 | Uses the permission-scoped financial APIs for the captured offer policy; the ordinary job projection does not disclose policy percentages.                                                      |

The former unpaginated `jobsQuery` browser-list path is no longer the marketplace owner. The current server filters before its page boundary; the UI requests 50 results and the API permits 1–100 per page. Loading a page or selecting an own saved view is not an allocation or a replacement for final server checks. [Job discovery](GUIDE.md#section-job-discovery) describes the complete filter, saved-view and paging workflow.

<a id="section-delegated-roles-pricing-current-paginated-quotes-and-cursor-context"></a>

## Current paginated quotes and cursor context

Discovery filters and monetary ordering use the same actor-specific quote returned in each item, exact detail and dashboard suggestion. They do not use public zero sentinels, another tier or the latest global percentages to reprice an existing captured offer. Restricted values remain nullable through SQL, JSON, DTOs and rendering. Unknown amounts fail money bounds, including a minimum of zero, and sort after known amounts in either monetary direction. Their internal ordering sentinel is never
returned as compensation. Original-currency comparisons remain explicit; rate comparisons also require one fee unit.

The server cursor fingerprint binds normalized filters to the current actor, lecturer eligibility/tier marker and current global policy version. A mismatch in that context rejects the old cursor instead of silently continuing a different price order. Other role-list changes need not alter the server fingerprint; current authorization checks still apply. Updating the global policy version therefore invalidates the cursor without rewriting an existing offer's captured quote. The browser also
resets infinite-page state when its observed roles change; that convenience does not replace the server check for changes it has not observed.

Each page rechecks current access. Multiple HTTP pages are not one frozen database snapshot, so new or reordered offers can require a fresh search. The bridge adds private quote/context helpers, not a browser-readable policy table or an alternative claim API. Their explicit execution revokes retain the public invoker wrappers as the entry boundary. Final claims keep the full displayed-consent fingerprint, fresh quote-version validation and immutable accepted snapshots described above; management
budgets remain a separate authorised projection.

<a id="section-delegated-roles-pricing-verification"></a>

## Verification

`scripts/delegated-pricing-db-tests.mjs` replays the previous schema, creates a historical accepted commission, applies the migration, and verifies exact historical claim/revenue preservation. Its disposable PostgreSQL cases cover subordinate delegation, guest permissions, equal/higher/self protection, invitation rechecks, financial-grant composition, policy setup/CAS/privacy, direct-table sentinels, role-bound consent, mixed-role capacity claims, exact rounding, idempotent accepted receipts and
future-only policy changes. Existing accounts, commission, course-building-block and capacity suites retain independent checks. Native API/browser evidence is reported separately in QA results.

The current [job component regressions](../src/features/jobs/jobs.test.tsx) check restricted compensation and renewed consent after either a version change or a displayed quote change. [Lifecycle regressions](../src/features/jobs/lifecycle.test.tsx) check the server's maximum budget and refusal to replace an explicitly protected budget with a cached personal quote. These targeted commands use existing component fixtures:

```bash
npx --no-install vitest run src/features/jobs/jobs.test.tsx src/features/jobs/lifecycle.test.tsx
npx --no-install vitest run src/features/jobs/discovery-api.test.ts src/features/jobs/card.test.tsx
node --test scripts/runtime-documentation.test.mjs
```

Run mutating [delegated-pricing SQL checks](../scripts/delegated-pricing-db-tests.mjs), [commission API checks](../scripts/commission-api-check.mjs) and [role/pricing browser journeys](../tests/e2e/roles-pricing.spec.ts) only through the owned isolated acceptance environment described in [LOCAL_DEVELOPMENT](../CONTRIBUTING.md), normally `./portal test`. The SQL, actual Auth/REST/browser and native retained-data stages are distinct evidence. This documentation lists their entry
points without asserting a new execution, operational policy setup, deployment or complete security/legal certification.

The current [job-discovery SQL suite](../scripts/job-discovery-db-tests.mjs) checks authorised search and paging; [delegated-pricing SQL tests](../scripts/delegated-pricing-db-tests.mjs) check individual quotes, privacy and immutable claim snapshots. The older [role-percentage discovery probe](../scripts/role-aware-job-discovery.archived.mjs) documents the superseded model and is not part of current acceptance. [Discovery DTO regressions](../src/features/jobs/discovery-api.test.ts)
and [card regressions](../src/features/jobs/card.test.tsx) cover strict nullable values and restricted rendering. Exact executed results are reported from the current source run.

<a id="section-permanent-deletion"></a>

<a id="section-permanent-deletion-permanent-deletion--working-implementation-contract"></a>

# Permanent deletion — working implementation contract

User decision on 16 November 2026: confirmed deletion is permanent; no trash or restore. Scope is deletion only. Existing create/edit/role assignment remains in place; no other PR is merged by this task (the only stated exception is already merged PR13). Companies may delete only their own jobs under current database membership. Normal or production data is never touched by tests.

The subsequent direct instruction authorises completing verification and merging PR35 once the current required checks and local acceptance pass. It does not authorise merging other PRs or deploying production.

<a id="section-permanent-deletion-http-boundary"></a>

## HTTP boundary

Extend the existing `accounts/v1` Edge facade, keeping credentials server-only:

- `GET /deletions/access` → `{ can_admin, kinds }`.
- `GET /deletions/operations` → `{ items: [operation] }` for currently authorised incomplete operations; recovery does not depend on browser storage.
- `GET /deletions/resources?kind=&q=&cursor=&limit=` → `{ items: [{id,kind,label,owner_label,can_delete}], next_cursor }`. Administrative metadata only; never private contract/message/calendar contents.
- `POST /deletions/preview` body `{kind,id}` → `{plan_id,kind,id,label,counts,blockers,can_confirm,expires_at}`.
- `POST /deletions/confirm` body `{plan_id,request_id,confirmation:"DELETE"}` → `{operation_id,status,kind,id}`. Recompute scope under current authority/locks; a changed preview is a conflict. This starts an irreversible operation, not an archive.
- `POST /deletions/operations/:id` with an empty object resumes/reads that confirmed operation using current authority. `status` is `pending`, `failed` or `completed`; only completed receives a deletion success message. Return202 while uploads or external cleanup are pending.

<a id="section-permanent-deletion-caller-rpcs"></a>

## Caller RPCs

`deletion_access()`, `deletion_operations()`, `deletion_resources(p_kind,p_query,p_cursor,p_limit)`, `deletion_preview(p_kind,p_id)`, `deletion_confirm(p_plan_id,p_request_id,p_confirmation)`, `deletion_status(p_operation_id)` and `deletion_execution(p_operation_id)` are invoker wrappers. Execution yields a short-lived permit bound internally to current actor/assurance/operation; browser-supplied actor/role values never grant authority. All plans/permits/operations are private with RLS and no
direct browser grants.

Worker service-only RPCs consume the permit: `_deletion_work(p_operation_id,p_permit_id)` returns the operation projection, exact internal object manifest, `auth_user_id` if applicable, and active-upload count; `_deletion_apply(p_operation_id,p_permit_id)` removes the permitted relational scope after Storage acknowledgements; `_deletion_complete(p_operation_id,p_permit_id,p_storage_removed,p_auth_removed)` verifies target/Auth/Storage absence before reporting completed. Edge sets acknowledgement
flags only after actual native API absence checks and reacquires current caller authority before privileged steps. No worker accepts arbitrary table names, object paths or user identities from the request.

Permits bind the actual executor independently of the original issuer. A currently qualified Owner/Administration can recover incomplete administrative/company business operations after issuer revocation or removal; account hierarchy and self protection still apply. Private owner/scoped operations remain with the original authorised person. An account with unfinished private operations cannot be purged into an orphaned cleanup barrier. Recovery lists contain only reduced operation IDs, kinds,
target IDs and status.

<a id="section-permanent-deletion-roots-and-dependencies"></a>

## Roots and dependencies

Use a closed typed registry for managed business roots, covering accounts, documents, jobs, assignments, organisations/contacts, course templates/runs/sessions, taxonomy, wiki/forum/chat/comment/review/enrolment records, announcements/global events, contracts/invoices/payment tracking and personal saved resources. Protect current self/last administrator and existing hierarchy. Dependency conflicts must be explicit; ordinary accepted-snapshot, finance and privacy protections are never disabled.
Do not treat all foreign-key attribution as ownership or blindly cascade into another organisation/shared resource.

The implemented registry addresses UUID roots. Composite-key enrolment/settings rows are dependent records, not arbitrary table or string-key deletion endpoints. Direct private-calendar/availability/saved-view deletion remains owner-only, and another account’s personal or room documents cannot be deleted through administrator authority. Administrators can manage authorised job-scoped material; and private room/message/financial actions retain their existing resource/capability boundaries. Full
administrative business deletion is limited to current Owner/Administration, not the account-directory capability of Management alone. Every new permanent-delete action requires current AAL2. An account with protected business references can be blocked explicitly; the confirmation is unavailable until those dependencies are resolved. This feature does not override financial retention or erase another person's shared records by attributing ownership to an editor.

An account's native Auth and profile records must actually disappear. Protected business references block deletion explicitly; no inactive profile marker or restorable account substitutes for removal. Historical audit events retain a nullable cleared actor attribution, counted and fingerprinted in the preview; accepted business records remain protected. Confirming an account operation fences/deactivates the target before external cleanup so an old JWT cannot regain application access. Completion
requires native identity absence, not suspension alone.

Posted and voided payment records are retained financial history: previews explicitly block their physical purge and preserve the existing reasoned void/correction workflow. Assignment removal revokes the affected lecturer's course-room/file membership only when no current allocation still grants it; remaining lecturers and unrelated manual room ownership remain intact. Curated business audit entries survive account deletion with a reduced blank actor label, while private deletion activity and
arbitrary details remain excluded from the global audit projection.

For company job roots derive one consistent organisation from stored request/commission/run relationships. Never use display names or grant global jobs.manage. Accepted/invoiced/shared dependencies outside company deletion authority produce a typed blocker; no partial success. A company-specific projection supplies own-job targets without granting staff discussion/net-fee/private-contract access. Close the former-lecturer→client historical-claim bypass in general job read channels.

<a id="section-permanent-deletion-storage-and-uploads"></a>

## Storage and uploads

Exact all-version manifests cover portal-clean and portal-quarantine, including rejected/error/archive versions. Never purge by Storage owner or uploader prefix. Fence new reservations, promotions, database writes and metadata resurrection for confirmed targets; remove bytes only through Storage API. Use service-released upload leases. Do not report completed while any upload can still promote bytes; crashed/stalled work must remain a visible safe pending/failure state, never silently expire
into success.

One immutable version has at most one active writer lease. Existing objects are verified/read on retry instead of issuing conflicting uploads. Every new Storage byte write needs a definite acknowledgement before the lease is released; an unknown transport outcome retains its barrier even when the client promise has rejected. Storage metadata absence alone cannot establish that an accepted remote write or provider cleanup has finished.

Shared SQL upload contract: `deletion_upload_begin(p_document_id,p_version_id)` service-only returns lease UUID after checking the document is not fenced; `deletion_upload_end(p_lease_id)` releases only server-owned lease after all awaited writes/cleanup. `_deletion_work` reports pending leases. Private document/Storage fence helpers must cover exact reserved paths; tests include a delayed promotion racing deletion and post-completion download404.

<a id="section-permanent-deletion-ui-and-verification"></a>

## UI and verification

An interrupted writer leaves an explicit lease and pending operation. Do not clear that lease while its request or scan can still write. An operator must first prove that the exact owned writer has stopped, review the operation's exact paths and then release only that server lease before retrying cleanup. There is no timer that converts uncertain external work into completed deletion. No production operation is authorised by this implementation document.

Reusable bilingual confirmation dialog binds current actor, target and preview. Show impact/blockers and require explicit irreversible confirmation. No optimistic removal; cancel old queries before post-acknowledgement refresh. Admin console supports typed targets; account/file/job and company-own-job contexts use the same deletion action. Existing archive/moderation actions must not be described as permanent deletion.

<a id="section-permanent-deletion-accepted-smart-operation-dependencies"></a>

## Accepted smart-operation dependencies

The additive PR35 repair includes initialized delivery/dashboard/contact preferences,
private subscriptions/favourites/notebooks, own acknowledgements and waitlists in
account scopes. A job owns its request briefs/revisions and exact matching/waitlist
notifications; an assignment owns its preparation and exact reminder notifications.
Other users' records, shared tasks, timesheet evidence and protected business
relationships remain blockers. The complete counts and row fingerprints are still
reviewed before confirmation. Notification deliveries in leased, sending or uncertain
states block purge even after lease expiry; application rechecks their rows before
removal. No worker is started by a deletion preview or this migration.

PR-only migration versions follow the complete accepted main prefix so retained-data
upgrades remain append-only. The current document helper keeps its OID/ACL and
delegates to the exact accepted support/qualification predecessor through a revoked
private clone. Dependency and blocker catalogue walks use explicit ordering: a
different PostgreSQL execution plan cannot invalidate unchanged reviewed records.

<a id="section-job-briefing"></a>

<a id="section-job-briefing-optional-job-contacts-and-external-references"></a>

# Optional job contacts and external references

Managers can add optional information in a job's detail page under **Contact and job reference**. The successful creation form also links directly to that section. Both standalone offers and course-backed offers use this same job-scoped editor. Existing offers have empty defaults; no customer contacts or external content are imported automatically.

<a id="section-job-briefing-fields-and-audience"></a>

## Fields and audience

The reference has an optional HTTP/HTTPS URL, an authored link label and an authored description. It may explain that a job follows an external brief or advertisement. A description can also stand alone without a URL. The application renders literal text and opens validated external links with `noopener noreferrer`; it never fetches the destination on the server.

The contact has optional name, email, telephone and notes. The manager chooses **Only after a confirmed claim** (default) or explicitly shares these entered details with **authorised offer viewers**. The internal customer/contact directory stays private and unchanged. This is not a public or anonymous publication.

Only current authorised staff can read this job projection. By default a currently confirmed lecturer sees contact fields; an unassigned viewer receives only a contact-availability hint. Cancellation removes after-claim contact visibility immediately through the refreshed server projection. Role revocation, suspension and loss of job access apply even with an existing token or historical claim. Management reads/writes retain the existing current MFA/capability requirements. Archived jobs remain
readable under their existing ACL and cannot be edited.

<a id="section-job-briefing-saving-and-safety"></a>

## Saving and safety

Text limits count Unicode code points like PostgreSQL, so supplementary characters remain readable and editable at the allowed boundary. All fields are optional. Saving empty values removes the visible optional information. The editor freezes its reviewed version and retains the same operation key for an unchanged retry. A concurrent edit produces a conflict; only an explicit reload replaces the draft with fresh server state. Network uncertainty never becomes optimistic success. A current
access-denied response hides retained contact data and any open private draft.

The server rejects unknown payload fields, invalid types, oversized values, invalid email/control characters and URLs with unsafe schemes, missing authority, embedded credentials or impossible ports. The browser canonicalizes valid international domain names and IPv4 spellings before submitting the retry-bound request; the server independently validates ASCII DNS/IPv4 or bracketed IPv6 authority and rejects malformed hosts, backslashes and whitespace. Stored links are parsed again before
rendering; a browser-parser discrepancy retains readable text and an editable repair path without producing an unsafe link. Email/telephone actions open the user's chosen client; the application sends no message.

The information is separate from the accepted financial/contractual snapshot. Updating contact logistics never changes accepted fees, currency, terms, dates or invoice history. Safe job duplication deliberately does not copy these contact/reference fields: the new job's manager reviews and adds them explicitly.

<a id="section-job-briefing-owning-data-and-api"></a>

## Owning data and API

The additive migration `20261116163013_job_briefing_contacts_references.sql` creates `private.job_briefings` and `private.job_briefing_requests`, both with RLS and no direct browser grants. Public wrappers remain security invoker. Their unexposed implementations check current actor/resource authority, lock actor/request/job in a consistent order and use comparison-and-swap versions. Request identity binds actor, job, expected version and the exact original JSON payload. Only safe flags and
version enter the ordinary audit event; personal contact values remain in the private rows.

- `job_briefing(p_job_id)` returns the current authorised projection and write capabilities.
- `save_job_briefing(p_job_id, p_expected_version, p_request_id, p_payload)` stores an explicit complete set and returns confirmed current state.

The actor/job-scoped `job-briefing` query is refreshed after real claims and cancellations, on current capability changes and through bounded polling. No new list/card queries, service, email delivery or production deployment is introduced.

<a id="section-job-briefing-validation-entry-points"></a>

## Validation entry points

- `src/features/jobs/briefing.test.tsx`: successful/failed saving, stable retries, conflict/reload, access denial, offline state, safe links and visibility.
- `scripts/job-briefing-db-tests.mjs`: actual PostgreSQL permissions, defaults, strict payloads, races, current role/claim visibility, immutable accepted history, safe duplication and cleanup.
- `scripts/job-briefing-api-check.mjs`: real Auth/MFA/REST and existing-token revocation in the canonical disposable stack.
- `tests/e2e/job-briefing.spec.ts`: actual management editing, lecturer claim/cancellation, DE/EN, dark theme, responsive layout and axe on desktop/mobile.

<a id="section-job-briefing-observed-browser-examples"></a>

## Observed browser examples

Both new browser journeys passed on96c3c5c with fictional data. The complete run still requires correction/repetition for its separate existing mobile-board failure; see the relevant pull request checks.

| Layout  | Management, German/light | Revoked contact, English/dark     |
|---------|--------------------------|-----------------------------------|
| Desktop | Saved optional details   | Contact hidden after cancellation |
| Mobile  | Saved optional details   | Contact hidden after cancellation |
## Assignment change requests

Open **Assignment changes** or follow the link from one of your confirmed jobs.
Create a draft, check the before/after comparison, then submit it for consent.
Management and the assigned lecturer each approve the exact proposal. An
authorised manager can then apply it. Rejection or withdrawal leaves the booking
in place and records the reason. A new version requires fresh consent.

This workflow covers future, unstarted, single-position assignments with no
invoice or invoice-review history. For standalone jobs, a proposal can replace
the complete schedule. A dedicated course can move its existing sessions when
the assignment covers the full schedule and there are no enrolments, confirmed
schedules or dependent records. The course and job session identifiers stay
stable. The workflow also supports changes to location, scope and, with
permission, terms or net pay. Company contacts can propose available schedule,
location and scope changes for their company’s assignment and can read their
own proposals. Their view hides lecturer terms, compensation and decision notes.

**Deutsch.** Wähle beim Erstellen eines kursgebundenen Auftrags die Anzahl der Dozierendenplätze. Jeder Platz umfasst alle Termine und sein eigenes Honorar. Bei einem geeigneten gemeinsamen Kursplan reicht das Management eine Terminänderung einmal ein. Bei Bedarf können ungebundene Termine ergänzt oder entfernt werden. Das Portal erstellt einen Antrag je betroffener Zuweisung. Jede dozierende Person und eine berechtigte Person aus der Verwaltung stimmen der entsprechenden Fassung zu. Die Verwaltung kann die Änderung erst anwenden, wenn alle Zustimmungen vorliegen. Dabei werden der gemeinsame Kursplan und die zugehörigen Zuweisungen gemeinsam aktualisiert. Die bisherige Vergütung und Abrechnungseinheit bleiben erhalten. Unveränderte Termine mit Anwesenheitsnachweisen behalten ihre IDs. Die ursprünglichen Einträge entfallener Termine bleiben in der Historie erhalten. Bei laufenden Einschreibungen darf sich die Abmeldefrist durch die Änderung nicht verkürzen.

**English.** Choose the number of lecturer positions when creating a course-backed offer. Each position covers the complete schedule and has its own fee. For an eligible shared schedule, management submits the date change once. Future slots without retained evidence can be added or retired when the agreed billing units are preserved. The portal creates one proposal for each affected assignment. Each lecturer and an authorised manager consent to the corresponding version. Management can apply the change once all consents have been recorded. The portal then updates the shared course schedule and the linked assignments together. It preserves the agreed commercial terms and the identifiers of unchanged attendance-backed sessions. The original entries for retired dates remain in the history. The change must preserve the withdrawal deadline for learners with current enrolments.

**Deutsch.** Firmenkontakte können für ihre gemeinsamen Kurse neue Termine vorschlagen. Die Verwaltung koordiniert den eingereichten Antrag und holt die Zustimmung der betroffenen Dozierenden ein. Bei geeigneten, vollständig zukünftigen Zuweisungen kann die Finanzverwaltung im selben Antrag Konditionen oder Vergütung für die ausgewählte dozierende Person vereinbaren. Die anderen Dozierenden bestätigen ihre Termine. Die ursprünglichen Vereinbarungen bleiben in der Historie.

**English.** Company contacts can propose new dates for their shared courses. Management coordinates the submitted request and asks each affected lecturer for consent. On an eligible assignment where all teaching is still in the future, finance can include terms or compensation for the selected lecturer in the same proposal. The other lecturers confirm their dates. The original agreements remain in history.

Commissioned net changes require gross-finance authority, retain the original
currency and customer charge, and preserve the original claim and revenue
records. An eligible later invoice uses the jointly accepted amount and stores
a reference to that amendment. The final session still determines when the
assignment can be invoiced. Cancellation records the decision for the complete
block. Compensation for cancellation is a separate finance review.

All decisions require an online database confirmation. The portal keeps the
consent and result history. Any required legal signatures follow the applicable
contract process.
