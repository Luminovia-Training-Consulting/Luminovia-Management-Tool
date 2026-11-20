import i18n from "../../lib/i18n";

const de = {
    title: "E-Mail-Benachrichtigungen",
    intro:
        "Erhalte Hinweise zu neuen Portal-Meldungen an die E-Mail-Adresse deines Kontos. Inhalte und vertrauliche Unterlagen bleiben im Portal.",
    enabled: "Zusätzliche Hinweise per E-Mail erhalten",
    quiet: "Ruhezeiten für E-Mails verwenden",
    start: "Ruhezeit von",
    end: "Ruhezeit bis",
    zone: "Zeitzone der Ruhezeiten",
    help: "Während der Ruhezeit bleiben Meldungen im Portal sichtbar. E-Mails warten bis zum nächsten Versandfenster. Bei aktivierter Zustellung verarbeitet der Server neue Meldungen automatisch.",
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
        "Receive alerts for new portal notifications at your account email address. Content and confidential documents remain in the portal.",
    enabled: "Receive additional alerts by email",
    quiet: "Use email quiet hours",
    start: "Quiet hours from",
    end: "Quiet hours until",
    zone: "Quiet hours time zone",
    help: "Notifications remain visible in the portal during quiet hours. Emails wait until the next delivery window. When delivery is enabled, the server processes new notifications automatically.",
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