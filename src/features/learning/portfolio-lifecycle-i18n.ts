/** German and English copy for the owner-only portfolio lifecycle. */
import i18n from "../../lib/i18n";

const messages = {
  portfolioReflection: ["Lernreflexion ergänzen", "Add learning reflection"],
  portfolioReflectionGoal: ["Lernziel", "Learning goal"],
  portfolioReflectionOutcome: [
    "Ergebnis und Erkenntnisse",
    "Outcome and insights",
  ],
  portfolioReflectionNextStep: ["Nächster Lernschritt", "Next learning step"],
  portfolioEvidenceHeading: ["Nachweise", "Supporting files"],
  portfolioAttach: ["Nachweis verknüpfen", "Link supporting file"],
  portfolioChooseFile: ["Datei auswählen", "Choose a file"],
  portfolioUploadEvidence: [
    "Datei prüfen und verknüpfen",
    "Scan and link file",
  ],
  portfolioScanningEvidence: ["Datei wird geprüft …", "Scanning file …"],
  portfolioEvidenceHelp: [
    "Bis zu fünf Dateien pro Fassung, jeweils höchstens 10 MiB. Bereits geteilte Fassungen behalten ihre Nachweise.",
    "Up to five files per revision, with a limit of 10 MiB per file. Existing shared revisions keep their supporting files.",
  ],
  portfolioEvidenceLimit: [
    "Diese Fassung kann keine weitere Datei aufnehmen.",
    "This revision cannot accept another file.",
  ],
  portfolioUnlinkEvidence: ["Verknüpfung lösen", "Unlink file"],
  portfolioUnlinkEvidenceNamed: [
    "Verknüpfung für {{name}} lösen",
    "Unlink {{name}}",
  ],
  portfolioDownloadEvidence: ["Herunterladen", "Download"],
  portfolioDownloadEvidenceNamed: [
    "{{name}} herunterladen",
    "Download {{name}}",
  ],
  portfolioEvidenceDownloadError: [
    "Die Datei ist nicht verfügbar.",
    "The file is unavailable.",
  ],
  portfolioEvidenceSizeError: [
    "Die Datei muss zwischen 1 Byte und 10 MiB groß sein.",
    "Choose a file between 1 byte and 10 MiB.",
  ],

  portfolioArchive: ["Eintrag archivieren", "Archive entry"],
  portfolioArchiveConfirm: ["Archivierung bestätigen", "Confirm archive"],
  portfolioArchiveHelp: [
    "Beim Archivieren werden alle Freigaben dieses Eintrags widerrufen.",
    "Archiving revokes every share for this entry.",
  ],
  portfolioRestore: ["Eintrag wiederherstellen", "Restore entry"],
  portfolioShowArchived: [
    "Archivierte Einträge anzeigen",
    "Show archived entries",
  ],
  portfolioArchiveEmpty: ["Dein Archiv ist leer.", "Your archive is empty."],
  portfolioDelete: ["Eintrag löschen", "Delete entry"],
  portfolioDeleteConfirm: ["Endgültig löschen", "Delete permanently"],
  portfolioDeleteHelp: [
    "Alle Fassungen und Freigabebelege dieses Eintrags werden gelöscht.",
    "This removes every revision and share receipt for this entry.",
  ],
  portfolioConfirmTitle: [
    "Titel zur Bestätigung eingeben",
    "Enter the title to confirm",
  ],
};

for (const [index, locale] of ["de", "en"].entries()) {
  i18n.addResourceBundle(
    locale,
    "learning",
    Object.fromEntries(
      Object.entries(messages).map(([key, values]) => [key, values[index]]),
    ),
    true,
    true,
  );
}
