import i18n from "../../lib/i18n";

const de = {
  title: "E-Mail-Benachrichtigungen",
  intro:
    "Neue versandfähige Hinweise gehen an die bestätigte E-Mail-Adresse deines Kontos. Ohne eigene Auswahl ist der E-Mail-Versand für dein Konto aktiviert. Du kannst ihn hier ausschalten. Vertrauliche Unterlagen bleiben im Portal.",
  enabled: "Zusätzliche Hinweise per E-Mail erhalten",
  quiet: "Versand-Ruhezeiten verwenden",
  start: "Ruhezeit von",
  end: "Ruhezeit bis",
  zone: "Zeitzone der Ruhezeiten",
  help: "Während der Versand-Ruhezeit bleiben Meldungen im Portal sichtbar. E-Mail und Push warten bis zum nächsten Versandfenster.",
  validation:
    "Wähle zwei unterschiedliche Uhrzeiten und eine gültige IANA-Zeitzone, zum Beispiel Europe/Berlin.",
  save: "E-Mail-Einstellungen speichern",
  saved: "E-Mail-Einstellungen gespeichert.",
  error:
    "Die E-Mail-Einstellungen konnten nicht gespeichert werden. Deine Auswahl bleibt erhalten.",
  conflict:
    "Die E-Mail-Einstellungen wurden an anderer Stelle geändert. Lade den aktuellen Stand, bevor du erneut speicherst.",
  reload: "Aktuelle E-Mail-Einstellungen laden",
};
const en: Record<keyof typeof de, string> = {
  title: "Email notifications",
  intro:
    "Eligible new alerts go to your confirmed account email address. Email is enabled for accounts without a saved choice. You can switch it off here. Confidential documents stay in the portal.",
  enabled: "Receive additional alerts by email",
  quiet: "Use delivery quiet hours",
  start: "Quiet hours from",
  end: "Quiet hours until",
  zone: "Quiet hours time zone",
  help: "Notifications remain visible in the portal during delivery quiet hours. Email and push wait until the next delivery window.",
  validation:
    "Choose two different times and a valid IANA time zone, such as Europe/Berlin.",
  save: "Save email preferences",
  saved: "Email preferences saved.",
  error: "Email preferences could not be saved. Your choices have been kept.",
  conflict:
    "Email preferences changed elsewhere. Load the current version before saving again.",
  reload: "Load current email preferences",
};
i18n.addResourceBundle("de", "delivery", de);
i18n.addResourceBundle("en", "delivery", en);
