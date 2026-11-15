# Luminovia Portal — local development user guide

This guide covers the currently implemented local development workflows. The complete product includes further modules listed in [PRODUCT_SPEC.md](PRODUCT_SPEC.md); a missing module is not presented as a working placeholder. Local development uses fictional test accounts and records. Start the complete local application with `./portal start`; the command prints its address and local account instructions. `./portal status` reports service state, `./portal stop` stops services while retaining application data, and `./portal test` creates an isolated test stack without using your development records. No hosted production portal or real invitations are implied.

## Sign in and account security

Open the local URL printed by the development server. Use an account created for that local Supabase environment. Public self-registration is disabled. Sign in at `/login` with the invited account's email/password. Invitation/recovery links target `/auth/callback` (with `/auth/password` also available for password setup). The invitation asks for explicit acceptance, then password setup. This full journey and recovery have been verified with fictional local accounts; production uses separately approved email configuration. Production email delivery is a separate configuration and acceptance gate.

Account invitations and recovery rely on Supabase Auth. A local captured test email is not a message sent to a real lecturer. If sign-in or account setup fails, use the visible error and contact the responsible administrator; do not reuse test credentials outside local development.

At `/security`, set up/challenge the supported authenticator MFA flow. Management operations require a database-verified second factor. A role label alone does not grant access and a screen cannot override backend denial. Sign out after using a shared device.

## Language, theme and profile

Use the language control to switch German/English without translating authored course/profile text. Choose light/dark/system appearance. These non-sensitive preferences may be stored locally.

At `/profile`, edit your permitted self-service fields, bilingual biography, display zone and declared expertise, then save and wait for confirmation. The separate **Öffentliche Profilangaben / Public profile details** form records country, spoken languages, teaching experience and your own comma-separated labels. These details are visible only to authorised portal members. A save error means the server has not confirmed the change. Labels describe you; they do not grant roles, verify qualifications or set commercial prices. Expertise verification, account roles and contract status are controlled separately by authorised management.

## Individual accounts, roles and organisation access

Each person has an individual invited account and chooses their own password. The supported roles are **Inhaberin / Plattformleitung / Owner**, **Administration**, **Management**, **Senior-Dozent:in / Senior lecturer**, **Dozent:in / Lecturer**, **Auftraggeber:in / Client** and **Kursteilnehmer:in / Course participant**. A person may hold several actual roles. Owner and Administration can perform the business functions, including eligible teaching claims and their own invoice workflow. Privileged account, publishing and financial operations still require the corresponding server permission and MFA. This does not make them members of other people's private chats or reveal private calendar entries.

Authorised administrators open `/admin/accounts` (**Konten & Zugänge / Accounts & access**) to search accounts, invite a new person with the intended role, and edit roles through a named confirmation. An invitation is reported as sent only after server confirmation; retries do not send another invitation. For a client account, choose its existing client organisation and save **Organisation zuordnen / Assign organisation**. **Organisationszugriff entziehen / Revoke organisation access** removes that association. A client role without an active association does not grant company-wide access. One organisation can have several individually invited contacts, and an authorised administrator can associate a client with more than one organisation.

Role changes apply to subsequent authorised API requests and preserve accepted assignments and fees. Self-removal of administrative access and removal of the last active administrator are protected. Follow the linked management profile for evidence review and account suspension. Existing development volumes retain their accounts and records; first-boot fictional fixture changes do not silently rewrite them. Use the private local credentials command rather than putting passwords in project files or support messages. The approved integration surface is documented in [API_REFERENCE.md](API_REFERENCE.md).

## People, course history and participant reviews

At `/people`, search the permitted directory by name/text, declared label or topic. Open `/people/<id>` for the member's allowed biography, experience, languages, topics and upcoming/current/past teaching history. A verified topic is distinguished from a self-declared one. Private phone/email, contracts and financial terms are not part of these directory cards. **Nachricht schreiben / Message** opens the permitted direct-message workflow. Course links open `/courses?run=<id>` only when the current person may view that run.

