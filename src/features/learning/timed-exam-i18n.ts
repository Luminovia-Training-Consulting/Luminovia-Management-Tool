import i18n from "../../lib/i18n";

const copy = {
  title: ["Klausur planen", "Schedule exam"],
  paperName: ["Klausurname", "Exam name"],
  visible: ["Ankündigung sichtbar ab", "Show announcement from"],
  starts: ["Bearbeitung beginnt", "Exam opens"],
  ends: ["Abgabeschluss", "Submission deadline"],
  pass: ["Bestanden ab (%)", "Pass threshold (%)"],
  save: ["Zeitfenster speichern", "Save exam schedule"],
  hint: [
    "Das PDF und die Abgabe sind erst zwischen Start und Abgabeschluss verfügbar. Start und Ende müssen in den Kurstagen liegen.",
    "The PDF and submission are available between the start and deadline. Both must be within the course dates.",
  ],
  requiredSchedule: [
    "Speichere zuerst das Zeitfenster, um das Aufgabenblatt freizugeben.",
    "Save the exam schedule before publishing the paper.",
  ],
  upcoming: [
    "Die Bearbeitung hat noch nicht begonnen.",
    "The exam has not opened yet.",
  ],
  ended: ["Das Zeitfenster ist beendet.", "The exam window has closed."],
  file: ["Ausgefüllte Klausur", "Completed exam"],
  stage: ["Datei hochladen", "Upload file"],
  scanReady: [
    "Datei geprüft. Bestätige jetzt die Abgabe.",
    "File checked. Confirm the submission now.",
  ],
  submit: ["Verbindlich abgeben", "Submit exam"],
  submitted: ["Abgegeben am {{date}}", "Submitted on {{date}}"],
  working: ["Wird verarbeitet …", "Working…"],
  saved: ["Gespeichert.", "Saved."],
  failed: [
    "Vorgang konnte nicht bestätigt werden. Prüfe Angaben, Zeitfenster und Zugriffsrechte.",
    "The operation could not be confirmed. Check the details, exam window and access.",
  ],
  grading: ["Klausurbewertungen", "Exam grades"],
  grade: ["Erreicht (%)", "Score (%)"],
  saveDraft: ["Bewertungen speichern", "Save grades"],
  publish: ["Bewertungen veröffentlichen", "Publish grades"],
  publishHint: [
    "Veröffentlichte Bewertungen sind für die jeweiligen Teilnehmenden und berechtigte Unternehmen sichtbar.",
    "Published grades are visible to each participant and authorised company viewers.",
  ],
  published: ["Bewertungen veröffentlicht.", "Grades published."],
  notSubmitted: ["Keine Abgabe", "No submission"],
  downloadSubmission: ["Abgabe herunterladen", "Download submission"],
  results: ["Klausurergebnisse", "Exam results"],
  average: ["Durchschnitt {{score}}", "Average {{score}}"],
  scoped: [
    "Durchschnitt der für dich freigegebenen Kurse.",
    "Average of the course results you can access.",
  ],
  passed: ["Bestanden", "Passed"],
  notPassed: ["Nicht bestanden", "Did not pass"],
  empty: [
    "Keine veröffentlichten Klausurergebnisse.",
    "No published exam results.",
  ],
  learnerProfile: ["Klausurergebnisse von {{name}}", "{{name}}’s exam results"],
} satisfies Record<string, [string, string]>;

for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    language,
    "timedExam",
    Object.fromEntries(
      Object.entries(copy).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
}
