import i18n from "../../lib/i18n";

for (const [language, resource] of Object.entries({
  de: {
    review: "Terminserie prüfen",
    reviewHint:
      "Prüfe die ausgewählten Termine, bevor du sie gemeinsam speicherst.",
    save: "Terminserie speichern",
    invalid:
      "Prüfe die Uhrzeiten, das Ende und die Wiederholung. Die einzelnen Termine dürfen sich nicht überschneiden.",
    conflict:
      "Mindestens ein Termin überschneidet sich mit einem bestätigten Lehrauftrag. Es wurde kein Termin der Serie gespeichert.",
    failed:
      "Die Terminserie konnte nicht bestätigt werden. Du kannst dieselbe Liste erneut speichern.",
    occurrence:
      "Dieser Termin gehört zu einer Serie. Änderungen hier gelten für diesen Termin.",
    cancelFuture: "Künftige Serientermine löschen",
    cancelTitle: "Künftige Termine dieser Serie löschen?",
    cancelHint:
      "Künftige Termine dieser Serie werden gelöscht. Vergangene und bereits begonnene Termine bleiben erhalten.",
    cancelFailed: "Die künftigen Termine konnten nicht gelöscht werden.",
  },
  en: {
    review: "Review recurring appointments",
    reviewHint: "Review the selected appointments before saving them together.",
    save: "Save recurring appointments",
    invalid:
      "Check the time, end and repeat settings. Appointments in the series must not overlap.",
    conflict:
      "At least one appointment overlaps a confirmed assignment. No appointments in the series were saved.",
    failed:
      "The series could not be confirmed. You can retry saving the same list.",
    occurrence:
      "This appointment belongs to a series. Changes here apply to this appointment.",
    cancelFuture: "Delete future appointments in this series",
    cancelTitle: "Delete future appointments in this series?",
    cancelHint:
      "Future appointments in this series will be deleted. Past appointments and appointments in progress will be kept.",
    cancelFailed: "The future appointments could not be deleted.",
  },
})) {
  i18n.addResourceBundle(language, "personalCalendarSeries", resource);
}
