/** Load course policy wording with the online-only policy controls. */
import i18n from "../../lib/i18n";

const messages = {
  completionPolicyTitle: [
    "Abschlussregeln verwalten",
    "Manage completion rules",
  ],
  completionPolicyNew: [
    "Für neue Einschreibungen gelten die zuletzt veröffentlichten Regeln.",
    "New enrolments use the most recently published rules.",
  ],
  completionPolicyLatest: [
    "Zuletzt veröffentlicht: Fassung {{version}}",
    "Latest published version: {{version}}",
  ],
  completionPolicyPublish: [
    "Abschlussregeln veröffentlichen",
    "Publish completion rules",
  ],
  completionPolicyAttendance: [
    "Mindestanwesenheit je Termin (%)",
    "Minimum attendance per session (%)",
  ],
  completionPolicyAssignment: [
    "Abgabe mit freigegebener Bewertung",
    "Assignment with released assessment",
  ],
  completionPolicyCompetency: [
    "Erforderliche Kompetenz",
    "Required competency",
  ],
  completionPolicyCompetencyLevel: [
    "Mindestens erforderliche Kompetenzstufe",
    "Minimum competency level",
  ],
  completionPolicyCurrent: [
    "Diese Fassung ist der Einschreibung zugeordnet.",
    "This enrolment already uses the current policy.",
  ],
  completionPolicyPin: [
    "Einschreibung auf Fassung {{version}} umstellen",
    "Move enrolment to version {{version}}",
  ],
  completionPolicyPastCompetency: [
    "Diese Regel bezieht sich auf eine frühere Kompetenzfassung. Wähle die Anforderung aus der aktuellen Fassung erneut aus.",
    "The rule refers to an earlier competency revision. Choose the requirement from the current revision.",
  ],
  completionPolicyRequireLecturer: [
    "Verifikation durch das Kursteam verlangen",
    "Require course-staff verification",
  ],
  completionPolicyTarget: [
    "Optionaler Zieltermin ({{zone}})",
    "Optional target date ({{zone}})",
  ],
  completionPolicyTargetHelp: [
    "Der Zieltermin dient der Planung.",
    "The target date is for planning.",
  ],
  completionPolicyTargetShow: ["Zieltermin: {{date}}", "Target date: {{date}}"],
  completionPolicyNoAdditional: [
    "Keine zusätzliche Anforderung",
    "No additional requirement",
  ],
  completionPolicyVersion: [
    "Abschlussregeln, Fassung {{version}}",
    "Completion rules, version {{version}}",
  ],
  completionPolicyLegacy: [
    "Diese Einschreibung nutzt die bisherigen Abschlussregeln.",
    "This enrolment uses the original completion rules.",
  ],
  completionPolicyVerifyTitle: [
    "Abschluss für die Einschreibung verifizieren",
    "Verify completion for the enrolment",
  ],
  completionPolicyReason: [
    "Begründung für das Kursteam",
    "Reason for course staff",
  ],
  completionPolicyVerify: ["Verifikation bestätigen", "Confirm verification"],
  completionPolicyUnverify: [
    "Verifikation zurücknehmen",
    "Withdraw verification",
  ],
  completionPolicyVerificationMet: [
    "Verifikation durch das Kursteam erteilt",
    "Verification confirmed by course staff",
  ],
  completionPolicyVerificationPending: [
    "Verifikation durch das Kursteam steht aus",
    "Course-staff verification is outstanding",
  ],
  completionPolicyAssignmentMet: [
    "Aufgabe bewertet und freigegeben: {{title}}",
    "Assignment assessed and released: {{title}}",
  ],
  completionPolicyAssignmentPending: [
    "Freigegebene Bewertung steht aus: {{title}}",
    "Released assessment is outstanding: {{title}}",
  ],
  completionPolicyAssignmentException: [
    "Ausnahme für die erforderliche Aufgabe erteilt: {{title}}",
    "Exception granted for the required assignment: {{title}}",
  ],
  completionPolicyCompetencyMet: [
    "Kompetenzstufe erreicht: {{title}} · {{level}}",
    "Competency level reached: {{title}} · {{level}}",
  ],
  completionPolicyCompetencyPending: [
    "Kompetenzstufe steht aus: {{title}} · {{level}}",
    "Competency level is outstanding: {{title}} · {{level}}",
  ],
  completionPolicyCompetencyException: [
    "Ausnahme für die erforderliche Kompetenz erteilt: {{title}} · {{level}}",
    "Exception granted for the required competency: {{title}} · {{level}}",
  ],
  completionPolicyExceptions: [
    "Individuelle Ausnahmen",
    "Individual exceptions",
  ],
  completionPolicyAssignmentExceptionTitle: [
    "Ausnahme für die Aufgabe",
    "Assignment exception",
  ],
  completionPolicyCompetencyExceptionTitle: [
    "Ausnahme für die Kompetenz",
    "Competency exception",
  ],
  completionPolicyGrantException: ["Ausnahme erteilen", "Grant exception"],
  completionPolicyWithdrawException: [
    "Ausnahme zurücknehmen",
    "Withdraw exception",
  ],
  completionPolicyCompetencyChanged: [
    "Die Kompetenzfassung wurde geändert. Das Kursteam kann eine passende Abschlussregel zuordnen.",
    "The competency revision has changed. Course staff can assign a matching completion policy.",
  ],
  completionPolicyConflict: [
    "Der Stand hat sich geändert. Prüfe die aktuelle Fassung vor dem nächsten Speichern.",
    "The record changed. Review the current version before saving again.",
  ],
  completionPolicyInvalid: [
    "Prüfe die Angaben und wähle eine eindeutige lokale Uhrzeit.",
    "Check the fields and choose an unambiguous local time.",
  ],
} as const;

for (const [locale, column] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    locale,
    "learning",
    Object.fromEntries(
      Object.entries(messages).map(([key, label]) => [key, label[column]]),
    ),
    true,
  );
}
