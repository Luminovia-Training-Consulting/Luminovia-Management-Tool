import i18n from "../../lib/i18n";

const de = {
    nav: "Willkommensguide",
    title: "Willkommen bei Luminovia",
    subtitle:
        "Lerne deinen Arbeitsbereich Schritt für Schritt kennen. Dein Fortschritt gehört zu deinem Konto und wird erst nach Bestätigung des Servers gespeichert.",
    progress: "Schritt {{current}} von {{total}}",
    next: "Weiter",
    back: "Zurück",
    finish: "Einführung abschließen",
    pause: "Später fortsetzen",
    skip: "Einführung überspringen",
    resume: "Einführung fortsetzen",
    restart: "Einführung neu starten",
    open: "Bereich öffnen",
    home: "Zum Dashboard",
    saved: "Dein Fortschritt wurde gespeichert.",
    paused:
        "Deine Einführung ist pausiert. Mache beim zuletzt gespeicherten Schritt weiter.",
    completed:
        "Du hast die Einführung abgeschlossen. Du kannst sie jederzeit über das Menü erneut öffnen.",
    skipped:
        "Du hast die Einführung übersprungen. Du kannst sie jederzeit neu starten.",
    error:
        "Der Fortschritt wurde nicht gespeichert. Bitte lade den aktuellen Stand und versuche es erneut.",
    loadError: "Die Einführung konnte nicht geladen werden.",
    reload: "Aktuellen Stand laden",
    saving: "Wird gespeichert …",
    offline:
        "Du bist offline. Zum Speichern des Fortschritts ist eine Verbindung erforderlich.",
    welcomeTitle: "Dein persönlicher Start",
    welcomeBody:
        "Hier findest du die Bereiche, die zu deinen aktuellen Kontoberechtigungen passen. Mit Weiter lernst du jeden Bereich kennen. Du kannst jederzeit pausieren oder einen Bereich öffnen und danach hier fortsetzen.",
    profileTitle: "Profil und Zeitzone",
    profileBody:
        "Prüfe deinen Namen, deine Sprache und deine IANA-Zeitzone im Profil. Ergänze bei Bedarf deine Biografie und Expertise. Nachweise und Qualifikationen werden nach den geltenden Berechtigungen geprüft.",
    jobsTitle: "Aufträge entdecken und planen",
    jobsBody:
        "Aufträge enthalten Termine, Anforderungen und die für dich sichtbaren Konditionen. Prüfe vor einer Übernahme den gesamten Zeitraum. Erst die erfolgreiche Datenbankbestätigung reserviert alle Termine; bei Konflikten wird kein Teilblock gebucht. Verwaltungsfunktionen erscheinen nur mit entsprechender Berechtigung.",
    availabilityTitle: "Verfügbarkeit bewusst teilen",
    availabilityBody:
        "Pflege verfügbare Zeitfenster und Sperrzeiten. Nur ausdrücklich freigegebene Zeiträume und ihr Status sind für die Planung sichtbar. Private Notizen und private Kalendertermine bleiben persönlich.",
    clientTitle: "Dein Unternehmensbereich",
    clientBody:
        "Wähle eine dir zugeordnete Organisation und erfasse Kursanfragen mit Terminen, Anforderungen und dem vereinbarten Unternehmensbudget. Du siehst die für deine Organisation freigegebenen Anfragen und Ausgaben.",
    calendarTitle: "Termine an einem Ort",
    calendarBody:
        "Dein Kalender verbindet persönliche Einträge mit bestätigten Aufträgen und freigegebenen globalen Terminen. Beachte die angezeigte Zeitzone. Andere Konten erhalten durch diesen Guide keinen Zugriff auf deine privaten Termine.",
    collaborationTitle: "Nachrichten und Zusammenarbeit",
    collaborationBody:
        "Starte Gespräche über das Personenverzeichnis und nutze die Chats, zu denen du gehörst. Kurs- und Gruppenräume haben eigene Mitgliedschaften. Interne Lehrendengespräche und Teilnehmendenkanäle bleiben getrennt; zusätzliche Wissensbereiche erscheinen je nach Berechtigung im Menü.",
    filesTitle: "Dateien sicher austauschen",
    filesBody:
        "Im Dateibereich findest du freigegebene Unterlagen. Wähle beim Hochladen den passenden Zusammenhang und prüfe die Sichtbarkeit. Neue Dateien können bis zum Abschluss der Sicherheitsprüfung gesperrt bleiben. Private Dateien sind keine öffentlich teilbaren Links.",
    contractsTitle: "Vereinbarungen prüfen",
    contractsBody:
        "Prüfe deine eigenen verfügbaren Vertragsunterlagen und die für einen Auftrag geforderten Voraussetzungen. Bereits angenommene Aufträge behalten ihre bestätigten Konditionen. Du erhältst dadurch keinen Einblick in private Verträge anderer Personen.",
    notificationsTitle: "Hinweise und Einstellungen",
    notificationsBody:
        "Dein Posteingang sammelt Hinweise zu deinen Vorgängen. Unter Einstellungen steuerst du die angebotenen Kategorien. Ein gespeicherter Hinweis oder eine Einstellung bedeutet nicht automatisch, dass eine E-Mail versendet wurde.",
    administrationTitle: "Konten verantwortungsvoll verwalten",
    administrationBody:
        "Im Kontenbereich findest du nur die für dich erlaubten Verwaltungsaktionen. Vergib Rollen innerhalb deiner Berechtigung und prüfe den Zielaccount. Jede wirksame Änderung wird auf dem Server geprüft; eigene oder höhere Rechte lassen sich hier nicht freischalten.",
    finishTitle: "Bereit für deinen Arbeitsalltag",
    finishBody:
        "Du kennst jetzt die wichtigsten Bereiche deines aktuellen Arbeitsbereichs. Öffne Funktionen über das Menü und kehre bei Bedarf zum Willkommensguide zurück. Das Abschließen bestätigt nur die Einführung und ersetzt keine fachlichen, vertraglichen oder Sicherheitsfreigaben.",
};
const en: Record<keyof typeof de, string> = {
    nav: "Welcome guide",
    title: "Welcome to Luminovia",
    subtitle:
        "Explore your workspace one step at a time. Progress belongs to your account and is saved only after server confirmation.",
    progress: "Step {{current}} of {{total}}",
    next: "Next",
    back: "Back",
    finish: "Complete introduction",
    pause: "Continue later",
    skip: "Skip introduction",
    resume: "Resume introduction",
    restart: "Restart introduction",
    open: "Open this area",
    home: "Go to dashboard",
    saved: "Your progress has been saved.",
    paused: "Your introduction is paused. Continue from your last saved step.",
    completed:
        "You have completed the introduction. You can reopen it from the menu at any time.",
    skipped: "You skipped the introduction. You can restart it at any time.",
    error: "Progress was not saved. Reload the current version and try again.",
    loadError: "The introduction could not be loaded.",
    reload: "Reload current version",
    saving: "Saving …",
    offline: "You are offline. Saving progress requires a connection.",
    welcomeTitle: "Your personal starting point",
    welcomeBody:
        "These areas match your current account permissions. Select Next to explore each one. Pause at any time, or open an area and return here to continue.",
    profileTitle: "Profile and time zone",
    profileBody:
        "Check your name, language and IANA time zone in your profile. Add your biography and expertise where relevant. Evidence and qualifications are reviewed according to the applicable permissions.",
    jobsTitle: "Explore and plan assignments",
    jobsBody:
        "Assignments include dates, requirements and the terms available to you. Review the entire period before claiming. Only a successful database confirmation reserves all dates; a conflict never creates a partial allocation. Management actions appear only with the relevant permission.",
    availabilityTitle: "Share availability deliberately",
    availabilityBody:
        "Maintain available windows and blocked time. Only explicitly shared intervals and their status are available for planning. Private notes and private calendar appointments remain personal.",
    clientTitle: "Your company area",
    clientBody:
        "Choose an organisation assigned to you and create course requests with dates, requirements and the agreed company budget. You can view requests and spending authorised for your organisation.",
    calendarTitle: "Your dates in one place",
    calendarBody:
        "Your calendar combines personal entries, confirmed assignments and published global events. Check the displayed time zone. This guide never gives another account access to your private appointments.",
    collaborationTitle: "Messages and collaboration",
    collaborationBody:
        "Start conversations from the people directory and use the chats you belong to. Course and group rooms have separate memberships. Internal lecturer discussions and participant channels remain separate; additional knowledge areas appear in the menu according to your permissions.",
    filesTitle: "Share files safely",
    filesBody:
        "Find authorised materials in Files. Choose the right context and review visibility when uploading. New files may remain unavailable until security scanning completes. Private files do not provide publicly shareable links.",
    contractsTitle: "Review your agreements",
    contractsBody:
        "Check your own available contract documents and any prerequisites for an assignment. Accepted assignments retain their confirmed terms. This does not give you access to other people's private contracts.",
    notificationsTitle: "Notifications and settings",
    notificationsBody:
        "Your inbox collects notices about your activities. Use Settings to control the available categories. A saved notice or preference does not by itself mean an email has been sent.",
    administrationTitle: "Manage accounts responsibly",
    administrationBody:
        "The accounts area offers only administrative actions you are authorised to use. Assign roles within your permissions and check the target account. Every effective change is checked on the server; you cannot grant yourself or higher privileges here.",
    finishTitle: "Ready for your daily work",
    finishBody:
        "You now know the main areas of your current workspace. Open features from the menu and return to the welcome guide whenever helpful. Completion records only this introduction and does not replace professional, contractual or security approvals.",
};
i18n.addResourceBundle("de", "welcome", de);
i18n.addResourceBundle("en", "welcome", en);