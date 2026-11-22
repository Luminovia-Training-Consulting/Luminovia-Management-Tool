/**
 * Public bilingual instructions shared by help, fictional practice and the live tour. Catalog
 * IDs/routes identify authored sections; optional role/permission hints grant no data access.
 */
import type { GuideModule } from "./guide";
import lmsHelpGuides from "./lms-catalog";
export type { GuideModule } from "./guide";
export { guideText } from "./guide";

const staff = ["owner", "admin", "management", "senior_lecturer", "lecturer"];
// Public, authored instructions only. No account records, secrets or access grants.
// Roles/permissions help the live tour choose relevant stops; the database remains authoritative.
// Compound commercial/qualification navigation is handled in tour-state.ts.
export const guideModules: GuideModule[] = [
  {
    id: "home",
    path: "/",
    title: { de: "Dashboard", en: "Dashboard" },
    summary: {
      de: "Dein Einstieg mit kommenden Terminen, offenen Aufgaben und persönlichen Hinweisen.",
      en: "Your starting point for upcoming sessions, outstanding tasks and personal updates.",
    },
    steps: {
      de: [
        "Prüfe die nächsten Termine und die angezeigte Zeitzone.",
        "Öffne einen Auftrag, einen Vertrag oder eine Nachricht direkt aus der Übersicht.",
        "Nutze die Navigation für weitere Bereiche; die Inhalte richten sich nach deinem Zugang.",
      ],
      en: [
        "Check upcoming sessions and the displayed time zone.",
        "Open a job, contract or message directly from the overview.",
        "Use navigation for other areas; available content depends on your access.",
      ],
    },
    problem: {
      de: "Eine Übersicht ist leer oder veraltet.",
      en: "A dashboard section is empty or out of date.",
    },
    resolution: {
      de: [
        "Prüfe die Internetverbindung und lade den betroffenen Bereich neu.",
        "Eine leere Übersicht kann bedeuten, dass noch keine für dich freigegebenen Einträge vorhanden sind.",
      ],
      en: [
        "Check your internet connection and reload the affected section.",
        "An empty overview may mean no entries have been shared with you yet.",
      ],
    },
    keywords: ["start", "übersicht", "overview", "empty", "leer"],
  },
  {
    id: "profile",
    path: "/profile",
    title: { de: "Mein Profil", en: "My profile" },
    summary: {
      de: "Pflege deine Kontaktdaten, Sprachen, Zeitzone und fachliche Expertise.",
      en: "Maintain your contact details, languages, time zone and expertise.",
    },
    steps: {
      de: [
        "Prüfe Anzeigenamen und Zeitzone, bevor du Termine planst.",
        "Ergänze deine Expertise und lade zulässige Nachweise im dafür vorgesehenen Bereich hoch.",
        "Speichere die Änderungen und prüfe die Bestätigung; erforderliche Verifizierungen erfolgen durch berechtigte Mitarbeitende.",
      ],
      en: [
        "Check your display name and time zone before planning sessions.",
        "Add expertise and upload permitted evidence in its designated area.",
        "Save and check the confirmation; required verification is performed by authorised staff.",
      ],
    },
    problem: {
      de: "Eine angegebene Expertise berechtigt noch nicht zur Übernahme.",
      en: "Declared expertise does not yet make a job claim eligible.",
    },
    resolution: {
      de: [
        "Prüfe, ob für den Auftrag eine verifizierte und noch gültige Qualifikation erforderlich ist.",
        "Bitte die zuständige Verwaltung um Prüfung des Nachweises; ändere keine Rollen zur Umgehung.",
      ],
      en: [
        "Check whether the job requires verified, unexpired qualifications.",
        "Ask the responsible administrator to review the evidence; do not change roles to bypass eligibility.",
      ],
    },
    keywords: [
      "profil",
      "profile",
      "expertise",
      "qualifikation",
      "timezone",
      "zeitzone",
    ],
  },
  {
    id: "security",
    path: "/auth/password",
    area: "access",
    title: { de: "Anmeldung & Sicherheit", en: "Sign-in & security" },
    summary: {
      de: "Melde dich mit deinem Konto an und verwalte dein Passwort.",
      en: "Sign in with your account and manage your password.",
    },
    steps: {
      de: [
        "Öffne die Einladung und richte dein Passwort ein. Melde dich anschließend mit deiner E-Mail-Adresse oder deinem Benutzernamen und deinem Passwort an.",
        "Falls dein Konto eine zusätzliche Sicherheitsprüfung verlangt, bestätige sie mit der eingerichteten Methode.",
        "Öffne bei einem vergessenen Passwort die Wiederherstellung auf der Anmeldeseite. Gib deine E-Mail-Adresse oder deinen Benutzernamen ein und öffne den neuesten Link im Postfach des Kontos.",
      ],
      en: [
        "Open the invitation and set your password. Then sign in with your email address or username and your password.",
        "If your account requires an additional security check, confirm it using the method already set up.",
        "If you forget your password, open recovery on the sign-in page. Enter your email address or username, then open the latest link in the account's mailbox.",
      ],
    },
    problem: {
      de: "Anmeldung oder Passwort-Wiederherstellung schlägt fehl.",
      en: "Sign-in or password recovery fails.",
    },
    resolution: {
      de: [
        "Prüfe Verbindung, Konto und die Adresse des Portals. Sieh auch im Spamordner des hinterlegten Postfachs nach.",
        "Bitte die zuständige Verwaltung um Hilfe, wenn eine Einladung fehlt oder die Zustellung nicht funktioniert. Teile dabei keine Passwörter oder Codes.",
      ],
      en: [
        "Check your connection, account and portal address. Check the spam folder in the mailbox attached to your account.",
        "Ask the responsible administrator for help if the invitation or delivery is missing. Keep passwords and codes private.",
      ],
    },
    keywords: [
      "login",
      "benutzername",
      "username",
      "passwort",
      "password",
      "einladung",
      "invitation",
      "recovery",
    ],
  },
  {
    id: "jobs",
    path: "/jobs",
    roles: staff,
    title: { de: "Aufträge übernehmen", en: "Claim jobs" },
    summary: {
      de: "Finde passende Lehraufträge und prüfe den vollständigen Terminblock vor der Übernahme.",
      en: "Find suitable teaching jobs and review the complete session block before claiming.",
    },
    steps: {
      de: [
        "Filtere offene Aufträge und öffne die Details.",
        "Prüfe alle Termine, Zeitzone, Vergütung, Anforderungen und Vertragsbedingungen.",
        "Bestätige die Bedingungen und übernimm online. Erst die erfolgreiche Datenbankbestätigung bedeutet eine Zuteilung des gesamten Blocks.",
        "Zum Rücktritt öffnest du den übernommenen Auftrag. Bei weniger als sieben Tagen bis zum ersten Termin stellst du einen begründeten Rücktrittsantrag; die Zuweisung bleibt bis zur Genehmigung durch Administration oder Management verbindlich. Die Entscheidung steht im Posteingang.",
      ],
      en: [
        "Filter open jobs and open their details.",
        "Review every session, time zone, fee, requirement and contractual term.",
        "Accept the terms and claim online. Only successful database confirmation allocates the complete block.",
        "To withdraw, open the assigned job. With less than seven days before its first session, submit a reasoned withdrawal request; the assignment remains binding until Administration or Management approves. Read the decision in your inbox.",
      ],
    },
    problem: {
      de: "Die Übernahme wurde abgelehnt oder ihr Ergebnis ist unklar.",
      en: "A claim was rejected or its result is unclear.",
    },
    resolution: {
      de: [
        "Lade Auftrag und Kalender neu. Prüfe, ob bereits eine bestätigte Zuteilung vorliegt, bevor du erneut übernimmst.",
        "Belegt: wähle einen anderen Auftrag. Konflikt: prüfe alle Termine. Fehlende Voraussetzung: kläre Qualifikation oder Vertrag. Offline ist keine Übernahme möglich.",
      ],
      en: [
        "Reload the job and calendar. Check for an existing confirmed assignment before claiming again.",
        "Filled: choose another job. Conflict: review every session. Missing prerequisite: resolve qualifications or contract. Claims require an online connection.",
      ],
    },
    keywords: [
      "auftrag",
      "job",
      "claim",
      "rücktritt",
      "withdrawal",
      "übernehmen",
      "conflict",
      "konflikt",
      "filled",
      "belegt",
      "offline",
    ],
  },
  {
    id: "calendar",
    path: "/calendar",
    title: { de: "Kalender", en: "Calendar" },
    summary: {
      de: "Sieh bestätigte Einsätze und eigene private Termine in deiner Zeitzone.",
      en: "View confirmed assignments and your own private events in your time zone.",
    },
    steps: {
      de: [
        "Wähle die passende Kalenderansicht und den gewünschten Zeitraum.",
        "Prüfe die angezeigte Zeitzone; ein Zeitpunkt kann in Berlin und Brisbane auf unterschiedliche Uhrzeiten fallen.",
        "Erstelle oder bearbeite eigene private Termine. Bestätigte Aufträge erscheinen aus der Zuteilung.",
      ],
      en: [
        "Choose a calendar view and the desired date range.",
        "Check the displayed time zone; the same instant can have different local times in Berlin and Brisbane.",
        "Create or edit your own private events. Confirmed jobs appear from their assignments.",
      ],
    },
    problem: {
      de: "Ein Termin scheint verschoben oder fehlt.",
      en: "An event seems shifted or is missing.",
    },
    resolution: {
      de: [
        "Vergleiche Profilzeitzone, Kalenderanzeige und Terminzeit; beachte die Sommerzeit in Europe/Berlin.",
        "Prüfe die Ansicht und den Zeitraum. Private Termine anderer Personen sind nicht freigegeben.",
      ],
      en: [
        "Compare your profile time zone, calendar display and session time; account for daylight saving in Europe/Berlin.",
        "Check the view and date range. Other people's private events are not shared.",
      ],
    },
    keywords: [
      "kalender",
      "calendar",
      "termin",
      "event",
      "dst",
      "sommerzeit",
      "timezone",
    ],
  },
  {
    id: "availability",
    path: "/availability",
    roles: staff,
    title: { de: "Verfügbarkeit", en: "Availability" },
    summary: {
      de: "Pflege eigene Zeitfenster und entscheide bewusst, was für die Einsatzplanung geteilt wird.",
      en: "Maintain your availability windows and deliberately choose what scheduling staff may see.",
    },
    steps: {
      de: [
        "Erfasse ein verfügbares oder gesperrtes Zeitfenster mit der richtigen Zeitzone.",
        "Prüfe die Freigabe für die Planung; private Notizen bleiben privat.",
        "Speichere online und prüfe das Ergebnis auf Überschneidungen.",
      ],
      en: [
        "Add an available or blocked window with the correct time zone.",
        "Review scheduling visibility; private notes remain private.",
        "Save online and check the result for overlaps.",
      ],
    },
    problem: {
      de: "Eine Sperrzeit überschneidet sich mit einem bestätigten Auftrag.",
      en: "A blocked window overlaps a confirmed assignment.",
    },
    resolution: {
      de: [
        "Prüfe den gesamten bestätigten Terminblock und korrigiere das Zeitfenster.",
        "Eine Sperrzeit storniert keinen Auftrag. Kläre notwendige Änderungen mit der zuständigen Planung.",
      ],
      en: [
        "Review the complete confirmed session block and correct the window.",
        "A blocked window does not cancel an assignment. Discuss required changes with the scheduling team.",
      ],
    },
    keywords: [
      "verfügbarkeit",
      "availability",
      "blockout",
      "sperrzeit",
      "planung",
    ],
  },
  {
    id: "chats",
    path: "/chats",
    title: { de: "Chats", en: "Chats" },
    summary: {
      de: "Tausche dich in freigegebenen Direkt-, Gruppen- und Kurschats aus.",
      en: "Communicate in authorised direct, group and course chats.",
    },
    steps: {
      de: [
        "Öffne einen vorhandenen Chat oder beginne eine Direktnachricht über ein freigegebenes Profil.",
        "Prüfe die Mitglieder und den Kontext, bevor du Inhalte oder Anhänge teilst.",
        "Sende online und warte auf die Bestätigung. Dozierenden- und Teilnehmendenkommunikation haben getrennte Zugänge.",
      ],
      en: [
        "Open an existing chat or start a direct message from an authorised profile.",
        "Check membership and context before sharing content or attachments.",
        "Send online and wait for confirmation. Lecturer and participant communication have separate access.",
      ],
    },
    problem: {
      de: "Eine Nachricht fehlt oder ein Chat ist nicht mehr zugänglich.",
      en: "A message is missing or a chat is no longer accessible.",
    },
    resolution: {
      de: [
        "Prüfe Verbindung und Sendestatus und lade den Chat neu, bevor du denselben Inhalt erneut sendest.",
        "Ein entfernter Chat-Zugang ist kein Ladefehler. Frage die Gruppenverantwortlichen nach der Mitgliedschaft; Administratoren haben keinen allgemeinen Direktnachrichten-Zugriff.",
      ],
      en: [
        "Check the connection and send status; reload before resending the same content.",
        "Revoked chat access is not a loading error. Ask the group owner about membership; administrators have no blanket access to direct messages.",
      ],
    },
    keywords: [
      "chat",
      "nachricht",
      "message",
      "mitglied",
      "member",
      "attachment",
      "anhang",
    ],
  },
  {
    id: "files",
    path: "/files",
    title: { de: "Dateizentrale", en: "File centre" },
    summary: {
      de: "Lade freigegebene Dokumente hoch, prüfe Versionen und öffne zulässige Dateien.",
      en: "Upload authorised documents, review versions and open permitted files.",
    },
    steps: {
      de: [
        "Wähle den richtigen Dokumentkontext und prüfe die Freigabe.",
        "Lade eine Datei im erlaubten Format und Größenlimit hoch; warte auf die Sicherheitsprüfung.",
        "Öffne die freigegebene Version oder ersetze sie über die Versionsfunktion.",
      ],
      en: [
        "Choose the correct document context and review its visibility.",
        "Upload a permitted format within the size limit; wait for security scanning.",
        "Open the released version or replace it through the version workflow.",
      ],
    },
    problem: {
      de: "Eine Datei ist gesperrt, in Prüfung oder ein Downloadlink ist abgelaufen.",
      en: "A file is blocked, awaiting scanning or its download link has expired.",
    },
    resolution: {
      de: [
        "Prüfe Format, Größe und Prüfstatus. Eine Datei in Quarantäne darf nicht geöffnet werden.",
        "Öffne den Download erneut aus dem Portal, um die aktuelle Berechtigung zu prüfen. Teile keine privaten Downloadlinks als dauerhafte Freigabe.",
      ],
      en: [
        "Check the format, size and scanning status. Quarantined files cannot be opened.",
        "Open the download again from the portal to check current access. Do not use private download links as permanent sharing links.",
      ],
    },
    keywords: [
      "datei",
      "file",
      "upload",
      "download",
      "scan",
      "quarantäne",
      "quarantine",
      "pdf",
      "version",
    ],
  },
  {
    id: "search",
    path: "/search",
    title: { de: "Portalsuche", en: "Portal search" },
    summary: {
      de: "Durchsuche die für dich freigegebenen Portalinhalte an einer Stelle.",
      en: "Search portal content you are authorised to access in one place.",
    },
    steps: {
      de: [
        "Gib mindestens zwei Zeichen in die Portalsuche ein.",
        "Prüfe Treffer aus Aufträgen, Dateien, Nachrichten und Wissen.",
        "Öffne einen Treffer; die Berechtigung wird im Zielbereich erneut geprüft.",
      ],
      en: [
        "Enter at least two characters in portal search.",
        "Review results from jobs, files, messages and knowledge.",
        "Open a result; access is checked again in its destination.",
      ],
    },
    problem: {
      de: "Eine Suche liefert keinen Treffer.",
      en: "Search returns no results.",
    },
    resolution: {
      de: [
        "Verwende einen kürzeren eindeutigen Begriff mit mindestens zwei Zeichen und prüfe den zuständigen Bereich direkt.",
        "Die Suche erweitert keine Berechtigungen. Private oder nicht freigegebene Inhalte bleiben verborgen.",
      ],
      en: [
        "Try a shorter distinctive term of at least two characters and check the relevant section directly.",
        "Search does not expand access. Private or unshared content remains hidden.",
      ],
    },
    keywords: ["suche", "search", "finden", "find", "results", "treffer"],
  },
  {
    id: "courses",
    area: "courses",
    path: "/courses",
    title: { de: "Kurse & Vorlagen", en: "Courses & templates" },
    summary: {
      de: "Unterscheide wiederverwendbare Kursvorlagen von konkreten Durchführungen mit Terminen.",
      en: "Distinguish reusable course templates from actual course runs with sessions.",
    },
    steps: {
      de: [
        "Suche eine freigegebene Vorlage oder Durchführung.",
        "Prüfe Beschreibung, Themen und bei Durchführungen die konkreten Termine.",
        "Mit Verwaltungsrecht kannst du Vorlagen oder Durchführungen anlegen und daraus Aufträge vorbereiten.",
      ],
      en: [
        "Find an authorised template or course run.",
        "Review the description, topics and, for runs, the actual sessions.",
        "With management access, create templates or runs and prepare jobs from them.",
      ],
    },
    problem: {
      de: "Eine Vorlage hat noch keinen buchbaren Termin.",
      en: "A template has no scheduled session yet.",
    },
    resolution: {
      de: [
        "Eine Vorlage beschreibt Inhalte; erst eine Durchführung besitzt konkrete Termine.",
        "Prüfe die Durchführungen und den zugehörigen veröffentlichten Auftrag oder frage die Kursplanung.",
      ],
      en: [
        "A template describes content; an actual course run has scheduled sessions.",
        "Check the runs and related published job or ask the scheduling team.",
      ],
    },
    keywords: [
      "kurs",
      "course",
      "template",
      "vorlage",
      "durchführung",
      "run",
      "baustein",
      "building block",
    ],
  },
  {
    id: "people",
    path: "/people",
    title: { de: "Dozierendenverzeichnis", en: "Lecturer directory" },
    summary: {
      de: "Finde freigegebene Dozierendenprofile und deren sichtbare fachliche Angaben.",
      en: "Find authorised lecturer profiles and their visible expertise.",
    },
    steps: {
      de: [
        "Suche nach Namen oder fachlichen Angaben.",
        "Öffne ein Profil und prüfe die sichtbar freigegebenen Informationen.",
        "Beginne bei entsprechendem Zugang eine Direktnachricht aus dem Profil.",
      ],
      en: [
        "Search by name or expertise.",
        "Open a profile and review its shared information.",
        "Start a direct message from the profile when your access permits it.",
      ],
    },
    problem: {
      de: "Kontaktdaten oder Nachweise sind nicht sichtbar.",
      en: "Contact details or evidence are not visible.",
    },
    resolution: {
      de: [
        "Profile zeigen nur für deinen Zugang freigegebene Angaben.",
        "Bitte die Person oder die zuständige Verwaltung um die benötigte Freigabe; private Dokumente gehören nicht ins öffentliche Verzeichnis.",
      ],
      en: [
        "Profiles show only information shared with your access level.",
        "Ask the person or responsible administrator for appropriate access; private evidence does not belong in the public directory.",
      ],
    },
    keywords: [
      "personen",
      "people",
      "dozierende",
      "lecturers",
      "contact",
      "kontakt",
    ],
  },
  {
    id: "client",
    path: "/client",
    roles: ["owner", "admin", "client"],
    title: { de: "Unternehmensportal", en: "Company portal" },
    summary: {
      de: "Prüfe die für dein Unternehmenskonto freigegebenen Kurs- und Auftragsinformationen.",
      en: "Review course and commission information shared with your client account.",
    },
    steps: {
      de: [
        "Öffne deine freigegebenen Kurse und Beauftragungen.",
        "Prüfe Termine, Umfang und die für dich sichtbaren kaufmännischen Angaben.",
        "Erstelle bei entsprechendem Zugang eine Kursbeauftragung und prüfe ihre Bestätigung.",
      ],
      en: [
        "Open your shared courses and commissions.",
        "Review dates, scope and the commercial details visible to you.",
        "Create a course commission when authorised and check its confirmation.",
      ],
    },
    problem: {
      de: "Ein erwarteter Kursauftrag des Unternehmens fehlt.",
      en: "An expected client commission is missing.",
    },
    resolution: {
      de: [
        "Prüfe, ob du mit dem richtigen eingeladenen Unternehmenskonto angemeldet bist.",
        "Bitte die zuständige Verwaltung um Prüfung der Organisationszuordnung. Andere Unternehmen und private Dozierendenunterlagen bleiben geschützt.",
      ],
      en: [
        "Check that you signed in with the correct invited client account.",
        "Ask the responsible administrator to check your organisation assignment. Other companies and lecturers' private documents remain protected.",
      ],
    },
    keywords: ["auftraggeber", "client", "commission", "beauftragung", "kunde"],
  },
  {
    id: "my-reviews",
    path: "/my-reviews",
    roles: ["owner", "admin", "participant"],
    title: { de: "Kursbewertungen", en: "Course reviews" },
    summary: {
      de: "Bewerte Kurse, für die dein Teilnehmendenkonto eine Bewertung abgeben darf.",
      en: "Review courses your participant account is eligible to rate.",
    },
    steps: {
      de: [
        "Wähle einen zur Bewertung freigegebenen Kurs.",
        "Vergib eine Bewertung und einen sachlichen Kommentar ohne private Daten.",
        "Speichere online; eigene Bewertungen lassen sich im vorgesehenen Ablauf bearbeiten oder zurücknehmen.",
      ],
      en: [
        "Choose a course available for review.",
        "Add a rating and factual feedback without private data.",
        "Save online; use the provided workflow to edit or withdraw your own review.",
      ],
    },
    problem: {
      de: "Ein Kurs kann noch nicht bewertet werden.",
      en: "A course cannot be reviewed yet.",
    },
    resolution: {
      de: [
        "Prüfe, ob der Kurs beendet ist und dein Konto als teilnahmeberechtigt zugeordnet wurde.",
        "Lade nach einer Änderung neu; bei einer Versionsmeldung prüfe die aktuelle Bewertung, bevor du erneut speicherst.",
      ],
      en: [
        "Check whether the course has ended and your account has an eligible enrolment.",
        "Reload after a change; if a version conflict occurs, review the current rating before saving again.",
      ],
    },
    keywords: [
      "bewertung",
      "review",
      "rating",
      "feedback",
      "teilnehmende",
      "participant",
    ],
  },
  {
    id: "contracts",
    path: "/contracts",
    title: { de: "Verträge", en: "Contracts" },
    summary: {
      de: "Prüfe die für dich freigegebenen Vertragsversionen, Laufzeiten und Bestätigungen.",
      en: "Review authorised contract versions, effective dates and acknowledgements.",
    },
    steps: {
      de: [
        "Öffne den relevanten Rahmenvertrag oder Nachtrag.",
        "Prüfe Dokument, Version und Gültigkeitszeitraum vor einer Bestätigung.",
        "Bestätige nur die tatsächlich gelesene Version und kontrolliere den gespeicherten Beleg.",
      ],
      en: [
        "Open the relevant master agreement or addendum.",
        "Review the document, version and effective dates before acknowledging it.",
        "Acknowledge only the version you have read and check the saved receipt.",
      ],
    },
    problem: {
      de: "Ein Vertrag fehlt oder erfüllt die Auftragsvoraussetzung nicht.",
      en: "A contract is missing or does not meet the job prerequisite.",
    },
    resolution: {
      de: [
        "Prüfe die erforderliche Vertragsversion sowie Beginn und Ablaufdatum.",
        "Bitte die zuständige Vertragsverwaltung um Klärung. Eine Bestätigung ersetzt keine rechtliche Prüfung oder pauschale elektronische Signatur.",
      ],
      en: [
        "Check the required contract version, effective date and expiry.",
        "Ask the responsible contract administrator to resolve it. An acknowledgement does not establish legal review or general electronic-signature validity.",
      ],
    },
    keywords: [
      "vertrag",
      "contract",
      "agreement",
      "acknowledgement",
      "bestätigung",
      "ablauf",
    ],
  },
  {
    id: "analytics",
    path: "/analytics",
    title: { de: "Analysen", en: "Analytics" },
    summary: {
      de: "Vergleiche vergangene und geplante Aufträge, Unterrichtszeiten und Beträge in deiner Ansicht.",
      en: "Compare past and upcoming assignments, teaching hours and amounts in your view.",
    },
    steps: {
      de: [
        "Wähle einen Zeitraum oder gib ein eigenes Anfangs- und Enddatum ein.",
        "Wechsle zwischen Aufträgen und Unterrichtsstunden. Öffne die Tabellen für die Monatswerte.",
        "Wähle im Finanzverlauf eine verfügbare Kennzahl und die passende Währung.",
      ],
      en: [
        "Choose a reporting period or enter your own start and end dates.",
        "Switch between assignments and teaching hours. Open the tables for monthly values.",
        "In the financial trend, choose an available metric and its currency.",
      ],
    },
    problem: {
      de: "Welche Zahlen sieht mein Unternehmen?",
      en: "Which figures can my company see?",
    },
    resolution: {
      de: [
        "Die Unternehmensansicht zeigt die eigenen Aufträge, Auftragshonorare und die eigenen erfassten Zahlungen.",
        "Wähle die Währung des Auftrags, um die zugehörigen Beträge zu sehen.",
      ],
      en: [
        "The company view shows its own assignments, contract fees and its recorded payments.",
        "Choose the contract currency to see the corresponding amounts.",
      ],
    },
    keywords: ["Statistik", "Prognose", "statistics", "forecast"],
  },
  {
    id: "finance",
    path: "/finance",
    title: { de: "Finanzen & Rechnungen", en: "Finance & invoices" },
    summary: {
      de: "Prüfe bestätigte Honorare und verfolge Rechnungen und Zahlungen im zulässigen Umfang.",
      en: "Review accepted fees and track invoices and payments within your access.",
    },
    steps: {
      de: [
        "Prüfe bestätigte Einsätze und deren unveränderliche Vergütungs- und Währungsschnappschüsse.",
        "Ordne zulässige noch nicht abgerechnete Positionen einer Rechnung mit geprüftem PDF zu.",
        "Kontrolliere Rechnungsnummer, Fälligkeit und gespeicherten Status; Zahlungsverwaltung erfordert eigene Berechtigung.",
      ],
      en: [
        "Review confirmed assignments and their immutable fee and currency snapshots.",
        "Assign eligible unbilled items to an invoice with an approved PDF.",
        "Check invoice number, due date and saved status; payment administration requires separate access.",
      ],
    },
    problem: {
      de: "Ein Betrag stimmt nach einer Vorlagenänderung scheinbar nicht mehr.",
      en: "An amount seems different after a template change.",
    },
    resolution: {
      de: [
        "Maßgeblich sind die bei Übernahme akzeptierten Beträge und die ursprüngliche Währung; spätere Vorlagenänderungen ändern diese nicht.",
        "Prüfe vorhandene Rechnungszuordnungen und vergleiche keine unterschiedlichen Währungen ohne eigene nachvollziehbare Umrechnung.",
      ],
      en: [
        "The accepted amount and original currency at claim time are authoritative; later template changes do not change them.",
        "Check existing invoice allocations and do not compare different currencies without a separate explicit conversion.",
      ],
    },
    keywords: [
      "finanzen",
      "finance",
      "rechnung",
      "invoice",
      "honorar",
      "fee",
      "zahlung",
      "payment",
      "currency",
    ],
  },
  {
    id: "clients",
    path: "/clients",
    permission: "organisations.manage",
    title: { de: "Unternehmen", en: "Companies" },
    summary: {
      de: "Verwalte Organisationen und geschäftliche Kontakte mit entsprechender Berechtigung.",
      en: "Manage organisations and business contacts with the required permission.",
    },
    steps: {
      de: [
        "Suche zuerst nach einer vorhandenen Organisation, um Doppelanlagen zu vermeiden.",
        "Pflege die benötigten Geschäftsdaten und Kontakte.",
        "Speichere und prüfe verknüpfte Kurse; interne Notizen sind keine öffentliche Kursbeschreibung.",
      ],
      en: [
        "Search for an existing organisation before creating a duplicate.",
        "Maintain the required business details and contacts.",
        "Save and review linked courses; internal notes are not public course descriptions.",
      ],
    },
    problem: {
      de: "Die Unternehmensverwaltung ist nicht verfügbar.",
      en: "The company directory is unavailable.",
    },
    resolution: {
      de: [
        "Prüfe, ob dein Konto die Organisationsverwaltung ausführen darf.",
        "Bitte die zuständige Verwaltung um Prüfung. Ein Dozierendenzugang gewährt keinen allgemeinen Zugriff auf Unternehmenskontakte.",
      ],
      en: [
        "Check whether your account may manage organisations.",
        "Ask the responsible administrator to check. Lecturer access does not grant general access to company contacts.",
      ],
    },
    keywords: [
      "kunde",
      "client",
      "organisation",
      "organization",
      "kontakt",
      "crm",
    ],
  },
  {
    id: "wiki",
    path: "/wiki",
    roles: staff,
    title: { de: "Wiki", en: "Wiki" },
    summary: {
      de: "Finde freigegebenes Wissen und erstelle mit passendem Zugang versionierte Artikel.",
      en: "Find shared knowledge and create versioned articles when authorised.",
    },
    steps: {
      de: [
        "Suche einen Artikel oder wähle eine Kategorie.",
        "Prüfe die Inhaltssprache; verfasste Beiträge werden durch den Sprachwechsel nicht übersetzt.",
        "Bearbeite mit entsprechendem Recht einen Entwurf und veröffentliche ihn erst nach Prüfung.",
      ],
      en: [
        "Search for an article or choose a category.",
        "Check its authored language; changing interface language does not translate authored content.",
        "With the required access, edit a draft and publish only after review.",
      ],
    },
    problem: {
      de: "Ein Artikel ist als Entwurf gespeichert oder wurde parallel geändert.",
      en: "An article is saved as a draft or changed concurrently.",
    },
    resolution: {
      de: [
        "Ein gespeicherter Entwurf ist nicht automatisch veröffentlicht.",
        "Lade bei einer Versionsmeldung den aktuellen Stand und übertrage deine Änderungen kontrolliert; überschreibe keine fremden Änderungen ungeprüft.",
      ],
      en: [
        "A saved draft is not automatically published.",
        "For a version conflict, reload the current revision and reapply changes carefully; do not overwrite others' changes without review.",
      ],
    },
    keywords: [
      "wiki",
      "wissen",
      "knowledge",
      "artikel",
      "article",
      "draft",
      "entwurf",
      "version",
    ],
  },
  {
    id: "forum",
    path: "/forum",
    roles: staff,
    title: { de: "Forum", en: "Forum" },
    summary: {
      de: "Besprich fachliche Fragen in freigegebenen Themen und Antworten.",
      en: "Discuss questions in authorised topics and replies.",
    },
    steps: {
      de: [
        "Suche zuerst nach einer bestehenden Diskussion.",
        "Erstelle ein passendes Thema oder antworte sachlich im vorhandenen Verlauf.",
        "Nutze bei Bedarf die Meldefunktion; Moderation erfordert einen passenden Zugang.",
      ],
      en: [
        "Search for an existing discussion first.",
        "Create an appropriate topic or reply factually in its existing thread.",
        "Use reporting when needed; moderation requires the appropriate access.",
      ],
    },
    problem: {
      de: "Eine Diskussion lässt keine neue Antwort zu.",
      en: "A discussion does not accept new replies.",
    },
    resolution: {
      de: [
        "Prüfe, ob das Thema gesperrt oder archiviert ist und dein Zugang noch gilt.",
        "Wende dich bei Moderationsfragen an die zuständigen Moderierenden und veröffentliche keine privaten Chat-Inhalte.",
      ],
      en: [
        "Check whether the topic is locked or archived and your access is still valid.",
        "Contact the responsible moderators about moderation and do not publish private chat content.",
      ],
    },
    keywords: [
      "forum",
      "diskussion",
      "discussion",
      "reply",
      "antwort",
      "moderation",
      "locked",
    ],
  },
  {
    id: "notifications",
    path: "/notifications",
    title: { de: "Benachrichtigungen", en: "Notifications" },
    summary: {
      de: "Verfolge persönliche Portalhinweise und öffne deren aktuell freigegebene Ziele.",
      en: "Track your personal portal notifications and open currently authorised destinations.",
    },
    steps: {
      de: [
        "Öffne die Benachrichtigungsglocke oder die vollständige Liste.",
        "Lies den Hinweis und öffne bei Bedarf den verknüpften Datensatz.",
        "Markiere Hinweise als gelesen und passe optionale Meldungen in Einstellungen an.",
      ],
      en: [
        "Open the notification bell or full inbox.",
        "Read the notice and open its linked record if needed.",
        "Mark notices read and adjust optional notifications in Settings.",
      ],
    },
    problem: {
      de: "Ein Hinweisziel ist nicht mehr verfügbar oder eine optionale Meldung fehlt.",
      en: "A notification destination is no longer available or an optional notice is missing.",
    },
    resolution: {
      de: [
        "Verknüpfte Datensätze können archiviert oder nicht mehr freigegeben sein; der Hinweis gibt keine zusätzliche Berechtigung.",
        "Prüfe deine Einstellungen und lade die Liste neu. Portalhinweise bedeuten nicht automatisch E-Mail- oder Push-Zustellung.",
      ],
      en: [
        "Linked records may be archived or no longer shared; a notice does not grant extra access.",
        "Check your preferences and reload the inbox. An in-app notice does not automatically mean email or push delivery.",
      ],
    },
    keywords: [
      "notification",
      "benachrichtigung",
      "glocke",
      "bell",
      "unread",
      "ungelesen",
      "email",
      "push",
    ],
  },
  {
    id: "topics",
    path: "/topics",
    title: { de: "Themen & Tools", en: "Topics & tools" },
    summary: {
      de: "Erkunde die Themenhierarchie, alternative Begriffe und zugehörige Kursvorlagen.",
      en: "Explore the topic hierarchy, aliases and related course templates.",
    },
    steps: {
      de: [
        "Suche einen Fachbegriff oder einen alternativen Namen.",
        "Prüfe übergeordnete Themen und zugehörige freigegebene Vorlagen.",
        "Mit Verwaltungsrecht lassen sich Begriffe pflegen oder archivieren; bestehende Verweise bleiben berücksichtigt.",
      ],
      en: [
        "Search for a subject or alias.",
        "Review parent topics and related authorised templates.",
        "With management access, maintain or archive terms while preserving existing references.",
      ],
    },
    problem: {
      de: "Ein Begriff fehlt in einer neuen Auswahl.",
      en: "A term is missing from a new selection.",
    },
    resolution: {
      de: [
        "Suche nach einem Alias und prüfe, ob der Begriff archiviert wurde.",
        "Bitte die Themenverwaltung um Prüfung, statt denselben Begriff mehrfach neu anzulegen.",
      ],
      en: [
        "Search for an alias and check whether the term was archived.",
        "Ask the taxonomy administrator to check instead of creating duplicate terms.",
      ],
    },
    keywords: [
      "thema",
      "topic",
      "tool",
      "alias",
      "taxonomy",
      "taxonomie",
      "skill",
    ],
  },
  {
    id: "settings",
    path: "/settings",
    title: { de: "Einstellungen", en: "Settings" },
    summary: {
      de: "Steuere optionale persönliche Benachrichtigungen; Sprache und Darstellung stehen in der Kopfzeile.",
      en: "Control optional personal notifications; language and appearance are in the header.",
    },
    steps: {
      de: [
        "Wähle in der Kopfzeile Deutsch oder Englisch und Hell, Dunkel oder System.",
        "Prüfe in Einstellungen, welche optionalen Hinweise du erhalten möchtest.",
        "Speichere die Benachrichtigungswünsche online und kontrolliere die Bestätigung.",
      ],
      en: [
        "Choose German or English and Light, Dark or System in the header.",
        "Review which optional notifications you want in Settings.",
        "Save notification preferences online and check confirmation.",
      ],
    },
    problem: {
      de: "Eine Einstellung wurde nicht übernommen.",
      en: "A preference was not applied.",
    },
    resolution: {
      de: [
        "Prüfe die Verbindung für gespeicherte Benachrichtigungswünsche; bei einem Versionskonflikt lade den aktuellen Stand.",
        "Sprache und Darstellung werden bestmöglich im Browser gespeichert. Bei blockiertem Browserspeicher kann nach einem Neustart der Standard erscheinen.",
      ],
      en: [
        "Check the connection for saved notification preferences; reload the current state after a version conflict.",
        "Language and appearance are stored in the browser on a best-effort basis. Blocked browser storage may restore defaults after reopening.",
      ],
    },
    keywords: [
      "einstellung",
      "settings",
      "language",
      "sprache",
      "theme",
      "dark",
      "dunkel",
      "preference",
    ],
  },
  {
    id: "admin",
    path: "/admin",
    permission: "jobs.manage",
    title: { de: "Auftragsverwaltung", en: "Job administration" },
    summary: {
      de: "Bereite Aufträge vor und verwalte deren veröffentlichte Lebenszyklen mit entsprechender Berechtigung.",
      en: "Prepare jobs and manage their publication lifecycle with the required access.",
    },
    steps: {
      de: [
        "Erstelle einen Entwurf mit allen Terminen, Anforderungen und Vergütungsangaben.",
        "Prüfe den vollständigen Block und veröffentliche ihn mit der erforderlichen Berechtigung.",
        "Bearbeite Lebenszyklusänderungen im vorgesehenen Ablauf; Stornierung und Wiederöffnung sind ausdrückliche Aktionen.",
      ],
      en: [
        "Create a draft with all sessions, requirements and fee details.",
        "Review the complete block and publish with the required permission.",
        "Use the lifecycle workflow for changes; cancellation and reopening are explicit actions.",
      ],
    },
    problem: {
      de: "Ein Auftrag lässt sich nicht veröffentlichen oder wurde parallel geändert.",
      en: "A job cannot be published or changed concurrently.",
    },
    resolution: {
      de: [
        "Prüfe Pflichtfelder, gültige Termine, Voraussetzungen und Berechtigungen.",
        "Lade bei einer Versionsmeldung neu. Akzeptierte Vergütungen und bestätigte Einsätze dürfen durch Entwurfsänderungen nicht überschrieben werden.",
      ],
      en: [
        "Check required fields, valid sessions, prerequisites and permissions.",
        "Reload after a version conflict. Draft changes must not overwrite accepted fees or confirmed assignments.",
      ],
    },
    keywords: [
      "admin",
      "publish",
      "veröffentlichen",
      "kanban",
      "cancel",
      "stornieren",
      "reopen",
    ],
  },
  {
    id: "accounts",
    area: "administration",
    path: "/admin/accounts",
    permission: "users.manage",
    title: { de: "Konten & Einladungen", en: "Accounts & invitations" },
    summary: {
      de: "Verwalte Konten und Einladungen im Umfang deiner serverseitigen Berechtigungen.",
      en: "Manage accounts and invitations within your server-side permissions.",
    },
    steps: {
      de: [
        "Suche vor einer Einladung nach einem vorhandenen Konto.",
        "Prüfe E-Mail-Adresse und die zulässige Rolle sorgfältig.",
        "Sende die Einladung ausdrücklich und prüfe das tatsächliche Ergebnis. Die Demo versendet nichts.",
      ],
      en: [
        "Search for an existing account before inviting someone.",
        "Check the email address and permitted role carefully.",
        "Send the invitation explicitly and check the actual result. The demo sends nothing.",
      ],
    },
    problem: {
      de: "Eine Einladung ist fehlgeschlagen oder kommt nicht an.",
      en: "An invitation failed or does not arrive.",
    },
    resolution: {
      de: [
        "Prüfe zuerst den tatsächlichen Kontostatus, bevor du eine Einladung erneut sendest.",
        "Kontrolliere Adresse, Spamordner und den eingerichteten Mailversand mit der zuständigen Verwaltung. Ein angelegtes Konto beweist keine E-Mail-Zustellung.",
      ],
      en: [
        "Check the actual account state before resending an invitation.",
        "Check the address, spam folder and configured mail delivery with the administrator. A created account does not prove email delivery.",
      ],
    },
    keywords: [
      "konto",
      "account",
      "invite",
      "einladung",
      "role",
      "rolle",
      "email",
      "smtp",
    ],
  },
  {
    id: "admin-people",
    path: "/admin/people",
    title: {
      de: "Zugänge & Qualifikationsprüfung",
      en: "Access & qualification review",
    },
    summary: {
      de: "Prüfe Expertise und verwalte Zugänge mit den jeweils erforderlichen Verwaltungsrechten.",
      en: "Review expertise and manage access with the respective administrative permissions.",
    },
    steps: {
      de: [
        "Öffne die betreffende Person und prüfe ihren aktuellen Kontostatus.",
        "Vergleiche angegebene Expertise mit dem Nachweis und einem gegebenenfalls erforderlichen Ablaufdatum.",
        "Bestätige die Prüfung oder sperre einen Zugang nur im vorgesehenen berechtigten Ablauf.",
      ],
      en: [
        "Open the person and check their current account status.",
        "Compare declared expertise with evidence and any required expiry date.",
        "Confirm verification or suspend access only through the authorised workflow.",
      ],
    },
    problem: {
      de: "Eine Verifizierung oder Zugangssperre wird abgelehnt.",
      en: "A verification or access suspension is rejected.",
    },
    resolution: {
      de: [
        "Prüfe die Rechte für Benutzerverwaltung und Qualifikationsprüfung sowie die Gültigkeit des Nachweises.",
        "Eigene Sperren und Änderungen am letzten geschützten Verwaltungskonto sind eingeschränkt. Kläre die Änderung mit einer weiteren berechtigten Person.",
      ],
      en: [
        "Check user-management and qualification-review permissions and evidence validity.",
        "Self-suspension and changes to the last protected administrator are restricted. Resolve the change with another authorised person.",
      ],
    },
    keywords: [
      "verify",
      "verifizieren",
      "qualification",
      "qualifikation",
      "suspend",
      "sperren",
      "expiry",
    ],
  },
  {
    id: "audit",
    path: "/admin/audit",
    permission: "audit.read",
    title: { de: "Administrationsprotokoll", en: "Administration log" },
    summary: {
      de: "Prüfe freigegebene Verwaltungsereignisse mit aktuellem Auditrecht.",
      en: "Review authorised administrative events with current audit permission.",
    },
    steps: {
      de: [
        "Wähle einen zulässigen Zeitraum und die benötigte Ereignisart.",
        "Prüfe die erlaubten Metadaten und lade bei Bedarf weitere Ergebnisse.",
        "Nutze die Historie zur Klärung eines Ablaufs; sie ist kein Zugriff auf private Nachrichten oder Dokumentinhalte.",
      ],
      en: [
        "Choose an allowed date range and event type.",
        "Review permitted metadata and load more results when needed.",
        "Use history to investigate a workflow; it does not grant access to private messages or document contents.",
      ],
    },
    problem: {
      de: "Das Protokoll zeigt keine Ereignisse oder verweigert den Zugriff.",
      en: "The log shows no events or denies access.",
    },
    resolution: {
      de: [
        "Prüfe Zeitraum, Filter und aktuelles Auditrecht.",
        "Nicht jede Aktivität ist Teil dieses Verwaltungsprotokolls. Sammle für eine Rückfrage nur Zeitpunkt, Bereich und sichtbare Fehlermeldung, keine Geheimnisse.",
      ],
      en: [
        "Check date range, filters and current audit permission.",
        "Not every activity belongs in this administration log. For support, collect only time, section and visible error text, never secrets.",
      ],
    },
    keywords: [
      "audit",
      "log",
      "protokoll",
      "history",
      "historie",
      "diagnose",
      "diagnostic",
    ],
  },
];

