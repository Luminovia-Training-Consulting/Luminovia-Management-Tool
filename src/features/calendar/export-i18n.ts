import i18n from "../../lib/i18n";

const de = {
  title: "Kalenderdatei exportieren",
  help: "Lade deine bestätigten Unterrichtstermine für einen Monat als ICS-Datei herunter. Die Datei lässt sich etwa in Google Kalender, Outlook oder Apple Kalender importieren. Es handelt sich um einen aktuellen Auszug; spätere Änderungen werden nicht automatisch übertragen.",
  month: "Exportmonat",
  private: "Eigene private Kalendereinträge einschließen",
  privacy:
    "Die heruntergeladene Datei enthält Termintitel und Uhrzeiten. Beim Import gibst du diese Daten an den gewählten Kalenderanbieter weiter.",
  download: "ICS-Datei herunterladen",
  downloaded: "Die Kalenderdatei wurde zum Download bereitgestellt.",
  calendarName: "Mein Luminovia-Kalender",
  error:
    "Der Kalenderexport ist fehlgeschlagen. Prüfe deine Verbindung und den gewählten Monat. Bei mehr als 500 Terminen ist ein kleinerer Zeitraum erforderlich.",
};
const en: Record<keyof typeof de, string> = {
  title: "Export calendar file",
  help: "Download your confirmed teaching sessions for one month as an ICS file. Import it into Google Calendar, Outlook or Apple Calendar, for example. This is a current snapshot; later changes are not transferred automatically.",
  month: "Export month",
  private: "Include my private calendar entries",
  privacy:
    "The downloaded file contains event titles and times. Importing it shares these details with your chosen calendar provider.",
  download: "Download ICS file",
  downloaded: "The calendar file was prepared for download.",
  calendarName: "My Luminovia calendar",
  error:
    "Calendar export failed. Check your connection and selected month. More than 500 events requires a shorter period.",
};
i18n.addResourceBundle("de", "calendarExport", de);
i18n.addResourceBundle("en", "calendarExport", en);
