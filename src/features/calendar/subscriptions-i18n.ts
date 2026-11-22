import i18n from "../../lib/i18n";

const de = {
  title: "Kalender abonnieren",
  help: "Verbinde deinen Kalender auf Desktop oder Mobilgerät mit einer persönlichen, nur lesbaren Kalenderadresse. Die Adresse gilt 90 Tage. Der Kalenderanbieter bestimmt, wie oft er Änderungen abruft; Absagen werden dort möglicherweise verzögert sichtbar.",
  secret:
    "Wer diese geheime Adresse kennt, kann die freigegebenen Titel und Zeiten ohne Anmeldung lesen. Gib sie nur an deinen Kalenderanbieter weiter. Die vollständige Adresse wird hier nur in dieser Sitzung bereitgestellt.",
  new: "Kalenderadresse erstellen",
  edit: "Adresse erneuern",
  label: "Name des Kalenderabos",
  private: "Auch meine privaten Termine ausdrücklich freigeben",
  save: "Neue geheime Adresse bestätigen",
  revoke: "Adresse widerrufen",
  revoked: "Widerrufen",
  expiry: "Gültig bis",
  address: "Geheime Kalenderadresse",
  copy: "Adresse kopieren",
  copied: "Adresse wurde kopiert.",
  saved: "Die Kalenderadresse wurde bestätigt.",
  error: "Die Änderung wurde nicht bestätigt. Deine Eingaben bleiben erhalten.",
  conflict:
    "Dieses Kalenderabo wurde geändert. Lade den aktuellen Stand, bevor du es erneut änderst.",
  empty: "Du hast noch keine Kalenderabos.",
  hide: "Geheime Adresse aus dieser Sitzung entfernen",
  rotateHint:
    "Eine Erneuerung macht die bisherige Adresse ungültig. Ersetze die Adresse anschließend auch in deinem Kalenderprogramm.",
  offlineTitle: "Unterrichtsplan offline bereithalten",
  offlineProfileUnavailable:
    "Dein aktuelles Profil kann nicht geprüft werden, solange du offline bist. Hier ist ausschließlich die ausdrücklich gespeicherte Unterrichtsvorschau dieses angemeldeten Kontos verfügbar.",
  offlineHelp:
    "Speichere ausdrücklich eine reduzierte Vorschau deiner nächsten 30 Tage für dieses Konto. Nur bestätigte Unterrichtstitel, Zeiten und Zeitzonen bleiben bis zu sieben Tage auf diesem Gerät. Private Termine, Links, Kontakte, Dateien, Honorare und Nachrichten werden nicht gespeichert.",
  offlineRefresh: "Unterrichtsplan für offline speichern",
  offlineClear: "Offline-Vorschau löschen",
  offlineAsOf: "Gespeichert am",
  offlineExpiry: "Automatisch ungültig ab",
  offlineWarning:
    "Gespeicherte Vorschau: Änderungen und Absagen seit dem letzten Abruf fehlen möglicherweise. Dies ist keine aktuelle Auftragsbestätigung. Verbindliche Änderungen und Übernahmen brauchen eine Online-Verbindung.",
  offlineEmpty:
    "Auf diesem Gerät ist keine gültige Offline-Vorschau für dein Konto gespeichert.",
  offlineSaved: "Die reduzierte Offline-Vorschau wurde gespeichert.",
  offlineError: "Die Offline-Vorschau konnte nicht geändert werden.",
  offlineNoItems:
    "Im gespeicherten Zeitraum sind keine bestätigten Unterrichtstermine enthalten.",
};
const en: Record<keyof typeof de, string> = {
  title: "Subscribe to your calendar",
  help: "Connect your desktop or mobile calendar to a personal read-only feed. The address expires after 90 days. Your calendar provider decides how often it refreshes; cancellations may appear there later.",
  secret:
    "Anyone with this secret address can read the shared titles and times without signing in. Share it only with your calendar provider. The complete address is provided only in this session.",
  new: "Create calendar address",
  edit: "Renew address",
  label: "Calendar subscription name",
  private: "Explicitly include my private events",
  save: "Confirm new secret address",
  revoke: "Revoke address",
  revoked: "Revoked",
  expiry: "Valid until",
  address: "Secret calendar address",
  copy: "Copy address",
  copied: "Address copied.",
  saved: "Calendar address confirmed.",
  error: "Your change was not confirmed. Your entries have been kept.",
  conflict:
    "This calendar subscription changed elsewhere. Load the current version before changing it again.",
  empty: "You have no calendar subscriptions yet.",
  hide: "Remove secret address from this session",
  rotateHint:
    "Renewing invalidates the previous address. Replace the address in your calendar application afterwards.",
  offlineTitle: "Keep your teaching schedule offline",
  offlineProfileUnavailable:
    "Your current profile cannot be checked while you are offline. Only this signed-in account's explicitly saved teaching preview is available here.",
  offlineHelp:
    "Explicitly save a reduced preview of your next 30 days for this account. Only confirmed teaching titles, times and time zones remain on this device for up to seven days. Private events, links, contacts, files, fees and messages are excluded.",
  offlineRefresh: "Save teaching schedule offline",
  offlineClear: "Delete offline preview",
  offlineAsOf: "Saved at",
  offlineExpiry: "Automatically invalid after",
  offlineWarning:
    "Saved preview: changes and cancellations since the last refresh may be missing. This is not a current assignment confirmation. Changes and claims require an online connection.",
  offlineEmpty: "This device has no valid offline preview for your account.",
  offlineSaved: "Reduced offline preview saved.",
  offlineError: "The offline preview could not be changed.",
  offlineNoItems:
    "There are no confirmed teaching sessions in the saved period.",
};
i18n.addResourceBundle("de", "calendarSubscriptions", de);
i18n.addResourceBundle("en", "calendarSubscriptions", en);