const recovery = [
  {
    title: { de: "Verbindung oder Laden", en: "Connection or loading" },
    body: {
      de: "Prüfe zuerst deine Internetverbindung. Lade den betroffenen Bereich erneut. Offline kannst du keine Aufträge übernehmen, Nachrichten senden oder Dateien hochladen. Eine lokale Anzeige bestätigt keine Speicherung.",
      en: "Check your internet connection first. Reload the affected section. You cannot claim jobs, send messages or upload files offline. A local display does not confirm a saved change.",
    },
    topic: "jobs",
  },
  {
    title: {
      de: "Speichern oder Übernahme unklar",
      en: "Unclear save or claim result",
    },
    body: {
      de: "Prüfe den aktuellen Datensatz und zugehörige Bestätigungen, bevor du eine Aktion wiederholst. Bei einer Versionsmeldung lade den aktuellen Stand und gleiche deine Änderungen ab. Erfolgreiche Aufträge gelten für den gesamten Terminblock.",
      en: "Check the current record and related confirmations before repeating an action. After a version conflict, reload the current state and reconcile your changes. A successful assignment covers the entire session block.",
    },
    topic: "jobs",
  },
  {
    title: { de: "Zugriff verweigert", en: "Access denied" },
    body: {
      de: "Prüfe das angemeldete Konto und bitte die zuständige Verwaltung, deine Berechtigung zu prüfen. Private Termine, Direktnachrichten und Vertragsunterlagen werden nicht durch einen allgemeinen Admin-Zugang freigegeben.",
      en: "Check the signed-in account and ask the responsible administrator to review your permission. Private events, direct messages and contract documents are not shared through blanket administrator access.",
    },
    topic: "security",
  },
  {
    title: { de: "Datei noch nicht verfügbar", en: "File not yet available" },
    body: {
      de: "Prüfe Größenlimit, zulässigen Dateityp und Prüfstatus. Warte auf die Sicherheitsprüfung. Öffne einen abgelaufenen Download erneut aus dem Portal; umgehe keine Quarantäne oder Berechtigungsprüfung.",
      en: "Check the size limit, allowed file type and scanning status. Wait for security scanning. Reopen an expired download from the portal; never bypass quarantine or permission checks.",
    },
    topic: "files",
  },
  {
    title: {
      de: "App-Aktualisierung oder Darstellung",
      en: "App update or appearance",
    },
    body: {
      de: "Sichere noch nicht gespeicherte Eingaben, bevor du die angebotene App-Aktualisierung ausführst oder neu lädst. Prüfe Sprache und Darstellung in der Kopfzeile. Die PWA-Installation hängt von Browser und Gerät ab; private Inhalte sind kein Offline-Archiv.",
      en: "Preserve unsaved input before applying an offered app update or reloading. Check language and appearance in the header. PWA installation depends on your browser and device; private content is not an offline archive.",
    },
    topic: "settings",
  },
];

export default { modules: [...guideModules, ...lmsHelpGuides], recovery };
