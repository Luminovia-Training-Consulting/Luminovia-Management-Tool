import type { GuideModule } from "./guide";

const academyGuides: GuideModule[] = [
  {
    id: "academy-sign-in",
    path: "/login",
    area: "access",
    title: { de: "Anmeldung und Zugang", en: "Sign-in and access" },
    summary: {
      de: "Öffne deine Akademie mit deinem eigenen Konto.",
      en: "Open your academy with your own account.",
    },
    steps: {
      de: [
        "Öffne die Einladung zur Akademie und lege ein Passwort an.",
        "Melde dich mit deiner E-Mail-Adresse oder deinem Benutzernamen und deinem Passwort an. Bestätige eine zusätzliche Sicherheitsprüfung, falls sie für dein Konto eingerichtet ist.",
        "Nutze bei einem vergessenen Passwort die Wiederherstellung auf der Anmeldeseite. Gib deine E-Mail-Adresse oder deinen Benutzernamen ein und öffne den neuesten Link im hinterlegten Postfach.",
      ],
      en: [
        "Open your academy invitation and set a password.",
        "Sign in with your email address or username and your password. Confirm the additional security check if your account has one.",
        "If you forget your password, open recovery on the sign-in page. Enter your email address or username, then open the latest link in the mailbox attached to your account.",
      ],
    },
    problem: {
      de: "Dein Zugang funktioniert nicht.",
      en: "You cannot sign in.",
    },
    resolution: {
      de: [
        "Prüfe, ob du die richtige Akademie geöffnet hast. Sieh auch im Spamordner des hinterlegten Postfachs nach.",
        "Bitte die Akademieverwaltung um Hilfe, falls keine Nachricht eintrifft oder dein Zugang gesperrt ist. Teile keine Passwörter oder Codes.",
      ],
      en: [
        "Check that you're on the correct academy site. Check the spam folder in the mailbox attached to your account.",
        "Ask academy administration for help if the message does not arrive or your access is blocked. Keep passwords and codes private.",
      ],
    },
    keywords: [
      "Passwort",
      "password",
      "login",
      "username",
      "Benutzername",
      "Sprache",
      "language",
      "Dunkel",
      "dark",
    ],
  },
  {
    id: "academy-classes",
    path: "/learning",
    area: "courses",
    practicePath: "/learning?role=participant",
    title: {
      de: "Kurse, Lernmaterial und Nachrichten",
      en: "Courses, learning materials and messages",
    },
    summary: {
      de: "Finde freigegebene Kurse, Lernunterlagen und den Kurschat.",
      en: "Find your courses, shared learning materials and course chat.",
    },
    steps: {
      de: [
        "Öffne den gewünschten Kurs und prüfe die Kursinformationen sowie den Meetinglink.",
        "Lade die freigegebene Fassung aus den Kursunterlagen herunter. Bestätige den Erhalt, wenn du sie geöffnet hast.",
        "Öffne den Kurschat für Nachrichten und gescannte Anhänge. Die Glocke zeigt neue Meldungen für deine Kurse.",
      ],
      en: [
        "Open your course to find its details and meeting link.",
        "Download the shared version in course materials and acknowledge receipt after opening it.",
        "Use course chat for messages and scanned attachments. The bell shows new notices for your courses.",
      ],
    },
    problem: {
      de: "Ein Kurs oder eine Datei fehlt.",
      en: "A course or file is missing.",
    },
    resolution: {
      de: [
        "Prüfe, ob deine Anmeldung für diesen Kurs bestätigt wurde. Bitte bei fehlenden Unterlagen die Lehrperson, den Freigabestatus zu prüfen.",
      ],
      en: [
        "Check whether your enrolment is confirmed. For missing materials, ask the instructor to check their sharing status.",
      ],
    },
    keywords: [
      "Kurschat",
      "attachment",
      "Meeting",
      "Upload",
      "Benachrichtigung",
      "notification",
    ],
  },
  {
    id: "academy-teaching",
    path: "/learning",
    area: "courses",
    practicePath: "/courses?role=lecturer",
    title: {
      de: "Als Lehrkraft im Kurs arbeiten",
      en: "Teach in a course workspace",
    },
    summary: {
      de: "Bereite den Unterricht für deine zugewiesenen Kurse vor und dokumentiere die Teilnahme.",
      en: "Prepare teaching for your assigned courses and record attendance.",
    },
    steps: {
      de: [
        "Öffne deinen zugewiesenen Kurs unter Meine Kurse. Hinterlege einen Meetinglink und veröffentliche die Willkommensinformation.",
        "Lade deine Materialien hoch und wähle die vorgesehene Sichtbarkeit. Prüfe, ob die richtige Fassung für Teilnehmende freigegeben ist.",
        "Wähle im Anwesenheitsregister den Termin und speichere die Einträge. Veröffentliche geeignete Prüfungsaufgaben oder Quizze in den Lernaktivitäten.",
      ],
      en: [
        "Open your assigned course under My courses. Add a meeting link and publish the welcome information.",
        "Upload your materials and select the intended audience. Check that the correct version is available to learners.",
        "Choose the session in the attendance register and save the entries. Publish the relevant exam papers or quizzes in Learning activities.",
      ],
    },
    problem: {
      de: "Du kannst den Kurs oder seine Einstellungen nicht bearbeiten.",
      en: "You cannot edit the course or its settings.",
    },
    resolution: {
      de: [
        "Bitte die Akademieverwaltung, die Lehrzuweisung für diesen Kurs zu prüfen.",
        "Prüfe bei einem nicht sichtbaren Upload die Freigabe und den Prüfstatus der Datei.",
      ],
      en: [
        "Ask academy administration to check your instructor assignment for that course.",
        "For an upload that is not visible, check its audience and scanning status.",
      ],
    },
    keywords: [
      "Dozent",
      "lecturer",
      "instructor",
      "Meetinglink",
      "Upload",
      "Anwesenheit",
    ],
  },
  {
    id: "academy-schedule",
    path: "/timetable",
    area: "courses",
    title: { de: "Stundenplan und Zeitzonen", en: "Timetable and time zones" },
    summary: {
      de: "Prüfe Termine in der Zeitzone des jeweiligen Kurses.",
      en: "Review sessions in each course’s time zone.",
    },
    steps: {
      de: [
        "Öffne den Stundenplan über die Kopfzeile.",
        "Wähle einen Zeitraum von bis zu 31 Tagen und öffne den Kurs über den Termintitel.",
      ],
      en: [
        "Open Timetable from the header.",
        "Select up to 31 days and open the course from its session listing.",
      ],
    },
    problem: {
      de: "Eine Uhrzeit passt nicht zu deiner Ortszeit.",
      en: "A time differs from your local clock.",
    },
    resolution: {
      de: [
        "Vergleiche die angezeigte Kurszeitzone und den UTC-Offset, besonders am Tag einer Zeitumstellung.",
      ],
      en: [
        "Check the course’s time zone and UTC offset, especially on daylight-saving transition days.",
      ],
    },
    keywords: ["Termin", "calendar", "schedule", "time zone", "Zeitzone"],
  },
  {
    id: "academy-assessments",
    path: "/learning",
    area: "courses",
    title: {
      de: "Prüfungen, Anwesenheit und Abschluss",
      en: "Exams, attendance and completion",
    },
    summary: {
      de: "Bearbeite Lernaktivitäten und rufe deinen eigenen Nachweis ab.",
      en: "Complete your learning activities and access your own completion record.",
    },
    steps: {
      de: [
        "Öffne im Kurs die freigegebene Prüfungsaufgabe oder das veröffentlichte Quiz.",
        "Die Lehrperson erfasst die Anwesenheit je Termin. Berechtigte Kursmitarbeitende können die Liste als CSV oder PDF exportieren.",
        "Beantrage das Abschlussdokument in den Lernaktivitäten, sobald Einschreibung, bestätigte Anwesenheit und ein erforderliches Quiz abgeschlossen sind.",
      ],
      en: [
        "Open the released student exam paper or the published quiz in the course.",
        "The instructor records attendance per session. Authorised course staff can export a register as CSV or PDF.",
        "Request your completion document in Learning activities once enrolment, verified attendance and any required published quiz are complete.",
      ],
    },
    problem: {
      de: "Ein Prüfungsdokument oder Nachweis ist gesperrt.",
      en: "An exam or completion document is unavailable.",
    },
    resolution: {
      de: [
        "Prüfe die Freigabe und die Abschlussvoraussetzungen. Lösungsschlüssel bleiben dem berechtigten Kursteam vorbehalten.",
      ],
      en: [
        "Check the release and completion requirements. Only authorised course staff can access answer keys.",
      ],
    },
    keywords: [
      "Lösungsschlüssel",
      "answer key",
      "quiz",
      "Anwesenheit",
      "certificate",
      "Abschluss",
    ],
  },
  {
    id: "academy-manage-courses",
    path: "/learning",
    area: "administration",
    practicePath: "/courses?role=admin",
    title: {
      de: "Akademie verwalten und Kurse freigeben",
      en: "Manage the academy and publish a course",
    },
    summary: {
      de: "Lege lokale Konten und Kurse an und bestätige Anmeldungen.",
      en: "Create local accounts and courses, and confirm enrolments.",
    },
    steps: {
      de: [
        "Lege Organisationseinheiten sowie Konten für interne Lehrkräfte und Teilnehmende in der Akademieverwaltung an. Die Schulungskoordination betreut Teilnehmende ihrer zugewiesenen Einheit.",
        "Erstelle unter Meine Kurse einen Kursentwurf mit Vorlage, Zeitzone und Terminen. Weise eine Lehrperson zu und bestätige bei der Freigabe die Gruppengröße.",
        "Öffne den freigegebenen Kurs und melde die aktiven Teilnehmenden an. Hinterlege bei Bedarf einen Meetinglink und veröffentliche die Willkommensinformation.",
      ],
      en: [
        "Create organisational units and accounts for internal instructors and learners in academy administration. Training coordinators support learners in their assigned unit.",
        "Under My courses, create a draft with its template, time zone and sessions. Assign an instructor and confirm the group size when publishing.",
        "Open the published course and enrol active learners. Add a meeting link if needed and publish the welcome information.",
      ],
    },
    problem: {
      de: "Der Server hat eine Änderung abgewiesen.",
      en: "The server declined a change.",
    },
    resolution: {
      de: [
        "Lade den aktuellen Kursstand. Prüfe die Lehrperson und vorhandene Anmeldungen und bestätige die Änderung erneut.",
      ],
      en: [
        "Reload the course, check the current instructor and enrolments, then review and confirm the change again.",
      ],
    },
    keywords: [
      "Lehrperson",
      "teacher",
      "Einladung",
      "invitation",
      "Entwurf",
      "draft",
      "publish",
      "Verwaltung",
    ],
  },
  {
    id: "academy-lms-access",
    path: "/administration",
    area: "administration",
    title: {
      de: "LMS-Zugriff der Akademie prüfen",
      en: "Check academy LMS access",
    },
    summary: {
      de: "Premium LMS ist Bestandteil jeder eigenständigen White-Label-Akademie.",
      en: "Premium LMS is included in every dedicated White Label academy.",
    },
    steps: {
      de: [
        "Der Betreiber richtet das Kursprofil der Installation für die passende Lizenz und den installierten Versionsstand ein.",
        "Prüfe in der Akademieverwaltung die Lizenz und die verfügbaren Kontoplätze. Lege Konten, Rollen und Organisationseinheiten fest. In der Akademie gibt es keinen separaten Premium-Schalter pro Unternehmen.",
        "Prüfe den Zugriff im vorgesehenen Konto und für den richtigen Kurs. Die Rollenvorschau zeigt Beispieldaten. Reale Aktionen richten sich nach dem Konto und seiner Kurszuordnung.",
      ],
      en: [
        "The operator sets up the installation's course profile for the matching licence and installed release.",
        "Check the licence and available seats in Academy administration. Assign accounts, roles and organisational units. The academy does not have a separate per-company Premium switch.",
        "Check access using the intended account and course. Role previews use sample data. Real actions follow the account and its course assignment.",
      ],
    },
    problem: {
      de: "Die Akademie ist schreibgeschützt oder der Kursbereich ist gesperrt.",
      en: "The academy is read-only or its learning area is unavailable.",
    },
    resolution: {
      de: [
        "Wende dich an den Betreiber, damit er Kursprofil, Lizenz und installierten Versionsstand abgleicht. Während der Lizenz-Kulanzfrist ist der Kursbereich schreibgeschützt.",
        "Prüfe bei einzelnen fehlenden Funktionen die Rolle, die Organisationseinheit und die bestätigte Kurseinschreibung oder Lehrzuweisung.",
      ],
      en: [
        "Ask the operator to check the course profile, licence and installed version. The learning area is read-only during the licence grace period.",
        "For missing individual actions, check the role, organisational unit and confirmed enrolment or instructor assignment.",
      ],
    },
    keywords: [
      "Premium LMS",
      "White Label",
      "licence",
      "Lizenz",
      "Freischaltung",
      "Rollen",
      "Organisation",
    ],
  },
  {
    id: "academy-branding",
    path: "/administration",
    area: "administration",
    title: {
      de: "Akademie-Auftritt und öffentliche Links",
      en: "Academy branding and public links",
    },
    summary: {
      de: "Passe Name, Farbe, Logo und öffentliche Links deiner Installation an.",
      en: "Set your installation's name, accent colour, logo and public links.",
    },
    steps: {
      de: [
        "Öffne als lokaler Admin den Akademie-Auftritt. Speichere den vollständigen Namen, den Kurznamen und die Akzentfarbe.",
        "Wähle unter Akademie-Logo ein RGB- oder RGBA-PNG ohne Metadaten mit höchstens 512 × 512 Pixeln und 256 KiB. Prüfe die Vorschau vor dem Speichern.",
        "Trage unter Öffentliche Links die HTTPS-Adressen für die gewünschten Einträge ein. Leere Felder blenden die jeweiligen Links aus. Prüfe die Anmeldeseite anschließend in einem privaten Browserfenster.",
      ],
      en: [
        "As a local administrator, open Academy branding. Save the full name, short name and accent colour.",
        "Under Academy logo, choose an RGB or RGBA PNG with no metadata, up to 512 × 512 pixels and 256 KiB. Check the preview before saving.",
        "Enter the HTTPS addresses you want under Public links. Leaving a field blank hides the corresponding link. Check the sign-in page in a private browser window afterward.",
      ],
    },
    problem: {
      de: "Eine Änderung ist für Besucher oder in der installierten App nicht sichtbar.",
      en: "A change is missing for visitors or in the installed app.",
    },
    resolution: {
      de: [
        "Lade bei einem Konflikt den aktuellen Stand und übernimm gewünschte Änderungen erneut.",
        "App-Symbole und die Installationsdomain werden mit dem Installationspaket festgelegt. Bitte den Betreiber um eine passende Paketaktualisierung.",
      ],
      en: [
        "After a conflict, reload the latest settings and reapply the intended changes.",
        "App icons and the installation domain are set through the installation package. Ask the operator to prepare the corresponding package update.",
      ],
    },
    keywords: [
      "White Label",
      "branding",
      "logo",
      "PWA",
      "footer",
      "links",
      "domain",
    ],
  },
  {
    id: "academy-integrations",
    path: "/administration",
    area: "integrations",
    title: {
      de: "API-Schlüssel und signierte Kurs-Webhooks",
      en: "API keys and signed course webhooks",
    },
    summary: {
      de: "Lies veröffentlichte Kurse ab oder empfange signierte Meldungen zu Kursänderungen.",
      en: "Read published courses or receive signed notifications of course updates.",
    },
    steps: {
      de: [
        "Öffne als lokaler Admin die Kursintegrationen in der Akademieverwaltung und wähle die Organisation. Erstelle einen benannten API-Schlüssel mit Ablaufdatum.",
        "Speichere den einmal angezeigten Wert im Geheimnisspeicher des abfragenden Servers. Entnimm die Basis-URL und den Kursindex dem OpenAPI-Dokument.",
        "Lass den Betreiber einen HTTPS-Empfänger mit Alias einrichten. Registriere den Alias unter Signierte Kurs-Webhooks und speichere den Signierschlüssel beim Empfänger.",
        "Prüfe die erste Zustellung im Verlauf. Der Empfänger prüft Signatur und Zeitstempel und verarbeitet jede Ereignis-ID nur einmal.",
      ],
      en: [
        "As a local administrator, open Course integrations in Academy administration and choose the organisation. Create a named API key with an expiry.",
        "Store the one-time credential in the consuming server's secret store. The OpenAPI document gives the base URL and course index operation.",
        "Ask the operator to configure an HTTPS receiver with an alias. Register it under Signed course webhooks and store the signing key on the receiver.",
        "Check the first delivery in delivery history. The receiver verifies the signature and timestamp and processes each event ID once.",
      ],
    },
    problem: {
      de: "Der Kursabruf oder die Zustellung ist fehlgeschlagen.",
      en: "The course request or delivery failed.",
    },
    resolution: {
      de: [
        "Prüfe das gewählte Unternehmen, die aktive Lizenz und den Ablauf des Schlüssels. Ersetze einen widerrufenen Schlüssel im abfragenden Dienst.",
        "Prüfe bei einem Webhook den Zustellverlauf. Lass den Betreiber Alias, Zuordnung zum HTTPS-Empfänger und Signierschlüssel abgleichen.",
      ],
      en: [
        "Check the selected organisation, active licence and key expiry. Replace a revoked credential in the consuming service.",
        "For a webhook, inspect delivery history. Ask the operator to verify the alias, its HTTPS receiver mapping and the signing key.",
      ],
    },
    keywords: [
      "API",
      "OpenAPI",
      "Swagger",
      "Webhook",
      "HMAC",
      "receiver",
      "Empfänger",
      "Integration",
      "Schlüssel",
    ],
  },
];

export default {
  modules: academyGuides,
  recovery: academyGuides.map(({ id, problem, resolution }) => ({
    title: problem,
    body: { de: resolution.de.join(" "), en: resolution.en.join(" ") },
    topic: id,
  })),
};
