/** Bilingual strings for the SCORM package review, publishing and playback. */
export const scormReviewTexts = {
  scormReviewTitle: ["SCORM-1.2-Paketprüfung", "SCORM 1.2 package review"],
  scormReviewHint: [
    "Die Prüfung liest das Archiv lokal im Browser. Sie zeigt die Kursstruktur und den SHA-256-Fingerabdruck der geprüften ZIP-Datei. Erst die Veröffentlichung startet Upload und Dateiprüfung.",
    "The review reads the archive locally in your browser. It shows the course outline and the SHA-256 fingerprint of the reviewed ZIP file. Publication starts the upload and file scanning.",
  ],
  scormReviewFile: ["SCORM-ZIP auswählen", "Choose SCORM ZIP"],
  scormReviewLimit: [
    "ZIP bis 10 MiB mit imsmanifest.xml im Stammverzeichnis.",
    "ZIP up to 10 MiB with imsmanifest.xml at the root.",
  ],
  scormReviewInspect: ["Paket prüfen", "Review package"],
  scormReviewBusy: [
    "Paketstruktur und Dateiprüfsummen werden geprüft …",
    "Reviewing package structure and file checksums…",
  ],
  scormReviewReady: [
    "Struktur und Prüfsummen geprüft. {{files}} Dateien, {{size}} Byte entpackt.",
    "Structure and checksums reviewed. {{files}} files, {{size}} uncompressed bytes.",
  ],
  scormReviewDigest: ["SHA-256 des Archivs", "Archive SHA-256"],
  scormError_file_size: [
    "Die ZIP-Datei muss zwischen 4 Byte und 10 MiB groß sein.",
    "The ZIP file must be between 4 bytes and 10 MiB.",
  ],
  scormError_invalid_archive: [
    "Die Datei ist kein lesbares ZIP oder enthält beschädigte Einträge.",
    "The file is not a readable ZIP or contains corrupt entries.",
  ],
  scormError_archive_limits: [
    "Das ZIP überschreitet die Prüfgrenzen oder verwendet ein inkompatibles Archivformat.",
    "The ZIP exceeds the review limits or uses an unsupported archive format.",
  ],
  scormError_unsafe_paths: [
    "Das ZIP enthält mehrdeutige Pfade, Links oder verschachtelte Archive.",
    "The ZIP contains ambiguous paths, links or nested archives.",
  ],
  scormError_invalid_manifest: [
    "Das Archiv braucht ein gültiges imsmanifest.xml im Stammverzeichnis.",
    "The archive needs a valid imsmanifest.xml at the root.",
  ],
  scormError_unsupported_manifest: [
    "Für diese Prüfung ist ein SCORM-1.2-Paket mit lokaler HTML-Kursstruktur erforderlich.",
    "This review requires a SCORM 1.2 package with a local HTML course outline.",
  ],
  scormPublishHelp: [
    "Du kannst dieses Paket für den Kurs veröffentlichen, wenn alle Startseiten unterstützte HTML-Inhalte verwenden.",
    "You can publish this package to the course if all launch pages use supported HTML content.",
  ],
  scormPublish: ["Paket veröffentlichen", "Publish package"],
  scormPublishing: [
    "Datei wird geprüft und veröffentlicht …",
    "Scanning and publishing file…",
  ],
  scormPublished: [
    "Paket für den Kurs veröffentlicht.",
    "Package published to the course.",
  ],
  scormCoursePackages: ["SCORM-Lernpakete", "SCORM learning packages"],
  scormOnline: [
    "Lernpakete sind online verfügbar.",
    "Learning packages are available online.",
  ],
  scormNone: [
    "Für diesen Kurs ist kein Lernpaket veröffentlicht.",
    "This course has no published learning package.",
  ],
  scormChoosePackage: ["Lernpaket auswählen", "Choose learning package"],
  scormChooseLesson: ["Lektion auswählen", "Choose lesson"],
  scormProgress: [
    "{{completed}} von {{total}} Lektionen abgeschlossen",
    "{{completed}} of {{total}} lessons completed",
  ],
  scormOpenPackage: ["Lernpaket öffnen", "Open learning package"],
  scormCompleteLesson: ["Lektion abschließen", "Mark lesson complete"],
  scormLessonCompleted: ["Lektion abgeschlossen", "Lesson completed"],
  scormWithdraw: ["Veröffentlichung zurückziehen", "Withdraw publication"],
  scormWithdrawHelp: [
    "Der Kurs kann das Paket danach nicht mehr öffnen. Der gespeicherte Lernfortschritt bleibt erhalten.",
    "The course will lose access to the package. Saved learner progress is retained.",
  ],
  scormConfirmWithdraw: ["Paket zurückziehen", "Withdraw package"],
  scormOpenError: [
    "Das Lernpaket konnte nicht geöffnet werden.",
    "The learning package could not be opened.",
  ],
  scormSaveError: [
    "Die Änderung konnte nicht gespeichert werden.",
    "The change could not be saved.",
  ],
  scormError_unsupported_playback: [
    "Mindestens eine Startseite enthält Inhalte, die dieser Player nicht unterstützt. Verwende einfache HTML-Seiten ohne Skripte, Links oder Medien.",
    "At least one launch page uses content this player does not support. Use simple HTML pages without scripts, links or media.",
  ],
  scormError_missing_resources: [
    "Mindestens eine im Manifest referenzierte Ressource fehlt im ZIP.",
    "At least one resource referenced by the manifest is missing from the ZIP.",
  ],
} satisfies Record<string, [string, string]>;
