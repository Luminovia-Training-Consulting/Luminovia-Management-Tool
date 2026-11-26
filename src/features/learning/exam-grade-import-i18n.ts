/** Bilingual labels for reviewed timed-exam grade imports. */
import i18n from "../../lib/i18n";

i18n.addResourceBundle("de", "examGradeImport", {
  title: "Prüfungsnoten importieren",
  hint: "Fülle die Spalte score mit ganzen Prozentwerten von 0 bis 100. Prüfe die Änderungen und speichere sie als Entwurf. Verwende danach die Freigabe im Prüfungsnotenbuch.",
  pointsHint:
    "Trage für jede Frage ganze Punkte in die Spalten points_1, points_2 usw. ein. Prüfe die Änderung je Frage und speichere sie als Entwurf. Bestehendes Feedback bleibt erhalten. Die Freigabe erfolgt im jeweiligen Prüfungsversuch.",
  csv: "CSV-Vorlage herunterladen",
  xlsx: "Excel-Vorlage herunterladen",
  templatePart: "Teilnehmende für die Vorlage",
  part: "Teil {{page}} von {{pages}}",
  templateFailed: "Die Vorlage konnte nicht erstellt werden.",
  file: "Notentabelle auswählen",
  reading: "Tabelle wird gelesen …",
  invalid:
    "Prüfe Zeile {{row}}. Verwende die aktuelle Prüfungsvorlage und einen eindeutigen Eintrag je Person.",
  empty: "Die Tabelle enthält keine neuen Noten.",
  preview: "Vorschau der Notenänderungen",
  score: "{{score}} %",
  noScore: "Offen",
  change: "{{before}} → {{after}}",
  replace_one: "{{count}} gespeicherten Entwurf ersetzen",
  replace_other: "{{count}} gespeicherte Entwürfe ersetzen",
  confirm_one: "{{count}} Note als Entwurf speichern",
  confirm_other: "{{count}} Noten als Entwurf speichern",
  saving: "Entwürfe werden gespeichert …",
  stale:
    "Prüfung, Noten oder Teilnehmende haben sich geändert. Lade die aktuelle Vorlage und prüfe die Noten erneut.",
  failed: "Die Noten konnten nicht als Entwurf gespeichert werden.",
  saved_one: "{{count}} Note wurde als Entwurf gespeichert.",
  saved_other: "{{count}} Noten wurden als Entwurf gespeichert.",
});

i18n.addResourceBundle("en", "examGradeImport", {
  title: "Import exam grades",
  hint: "Fill the score column with whole percentages from 0 to 100. Review the changes and save them as drafts. Use the exam gradebook to publish the results.",
  pointsHint:
    "Enter whole points for every question in the points_1, points_2 and subsequent columns. Review the change per question and save it as a draft. Existing feedback is kept. Release grades from each learner’s exam attempt.",
  csv: "Download CSV template",
  xlsx: "Download Excel template",
  templatePart: "Learners to include in the template",
  part: "Part {{page}} of {{pages}}",
  templateFailed: "The template could not be created.",
  file: "Choose grade spreadsheet",
  reading: "Reading spreadsheet …",
  invalid:
    "Check row {{row}}. Use the current exam template and one row per learner.",
  empty: "The spreadsheet contains no new grades.",
  preview: "Preview grade changes",
  score: "{{score}}%",
  noScore: "Pending",
  change: "{{before}} → {{after}}",
  replace_one: "Replace {{count}} saved draft",
  replace_other: "Replace {{count}} saved drafts",
  confirm_one: "Save {{count}} grade as draft",
  confirm_other: "Save {{count}} grades as drafts",
  saving: "Saving drafts …",
  stale:
    "The exam, grades or learners changed. Download the current template and review the grades again.",
  failed: "The draft grades could not be saved.",
  saved_one: "{{count}} grade was saved as draft.",
  saved_other: "{{count}} grades were saved as drafts.",
});
