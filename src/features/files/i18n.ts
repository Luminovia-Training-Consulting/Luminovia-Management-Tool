import i18n from "../../lib/i18n";
const pairs: Record<string, [string, string]> = {
  title: ["Dateizentrale", "File centre"],
  description: [
    "Materialien und persönliche Dokumente sicher an einem Ort.",
    "Keep materials and personal documents together securely.",
  ],
  upload: ["Datei hochladen", "Upload file"],
  choose: ["Datei auswählen", "Choose file"],
  types: [
    "PDF, Bilder, TXT und Office-Dateien · bis 100 MiB. Jede Datei wird vor der Freigabe geprüft.",
    "PDF, images, TXT and Office files · up to 100 MiB. Every file is scanned before release.",
  ],
  scope: ["Freigabe", "Sharing"],
  personal: ["Nur persönlich", "Personal only"],
  room: ["Chat-Mitglieder", "Chat members"],
  job_before: ["Vor der Übernahme sichtbar", "Visible before claiming"],
  job_after: ["Nach der Übernahme sichtbar", "Visible after claiming"],
  kind: ["Kategorie", "Category"],
  material: ["Material", "Material"],
  cv: ["Lebenslauf", "CV"],
  certificate: ["Qualifikationsnachweis", "Qualification evidence"],
  contract: ["Vertrag", "Contract"],
  invoice: ["Rechnung", "Invoice"],
  avatar: ["Profilbild", "Profile picture"],
  chat: ["Chat-Anhang", "Chat attachment"],
  file: ["Datei", "File"],
  download: ["Herunterladen", "Download"],
  preview: ["Vorschau", "Preview"],
  rename: ["Umbenennen", "Rename"],
  archive: ["Archivieren", "Archive"],
  archiveTitle: ["Datei archivieren?", "Archive file?"],
  archiveDescription: [
    "{{name}} ist danach nicht mehr verfügbar. Bestehende Versionen bleiben für die Aufbewahrung erhalten.",
    "{{name}} will no longer be available. Existing versions are retained for record keeping.",
  ],
  name: ["Dateiname", "File name"],
  versions: ["Versionen", "Versions"],
  version: ["Version {{number}}", "Version {{number}}"],
  clean: ["Geprüft", "Scanned"],
  quarantined: ["In Quarantäne", "Quarantined"],
  scanning: ["Wird geprüft", "Scanning"],
  scan_error: ["Prüfung ausstehend", "Scan pending"],
  rejected: ["Gesperrt", "Rejected"],
  empty: ["Noch keine Dateien vorhanden.", "No files yet."],
  search: ["Dateien suchen", "Search files"],
  uploading: [
    "Übertragung {{percent}} % · anschließend Sicherheitsprüfung",
    "Uploading {{percent}}% · security scan follows",
  ],
  saved: ["Datei gespeichert und geprüft.", "File stored and scanned."],
  file_size: [
    "Die Datei muss zwischen 1 Byte und 100 MiB groß sein.",
    "Files must be between 1 byte and 100 MiB.",
  ],
  unsupported_type: [
    "Dateityp oder Inhalt wird nicht unterstützt.",
    "The file type or content is not supported.",
  ],
  scan_rejected: [
    "Die Sicherheitsprüfung hat diese Datei gesperrt. Sie kann nicht heruntergeladen werden.",
    "The security scan rejected this file. It cannot be downloaded.",
  ],
  scanner_unavailable: [
    "Die Sicherheitsprüfung ist nicht erreichbar. Die Datei bleibt in Quarantäne. Bitte später erneut versuchen.",
    "The scanner is unavailable. The file remains quarantined. Please retry later.",
  ],
  error: [
    "Die Dateianfrage ist fehlgeschlagen oder der Zugriff wurde entzogen.",
    "The file request failed or access was revoked.",
  ],
  replace: ["Neue Version hochladen", "Upload a new version"],
  uploaded: ["Hochgeladen", "Uploaded"],
  noPreview: [
    "Für diesen Dateityp steht der sichere Download zur Verfügung.",
    "Use the secure download for this file type.",
  ],
  view: ["Datei öffnen", "Open file"],
};
for (const lng of ["de", "en"] as const)
  i18n.addResourceBundle(
    lng,
    "files",
    Object.fromEntries(
      Object.entries(pairs).map(([k, v]) => [k, v[lng === "de" ? 0 : 1]]),
    ),
    true,
    true,
  );
