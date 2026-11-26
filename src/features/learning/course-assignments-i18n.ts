/** Bilingual assignment authoring, deadline, submission, and feedback labels. */
const assignmentTexts = {
  assignmentsTitle: ["Kursaufgaben", "Course assignments"],
  assignmentsChoose: ["Aufgabe auswählen", "Choose assignment"],
  assignmentsNew: ["Aufgabe erstellen", "Create assignment"],
  assignmentsEmpty: [
    "Es sind keine Aufgaben verfügbar.",
    "There are no assignments.",
  ],
  assignmentsTitleField: ["Titel der Aufgabe", "Assignment title"],
  assignmentsInstructions: ["Arbeitsauftrag", "Instructions"],
  assignmentsDue: ["Abgabefrist ({{zone}})", "Deadline ({{zone}})"],
  assignmentsAttempts: ["Maximale Abgaben", "Maximum attempts"],
  assignmentsRubric: ["Bewertungsraster", "Rubric"],
  assignmentsCriterion: ["Kriterium {{index}}", "Criterion {{index}}"],
  assignmentsCriterionName: ["Name des Kriteriums", "Criterion name"],
  assignmentsLevel: ["Stufe {{index}}", "Level {{index}}"],
  assignmentsLevelName: ["Name der Stufe", "Level name"],
  assignmentsLevelPoints: ["Punkte dieser Stufe", "Points for this level"],
  assignmentsAddCriterion: ["Kriterium ergänzen", "Add criterion"],
  assignmentsRemoveCriterion: ["Kriterium entfernen", "Remove criterion"],
  assignmentsAddLevel: ["Stufe ergänzen", "Add level"],
  assignmentsRemoveLevel: ["Stufe entfernen", "Remove level"],
  assignmentsSave: ["Entwurf speichern", "Save draft"],
  assignmentsPublish: ["Aufgabe veröffentlichen", "Publish assignment"],
  assignmentsDraft: ["Entwurf {{version}}", "Draft {{version}}"],
  assignmentsPublished: [
    "Version {{version}} veröffentlicht",
    "Version {{version}} published",
  ],
  assignmentsInvalid: [
    "Bitte prüfe die Angaben. Die erste Stufe jedes Kriteriums beginnt bei null. Stufenpunkte müssen steigen, Namen eindeutig sein.",
    "Check the details. Each criterion starts at zero points. Level points must increase and names must be distinct.",
  ],
  assignmentsExtension: ["Fristverlängerung", "Deadline extension"],
  assignmentsTeams: ["Abgabeteams", "Assignment teams"],
  assignmentsTeamChoose: ["Team auswählen", "Choose team"],
  assignmentsTeamNew: ["Neues Team", "New team"],
  assignmentsTeamName: ["Teamname", "Team name"],
  assignmentsTeamDue: [
    "Eigene Teamfrist ({{zone}}, optional)",
    "Team deadline ({{zone}}, optional)",
  ],
  assignmentsTeamMembers: ["Teammitglieder", "Team members"],
  assignmentsTeamNoLearners: [
    "Es sind keine eingeschriebenen Teilnehmenden verfügbar.",
    "No enrolled participants are available.",
  ],
  assignmentsTeamLocked: [
    "Die Mitglieder stehen seit der ersten Teamabgabe fest.",
    "Team membership is fixed after the first team submission.",
  ],
  assignmentsTeamSave: ["Team speichern", "Save team"],
  assignmentsTeamRemove: ["Team entfernen", "Remove team"],
  assignmentsTeamConfirmRemove: [
    "Möchtest du das Team {{title}} entfernen?",
    "Remove the team {{title}}?",
  ],
  assignmentsTeamRemoveConfirm: ["Entfernen bestätigen", "Confirm removal"],
  assignmentsTeamCancel: ["Abbrechen", "Cancel"],
  assignmentsTeamEmpty: [
    "Für diese Aufgabe wurden keine Teams eingerichtet.",
    "No teams have been set up for this assignment.",
  ],
  assignmentsTeamInvalid: [
    "Gib einen Namen, 1 bis 20 Mitglieder und bei Bedarf eine gültige Teamfrist an.",
    "Enter a team name, select 1 to 20 members and check the optional deadline.",
  ],
  assignmentsTeamShared: [
    "Team {{title}}. Dein Team teilt sich die Abgaben und Rückmeldungen.",
    "Team {{title}}. Your team shares submissions and feedback.",
  ],
  assignmentsParticipant: ["Teilnehmende Person", "Participant"],
  assignmentsExtend: ["Verlängerung speichern", "Save extension"],
  assignmentsExtensionCurrent: [
    "Aktuelle Verlängerung: {{time}}",
    "Current extension: {{time}}",
  ],
  assignmentsReview: ["Bewertung und Rückmeldung", "Assessment and feedback"],
  assignmentsStatus: ["Veröffentlichung", "Visibility"],
  assignmentsFeedback: [
    "Rückmeldung für Teilnehmende",
    "Feedback for the participant",
  ],
  assignmentsPrivateNote: [
    "Private Notiz für das Kursteam",
    "Private course-staff note",
  ],
  assignmentsStateDraft: ["Privater Entwurf", "Private draft"],
  assignmentsStateRevision: ["Überarbeitung anfordern", "Request revision"],
  assignmentsStateReleased: ["Freigeben", "Release feedback"],
  assignmentsReviewSave: ["Rückmeldung speichern", "Save feedback"],
  assignmentsReviewed: ["Rückmeldung freigegeben", "Feedback released"],
  assignmentsRevisionRequested: ["Überarbeitung erbeten", "Revision requested"],
  assignmentsWaiting: [
    "Die Rückmeldung steht noch aus.",
    "Feedback is pending.",
  ],
  assignmentsAttempt: ["Abgabe {{number}}", "Attempt {{number}}"],
  assignmentsPoints: [
    "{{points}} / {{max}} Punkte",
    "{{points}} / {{max}} points",
  ],
  assignmentsConflict: [
    "Der Stand hat sich geändert. Lade die Aufgabe neu und prüfe deine Eingaben.",
    "This assignment has changed. Reload to review your changes.",
  ],
  assignmentsNoAccess: [
    "Die Aktion ist für diese Aufgabe derzeit nicht verfügbar.",
    "The action is currently unavailable for this assignment.",
  ],
  assignmentsNoAttempts: [
    "Für diese Aufgabe liegen keine Abgaben vor.",
    "No attempts have been submitted for this assignment.",
  ],
  assignmentsReadOnly: [
    "Aufgaben sind derzeit schreibgeschützt.",
    "Assignments are currently read-only.",
  ],
  assignmentsUnavailable: [
    "Diese Aufgabe kann derzeit nicht abgegeben werden.",
    "This assignment currently does not accept submissions.",
  ],
} satisfies Record<string, [string, string]>;

export default assignmentTexts;
