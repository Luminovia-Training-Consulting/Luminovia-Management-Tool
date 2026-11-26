/** Bilingual strings for the local, read-only SCORM package inspection. */
export const scormReviewTexts = {
  scormReviewTitle: ["SCORM-1.2-Paketprüfung", "SCORM 1.2 package review"],
  scormReviewHint: [
    "Die Prüfung liest das Archiv lokal im Browser. Sie zeigt die Kursstruktur und den SHA-256-Fingerabdruck der geprüften ZIP-Datei. Upload, Veröffentlichung und Player sind separate Schritte.",
    "The review reads the archive locally in your browser. It shows the course outline and the SHA-256 fingerprint of the reviewed ZIP file. Upload, publication and the player are separate steps.",
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
  scormError_missing_resources: [
    "Mindestens eine im Manifest referenzierte Ressource fehlt im ZIP.",
    "At least one resource referenced by the manifest is missing from the ZIP.",
  ],
} satisfies Record<string, [string, string]>;
