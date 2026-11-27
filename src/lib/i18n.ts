/**
 * Shared DE/EN dictionary and active-language initialization. Translation keys affect UI text
 * only; authored business content keeps its original language.
 */
import { installationBrand, portalInternalEdition } from "./installation-brand";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { readPreference, writePreference } from "./preferences";
import { isAccountLanguage } from "./account-languages";

export const accountIdentifierLabels: [string, string] = portalInternalEdition
  ? ["Luminovia User ID", "Luminovia User ID"]
  : ["Benutzer-ID", "User ID"];

const pairs: Record<string, [string, string]> = {
  appInstallation: ["App-Installation", "App installation"],
  installApp: ["App installieren", "Install app"],
  assignmentChanges: ["Auftragsänderungen", "Assignment changes"],
  courseReadiness: ["Kursbereitschaft", "Course readiness"],
  helpSupport: ["Hilfe & Support", "Help & support"],
  teachingDelivery: ["Leistungsnachweise", "Teaching delivery"],
  supportDesk: ["Support", "Support desk"],
  websiteEnquiries: ["Website-Anfragen", "Website enquiries"],
  announcements: ["Ankündigungen", "Announcements"],
  helpGuides: ["Hilfe & Anleitungen", "Help & guides"],
  errorHelp: [
    "Problem verstehen und nächste Schritte finden",
    "Understand the problem and find next steps",
  ],
  auditLog: ["Verwaltungsprotokoll", "Administration log"],
  availability: ["Verfügbarkeit", "Availability"],
  topics: ["Themen & Tools", "Topics & tools"],
  requestCourses: ["Kurse beauftragen", "Commission courses"],
  myCourses: ["Meine Kurse", "My courses"],
  learningWorkspace: ["Lernbereich", "Learning workspace"],
  examTimeRemaining: ["Noch {{duration}}", "{{duration}} remaining"],
  accounts: ["Konten", "Accounts"],
  staffDirectory: ["Dozierende", "Lecturers"],
  clientPortal: ["Unternehmensportal", "Company portal"],
  myReviews: ["Kursbewertungen", "Course reviews"],
  courses: ["Kurse", "Courses"],
  coursesManage: ["Kurse & Durchführung", "Courses & delivery"],
  clientCourses: ["Kurse des Unternehmens", "Company courses"],
  companies: ["Unternehmen", "Companies"],
  contracts: ["Verträge", "Contracts"],
  finance: ["Finanzen", "Finance"],
  controlCenter: ["Leitstand", "Control Center"],
  myFinanceOverview: [
    "Eigene Honorare und Rechnungen",
    "Your fees and invoices",
  ],
  myFinanceExports: [
    "Rechnungsdaten herunterladen",
    "Download your invoice records",
  ],
  myFinanceAnalytics: [
    "Eigene Einsätze und Einnahmen auswerten",
    "Analyse your assignments and earnings",
  ],
  platformFinanceOverview: [
    "Umsatz, Rechnungen und Zahlungen",
    "Revenue, invoices and payments",
  ],
  platformFinanceExports: [
    "Buchhaltung und Abrechnungsdaten",
    "Accounting and financial exports",
  ],
  platformFinanceAnalytics: [
    "Kennzahlen, Vergleiche und Prognosen",
    "Metrics, comparisons and forecasts",
  ],
  myFinance: ["Meine Finanzen", "My finances"],
  myInvoiceExports: ["Rechnungsexporte", "Invoice exports"],
  companyFinance: ["Unternehmensfinanzen", "Company finances"],
  platformFinance: ["Plattformfinanzen", "Platform finances"],
  platformFinanceDescription: [
    "Finanzübersicht, Buchhaltung, Exporte und Analysen der Plattform",
    "Platform finance overview, accounting, exports and analytics",
  ],
  financeOverview: ["Finanzübersicht", "Finance overview"],
  analytics: ["Analysen", "Analytics"],
  accountingExports: ["Buchhaltung und Exporte", "Accounting and exports"],
  submitInvoice: ["Rechnung einreichen", "Submit invoice"],
  portalSearch: ["Im Portal suchen", "Search the portal"],
  searchAction: ["Suchen", "Search"],
  searchHint: [
    "Durchsuche die für dich freigegebenen Aufträge, Dateien, Nachrichten und Wissensbeiträge. Mindestens zwei Zeichen.",
    "Search jobs, files, messages and knowledge you are permitted to access. At least two characters.",
  ],
  searchEmpty: [
    "Keine freigegebenen Treffer gefunden.",
    "No permitted results found.",
  ],
  notificationForum: ["Neue Forum-Antwort", "New forum reply"],
  chats: ["Chat", "Chat"],
  files: ["Dateien", "Files"],
  more: ["Mehr", "More"],
  wiki: ["Wiki", "Wiki"],
  forum: ["Forum", "Forum"],
  notificationChat: ["Neue Chat-Nachricht", "New chat message"],
  notificationActivity: ["Neue Aktivität", "New activity"],
  sessionCount_one: ["{{count}} Termin", "{{count}} session"],
  sessionCount_other: ["{{count}} Termine", "{{count}} sessions"],
  peopleNoResults: [
    "Keine Personen zu dieser Suche gefunden.",
    "No people match this search.",
  ],
  peopleUnnamed: ["Person ohne Anzeigenamen", "Person without a display name"],
  peopleActive: ["Aktiv", "Active"],
  peopleInactive: ["Gesperrt", "Suspended"],
  peopleDeactivate: ["Zugang sperren", "Suspend access"],
  peopleActivate: ["Zugang aktivieren", "Activate access"],
  peopleDeactivateConfirm: ["Portalzugriff sperren?", "Suspend portal access?"],
  peopleActivateConfirm: [
    "Portalzugriff aktivieren?",
    "Activate portal access?",
  ],
  peopleDeactivateDescription: [
    "Der Portalzugriff für {{name}} wird gesperrt. Bestehende Aufträge und die Historie bleiben erhalten.",
    "Portal access for {{name}} will be suspended. Existing assignments and history are retained.",
  ],
  peopleActivateDescription: [
    "Der Portalzugriff für {{name}} wird erneut aktiviert.",
    "Portal access for {{name}} will be activated again.",
  ],
  peopleActivated: [
    "Der Zugang für {{name}} wurde aktiviert.",
    "Access for {{name}} was activated.",
  ],
  peopleDeactivated: [
    "Der Zugang für {{name}} wurde gesperrt.",
    "Access for {{name}} was suspended.",
  ],
  peopleSelfProtected: [
    "Dein eigenes Konto kann hier nicht gesperrt werden.",
    "Your own account cannot be suspended here.",
  ],
  peopleStatusFailed: [
    "Der Kontostatus konnte nicht geändert werden. Prüfe deine Berechtigungen und ob ein weiteres aktives Administratorkonto vorhanden ist.",
    "The account status could not be changed. Check your permissions and whether another active administrator account is available.",
  ],
  peopleExpertiseTitle: [
    "Expertise und Qualifikationen verwalten",
    "Manage expertise and qualifications",
  ],
  peopleVerificationHint: [
    "Prüfe die Qualifikationsnachweise vor der Freigabe. Nachweisdateien werden derzeit außerhalb des Portals verwaltet.",
    "Review qualification evidence before verifying expertise. Evidence files are currently managed outside the portal.",
  ],
  peopleDelegatedEvidence: [
    "Dateien werden im Profil dieser Person gespeichert. Hier siehst du die Qualifikationsdateien, die du für sie hochgeladen hast. Freigegebene Nachweise findest du beim jeweiligen Thema.",
    "Files are saved to this person's profile. You can see the qualification files you uploaded for them here. Shared evidence appears under the relevant topic.",
  ],
  peopleExpertiseTopic: ["Thema für diese Person", "Topic for this lecturer"],
  peopleExpertiseAdd: ["Expertise hinzufügen", "Add expertise"],
  peopleExpertiseRemove: ["Expertise entfernen", "Remove expertise"],
  peopleExpertiseRevokeFirst: [
    "Hebe zuerst die Qualifikationsbestätigung für dieses Thema auf.",
    "Revoke the qualification verification for this topic first.",
  ],
  peopleExpertiseSaveFailed: [
    "Die Expertise konnte nicht gespeichert werden.",
    "Could not save the expertise.",
  ],
  peopleExpertiseSaved: ["Expertise gespeichert.", "Expertise saved."],
  peopleNoExpertise: [
    "Für dieses Konto sind noch keine Themen hinterlegt.",
    "No expertise topics are assigned to this account yet.",
  ],
  peopleReviewTopic: [
    "Expertise prüfen: {{topic}}",
    "Review expertise: {{topic}}",
  ],
  peopleValidUntil: ["Gültig bis (UTC)", "Valid until (UTC)"],
  peopleCurrentExpiry: ["Aktuelles Ablaufdatum", "Current expiry"],
  peopleExpiryHint: [
    "Leer lassen, wenn die geprüfte Qualifikation kein Ablaufdatum hat. Alle Eingaben erfolgen in UTC.",
    "Leave empty if the reviewed qualification does not expire. All input times use UTC.",
  ],
  peopleExpiryInvalid: [
    "Wähle einen gültigen zukünftigen Zeitpunkt in UTC oder lasse das Ablaufdatum leer.",
    "Choose a valid future time in UTC, or leave the expiry empty.",
  ],
  peopleExpired: ["Abgelaufen", "Expired"],
  peopleVerify: ["Expertise verifizieren", "Verify expertise"],
  peopleUpdateVerification: ["Verifizierung speichern", "Save verification"],
  peopleRevokeVerification: ["Verifizierung aufheben", "Revoke verification"],
  peopleVerificationSaved: [
    "Die Verifizierung wurde gespeichert.",
    "The verification was saved.",
  ],
  peopleVerificationFailed: [
    "Die Verifizierung konnte nicht gespeichert werden. Prüfe, ob die Person aktiv ist, die Expertise noch angegeben ist und das Ablaufdatum gültig ist.",
    "The verification could not be saved. Check that the person is active, the expertise is still declared and the expiry is valid.",
  ],
  peopleActivateBeforeReview: [
    "Aktiviere den Zugang, bevor du die Expertise prüfst.",
    "Activate access before reviewing expertise.",
  ],
  acceptInvite: ["Einladung annehmen", "Accept invitation"],
  setupWelcome: [
    "Dein Zugang zu {{name}} wurde eingerichtet. Lege jetzt dein persönliches Passwort fest.",
    "Your access to {{name}} is ready. Set your personal password now.",
  ],
  inviteWelcome: [
    "Willkommen bei {{name}}. Bestätige deine Einladung und lege anschließend dein Passwort fest.",
    "Welcome to {{name}}. Accept your invitation, then set your password.",
  ],
  inviteInvalid: [
    "Dieser Link ist ungültig oder abgelaufen. Bitte kontaktiere die Verwaltung.",
    "This link is invalid or has expired. Please contact management.",
  ],
  inviteTitle: ["Dozierende einladen", "Invite lecturers"],
  inviteHint: [
    "Die eingeladene Person erhält einen Zugangslink per E-Mail und die Rolle Dozent:in. Verwaltungsrechte werden damit nicht vergeben.",
    "The invited person receives an access link by email and the lecturer role. This does not grant administrative permissions.",
  ],
  inviteNameHint: [
    "Optional; der Name kann später im Profil geändert werden.",
    "Optional; the name can be changed in the profile later.",
  ],
  inviteSend: ["Einladung senden", "Send invitation"],
  inviteSending: ["Einladung wird gesendet …", "Sending invitation …"],
  invite_sent: [
    "Die Einladung wurde versandt und der Zugang als Dozent:in angelegt.",
    "The invitation was sent and lecturer access was created.",
  ],
  invite_already_sent: [
    "Für diese Adresse wurde bereits eine Einladung versandt. Es wurde keine weitere E-Mail gesendet.",
    "An invitation has already been sent to this address. No additional email was sent.",
  ],
  invite_in_progress: [
    "Für diese Adresse besteht bereits eine Anfrage. Der Versand ist noch nicht bestätigt. Bitte prüfe den Einladungsstatus, bevor du einen erneuten Versand veranlasst.",
    "A request already exists for this address. Sending has not been confirmed. Check the invitation status before arranging another send.",
  ],
  invite_throttled: [
    "Das Einladungslimit ist erreicht: höchstens fünf neue Adressen in 15 Minuten. Bitte später erneut versuchen.",
    "The invitation limit has been reached: at most five new addresses in 15 minutes. Try again later.",
  ],
  invite_idempotency_conflict: [
    "Diese Anfrage gehört zu anderen Einladungsdaten. Bitte prüfe die Adresse und starte eine neue Anfrage.",
    "This request belongs to different invitation details. Check the address and start a new request.",
  ],
  invite_failed: [
    "Der Versand konnte nicht bestätigt werden. Die Anfrage wurde zur Prüfung gespeichert. Bitte den Versand prüfen; automatische Wiederholungen sind gesperrt.",
    "Sending could not be confirmed. The request was saved for investigation. Check delivery; automatic retries are blocked.",
  ],
  invite_permission_required: [
    "Für Einladungen sind Verwaltungsrechte und eine aktuelle Zwei-Faktor-Bestätigung erforderlich.",
    "Invitations require current administrative permission.",
  ],
  invite_disabled: [
    "Der Einladungsversand ist für diese Installation noch nicht freigeschaltet.",
    "Invitation sending has not been enabled for this installation yet.",
  ],
  invite_origin_denied: [
    "Diese Portaladresse ist für den Einladungsversand nicht freigegeben.",
    "This portal address has not been approved for invitation sending.",
  ],
  invite_unavailable: [
    "Der Einladungsstatus konnte nicht bestätigt werden. Bitte dieselbe Anfrage erneut prüfen; ein Versand wird erst nach Serverbestätigung angezeigt.",
    "The invitation status could not be confirmed. Retry the same request; sending is only shown after server confirmation.",
  ],

  workspace: ["Arbeitsbereich", "Workspace"],
  opportunities: ["Neue Möglichkeiten", "New opportunities"],
  connect: ["LERNEN. VERBINDEN. WACHSEN.", "LEARN. CONNECT. GROW."],
  portal: ["Dein Raum für gute Lehre.", "Your space for great teaching."],
  tagline: [
    "Wissen teilen. Gemeinsam wachsen.",
    "Share knowledge. Grow together.",
  ],
  home: ["Übersicht", "Overview"],
  jobs: ["Stellenbörse", "Jobs"],
  calendar: ["Kalender", "Calendar"],
  calendarDisplayZone: ["Kalenderanzeige in", "Show calendar in"],
  calendarProfileZone: [
    "Profilzeitzone ({{zone}})",
    "Profile time zone ({{zone}})",
  ],
  calendarDisplayedTime: [
    "Zeit in der Kalenderansicht",
    "Time in the calendar view",
  ],
  profile: ["Mein Profil", "My profile"],
  admin: ["Verwaltung", "Administration"],
  adminCoursesAssignments: ["Kurse & Aufträge", "Courses & assignments"],
  adminOverview: ["Übersicht", "Overview"],
  adminOverviewDescription: [
    "Alle verfügbaren Verwaltungsaufgaben auf einen Blick.",
    "All available administration tasks at a glance.",
  ],
  adminDestination_adminCoursesAssignments: [
    "Kursdurchführungen planen, Ausschreibungen erstellen und Dozierende zuweisen.",
    "Schedule course runs, publish assignments and allocate lecturers.",
  ],
  adminDestination_controlCenter: [
    "Offene Besetzungen, fehlende Unterlagen und Aufgaben vor Kursbeginn im Blick behalten.",
    "Track unfilled assignments, missing documents and tasks due before courses start.",
  ],
  adminDestination_topics: [
    "Themen, Werkzeuge und Sprachen für Kurse und Dozierendenprofile pflegen.",
    "Manage topics, tools and languages used in courses and lecturer profiles.",
  ],
  adminDestination_assignmentChanges: [
    "Änderungen an bestätigten Aufträgen prüfen und Entscheidungen festhalten.",
    "Review changes to confirmed assignments and record decisions.",
  ],
  adminDestination_contracts: [
    "Vertragsdokumente zuordnen und Bestätigungen nachverfolgen.",
    "Manage contract documents and track acknowledgements.",
  ],
  adminDestination_companies: [
    "Unternehmen, Ansprechpersonen, Klassen und interne Dozierende verwalten.",
    "Manage companies, contacts, classes and internal lecturers.",
  ],
  adminDestination_staffDirectory: [
    "Dozierendenprofile und fachliche Schwerpunkte einsehen.",
    "Browse lecturer profiles and areas of expertise.",
  ],
  adminDestination_adminAccounts: [
    "Konten einladen, Rollen zuweisen und Zugänge verwalten.",
    "Invite users, assign roles and manage account access.",
  ],
  adminDestination_platformFinance: [
    "Einnahmen, Rechnungen, Abrechnungsexporte und Kennzahlen der Plattform einsehen.",
    "Review platform revenue, invoices, accounting exports and analytics.",
  ],
  adminDestination_announcements: [
    "Portalweite Mitteilungen verfassen und veröffentlichen.",
    "Write and publish announcements for the portal.",
  ],
  adminDestination_auditLog: [
    "Administrative Aktionen und Änderungen nachvollziehen.",
    "Review administrative actions and changes.",
  ],
  adminDestination_mailSettings: [
    "Mailversand konfigurieren und Zustellprobleme bearbeiten.",
    "Configure outgoing mail and resolve delivery failures.",
  ],
  adminDestination_whiteLabel: [
    "Edition, Lizenz und Darstellung der Kundeninstallation verwalten.",
    "Manage the edition, licence and branding of a customer installation.",
  ],
  adminDestination_fullPlatformReset: [
    "Die gesamte Installation über den bestätigten Reset-Ablauf zurücksetzen.",
    "Reset the entire installation through the confirmed reset workflow.",
  ],
  adminOperations: ["Kursbetrieb", "Course operations"],
  adminOperationsDescription: [
    "Aufträge, Leitstand, Themen und Verträge",
    "Assignments, Control Center, topics and contracts",
  ],
  adminDirectory: ["Unternehmen & Personen", "Companies & people"],
  adminDirectoryDescription: [
    "Unternehmen, Dozierende und Benutzerkonten",
    "Companies, lecturers and user accounts",
  ],
  adminPlatform: ["Plattformbetrieb", "Platform operations"],
  adminPlatformDescription: [
    "Ankündigungen, Protokoll, Mail und Systemeinstellungen",
    "Announcements, audit trail, mail and system settings",
  ],
  adminAccounts: ["Benutzerkonten", "User accounts"],
  whiteLabel: ["White Label", "White Label"],
  mailSettings: ["E-Mail-Transport", "Mail transport"],
  settings: ["Einstellungen", "Settings"],
  personalSettings: ["Persönliche Einstellungen", "Personal settings"],
  login: ["Anmelden", "Sign in"],
  logout: ["Abmelden", "Sign out"],
  signOutFailed: [
    "Abmelden fehlgeschlagen. Versuche es erneut.",
    "Sign-out failed. Try again.",
  ],
  academyAdministration: ["Akademie verwalten", "Academy administration"],
  academySettings: ["Kontoeinstellungen", "Account settings"],
  email: ["E-Mail", "Email"],
  username: ["Benutzername", "Username"],
  password: ["Passwort", "Password"],
  authenticatorSettings: ["Authenticator-App", "Authenticator app"],
  authenticatorSetup: [
    "Authenticator-App einrichten",
    "Set up authenticator app",
  ],
  authenticatorVerifySignIn: ["Anmeldung bestätigen", "Verify sign-in"],
  authenticatorVerifyHint: [
    "Gib den aktuellen Code deiner Authenticator-App ein.",
    "Enter the current code from your authenticator app.",
  ],
  authenticatorConnect: [
    "Authenticator-App verbinden",
    "Connect authenticator app",
  ],
  authenticatorSetupHint: [
    "Verbinde eine Authenticator-App mit deinem Konto. Sie erzeugt nach der Passwortanmeldung den sechsstelligen Bestätigungscode.",
    "Connect an authenticator app to your account. It generates the six-digit code you need after signing in with your password.",
  ],
  authenticatorScan: [
    "Scanne den QR-Code mit deiner Authenticator-App und gib den angezeigten Code ein.",
    "Scan the QR code with your authenticator app and enter the code it displays.",
  ],
  authenticatorQr: [
    "QR-Code zum Verbinden der Authenticator-App",
    "QR code for connecting the authenticator app",
  ],
  authenticatorManualKey: ["Schlüssel manuell eingeben", "Enter key manually"],
  authenticatorDevice: ["Authenticator", "Authenticator"],
  authenticatorDeviceName: ["Portal-Authenticator", "Portal authenticator"],
  authenticatorDeviceNumber: [
    "Authenticator {{count}}",
    "Authenticator {{count}}",
  ],
  authenticatorCode: ["6-stelliger Code", "6-digit code"],
  authenticatorConfirm: ["Bestätigen", "Verify"],
  authenticatorConnected: [
    "Deine Authenticator-App ist verbunden.",
    "Your authenticator app is connected.",
  ],
  authenticatorOnline: [
    "Verbinde dich mit dem Internet, um deine Anmeldung zu bestätigen.",
    "Connect to the internet to verify your sign-in.",
  ],
  authenticatorSetupFailed: [
    "Die Authenticator-App konnte nicht verbunden werden. Versuche es erneut oder wende dich an die Administration.",
    "Could not connect the authenticator app. Try again or contact your administrator.",
  ],
  authenticatorCodeFailed: [
    "Der Code konnte nicht bestätigt werden. Gib den aktuellen Code deiner Authenticator-App ein.",
    "Could not verify the code. Enter the current code from your authenticator app.",
  ],
  forgot: ["Passwort vergessen?", "Forgot password?"],
  recover: ["Link anfordern", "Request reset link"],
  recoverSent: [
    "Wenn ein Konto existiert, erhältst du einen Link zur Wiederherstellung.",
    "If an account exists, you will receive a recovery link.",
  ],
  invitationOnly: [
    "Willkommen bei {{academy}}. Melde dich mit deinem eingeladenen Konto an.",
    "Welcome to {{academy}}. Sign in with your invited account.",
  ],
  invitationNote: [
    "Der Zugang erfolgt ausschließlich per Einladung.",
    "Access is by invitation only.",
  ],
  loginFailed: [
    "Anmeldung nicht möglich. Bitte prüfe deine Zugangsdaten.",
    "Unable to sign in. Check your credentials.",
  ],
  loginRateLimited: [
    "Zu viele Anmeldeversuche. Bitte warte einige Minuten und versuche es erneut.",
    "Too many sign-in attempts. Wait a few minutes before trying again.",
  ],
  loginUnavailable: [
    "Die Anmeldung ist vorübergehend nicht verfügbar. Bitte versuche es erneut.",
    "Sign-in is temporarily unavailable. Please try again.",
  ],
  save: ["Speichern", "Save"],
  saving: ["Wird gespeichert …", "Saving …"],
  saved: ["Gespeichert.", "Saved."],
  cancel: ["Abbrechen", "Cancel"],
  close: ["Schließen", "Close"],
  back: ["Zurück", "Back"],
  loading: ["Wird geladen …", "Loading …"],
  error: [
    "Die Anfrage konnte nicht abgeschlossen werden. Bitte erneut versuchen.",
    "The request could not be completed. Please try again.",
  ],
  nextPageUnavailable: [
    "Weitere Ergebnisse konnten gerade nicht geladen werden.",
    "More results could not be loaded right now.",
  ],
  retryNextPage: [
    "Weitere Ergebnisse erneut laden",
    "Retry loading more results",
  ],
  retry: ["Erneut versuchen", "Try again"],
  offline: [
    "Du bist offline. Für aktuelle Daten und Änderungen ist eine Verbindung erforderlich.",
    "You are offline. A connection is required for current data and changes.",
  ],
  notConfigured: [
    "Die Verbindung zum Portal ist noch nicht eingerichtet.",
    "The portal connection has not been configured yet.",
  ],
  setupHint: [
    "Für diese Installation fehlen die öffentlichen Supabase-Verbindungsdaten. Die Einrichtung ist im README beschrieben.",
    "This installation needs public Supabase connection settings. See the README for setup.",
  ],
  theme: ["Farbschema", "Theme"],
  light: ["Hell", "Light"],
  dark: ["Dunkel", "Dark"],
  system: ["System", "System"],
  language: ["Sprache", "Language"],
  search: ["Stellen durchsuchen", "Search jobs"],
  all: ["Alle", "All"],
  online: ["Online", "Online"],
  onsite: ["Vor Ort", "On site"],
  hybrid: ["Hybrid", "Hybrid"],
  mixed: ["Gemischte Durchführung", "Mixed delivery"],
  published: ["Offen", "Open"],
  filled: ["Vergeben", "Filled"],
  draft: ["Entwurf", "Draft"],
  archived: ["Archiviert", "Archived"],
  noJobs: [
    "Hier ist Raum für neue Möglichkeiten.",
    "Room for new opportunities.",
  ],
  noJobsHint: [
    "Aktuell passen keine Stellen zu deinen Filtern. Passe deine Suche an oder schau später wieder vorbei.",
    "No jobs match your filters. Adjust your search or check back later.",
  ],
  details: ["Details ansehen", "View details"],
  claim: ["Auftrag übernehmen", "Claim now"],
  claiming: ["Wird verbindlich geprüft …", "Confirming your claim …"],
  confirmed: [
    "Dein Auftrag ist bestätigt. Alle Termine sind reserviert.",
    "Your assignment is confirmed. All sessions are reserved.",
  ],
  claim_filled: [
    "Dieser Auftrag wurde bereits vergeben.",
    "This job has already been filled.",
  ],
  claim_conflict: [
    "Mindestens ein Termin überschneidet sich mit deinem Kalender.",
    "At least one session overlaps with your calendar.",
  ],
  claim_not_eligible: [
    "Wähle im Profil einen passenden Themenbereich für diesen Auftrag.",
    "Choose a matching subject area for this job in your profile.",
  ],
  claim_prerequisite_missing: [
    "Ein gültiger Rahmenvertrag wird benötigt.",
    "A valid master contract is required.",
  ],
  claim_terms_changed: [
    "Die Konditionen wurden geändert. Lade die Stelle neu und prüfe sie erneut.",
    "The terms have changed. Reload this job and review it again.",
  ],
  claim_unavailable: [
    "Dieser Auftrag ist derzeit nicht verfügbar.",
    "This job is currently unavailable.",
  ],
  terms: ["Konditionen", "Terms"],
  acceptTerms: ["Konditionen akzeptieren", "Accept the terms"],
  claimHelp: [
    "Die erfolgreiche Übernahme bestätigt den gesamten Block sofort verbindlich. Alle Zeiten werden auf Überschneidungen geprüft.",
    "A successful claim immediately confirms the entire block. All sessions are checked for conflicts.",
  ],
  sessions: ["Termine", "Sessions"],
  customer: ["Unternehmen", "Company"],
  rate: ["Honorar", "Fee"],
  total: ["Gesamtvergütung", "Total compensation"],
  per_day: ["pro Tag", "per day"],
  per_hour: ["pro Stunde", "per hour"],
  per_teaching_unit: ["pro Unterrichtseinheit", "per teaching unit"],
  fixed_total: ["pauschal", "fixed total"],
  timezone: ["Zeitzone", "Time zone"],
  commonTimeZones: ["Häufige Zeitzonen", "Common time zones"],
  otherTimeZones: ["Weitere Zeitzonen", "Other time zones"],
  chooseTimeZone: ["Zeitzone auswählen", "Choose a time zone"],
  profileTimeZoneHint: [
    "Standard für deinen Kalender, die Terminübersicht und Benachrichtigungszeiten.",
    "Default for your calendar, schedule preview and notification timestamps.",
  ],
  delivery: ["Durchführung", "Delivery"],
  expertise: ["Expertise", "Expertise"],
  requirements: ["Benötigte Themen", "Required topics"],
  noRequirements: [
    "Keine besonderen Qualifikationsvorgaben.",
    "No specific qualification requirements.",
  ],
  myAssignments: ["Meine Aufträge", "My assignments"],
  openJobs: ["Offene Stellen", "Open jobs"],
  nextSessions: ["Deine nächsten Termine", "Your next sessions"],
  noSessions: ["Noch keine bestätigten Termine.", "No confirmed sessions yet."],
  greeting: ["Schön, dass du da bist, {{name}}.", "Good to see you, {{name}}."],
  heroText: [
    "Finde deinen nächsten Lehrauftrag und behalte deine Termine im Blick.",
    "Find your next teaching assignment and keep your schedule in view.",
  ],
  explore: ["Möglichkeiten entdecken", "Explore opportunities"],
  today: ["Heute", "Today"],
  displayName: ["Anzeigename", "Display name"],
  accountSettings: ["Zugangsdaten", "Account credentials"],
  currentEmail: ["Aktuelle E-Mail-Adresse", "Current email address"],
  newEmail: ["Neue E-Mail-Adresse", "New email address"],
  changeEmail: ["E-Mail-Adresse ändern", "Change email address"],
  emailChangeInvalid: [
    "Gib eine gültige neue E-Mail-Adresse ein.",
    "Enter a valid new email address.",
  ],
  emailChangePending: [
    "Die Änderung wurde angefordert. Bitte bestätige sie über die E-Mails an deine bisherige und neue Adresse. Bis dahin gilt deine bisherige Adresse.",
    "The change was requested. Confirm it using the emails sent to your current and new addresses. Your current address remains active until then.",
  ],
  emailChangeSaved: [
    "Deine E-Mail-Adresse wurde geändert.",
    "Your email address was changed.",
  ],
  accountNameHelp: [
    "Deinen Anzeigenamen änderst du im Profil. Die Anmeldung erfolgt mit deiner E-Mail-Adresse.",
    "Change your display name in your profile. Sign in with your email address.",
  ],
  aboutMe: ["Über mich", "About me"],
  manageExpertise: [
    "Expertise-Labels hinzufügen und verwalten",
    "Add and manage expertise labels",
  ],
  bioDe: ["Über mich (Deutsch)", "About me (German)"],
  bioEn: ["About me (English)", "About me (English)"],
  phone: ["Telefon", "Phone"],
  saveProfile: ["Profil speichern", "Save profile"],
  expertiseHelp: [
    "Wähle IT und Informatik, Business und Wirtschaft oder Sonstige Themen. Ein passender Themenbereich genügt für die Übernahme. Einzelne Fachthemen kannst du zusätzlich angeben.",
    "Choose IT and Computing, Business and Economics or Other Subjects. One matching subject area is enough to claim a job. You can also list individual topics.",
  ],
  selfDeclaredExpertise: ["Als Expertise angegeben", "Declared expertise"],
  verified: ["Verifiziert", "Verified"],
  unverified: ["Noch nicht verifiziert", "Not verified yet"],
  profileMissing: [
    "Dein Profil ist noch nicht freigeschaltet. Bitte kontaktiere die Verwaltung.",
    "Your profile is not active yet. Please contact management.",
  ],
  privateCalendar: ["Dein privater Kalender", "Your private calendar"],
  calendarTools: ["Kalenderfunktionen", "Calendar tools"],
  privateNote: [
    "Private Termine sind nur für dich sichtbar. Bestätigte Aufträge werden automatisch eingetragen.",
    "Private appointments are visible only to you. Confirmed assignments appear automatically.",
  ],
  addEvent: ["Privaten Termin hinzufügen", "Add private appointment"],
  title: ["Titel", "Title"],
  start: ["Beginn", "Start"],
  end: ["Ende", "End"],
  saveEvent: ["Termin speichern", "Save appointment"],
  deleteEvent: ["Privaten Termin löschen", "Delete private appointment"],
  eventSaved: ["Termin gespeichert.", "Appointment saved."],
  eventDeleted: ["Termin gelöscht.", "Appointment deleted."],
  eventHelp: [
    "Dieser Termin blockiert deine Verfügbarkeit für neue Aufträge.",
    "This appointment blocks your availability for new assignments.",
  ],
  invalidTime: [
    "Bitte wähle einen eindeutigen Beginn und ein späteres Ende. Prüfe Zeitzone und Zeitumstellung.",
    "Choose an unambiguous start and a later end. Check the time zone and daylight saving transition.",
  ],
  createJob: ["Auftrag anlegen", "Create assignment"],
  adminIntro: [
    "Veröffentliche vollständige Lehrblöcke mit klaren Terminen und Konditionen.",
    "Publish complete teaching blocks with clear sessions and terms.",
  ],
  description: ["Beschreibung", "Description"],
  currency: ["Währung", "Currency"],
  unit: ["Einheit", "Rate unit"],
  newSession: ["Termin ergänzen", "Add session"],
  remove: ["Entfernen", "Remove"],
  saveJob: ["Auftrag speichern", "Save assignment"],
  jobSaved: ["Auftrag gespeichert.", "Assignment saved."],
  publish: ["Sofort veröffentlichen", "Publish immediately"],
  amount: ["Honorar", "Fee"],
  status: ["Status", "Status"],
  apiDocumentation: ["API-Dokumentation", "API documentation"],
  luminoviaUserId: accountIdentifierLabels,
  noAccess: [
    "Für diesen Bereich fehlt dir die Berechtigung.",
    "You do not have permission to access this area.",
  ],
  newPassword: ["Neues Passwort", "New password"],
  setPassword: ["Passwort festlegen", "Set password"],
  passwordHint: [
    "Mindestens 8 Zeichen mit Groß- und Kleinbuchstaben, einer Zahl und einem Sonderzeichen.",
    "At least 8 characters with upper and lower case letters, a number, and a symbol.",
  ],
  passwordSaved: [
    "Dein Passwort wurde gespeichert.",
    "Your password was saved.",
  ],
  initialPasswordHint: [
    "Lege ein eigenes Passwort fest, bevor du Kurse und weitere Portalbereiche öffnest. Verwende mindestens 8 Zeichen mit Groß- und Kleinbuchstaben, einer Zahl und einem Sonderzeichen.",
    "Choose your own password before opening courses or other portal areas. Use at least 8 characters with upper and lower case letters, a number and a symbol.",
  ],
  notifications: ["Benachrichtigungen", "Notifications"],
  noneNotifications: [
    "Alles auf dem aktuellen Stand.",
    "You are all caught up.",
  ],
  markRead: ["Als gelesen markieren", "Mark as read"],
  menu: ["Menü", "Menu"],
  skip: ["Zum Inhalt springen", "Skip to content"],
  viewCalendar: ["Zum Kalender", "Open calendar"],
  invalidForm: [
    "Bitte prüfe die markierten Felder.",
    "Please check the highlighted fields.",
  ],
  required: ["Dieses Feld wird benötigt.", "This field is required."],
  updatedApp: [
    "Eine neue Version ist verfügbar.",
    "A new version is available.",
  ],
  update: ["Jetzt aktualisieren", "Update now"],
  later: ["Später", "Later"],
  notFound: [
    "Diese Seite wurde nicht gefunden.",
    "This page could not be found.",
  ],
  notFoundDescription: [
    "Der Link ist möglicherweise veraltet oder die Seite ist für dein Konto nicht verfügbar. Öffne die Übersicht oder nutze die Hilfe.",
    "The link may be out of date or the page may not be available to your account. Open the overview or use the help guide.",
  ],
  notFoundHelp: ["Hilfe öffnen", "Open help"],
  goHome: ["Zur Übersicht", "Go to overview"],
  scopeNote: [
    "Dein Portal wächst weiter. Weitere Bereiche werden nach geprüfter Fertigstellung freigeschaltet.",
    "Your portal is growing. More areas will become available when they have been verified.",
  ],
  fullPlatformReset: ["Vollreset", "Full reset"],
  resetFilters: ["Filter zurücksetzen", "Reset filters"],
  minRate: ["Mindesthonorar", "Minimum fee"],
  dateFrom: ["Ab Datum", "From date"],
  dateTo: ["Bis Datum", "To date"],
  minTotal: ["Mindestgesamtvergütung", "Minimum total"],
  topic: ["Thema / Tool / Sprache", "Topic / tool / language"],
  claimDeadline: ["Übernahme möglich bis", "Claim deadline"],
  termsVersion: ["Konditionsversion", "Terms version"],
  termsSnapshot: ["Akzeptierte Konditionen", "Accepted terms"],
  totalHint: [
    "Originalwährung; keine Umrechnung. Der Gesamtbetrag ist das verbindliche Angebot für den Block.",
    "Original currency; no conversion. The total is the binding offer for this block.",
  ],
  notificationClaim: ["Auftrag bestätigt", "Assignment confirmed"],
  contractRequired: [
    "Gültiger Rahmenvertrag erforderlich",
    "Valid master contract required",
  ],
  safeLogin: ["Ein Konto. Dein Lehralltag.", "One account. Your teaching day."],
  loginStory: [
    "Aufträge entdecken, Wissen einbringen und gemeinsam etwas bewegen.",
    "Discover opportunities, contribute your expertise and make a difference together.",
  ],
  validation: ["Bitte prüfe deine Eingaben.", "Please check your input."],
  assignment: ["Auftrag", "Assignment"],
  privateEvent: ["Privater Termin", "Private appointment"],
  openCount: ["{{count}} offene Stellen", "{{count}} open jobs"],
  copyright: ["Training & Consulting", "Training & Consulting"],
  collapse: ["Navigation einklappen", "Collapse navigation"],
  expand: ["Navigation ausklappen", "Expand navigation"],
  uiPreferenceNotSaved: [
    "Oberflächeneinstellung nicht im Konto gespeichert.",
    "Interface setting was not saved to your account.",
  ],
  accountLanguage: ["Standardsprache", "Default language"],
  accountLanguageHelp: [
    "Diese Sprache gilt für dein Konto, auch wenn du dich auf einem anderen Gerät anmeldest.",
    "Your account uses this language, including when you sign in on another device.",
  ],
  accountLanguageSave: ["Sprache speichern", "Save language"],
  accountLanguageSaved: [
    "Standardsprache im Konto gespeichert.",
    "Default language saved to your account.",
  ],
};
// Static UI resources use the namespace's shared interpolation and pluralization contract.
// Authored content is separate from these i18next interface strings.
const de = Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, v[0]]));
const en = Object.fromEntries(Object.entries(pairs).map(([k, v]) => [k, v[1]]));
const saved = readPreference("language");
const language = isAccountLanguage(saved)
  ? saved
  : saved === "de-CH"
    ? "de"
    : installationBrand.defaultLanguage;
if (saved === "de-CH") writePreference("language", language);

document.documentElement.lang = language;
void i18n.use(initReactI18next).init({
  resources: {
    de: { translation: de },
    en: { translation: en },
  },
  lng: language,
  fallbackLng: "de",
  interpolation: {
    escapeValue: false,
    defaultVariables: { academy: installationBrand.name },
  },
});
i18n.on("languageChanged", (language) => {
  writePreference("language", language);
  document.documentElement.lang = language;
});
export default i18n;
