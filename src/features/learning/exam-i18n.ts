import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  title: ["Kursprüfung", "Course exam"],
  required: ["Prüfung erforderlich", "Exam required"],
  notRequired: ["Keine Prüfung erforderlich", "No exam required"],
  settingHelp: [
    "Mit dieser Einstellung legst du fest, ob Teilnehmende die Prüfungsdateien des Kurses sehen.",
    "This setting controls whether participants can see the course exam files.",
  ],
  learnerPublication: [
    "Nach erfolgreicher Dateiprüfung können eingeschriebene Teilnehmende diese PDF sofort herunterladen.",
    "Enrolled participants can download this PDF as soon as its scan succeeds.",
  ],
  learnerPublicationOff: [
    "Die geprüfte PDF wird für diesen Kurs gespeichert. Teilnehmende sehen sie, sobald eine Prüfung erforderlich ist.",
    "The scanned PDF is saved for this course. Participants can see it once the exam is required.",
  ],
  saveSetting: ["Prüfungseinstellung speichern", "Save exam setting"],
  upload: ["PDF hochladen und freigeben", "Upload and share PDF"],
  studentUploadFile: [
    "Neue Prüfungsaufgaben (PDF)",
    "New student exam paper (PDF)",
  ],
  answerKeyFile: ["Neuer Lösungsschlüssel (PDF)", "New answer key (PDF)"],
  scanAnswerKey: [
    "Lösungsschlüssel prüfen und für das Kursteam freigeben",
    "Scan and publish for course staff",
  ],
  withdrawNamed: ["Freigabe von {{name}} zurückziehen", "Withdraw {{name}}"],
  scanStudentPdf: [
    "Prüfungsdatei prüfen und freigeben",
    "Scan and publish exam paper",
  ],
  scanningStudentPdf: ["Prüfungsdatei wird geprüft …", "Scanning exam paper…"],
  publishingStudentPdf: [
    "Geprüfte Prüfungsdatei wird freigegeben …",
    "Publishing scanned exam paper…",
  ],
  retryStudentPublication: [
    "Freigabe der geprüften Datei erneut versuchen",
    "Retry publishing scanned exam paper",
  ],
  studentPublicationFailed: [
    "Die Datei ist geprüft. Versuche die Freigabe erneut.",
    "The PDF was scanned. Retry publishing the same version.",
  ],
  studentScanFailed: [
    "Die Dateiprüfung konnte nicht bestätigt werden. Prüfe PDF, Größe und Verbindung.",
    "The scan could not be confirmed. Check the PDF, file size and connection.",
  ],
  file: ["Prüfungsdatei (PDF)", "Exam file (PDF)"],
  retainedPdf: [
    "Bereits geprüfte Prüfungsdatei",
    "Previously scanned exam paper",
  ],
  selectRetainedPdf: [
    "Geprüfte PDF-Fassung auswählen",
    "Select a scanned PDF version",
  ],
  publishRetainedPdf: ["Prüfungsdatei freigeben", "Publish exam paper"],
  noRetainedPdf: [
    "Keine eigene geprüfte PDF-Fassung zur Freigabe verfügbar.",
    "No scanned PDF version of your own is available to publish.",
  ],
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
  conflict: [
    "Die Prüfungseinstellung wurde inzwischen geändert. Lade den Kurs neu, bevor du sie erneut bearbeitest.",
    "The exam setting has changed. Refresh the course before editing it again.",
  ],
  refresh: ["Kurs neu laden", "Refresh course"],
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