Authorised management opens a course run at `/courses` and uses **Kursteilnehmende verwalten / Manage course participants** to choose an eligible person and save an enrolled, completed or removed status. Mark participation completed only after actual attendance and after all the course sessions have ended. This is a separate attestation, not a result inferred from a self-selected role. Commercial lecturer channels remain separate from participant-facing access.

At `/my-reviews` (**Meine Kursbewertungen / My course reviews**), eligible participants see genuinely completed courses for which participation has been confirmed. Select a rating from 1 to 5, add feedback and save online. Reviews may be edited or withdrawn through the supported controls; a concurrent-edit conflict requires reloading and checking the latest version. Other members do not see the reviewer's name. A lecturer profile shows the aggregate and up to the 100 latest visible reviews. Authorised moderators can hide or restore a review with a recorded reason; moderation preserves a protected history. Directory visibility and review eligibility remain scoped by actual roles, participation and current account access.

## Find and claim teaching jobs

Use `/jobs` to browse published opportunities and combine the implemented filters. Open `/jobs/<id>` for the complete sessions, intended time zone, currency, rate unit, compensation and terms. Read every session and the applicable accepted terms before claiming the whole job.

Choose the claim action while online. The first eligible committed transaction wins; there is no routine administrator approval queue. Success appears only after the database confirms. A filled/conflict/eligibility/prerequisite/stale-terms error means there is no confirmed new allocation. Retry-safe requests prevent duplicate assignments. Do not assume a card movement or a temporarily displayed job proves acceptance.

After confirmation, the full block appears in your assigned calendar. The accepted compensation/currency/terms are preserved independently of later offer edits. The current allocation workflow supports one lecturer slot per job. Cancellation, replacement and reopened work must use an audited workflow when implemented; contact management rather than treating a UI edit as cancellation.

## Calendar

At `/calendar`, view your own events and confirmed assignments using the available views and explicit display time zone. Store a private appointment with precise start/end times; another lecturer or an ordinary administrator must not see it. A private appointment does not automatically become a company event. Claims check conflicts against the actual session instants.

Berlin and Brisbane can have different date/offset boundaries. Check the visible time zone when booking. An ambiguous or nonexistent Berlin daylight-saving local time must be resolved explicitly rather than guessed. Calendar display does not silently alter the original job's intended zone.

## Management job creation

Authorised management uses `/admin` after MFA verification. Create the customer/course/run/session/job block through the validated workflow, specify all sessions and their zone, currency/unit, terms and eligibility requirements, then save a draft or publish. Owner/Administration choose an existing client organisation or enter a new client name, enter the **full client fee per unit and in total**, and configure the platform percentage. The preview shows the resulting lecturer compensation and platform share. The default for new configured offers is **50% platform / 50% lecturer**; an authorised administrator may set another split before acceptance. A fixed-total rate and total stay synchronized. The complete creation and split are confirmed in one server transaction. Wait for that result. Lecturer accounts cannot gain publishing privileges by changing a route, role text or browser request.

Use fictional customers, identities and commercial documents in local development. The implemented collaboration, document and commercial workflows are described below; the complete production scope remains in the persistent implementation plan.

## Client portal and full-fee visibility

`/client` is the **Kundenportal / Client portal** for an associated client account and authorised platform management. It differs from `/clients`, the internal customer/contact directory. A client sees only its active associated organisations, their course requests and full client fees, confirmed assignment sums and assigned teachers. EUR and AUD remain separate. The request volume and confirmed assignment sum are agreement values, not proof of a bank payment.

Choose **Kurs anfragen / Request a course**, select the organisation, and enter the title, teaching details, every session with its intended IANA zone, topics, currency/unit and full client fee. Save and wait for confirmation. A request does not reserve a lecturer. A still-unconverted submitted request can be cancelled after confirmation. Already published or converted work requires the authorised job lifecycle rather than a cancellation shortcut.

Owner/Administration reviews the request and chooses **Als Lehrauftrag veröffentlichen / Publish teaching assignment**, confirms the percentage and lecturer terms/contract requirement, then publishes. The eligible lecturer marketplace uses the existing first-committed whole-job claim; there is no routine lecturer approval queue. Once claimed, the client sees the assigned teacher and the agreed full assignment sum. The client view does not disclose the lecturer's compensation or the platform's share.

