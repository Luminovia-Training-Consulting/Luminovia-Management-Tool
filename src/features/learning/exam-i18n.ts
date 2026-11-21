import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  title: ["Kursprüfung", "Course exam"],
  required: ["Prüfung erforderlich", "Exam required"],
  notRequired: ["Keine Prüfung erforderlich", "No exam required"],
  settingHelp: [
    "Die Einstellung gilt für diesen Kurs. Prüfungs-PDFs werden nach erfolgreicher Prüfung der Datei für Teilnehmende sichtbar; Lösungsschlüssel bleiben dem berechtigten Kursteam vorbehalten.",
    "This setting applies to this course. Exam PDFs appear to participants after the file scan succeeds; answer keys remain with the authorised course team.",
  ],
  saveSetting: ["Prüfungseinstellung speichern", "Save exam setting"],
  upload: ["PDF hochladen und freigeben", "Upload and share PDF"],
  file: ["Prüfungsdatei (PDF)", "Exam file (PDF)"],
  audience: ["Dokumenttyp", "Document type"],
  students: ["Aufgaben für Teilnehmende", "Student exam paper"],
  exam_staff: ["Lösungsschlüssel für das Kursteam", "Course team answer key"],
  empty: [
    "Noch keine Prüfungsdatei freigegeben.",
    "No exam PDF is shared yet.",
  ],
  download: ["PDF herunterladen", "Download PDF"],
  remove: ["Freigabe zurücknehmen", "Withdraw share"],
  version: ["Fassung {{version}}", "Version {{version}}"],
  saved: ["Änderung bestätigt.", "Change confirmed."],
  error: [
    "Die Änderung konnte nicht bestätigt werden. Prüfe den aktuellen Kursstand und versuche es erneut.",
    "The change could not be confirmed. Refresh the course and try again.",
  ],
};

for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "learningExams",
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => [key, value[index]]),
    ),
    true,
    true,
  );
