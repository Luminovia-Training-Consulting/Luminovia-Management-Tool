import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  evaluations: ["Kursbewertungen", "Course evaluations"],
  evaluationIncomplete: [
    "Die Bewertungen öffnen nach dem letzten Kurstermin.",
    "Evaluations open after the final course session.",
  ],
  evaluationTarget: [
    "Wen oder was bewertest du?",
    "Who or what are you evaluating?",
  ],
  "evaluationRater.learner": ["Teilnehmende", "Participants"],
  "evaluationRater.company": ["Unternehmen", "Company"],
  "evaluationRater.lecturer": ["Dozierende", "Instructors"],
  "evaluationKind.lecturer": ["Dozent:in", "Instructor"],
  "evaluationKind.company": ["Unternehmen", "Company"],
  "evaluationKind.course": ["Kursniveau", "Course difficulty"],
  "evaluationKind.class": ["Klasse", "Class"],
  evaluationFormerSubject: ["Früherer Eintrag", "Former subject"],
  evaluationAs: ["{{subject}} · als {{role}}", "{{subject}} · as {{role}}"],
  evaluationScore: ["Punktzahl", "Score"],
  evaluationDifficulty: ["Anspruch des Kurses", "Course difficulty"],
  evaluationSelectScore: ["Bitte auswählen", "Select a score"],
  "evaluationDifficulty.1": ["1 · Sehr leicht", "1 · Very easy"],
  "evaluationDifficulty.2": ["2 · Leicht", "2 · Easy"],
  "evaluationDifficulty.3": ["3 · Mittel", "3 · Moderate"],
  "evaluationDifficulty.4": ["4 · Anspruchsvoll", "4 · Challenging"],
  "evaluationDifficulty.5": ["5 · Sehr anspruchsvoll", "5 · Very challenging"],
  evaluationComment: ["Kommentar (optional)", "Comment (optional)"],
  evaluationCommentHint: [
    "Berechtigte sehen deinen Kommentar ohne Absender. Beschreibe deine Erfahrung sachlich und lasse Namen und persönliche Angaben weg.",
    "People with access can read your comment without a byline. Describe your experience in factual terms and omit names and personal details.",
  ],
  evaluationSave: ["Bewertung speichern", "Save evaluation"],
  evaluationSaving: ["Bewertung wird gespeichert …", "Saving evaluation…"],
  evaluationSaved: ["Bewertung gespeichert.", "Evaluation saved."],
  evaluationSaveError: [
    "Die Bewertung konnte nicht gespeichert werden.",
    "Could not save the evaluation.",
  ],
  evaluationConflict: [
    "Diese Bewertung wurde inzwischen geändert. Lade die aktuelle Fassung, bevor du erneut speicherst.",
    "This evaluation changed. Reload the current revision before saving again.",
  ],
  evaluationReload: ["Aktuelle Bewertung laden", "Reload current evaluation"],
  evaluationMine: ["Deine Bewertungen", "Your evaluations"],
  evaluationResults: [
    "Bewertungen aus dem Kurs",
    "Evaluations from this course",
  ],
  evaluationEmpty: [
    "Für deine Kursansicht sind noch keine Bewertungen vorhanden.",
    "No evaluations are available for your course view yet.",
  ],
  evaluationAverage_one: [
    "{{average}} von 5 · {{count}} Bewertung",
    "{{average}} out of 5 · {{count}} evaluation",
  ],
  evaluationAverage_other: [
    "{{average}} von 5 · {{count}} Bewertungen",
    "{{average}} out of 5 · {{count}} evaluations",
  ],
  evaluationComments: ["Kommentare", "Comments"],
  evaluationCommentsEmpty: [
    "Es gibt keine Kommentare.",
    "There are no comments.",
  ],
  evaluationPrevious: ["Vorherige Seite", "Previous page"],
  evaluationNext: ["Nächste Seite", "Next page"],
};

for (const [index, locale] of ["de", "en"].entries()) {
  i18n.addResourceBundle(
    locale,
    "learning",
    Object.fromEntries(
      Object.entries(pairs).map(([key, values]) => [key, values[index]]),
    ),
    true,
    true,
  );
}