A lecturer sees only **Dozierendenhonorar / Lecturer compensation** in job cards, accepted terms, earnings and their invoice workflow. For example, a new EUR 1,000 full-fee offer at the default split exposes EUR 500 compensation to the lecturer and records EUR 500 platform share for authorised management. Here the compensation is the amount after the platform split; this is not a VAT, payroll or tax calculation. A changed percentage updates an unaccepted offer's terms version. Already accepted full/net/platform snapshots cannot be repriced. Existing legacy deals retain their original lecturer compensation; missing historical full fees/platform shares are displayed as unknown and are not invented by applying today's default.

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

At `/finance`, lecturers review only their own accepted compensation by **Erwartet / Expected**, **Abgeschlossen / Completed**, **In Rechnung gestellt / Invoiced** and **Bezahlt / Paid**. EUR and AUD remain separate original-currency totals. Amounts represent the accepted assignment compensation; the portal does not calculate tax or convert currencies.

To submit an invoice, choose **Rechnung einreichen / Submit invoice**, enter its number, issue date and due date, select up to 50 own eligible assignments in one currency, then upload its PDF. Selecting a currency disables assignments in the other currency. The due date cannot precede the issue date. Wait for the PDF scan, then submit and wait for server confirmation. The server derives the total from the accepted assignments and prevents active double invoicing; it does not parse the PDF’s tax/grand total. A rejected/cancelled invoice releases its claims for another permitted submission.

Owner/Administration with MFA additionally sees the protected full-fee/net/platform report. It separates offered volume from accepted agreement values, keeps EUR/AUD separate and identifies legacy records whose historical full price is unknown. Lecturer costs from those legacy accepted deals are still included; known full-fee subtotals do not fabricate missing amounts. Financial dashboard cards follow the same role boundaries.

Finance management with MFA can show all authorised lecturer records, download the exact invoice version, review it and record an approval/rejection/cancellation note. **Zahlung eintragen / Record payment** documents a payment already made; it does not initiate a bank transfer. Enter the original-currency amount, explicit-zone timestamp and reference. A partial payment leaves the invoice approved; the final payment marks it paid. Overpayment is rejected. **Zahlungsverlauf / Payment history** retains each entry; an authorised **Zahlungseintrag stornieren / Void payment record** corrects an erroneous entry with a reason and recalculates the outstanding balance without deleting its history or moving money.

Use **Rechnungslabels bearbeiten / Edit invoice labels** to classify an authorised invoice with up to 10 comma-separated labels of 50 characters each. The owner or authorised finance manager can save these metadata labels without changing its accepted amounts, document or payment history. Profile labels and invoice labels are separate. Search invoices by number/person/note and combine status, currency and label filters. The invoice CSV exports the current authorised filtered result. Earnings and protected platform reports have their own exports. All exports preserve original currency and neutralize spreadsheet formula prefixes in authored text. Broader accounting reports/statements and tax/payroll/banking integration are outside the current workflow.

## Search and remaining scope

The shell’s **Im Portal suchen / Search the portal** searches the supported authorised files, knowledge, messages and contact resources. Results remain scoped by the current database permissions; a search result or copied record identifier cannot grant access to a protected resource.

The complete target is larger than these implemented workflows. Remaining work includes multi-slot job capacity, cancellation/reopening/substitutes, complete availability/global-calendar publishing/reminders, richer saved job views, taxonomy administration, notification preferences/quiet hours and email delivery, knowledge attachment ACLs, file expiry/retention administration, legal/configurable documents, broader audit/administrative recovery, native PWA/platform checks and monitored hosted deployment/restore acceptance. Refer to `IMPLEMENTATION_PLAN.md` and `WORKLOG.md` for the current tested, untested and pending status. A local browser check does not constitute production or legal acceptance.

## Local verification checkpoint

