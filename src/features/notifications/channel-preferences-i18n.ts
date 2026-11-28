/** German and English labels for the external delivery table. */
import i18n from "../../lib/i18n";

const de = {
  title: "Benachrichtigungen per E-Mail und Push",
  description:
    "Wähle pro Kategorie, welche Hinweise du zusätzlich per E-Mail oder Push erhalten möchtest. Die Portalauswahl und bei optionalen E-Mails der E-Mail-Hauptschalter gelten weiterhin. Push braucht die Freigabe auf deinem Gerät. Kontozugangs- und Sicherheitsmails laufen separat.",
  category: "Benachrichtigungsart",
  email: "E-Mail",
  push: "Push",
  chat: "Chatnachrichten",
  forum: "Forum",
  job_updates: "Auftragsangebote",
  assignments: "Auftragsbestätigungen und Änderungen",
  courses: "Kursmeldungen",
  events: "Kalendereinladungen und Termine",
  invoices: "Rechnungen und Zahlungen",
  company_orders: "Bestätigungen zu Unternehmensaufträgen",
  reminders: "Erinnerungen und Aufgaben",
  announcements: "Portal-Ankündigungen",
  other: "Weitere zustellbare Meldungen",
  choice: "{{channel}} für {{category}}",
  unavailable: "Nicht verfügbar",
  save: "Versandarten speichern",
  saved: "Versandarten gespeichert.",
  error: "Die Versandarten konnten nicht gespeichert werden.",
  conflict:
    "Die Versandarten wurden parallel geändert. Lade den aktuellen Stand und prüfe deine Auswahl erneut.",
  reload: "Aktuelle Versandarten laden",
};
const en: Record<keyof typeof de, string> = {
  title: "Email and push notifications",
  description:
    "Choose which categories you also want to receive by email or push. Your portal preferences still apply, along with the main email switch for optional emails. Push requires permission on each device. Account access and security emails are sent separately.",
  category: "Notification type",
  email: "Email",
  push: "Push",
  chat: "Chat messages",
  forum: "Forum",
  job_updates: "Job offers",
  assignments: "Assignment confirmations and changes",
  courses: "Course updates",
  events: "Calendar invitations and events",
  invoices: "Invoices and payments",
  company_orders: "Company order confirmations",
  reminders: "Reminders and tasks",
  announcements: "Portal announcements",
  other: "Other deliverable updates",
  choice: "{{channel}} for {{category}}",
  unavailable: "Unavailable",
  save: "Save delivery choices",
  saved: "Delivery choices saved.",
  error: "Your delivery choices could not be saved.",
  conflict:
    "The delivery choices changed elsewhere. Load the current version and review your selection.",
  reload: "Load current delivery choices",
};
i18n.addResourceBundle("de", "channelDelivery", de);
i18n.addResourceBundle("en", "channelDelivery", en);
