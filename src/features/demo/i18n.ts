/**
 * DE/EN UI resources for fictional demo interactions. Import registers the demo namespace;
 * authored guide text is selected separately by the shared catalog helpers.
 */
import i18n from "../../lib/i18n";

const pairs = {
    adminTitle: ["Fiktiver Auftragstitel", "Fictional job title"],
    adminDraft: [
        "Demo-Angebot als Entwurf speichern",
        "Save demo offer as draft",
    ],
    adminPublish: ["Demo-Angebot veröffentlichen", "Publish demo offer"],
    adminDraftSaved: [
        "Demo-Entwurf gespeichert. Prüfe Termine und Konditionen, bevor du die Veröffentlichung simulierst.",
        "Demo draft saved. Check the sessions and terms before simulating publication.",
    ],
    adminPublished: [
        "In der Demo veröffentlicht; im Demo-Auftragsbereich sichtbar. Keine echte Ausschreibung erstellt.",
        "Published in the demo and visible in demo jobs. No real offer created.",
    ],
    adminLocked: [
        "Der veröffentlichte Demo-Titel bleibt für diese Übung fest. Zum Wiederholen die Demo zurücksetzen.",
        "The published demo title stays fixed for this exercise. Reset the demo to repeat.",
    ],
    adminClaimed: [
        "Dieser Demo-Terminblock wurde bereits übernommen. Sein Titel und seine Termine bleiben erhalten. Setze die Demo zurück, bevor du ein neues Angebot ausprobierst.",
        "This demo session block has already been claimed. Its title and sessions stay unchanged. Reset the demo before practising a new offer.",
    ],
    request: ["Fiktive Kursanfrage", "Fictional course request"],
    requestSend: [
        "Kursanfrage in Demo vormerken",
        "Record a course request in demo",
    ],
    requestSaved: [
        "Demo-Anfrage vorgemerkt. Dies reserviert keine Dozierenden oder Termine und sendet keine Nachricht.",
        "Demo request recorded. This reserves no lecturers or sessions and sends no message.",
    ],
    acceptTerms: [
        "Beispielbedingungen zur Probe bestätigen",
        "Practise acknowledging sample terms",
    ],
    termsAccepted: [
        "Nur in der Demo bestätigt. Keine rechtsverbindliche Erklärung und kein echter Vertrag.",
        "Acknowledged only in the demo. No legally binding declaration and no real agreement.",
    ],
    draftContent: ["Fiktiver Beitragstext", "Fictional post text"],
    publishContent: ["Beitrag in Demo veröffentlichen", "Publish post in demo"],
    contentPublished: [
        "Demo-Beitrag nur in diesem Tab veröffentlicht. Im echten Portal richten sich Sichtbarkeit und Moderation nach deinen Rechten.",
        "Demo post published only in this tab. In the real portal, visibility and moderation depend on your permissions.",
    ],
    contentHint: [
        "Verwende ausschließlich fiktiven Text. Maximal 500 Zeichen; HTML wird als Text angezeigt.",
        "Use fictional text only. Maximum 500 characters; HTML is displayed as text.",
    ],
    title: ["Demo zum Ausprobieren", "Explore the demo"],
    intro: [
        "Lerne die Abläufe kennen und probiere typische Aufgaben mit fiktiven Beispielen aus.",
        "Learn the workflows and practise typical tasks with fictional examples.",
    ],
    badge: ["DEMO · Nur fiktive Daten", "DEMO · Fictional data only"],
    isolation: [
        "Diese eigenständige Übungsumgebung sendet keine Nachrichten oder E-Mails, lädt keine Dateien hoch und verändert keine echten Konten, Aufträge oder Rechnungen. Deine Übungseingaben bleiben nur bis zum Neuladen im Arbeitsspeicher dieses Tabs.",
        "This separate practice environment sends no messages or emails, uploads no files and changes no real accounts, jobs or invoices. Practice input stays only in this tab's memory until reload.",
    ],
    role: ["Demo-Rolle", "Demo role"],
    roleHint: [
        "Die Auswahl ändert nur die fiktive Navigation. Sie erteilt keine Rechte im echten Portal und erzeugt keine Geschäftsdaten.",
        "The selection changes only fictional navigation. It grants no real portal permissions and creates no business data.",
    ],
    lecturer: ["Dozentin / Dozent", "Lecturer"],
    management: ["Verwaltung", "Management"],
    roleAdmin: ["Administration", "Administration"],
    client: ["Auftraggeber", "Client"],
    roleCompany: ["Unternehmen", "Company"],
    participant: ["Teilnehmende", "Participant"],
    roleLecturer: [
        "Als Lehrkraft suchst du passende Aufträge, prüfst alle Termine und pflegst deine eigenen Unterlagen.",
        "As a lecturer, find suitable jobs, check every session and manage your own documents.",
    ],
    roleManagement: [
        "Die Verwaltung organisiert Kurse und Angebote innerhalb ihrer ausdrücklich vergebenen Rechte. Private Nachrichten und Kalender bleiben geschützt.",
        "Management organises courses and offers within explicitly granted permissions. Private messages and calendars stay protected.",
    ],
    roleClient: [
        "Auftraggeber sehen ihre eigenen Kursanfragen und freigegebenen Informationen. Andere Kunden und Dozentenhonorare bleiben verborgen.",
        "Clients see their own course requests and shared information. Other clients and lecturer fees remain private.",
    ],
    roleParticipant: [
        "Teilnehmende nutzen freigegebene Kursinformationen und eigene Bewertungen. Interne Aufträge und Finanzen gehören nicht zu ihrer Ansicht.",
        "Participants use shared course information and their own reviews. Internal jobs and finances are outside their view.",
    ],
    navigation: ["Demo-Bereiche", "Demo sections"],
    navigationMore: ["Weitere Demo-Bereiche", "More demo sections"],
    navigationScroll: [
        "Alle Bereiche ansehen: Auf kleinen Bildschirmen in der Liste nach unten scrollen.",
        "Browse all sections: on smaller screens, scroll down within the list.",
    ],
    reset: ["Demo zurücksetzen", "Reset demo"],
    resetDone: [
        "Alle Demo-Übungen wurden zurückgesetzt.",
        "All demo exercises have been reset.",
    ],
    help: ["Hilfe & Problemlösungen", "Help & troubleshooting"],
    login: ["Zum echten Login", "Go to the real login"],
    start: ["Rundgang starten", "Start guided tour"],
    pause: ["Rundgang pausieren", "Pause guided tour"],
    restart: ["Rundgang neu starten", "Restart guided tour"],
    next: ["Nächster Bereich", "Next section"],
    previous: ["Vorheriger Bereich", "Previous section"],
    tour: ["Geführter Demo-Rundgang", "Guided demo tour"],
    progress: [
        "Bereich {{current}} von {{total}}",
        "Section {{current}} of {{total}}",
    ],
    finish: ["Rundgang abschließen", "Finish guided tour"],
    completed: [
        "Rundgang abgeschlossen. Du kannst weiter üben oder von vorn beginnen.",
        "Tour completed. You can keep practising or start again.",
    ],
    steps: ["So läuft es im echten Portal", "How it works in the real portal"],
    practice: ["Jetzt mit Beispielen üben", "Practise with examples"],
    sample: ["Fiktives Beispiel", "Fictional example"],
  quickAccess: ["Demo-Schnellzugriff", "Demo quick access"],
  sampleCourses: ["Fiktive Kursliste", "Fictional course list"],
  courseFilter: ["Kurse filtern", "Filter courses"],
  filterAll: ["Alle", "All"],
  filterUpcoming: ["Bevorstehend", "Upcoming"],
  sampleOrganisation: ["Demo-Akademie (fiktiv)", "Demo Academy (fictional)"],
  sampleSchedule: ["Terminplan", "Schedule"],
  sampleChat: ["Kurschat", "Course chat"],
  sampleFiles: ["Dateien", "Files"],
  samplePastCourse: [
    "Netzwerkeinstieg · Demo-Akademie",
    "Network basics · Demo Academy",
  ],
  samplePastDate: ["Abgeschlossen · April 2030", "Completed · April 2030"],
    claim: ["Auftrag zur Probe übernehmen", "Practise claiming this job"],
    claimed: [
        "Simulation: Der gesamte Block ist reserviert. Im echten Portal ist erst die Serverbestätigung verbindlich.",
        "Simulation: The entire block is reserved. In the real portal, only server confirmation is binding.",
    ],
    claimHint: [
        "Ein zusammenhängender Auftrag umfasst beide Termine. Im echten Portal prüft die Datenbank Verfügbarkeit, Qualifikation, Vertragsvoraussetzungen und Überschneidungen atomar.",
        "One whole-block job includes both sessions. In the real portal, the database checks availability, qualifications, contract prerequisites and overlaps atomically.",
    ],
    outcome: ["Ergebnis ausprobieren", "Try an outcome"],
    success: ["Erfolgreiche Simulation", "Successful simulation"],
    filled: ["Bereits vergeben", "Already filled"],
    conflict: ["Terminüberschneidung", "Schedule conflict"],
    qualification: ["Voraussetzung fehlt", "Missing prerequisite"],
    offline: ["Keine Verbindung", "No connection"],
    filledBody: [
        "Simulation: Ein anderer Dozent war schneller. Angebote aktualisieren und einen anderen vollständigen Block wählen; keine Teilreservierung.",
        "Simulation: Another lecturer was faster. Refresh the offers and choose another complete block; no partial reservation.",
    ],
    conflictBody: [
        "Simulation: Ein Termin überschneidet sich. Eigene bestätigte Aufträge und Sperrzeiten prüfen und einen anderen Block wählen.",
        "Simulation: A session overlaps. Check your confirmed assignments and blocked times, then choose another block.",
    ],
    qualificationBody: [
        "Simulation: Ein erforderliches Thema im Profil oder ein gültiger Vertrag fehlt. Eigene Fachgebiete und Vertragsstatus prüfen.",
        "Simulation: A required declared topic or valid contract is missing. Check your profile topics and contract status.",
    ],
    offlineBody: [
        "Simulation: Ohne Verbindung wird keine Übernahme bestätigt. Verbindung herstellen, aktuellen Auftragsstatus laden und erst dann erneut versuchen.",
        "Simulation: No claim is confirmed without a connection. Reconnect, reload the current job status and only then retry.",
    ],
    available: ["Noch offen", "Still available"],
    reserved: ["In der Demo übernommen", "Claimed in the demo"],
    event: [
        "Fiktiven privaten Termin hinzufügen",
        "Add a fictional private event",
    ],
    eventAdded: [
        "Fiktive Vorbereitung · nur in deiner Demo",
        "Fictional preparation · only in your demo",
    ],
    noEvent: ["Noch kein eigener Demo-Termin.", "No personal demo event yet."],
    assignment: [
        "Demo-Auftrag: beide bestätigten Termine",
        "Demo assignment: both confirmed sessions",
    ],
    pendingAssignment: [
        "Übernimm zuerst den Demo-Auftrag; danach erscheinen hier beide Termine.",
        "Claim the demo job first; both sessions will then appear here.",
    ],
    message: ["Demo-Nachricht", "Demo message"],
    messageHint: [
        "Bitte nur fiktive Inhalte eingeben. Maximal 280 Zeichen; kein Empfänger erhält eine Nachricht.",
        "Please enter fictional content only. Maximum 280 characters; no recipient receives a message.",
    ],
    send: ["In Demo senden", "Send in demo"],
    sent: [
        "Demo-Nachricht nur in diesem Tab hinzugefügt.",
        "Demo message added only in this tab.",
    ],
    chat: ["Demo-Kursraum · Linux Grundlagen", "Demo course room · Linux basics"],
    chatSample: [
        "Fiktive Kollegin: Das Beispiel-Handout liegt im Kursbereich.",
        "Fictional colleague: The sample handout is in the course section.",
    ],
    name: ["Fiktiver Anzeigename", "Fictional display name"],
    saveProfile: ["Demo-Profil speichern", "Save demo profile"],
    profileSaved: [
        "Demo-Profil nur im Arbeitsspeicher aktualisiert.",
        "Demo profile updated only in memory.",
    ],
    profileHint: [
        "Nutze einen erfundenen Namen. Hier werden weder E-Mail noch Lebenslauf benötigt.",
        "Use a made-up name. No email address or CV is needed here.",
    ],
    file: [
        "Demo-Handout.pdf · fiktiv · 42 KB",
        "Demo-handout.pdf · fictional · 42 KB",
    ],
    scan: [
        "Prüfung einer Beispieldatei simulieren",
        "Simulate scanning a sample file",
    ],
    scanned: [
        "Demo-Datei: Prüfung bestanden. Im echten Portal erfolgt die Prüfung serverseitig; erst danach ist ein freigegebener Zugriff möglich.",
        "Demo file: scan passed. In the real portal, scanning happens on the server; permitted access is available only afterwards.",
    ],
    quarantine: [
        "Beispielstatus: wartet auf Prüfung",
        "Sample status: awaiting scan",
    ],
    invoice: ["Fiktive Rechnung vormerken", "Record a fictional invoice"],
    invoiceSaved: [
        "Demo-Rechnung DEMO-001 vorgemerkt. Kein PDF hochgeladen, keine Zahlung ausgelöst.",
        "Demo invoice DEMO-001 recorded. No PDF uploaded and no payment initiated.",
    ],
    fee: [
        "Fiktiver Honorar-Snapshot: 800,00 € für den gesamten Block",
        "Fictional fee snapshot: €800.00 for the entire block",
    ],
    financeHint: [
        "Die Demo zeigt nur einen Ablauf. Im echten Portal bleiben akzeptierte Konditionen unveränderlich; die Finanzansicht ist rollenabhängig.",
        "This demo illustrates a workflow. In the real portal, accepted terms stay immutable and finance views depend on permissions.",
    ],
    check: ["Diesen Ablauf zur Probe durchgehen", "Practise this workflow"],
    checked: [
        "Demo-Checkliste durchgegangen. Es wurde kein echter Datensatz angelegt oder geändert.",
        "Demo checklist completed. No real record was created or changed.",
    ],
    course: ["Linux Grundlagen · Demo-Akademie", "Linux basics · Demo Academy"],
    organisation: [
        "Demo-Akademie · vollständig erfunden",
        "Demo Academy · entirely fictional",
    ],
    profile: [
        "Demo Alex · Europe/Berlin · Linux / SQL",
        "Demo Alex · Europe/Berlin · Linux / SQL",
    ],
    sampleTerms: [
        "Beispielvertrag v1 · nur zur Erläuterung, keine rechtliche Erklärung",
        "Sample agreement v1 · for explanation only, no legal declaration",
    ],
    notification: [
        "Demo-Hinweis: Neuer passender Linux-Auftrag",
        "Demo notice: New matching Linux job",
    ],
    wiki: [
        "Demo-Wiki: Wie bereite ich einen Linux-Kurs vor?",
        "Demo wiki: How do I prepare a Linux course?",
    ],
    forum: [
        "Demo-Frage: Welche Übungen eignen sich für Shell-Einstieg?",
        "Demo question: Which exercises suit an introduction to the shell?",
    ],
    security: [
        "Demo-Sicherheitscheck: Passwort im eigenen echten Konto selbst festlegen",
        "Demo security check: Set your password in your own real account",
    ],
    empty: ["Noch nicht ausprobiert", "Not practised yet"],
    done: ["Ausprobiert", "Practised"],
    calendar: ["Demo-Kalender", "Demo calendar"],
    messages: ["Demo-Nachrichten", "Demo messages"],
    statOpenOffers: ["Offene Aufträge", "Open offers"],
    statConfirmedBlocks: ["Bestätigte Zuordnungen", "Confirmed blocks"],
    statCourseRuns: ["Kursdurchführungen", "Course runs"],
    statCompanies: ["Unternehmen", "Companies"],
    statAccounts: ["Konten", "Accounts"],
    statAuditEvents: ["Audit-Ereignisse", "Audit events"],
    statOwnedCourses: ["Eigene Kurse", "Owned courses"],
    statParticipants: ["Teilnehmende", "Participants"],
    statOpenInvoices: ["Offene Rechnungen", "Open invoices"],
    statEnabledCourses: ["Freigeschaltete Kurse", "Enabled courses"],
    statUpcomingSessions: ["Kommende Termine", "Upcoming sessions"],
    statLearningMaterials: ["Lernmaterialien", "Learning materials"],
    state: ["Übungsstand", "Practice progress"],
    invalid: [
        "Dieser Demo-Bereich existiert nicht. Wähle einen Bereich aus der Navigation.",
        "This demo section does not exist. Choose a section from the navigation.",
    ],
} satisfies Record<string, [string, string]>;
for (const [index, language] of ["de", "en"].entries()) {
    i18n.addResourceBundle(
        language,
        "demo",
        Object.fromEntries(
            Object.entries(pairs).map(([key, values]) => [key, values[index]]),
        ),
    );
}