The earlier M2 complete local command passed 42 source unit/component tests, 7 runtime safety tests, 11 Edge tests, 78 PostgreSQL checks, real API/scanner/persistence workflows, 40 desktop/mobile browser journeys and 2 built-PWA checks. A subsequent visual correction replaced the private file pickers' hidden-input styling; all 6 affected chat/commercial desktop/mobile journeys then passed in a separate fresh isolated stack. These include the actual attachment button/file chooser, security scanning, sending and a recipient download compared byte-for-byte, plus a no-horizontal-overflow assertion on populated chats. The account/client/commission/profile extension is checked in additional isolated runs; their current source, actual completed checks and full CI result are recorded in the main work log. Do not infer acceptance of that extension from the earlier M2 counts. These local results do not establish native Android keyboard/PWA installation, hosted production or legal acceptance.

## Offline and support

The PWA shell may be available without a connection, but private data and sensitive files are not deliberately cached for offline use. Claims and other writes need an online server response. Reconnect and reload/refetch when appropriate; never treat offline submission as a confirmed booking. Save unsaved form content before accepting an app update when prompted.

Report the visible error, affected route, approximate local time/time zone and safe reproduction steps. Do not share passwords, access tokens, signed file URLs or private document/message contents in screenshots or support reports. Full supported-platform installation and production operating guidance will be added after actual acceptance testing.

## CBW-Bausteine, Profilbilder und Kommentare

Unter **Kurse → CBW-Bausteine** findest du die 22 fachlichen Vorlagen aus den 24 bereitgestellten PDF-Fassungen. Suche nach Kurzzeichen oder Inhalt und öffne die Beschreibung. Die Quellenangaben zeigen die genaue Fassung mit Dateiname, Stand, Seiten und aufklappbarer Prüfsumme; die Originaldateien werden nicht öffentlich angeboten. Bei LPC3/LPC4 sind beide Fassungen sichtbar.

Als berechtigte Verwaltung wählst du **Durchführung planen**, ordnest den Auftraggeber zu und passt Durchführungsart, Ort/Link, Zeitzone und Termine an. Die Terminvorlage kann die zehn Unterrichtstage auf Wochentage verteilen; prüfe Feiertage, Pausen und tatsächliche Unterrichtszeiten selbst. Eine neue Durchführung übernimmt keine fremden Personen, Verträge oder Zuweisungen.

Mit **Auftrag daraus erstellen** öffnest du den vorhandenen Kurs als Auftragsgrundlage. Inhalte und Termine sind zur Kontrolle sichtbar; in der Kursplanung kannst du sie vorher anpassen. Ergänze Honorar, Währung, Einheit und Bedingungen und entscheide über die Veröffentlichung. Admin/Owner sehen den vollen Kundenpreis mit Plattformanteil; Management ohne dieses Recht arbeitet mit dem eigenen Netto-Angebotsvertrag. Ein geänderter Quellenstand oder bereits vorhandener aktiver Auftrag wird serverseitig erkannt. Der bestätigte Auftrag öffnet sich über den Ergebnislink.

Unter **Mein Profil** kannst du ein PNG-, JPEG- oder WebP-Profilbild wählen. Der Editor erklärt den quadratischen Mittelausschnitt. Erst die bestätigte Verarbeitung und Speicherung wählen das neue Bild aus; ein abgelehntes Bild ersetzt dein bisheriges nicht. **Profilbild entfernen** hebt die aktuelle Auswahl auf. Berechtigte Team-/Kurskontakte sehen das ausgewählte Bild; es wird nicht als öffentliche Internetdatei veröffentlicht. Offline erscheinen Initialen und die Bearbeitung ist gesperrt.

Vorlagen und einzelne Aufträge haben **Kommentare & Unterrichtsnotizen** für das berechtigte Lehrteam. Schreibe eine Frage oder Lehrnotiz, bearbeite eigene Beiträge oder ziehe sie mit Bestätigung zurück. Die Verwaltung kann Beiträge mit MFA und Begründung ausblenden/wiederherstellen. Ein Versionskonflikt weist auf eine zwischenzeitliche Änderung hin; prüfe dann den aktuellen Beitrag. Kommentare ändern keine angenommenen Honorare oder Auftragsbedingungen und sind von Auftraggeber-/Teilnahmekonten getrennt.
