import i18n from "../../lib/i18n";
const de = {
  title: "Benachrichtigungen",
  description:
    "Deine Meldungen und Erinnerungen, mit aktuell geprüften Verweisen.",
  all: "Alle",
  unread: "Ungelesen",
  count: "{{count}} ungelesen",
  open: "Öffnen",
  markRead: "Als gelesen markieren",
  markUnread: "Als ungelesen markieren",
  markAll: "Alle bisher eingegangenen Meldungen lesen",
  empty: "Hier gibt es gerade keine Meldungen.",
  unavailable:
    "Dieser Inhalt ist nicht mehr verfügbar oder nicht mehr für dich freigegeben.",
  more: "Weitere Meldungen laden",
  inbox: "Alle Benachrichtigungen",
  preferences: "Benachrichtigungen einstellen",
  settings: "Einstellungen",
  settingsHelp:
    "Lege fest, welche zusätzlichen Meldungen du künftig im Portal erhältst.",
  chat: "Neue Chatnachrichten",
  forum: "Antworten im Forum",
  job_updates: "Neue Auftragsmeldungen",
  reminders: "Termin- und Vertragserinnerungen",
  preferenceHelp:
    "Die Auswahl gilt für neue Meldungen. Buchungs- und Stornierungsbestätigungen bleiben als Nachweis erhalten. Bereits eingegangene Meldungen werden nicht gelöscht.",
  refresh: "Fällige Erinnerungen prüfen",
  refreshHelp:
    "Prüft deine bestätigten Termine der nächsten 24 Stunden und Verträge, die in 30 Tagen auslaufen, höchstens einmal pro Minute. Neue Meldungen erscheinen im Portal. Bei aktivierten E-Mail-Hinweisen und eingerichteter Zustellung werden sie zusätzlich für den Versand vorgemerkt.",
  refreshed: "Erinnerungen sind geprüft.",
  saved: "Einstellungen gespeichert.",
  save: "Speichern",
  reload: "Aktuellen Stand laden",
  conflict:
    "Deine Einstellungen wurden zwischenzeitlich geändert. Lade den aktuellen Stand und wende deine Auswahl erneut an.",
  error: "Das hat nicht geklappt. Deine Änderung wurde nicht bestätigt.",
  claim_confirmed: "Auftrag bestätigt",
  claim_cancelled: "Zuweisung storniert",
  job_reopened: "Auftrag wieder verfügbar",
  job_matching: "Neuer Auftrag zu deinen Themen",
  chat_message: "Neue Chatnachricht",
  forum_reply: "Neue Antwort im Forum",
  session_reminder: "Bevorstehender Unterricht",
  contract_available: "Vertrag verfügbar",
  contract_expiring: "Vertrag läuft aus",
  activity: "Neue Aktivität",
};
const en: Record<keyof typeof de, string> = {
  title: "Notifications",
  description:
    "Your updates and reminders, with links checked against your current access.",
  all: "All",
  unread: "Unread",
  count: "{{count}} unread",
  open: "Open",
  markRead: "Mark as read",
  markUnread: "Mark as unread",
  markAll: "Read all notifications received so far",
  empty: "There are no notifications here right now.",
  unavailable:
    "This content is no longer available or you no longer have access.",
  more: "Load more notifications",
  inbox: "All notifications",
  preferences: "Notification preferences",
  settings: "Settings",
  settingsHelp:
    "Choose which additional notifications you receive in the portal from now on.",
  chat: "New chat messages",
  forum: "Forum replies",
  job_updates: "New job updates",
  reminders: "Session and contract reminders",
  preferenceHelp:
    "These choices apply to new notifications. Booking and cancellation confirmations remain available as receipts. Existing notifications are not deleted.",
  refresh: "Check due reminders",
  refreshHelp:
    "Checks your confirmed sessions in the next 24 hours and contracts expiring within 30 days, at most once a minute. New updates appear in the portal. With email alerts enabled and delivery configured, they are also queued for email.",
  refreshed: "Reminders checked.",
  saved: "Preferences saved.",
  save: "Save",
  reload: "Load current preferences",
  conflict:
    "Your preferences changed elsewhere. Load the current version and apply your choices again.",
  error: "That did not work. Your change was not confirmed.",
  claim_confirmed: "Assignment confirmed",
  claim_cancelled: "Assignment cancelled",
  job_reopened: "Job reopened",
  job_matching: "New job matching your topics",
  chat_message: "New chat message",
  forum_reply: "New forum reply",
  session_reminder: "Upcoming teaching session",
  contract_available: "Contract available",
  contract_expiring: "Contract expiring",
  activity: "New activity",
};
i18n.addResourceBundle("de", "inbox", de);
i18n.addResourceBundle("en", "inbox", en);
