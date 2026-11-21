/** Course roster commands and the participant's own withdrawal confirmation. */
import i18n from "../../lib/i18n";

const strings = {
  de: {
    enrolmentAdmin: "Kursanmeldungen verwalten",
    enrolmentCurrent: "Anmeldungen",
    enrolmentEmpty: "Für diesen Kurs liegen keine Anmeldungen vor.",
    enrolmentSearch: "Nach Name oder Luminovia User ID suchen",
    enrolmentSearchButton: "Suchen",
    enrolmentCandidate: "Teilnehmende Person",
    enrolmentCandidatePlaceholder: "Person auswählen",
    enrolmentNoCandidates:
      "Keine verfügbaren Firmenzuordnungen für diese Suche. Neue Personen müssen ihre Firmenzuordnung zuerst bestätigen.",
    enrolmentSearchMore:
      "Verfeinere die Suche, wenn die gesuchte Person nicht in den ersten 100 Treffern erscheint.",
    enrolmentEnrol: "Zum Kurs anmelden",
    enrolmentComplete: "Abschluss erfassen",
    enrolmentCompleteFor: "Abschluss erfassen für {{name}}",
    enrolmentRemove: "Kursanmeldung entfernen",
    enrolmentRemoveFor: "Kursanmeldung entfernen für {{name}}",
    enrolmentEnrolled: "Angemeldet",
    enrolmentCompleted: "Abgeschlossen",
    enrolmentRemoved: "Entfernt",
    enrolmentConfirmEnrol: "Möchtest du {{name}} zu diesem Kurs anmelden?",
    enrolmentConfirmComplete:
      "Möchtest du den Kurs für {{name}} als abgeschlossen erfassen?",
    enrolmentConfirmRemove:
      "Möchtest du die Kursanmeldung von {{name}} entfernen? Der aktuelle Kurszugang endet.",
    enrolmentSaved: "Kursanmeldung aktualisiert.",
    enrolmentFailed:
      "Die Änderung wurde nicht bestätigt. Prüfe die aktuelle Firmenzuordnung und versuche es erneut.",
    enrolmentOffline:
      "Verbinde dich mit dem Internet, um Kursanmeldungen zu verwalten.",
    enrolmentReadError: "Die Kursanmeldungen konnten nicht geladen werden.",
    withdrawalWindowFailed: "Die Abmeldefrist konnte nicht geladen werden.",
    withdrawalOpen: "Vom Kurs abmelden",
    withdrawalDeadline: "Abmeldung bis {{date}}",
    withdrawalUnavailable: "Eine Abmeldung ist zurzeit nicht möglich.",
    withdrawalConfirm:
      "Möchtest du dich von {{course}} abmelden? Dein Zugang zu diesem Kurs endet, und dein Firmenkonto bleibt bestehen.",
    withdrawalFailed:
      "Die Abmeldung wurde nicht bestätigt. Prüfe, ob die Frist und deine Anmeldung noch gültig sind.",
    enrolmentConfirm: "Bestätigen",
    enrolmentCancel: "Zurück",
  },
  en: {
    enrolmentAdmin: "Manage course enrolments",
    enrolmentCurrent: "Enrolments",
    enrolmentEmpty: "This course has no enrolments.",
    enrolmentSearch: "Search by name or Luminovia User ID",
    enrolmentSearchButton: "Search",
    enrolmentCandidate: "Participant",
    enrolmentCandidatePlaceholder: "Select a participant",
    enrolmentNoCandidates:
      "No available company participants match this search. New participants need to accept their company association first.",
    enrolmentSearchMore:
      "Refine your search if the person is outside the first 100 results.",
    enrolmentEnrol: "Enrol in this course",
    enrolmentComplete: "Record completion",
    enrolmentCompleteFor: "Record completion for {{name}}",
    enrolmentRemove: "Remove course enrolment",
    enrolmentRemoveFor: "Remove course enrolment for {{name}}",
    enrolmentEnrolled: "Enrolled",
    enrolmentCompleted: "Completed",
    enrolmentRemoved: "Removed",
    enrolmentConfirmEnrol: "Enrol {{name}} in this course?",
    enrolmentConfirmComplete: "Mark this course as completed for {{name}}?",
    enrolmentConfirmRemove:
      "Remove {{name}} from the course? Their current course access ends.",
    enrolmentSaved: "Course enrolment updated.",
    enrolmentFailed:
      "The change was not confirmed. Check the current company association and try again.",
    enrolmentOffline: "Connect to the internet to manage enrolments.",
    enrolmentReadError: "Could not load course enrolments.",
    withdrawalWindowFailed: "Could not load the withdrawal deadline.",
    withdrawalOpen: "Withdraw from course",
    withdrawalDeadline: "Withdraw by {{date}}",
    withdrawalUnavailable: "Withdrawal is currently unavailable.",
    withdrawalConfirm:
      "Withdraw from {{course}}? Your access to this course ends, and your company account remains active.",
    withdrawalFailed:
      "Your withdrawal was not confirmed. Check the deadline and your current enrolment.",
    enrolmentConfirm: "Confirm",
    enrolmentCancel: "Back",
  },
};
for (const [locale, resources] of Object.entries(strings)) {
  i18n.addResourceBundle(locale, "learning", resources, true, false);
}
