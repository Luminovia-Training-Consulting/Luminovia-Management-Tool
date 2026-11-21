import i18n from "../../lib/i18n";

const de = {
  title: "Ruhezeiten",
  enabled: "Tägliche Ruhezeit aktivieren",
  start: "Beginn der Ruhezeit",
  end: "Ende der Ruhezeit",
  zone: "Zeitzone der Ruhezeit",
  help: "Während der Ruhezeit zählt die Glocke nur ungelesene Buchungs-, Storno- und Vertragshinweise sowie wichtige Portal-Ankündigungen. Alle Meldungen bleiben im Posteingang erhalten.",
  interval:
    "Beginn eingeschlossen, Ende ausgeschlossen; Zeiten über Mitternacht sind möglich. Beginn und Ende müssen verschieden sein.",
  save: "Ruhezeiten speichern",
  saved: "Ruhezeiten gespeichert.",
  invalid: "Prüfe Uhrzeiten und Zeitzone, zum Beispiel Europe/Berlin.",
  conflict:
    "Die Ruhezeiten wurden zwischenzeitlich geändert. Dein Entwurf bleibt erhalten; lade zum Vergleichen den aktuellen Stand.",
  reload: "Aktuelle Ruhezeiten laden",
  error: "Die Ruhezeiten konnten nicht bestätigt werden.",
  active: "Ruhezeit aktiv",
  criticalCount_one: "{{count}} wichtiger ungelesener Hinweis",
  criticalCount_other: "{{count}} wichtige ungelesene Meldungen",
  totalCount: "{{count}} insgesamt ungelesen",
};
const en: Record<keyof typeof de, string> = {
  title: "Quiet hours",
  enabled: "Enable daily quiet hours",
  start: "Quiet hours start",
  end: "Quiet hours end",
  zone: "Quiet hours time zone",
  help: "During quiet hours the bell counter includes only unread booking, cancellation and contract receipts and important portal announcements. All updates remain in your inbox.",
  interval:
    "Start included, end excluded; overnight windows are supported. Start and end must differ.",
  save: "Save quiet hours",
  saved: "Quiet hours saved.",
  invalid: "Check the times and time zone, for example Europe/Berlin.",
  conflict:
    "Quiet hours changed elsewhere. Your draft is retained; load the current version to compare.",
  reload: "Load current quiet hours",
  error: "Quiet hours could not be confirmed.",
  active: "Quiet hours active",
  criticalCount_one: "{{count}} important unread update",
  criticalCount_other: "{{count}} important unread updates",
  totalCount: "{{count}} unread in total",
};
i18n.addResourceBundle("de", "attention", de);
i18n.addResourceBundle("en", "attention", en);
