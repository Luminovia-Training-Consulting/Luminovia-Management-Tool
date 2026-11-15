import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  calendar: ["Mein Kalender im Blick", "My calendar at a glance"],
  calendarZone: ["Anzeige: {{zone}}", "Displayed in {{zone}}"],
  calendarHint: [
    "Deine privaten Termine der nächsten 30 Tage und bestätigten Lehraufträge.",
    "Your private events for the next 30 days and confirmed teaching assignments.",
  ],
  personal: ["Privater Termin", "Private event"],
  assignment: ["Bestätigter Lehrauftrag", "Confirmed teaching assignment"],
  noEvents: [
    "Keine bevorstehenden Termine in dieser Vorschau.",
    "No upcoming events in this preview.",
  ],
  openCalendar: ["Kalender öffnen", "Open calendar"],
  calendarRefresh: [
    "Kalendervorschau aktualisieren",
    "Refresh calendar preview",
  ],
  activity: ["Nachrichten & Meldungen", "Messages & updates"],
  notifications: ["Benachrichtigungen", "Notifications"],
  unreadNotifications: [
    "{{count}} ungelesene Meldungen",
    "{{count}} unread notifications",
  ],
  unreadMessages: [
    "{{count}} ungelesene Nachrichten",
    "{{count}} unread messages",
  ],
  noNotifications: ["Du bist auf dem aktuellen Stand.", "You're up to date."],
  allNotifications: ["Posteingang öffnen", "Open inbox"],
  chats: ["Chats öffnen", "Open chats"],
  unknownActivity: ["Aktivität", "Activity"],
  noPreviewLink: ["Verweis nicht mehr verfügbar", "Link no longer available"],
  pendingContracts: [
    "Meine offenen Vertragsbestätigungen",
    "My pending contract receipts",
  ],
  contractHint: [
    "Aktuelle persönliche Verträge mit abrufbarer Dokumentfassung, deren Erhalt du noch nicht bestätigt hast.",
    "Current personal contracts with a document version whose receipt you have not acknowledged yet.",
  ],
  noContracts: [
    "Keine offenen Bestätigungen für aktuelle Verträge.",
    "No pending receipts for current contracts.",
  ],
  reviewContracts: ["Verträge prüfen", "Review contracts"],
  validUntil: ["Gültig bis {{date}}", "Valid until {{date}}"],
  recentDocuments: ["Zuletzt hinzugefügte Dateien", "Recently added files"],
  fileHint: [
    "Nur freigegebene, geprüfte Dateien, auf die dein Konto zugreifen darf.",
    "Only clean, available files that your account is allowed to access.",
  ],
  noDocuments: ["Noch keine verfügbaren Dateien.", "No available files yet."],
  openFiles: ["Dateizentrale öffnen", "Open file centre"],
  followUps: ["Verwaltung: nächste Schritte", "Management: next steps"],
  followUpHint: [
    "Aus den für dein Konto freigegebenen Aufträgen, ohne fremde private Kalenderdaten.",
    "Based on jobs available to your account, without other people's private calendar data.",
  ],
  draftJobs: [
    "{{count}} Auftragsentwürfe prüfen",
    "Review {{count}} job drafts",
  ],
  expiringJobs: [
    "{{count}} offene Aufträge mit abgelaufener Frist",
    "{{count}} open jobs past their claim deadline",
  ],
  upcomingUnfilled: [
    "{{count}} offene Lehraufträge mit Terminen in den nächsten 14 Tagen",
    "{{count}} unfilled teaching jobs with sessions within 14 days",
  ],
  unreadNotifications_one: ["1 ungelesene Meldung", "1 unread notification"],
  unreadNotifications_other: [
    "{{count}} ungelesene Meldungen",
    "{{count}} unread notifications",
  ],
  unreadMessages_one: ["1 ungelesene Nachricht", "1 unread message"],
  unreadMessages_other: [
    "{{count}} ungelesene Nachrichten",
    "{{count}} unread messages",
  ],
  draftJobs_one: ["1 Auftragsentwurf prüfen", "Review 1 job draft"],
  draftJobs_other: [
    "{{count}} Auftragsentwürfe prüfen",
    "Review {{count}} job drafts",
  ],
  expiringJobs_one: [
    "1 offener Auftrag mit abgelaufener Frist",
    "1 open job past its claim deadline",
  ],
  expiringJobs_other: [
    "{{count}} offene Aufträge mit abgelaufener Frist",
    "{{count}} open jobs past their claim deadline",
  ],
  upcomingUnfilled_one: [
    "1 offener Lehrauftrag mit Terminen in den nächsten 14 Tagen",
    "1 unfilled teaching job with sessions within 14 days",
  ],
  upcomingUnfilled_other: [
    "{{count}} offene Lehraufträge mit Terminen in den nächsten 14 Tagen",
    "{{count}} unfilled teaching jobs with sessions within 14 days",
  ],
  manageJobs: ["Aufträge verwalten", "Manage jobs"],
  shortcuts: ["Direkt weiter", "Quick links"],
  profile: ["Mein Profil", "My profile"],
  courses: ["Kursübersicht", "Course catalogue"],
  settings: ["Meine Einstellungen", "My settings"],
  jobs: ["Aufträge entdecken", "Explore jobs"],
  client: ["Meine Kursaufträge", "My commissioned courses"],
  widgetError: [
    "Dieser Bereich konnte nicht geladen werden. Andere Bereiche bleiben verfügbar.",
    "This section could not be loaded. Other sections remain available.",
  ],
  retry: ["Bereich neu laden", "Reload section"],
  loading: ["Wird geladen …", "Loading…"],
  matches: ["Passend zu deiner Expertise", "Matched to your expertise"],
  matchingHint: [
    "Vorschläge anhand deiner bestätigten Fachgebiete. Die verbindliche Prüfung erfolgt bei der Übernahme.",
    "Suggestions based on your verified expertise. Eligibility is confirmed when you claim.",
  ],
};

for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "dashboard",
    Object.fromEntries(
      Object.entries(pairs).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
