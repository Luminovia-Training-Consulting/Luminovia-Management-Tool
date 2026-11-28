/** Labels for the native text exam in both supported portal languages. */
import i18n from "../../lib/i18n";

const labels = {
  title: ["Freitextprüfung", "Text exam"],
  offline: [
    "Freitextprüfungen sind online verfügbar.",
    "Text exams are available online.",
  ],
  secondReviewer: [
    "Freigabe durch eine zweite Lehrkraft verlangen",
    "Require a second course staff member to publish grades",
  ],
  extraTime: ["Zusatzzeit verwalten", "Manage extra time"],
  extraTimeHint: [
    "Lege die Zusatzzeit vor Beginn für diese Prüfung fest. Mit 0 Minuten gilt die reguläre Abgabefrist.",
    "Set extra time for this exam before it opens. Use 0 minutes for the standard deadline.",
  ],
  extraTimeCandidate: [
    "Teilnehmende Person für Zusatzzeit",
    "Learner receiving extra time",
  ],
  extraTimeSelect: ["Person auswählen", "Select a learner"],
  extraMinutes: ["Zusatzzeit in Minuten", "Extra time in minutes"],
  saveExtraTime: ["Zusatzzeit speichern", "Save extra time"],
  awaitingSecondReviewer: [
    "Eine zweite Lehrkraft muss diese Bewertung freigeben.",
    "A second course staff member must release this assessment.",
  ],
  exportGrades: [
    "Freigegebene Prüfungsnoten als CSV",
    "Export released exam grades as CSV",
  ],
  exporting: ["Prüfungsnoten werden exportiert …", "Exporting exam grades…"],
  exportFailed: [
    "Prüfungsnoten konnten nicht exportiert werden.",
    "Exam grades could not be exported.",
  ],
  readOnly: ["Diese Prüfung ist im Lesemodus.", "This exam is read-only."],
  noExam: [
    "Hier ist noch keine Freitextprüfung veröffentlicht.",
    "No text exam has been published here yet.",
  ],
  questions: ["Aufgaben ansehen", "View questions"],
  editor: ["Prüfungsentwurf bearbeiten", "Edit exam draft"],
  name: ["Prüfungstitel", "Exam title"],
  start: ["Öffnet", "Opens"],
  end: ["Schließt", "Closes"],
  deadline: ["Abgabefrist", "Submission deadline"],
  zone: ["Zeitzone des Kurses: {{zone}}", "Course time zone: {{zone}}"],
  threshold: ["Bestehensgrenze (%)", "Passing threshold (%)"],
  number: ["Aufgabe {{number}}", "Question {{number}}"],
  prompt: ["Aufgabentext", "Question prompt"],
  points: ["Maximale Punktzahl", "Maximum points"],
  max: ["Maximal {{points}} Punkte", "Maximum {{points}} points"],
  add: ["Aufgabe hinzufügen", "Add question"],
  remove: ["Aufgabe {{number}} entfernen", "Remove question {{number}}"],
  saveDraft: ["Entwurf speichern", "Save draft"],
  publish: ["Prüfung veröffentlichen", "Publish exam"],
  publishPrompt: [
    "Nach der Veröffentlichung bleibt diese Version erhalten. Lernende sehen die Aufgaben ab dem Startzeitpunkt.",
    "This version is retained after publication. Learners see the questions when the exam opens.",
  ],
  cancel: ["Abbrechen", "Cancel"],
  versionChoice: ["Prüfungsversion", "Exam version"],
  current: ["Aktuelle Prüfung", "Current exam"],
  versionLabel: [
    "{{title}} (Version {{number}})",
    "{{title}} (version {{number}})",
  ],
  draftVersion: ["Entwurf", "Draft"],
  publishedVersion: ["Veröffentlicht", "Published"],
  draftAfterPublish: [
    "Für einen weiteren Termin kannst du einen neuen Entwurf anlegen.",
    "You can save a new draft for another sitting.",
  ],
  notOpen: [
    "Die Aufgaben sind verfügbar, sobald die Prüfung öffnet.",
    "Questions are available when the exam opens.",
  ],
  closed: [
    "Die Abgabefrist ist abgelaufen.",
    "The submission deadline has passed.",
  ],
  answer: ["Antwort zu Aufgabe {{number}}", "Answer to question {{number}}"],
  notSubmitted: [
    "Gespeicherte Entwürfe gelten als offen, bis du sie verbindlich abgibst.",
    "Saved drafts remain open until you submit them.",
  ],
  answerConflict: [
    "Die gespeicherten Antworten wurden in einer anderen Sitzung geändert. Deine Eingaben sind weiterhin sichtbar und können kopiert werden.",
    "Saved answers changed in another session. Your edits are still visible and can be copied.",
  ],
  useSavedAnswers: ["Gespeicherte Antworten laden", "Use saved answers"],
  unsavedAnswers: [
    "Du hast ungespeicherte Antworten. Speichere den Entwurf, bevor du die Seite verlässt.",
    "You have unsaved answers. Save your draft before leaving the page.",
  ],
  submit: ["Prüfung abgeben", "Submit exam"],
  submitPrompt: [
    "Möchtest du deine Antworten verbindlich abgeben? Danach kannst du sie nicht mehr ändern.",
    "Submit your final answers? You cannot change them after submission.",
  ],
  submitted: ["Abgegeben am {{date}}", "Submitted on {{date}}"],
  submissions: ["Abgaben", "Submissions"],
  noSubmission: [
    "Für diese Prüfung gibt es noch keine Abgaben.",
    "There are no submissions for this exam yet.",
  ],
  selectLearner: [
    "Abgabe zur Bewertung auswählen",
    "Select a submission for review",
  ],
  previous: ["Zurück", "Previous"],
  next: ["Weiter", "Next"],
  candidate: ["Teilnehmende Person", "Learner"],
  ungraded: ["Unbewertet", "Ungraded"],
  draft: ["Bewertungsentwurf", "Review draft"],
  released: ["Freigegeben", "Released"],
  awarded: ["Vergebene Punkte", "Points awarded"],
  feedback: ["Rückmeldung", "Feedback"],
  saveReview: ["Bewertungsentwurf speichern", "Save review draft"],
  release: ["Bewertung freigeben", "Release grade"],
  releasePrompt: [
    "Die Rückmeldung und Punktzahl werden für diese Person sichtbar.",
    "The score and feedback become visible to this learner.",
  ],
  waitsForDeadline: [
    "Die Bewertung kann nach Ende aller Abgabefristen beginnen.",
    "Review opens after all submission deadlines have passed.",
  ],
  awaitingGrade: [
    "Die Bewertung steht noch aus.",
    "The grade has not been released yet.",
  ],
  result: ["{{score}} von {{max}} Punkten", "{{score}} out of {{max}} points"],
  passed: ["Bestanden", "Passed"],
  failed: ["Nicht bestanden", "Failed"],
  saved: ["Gespeichert.", "Saved."],
  invalid: [
    "Prüfe die Eingaben und die Prüfungszeiten.",
    "Check the entries and exam times.",
  ],
  saveError: [
    "Änderung konnte nicht gespeichert werden.",
    "The change could not be saved.",
  ],
  conflict: [
    "Die Version oder der Prüfungszeitraum hat sich geändert. Lade die aktuelle Ansicht.",
    "The version or exam window changed. Load the current view.",
  ],
  reload: ["Aktuelle Ansicht laden", "Load current view"],
} as const;

for (const [index, locale] of ["de", "en"].entries())
  i18n.addResourceBundle(
    locale,
    "textExam",
    Object.fromEntries(
      Object.entries(labels).map(([key, values]) => [key, values[index]]),
    ),
    true,
    true,
  );
