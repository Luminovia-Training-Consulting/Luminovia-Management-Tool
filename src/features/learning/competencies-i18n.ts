/** German and English workplace labels for framework publication and reported competency decisions. */
import i18n from "../../lib/i18n";

const labels = {
  competencyTitle: ["Kompetenzen", "Competencies"],
  competencyName: ["Name des Kompetenzrahmens", "Framework name"],
  competencyChooseFramework: [
    "Kompetenzrahmen auswählen",
    "Choose a framework",
  ],
  competencyCreateFramework: ["Kompetenzrahmen erstellen", "Create framework"],
  competencyEditFramework: [
    "Neue Rahmenfassung erstellen",
    "Create framework revision",
  ],
  competencySaveFramework: [
    "Rahmenfassung speichern",
    "Save framework revision",
  ],
  competencySetFramework: [
    "Fassung dem Kurs zuordnen",
    "Assign revision to course",
  ],
  competencyFrameworkVersion: [
    "{{title}} · Fassung {{revision}}",
    "{{title}} · revision {{revision}}",
  ],
  competencyNoFramework: [
    "Diesem Kurs ist kein Kompetenzrahmen zugeordnet.",
    "This course has no assigned competency framework.",
  ],
  competencyLevel: ["Stufe", "Level"],
  competencyLevelNamed: ["Stufe {{number}}", "Level {{number}}"],
  competencyAddLevel: ["Stufe hinzufügen", "Add level"],
  competencyItemNamed: ["Kompetenz {{number}}", "Competency {{number}}"],
  competencyItem: ["Kompetenz", "Competency"],
  competencyAddItem: ["Kompetenz hinzufügen", "Add competency"],
  competencyCode: ["Kürzel", "Code"],
  competencyItemTitle: ["Bezeichnung", "Name"],
  competencyRemove: ["Entfernen", "Remove"],
  competencyCancel: ["Bearbeiten abbrechen", "Cancel editing"],
  competencyLearner: ["Teilnehmende Person", "Participant"],
  competencyChoose: ["Bitte wählen", "Select an option"],
  competencyAssessment: ["Kompetenz beurteilen", "Assess competency"],
  competencyEvidence: ["Begründung und Lernnachweis", "Reason and evidence"],
  competencyEvidenceHint: [
    "Die teilnehmende Person sieht diese Begründung und den Leistungsnachweis.",
    "The participant sees this reason and evidence.",
  ],
  competencyIncludeQuiz: [
    "Besten Versuch des aktuell veröffentlichten Quiz als Nachweis speichern",
    "Include the best current published quiz attempt as evidence",
  ],
  competencyAssignment: [
    "Freigegebene Aufgabenbewertung",
    "Released assignment grade",
  ],
  competencyNoAssignment: ["Ohne Aufgabenbewertung", "No assignment grade"],
  competencyAssignmentEvidence: [
    "{{title}} · {{score}} %",
    "{{title}} · {{score}}%",
  ],
  competencyPublishDecision: ["Beurteilung freigeben", "Release assessment"],
  competencyHistory: ["Freigegebene Beurteilungen", "Released assessments"],
  competencyNoDecisions: [
    "Es liegen noch keine Beurteilungen vor.",
    "There are no released assessments.",
  ],
  competencyDecisionVersion: [
    "Beurteilung {{revision}}",
    "Assessment revision {{revision}}",
  ],
  competencyQuizEvidence: [
    "Quizfassung {{version}} · {{score}} %",
    "Quiz revision {{version}} · {{score}}%",
  ],
  competencyConflict: [
    "Die Daten wurden inzwischen geändert. Lade den aktuellen Stand.",
    "The data changed. Reload the latest revision.",
  ],
  competencyInvalid: [
    "Prüfe alle Bezeichnungen, eindeutigen Kürzel und die erforderlichen Angaben.",
    "Check all labels, distinct codes and required entries.",
  ],
  competencyReload: ["Aktuellen Stand laden", "Reload current data"],
  competencyPrevious: ["Vorherige Seite", "Previous page"],
  competencyNext: ["Nächste Seite", "Next page"],
  competencyOffline: [
    "Kompetenzen sind online verfügbar.",
    "Competencies are available online.",
  ],
} as const;

for (const [index, locale] of ["de", "en"].entries()) {
  i18n.addResourceBundle(
    locale,
    "learning",
    Object.fromEntries(
      Object.entries(labels).map(([key, values]) => [key, values[index]]),
    ),
    true,
    true,
  );
}
