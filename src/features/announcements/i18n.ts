import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  title: ["Ankündigungen", "Announcements"],
  manage: ["Ankündigungen verwalten", "Manage announcements"],
  intro: [
    "Aktuelle Hinweise für deine freigegebenen Zielgruppen.",
    "Current notices for your authorized audiences.",
  ],
  adminIntro: [
    "Entwürfe und veröffentlichte Fassungen bleiben getrennt. Zielgruppen richten sich nach aktuellen Kontorollen.",
    "Drafts stay separate from published versions. Audiences use current account roles.",
  ],
  important: ["Wichtig", "Important"],
  information: ["Information", "Information"],
  acknowledge: ["Gelesen, ausblenden", "Read and dismiss"],
  acknowledged: ["Gelesen", "Read"],
  ackError: [
    "Die Bestätigung wurde nicht gespeichert. Der Hinweis bleibt sichtbar.",
    "Acknowledgement was not saved. The notice remains visible.",
  ],
  all: ["Alle Ankündigungen öffnen", "Open all announcements"],
  empty: ["Keine aktuellen Ankündigungen.", "No current announcements."],
  new: ["Ankündigung erstellen", "Create announcement"],
  edit: ["Entwurf bearbeiten", "Edit draft"],
  save: ["Entwurf speichern", "Save draft"],
  publish: ["Jetzt veröffentlichen", "Publish now"],
  archive: ["Archivieren", "Archive"],
  recover: ["Wiederherstellen", "Recover"],
  draft: ["Entwurf", "Draft"],
  published: ["Veröffentlicht", "Published"],
  archived: ["Archiviert", "Archived"],
  hasDraft: ["Neuer Entwurf vorhanden", "New draft available"],
  search: ["Ankündigungen suchen", "Search announcements"],
  filter: ["Status", "Status"],
  allStates: ["Alle Status", "All states"],
  apply: ["Suchen", "Search"],
  next: ["Nächste Seite", "Next page"],
  previous: ["Vorherige Seite", "Previous page"],
  titleDe: ["Titel auf Deutsch", "German title"],
  titleEn: ["Titel auf Englisch", "English title"],
  bodyDe: ["Inhalt auf Deutsch", "German content"],
  bodyEn: ["Inhalt auf Englisch", "English content"],
  start: ["Anzeigen ab", "Display from"],
  end: ["Anzeigen bis", "Display until"],
  zone: ["IANA-Zeitzone", "IANA time zone"],
  audience: ["Zielgruppen", "Audiences"],
  allRoles: [
    "Keine Auswahl bedeutet alle aktiven Konten.",
    "No selection means all active accounts.",
  ],
  importantHint: [
    "Wichtige Veröffentlichungen erzeugen zusätzlich einen einmaligen Inboxhinweis. Informationen erscheinen als Banner und auf dieser Seite.",
    "Important publications also create one inbox notice. Information appears in banners and on this page.",
  ],
  manual: [
    "Ein künftiger Beginn erfordert die manuelle Veröffentlichung, sobald der Zeitpunkt erreicht ist. Es läuft kein Veröffentlichungsscheduler.",
    "A future start requires manual publication when due. No publication scheduler is running.",
  ],
  draftPrivacy: [
    "Das Speichern ändert die aktuell veröffentlichte Fassung nicht. Erst „Jetzt veröffentlichen“ gibt die neue Revision frei.",
    "Saving does not change the current published version. Publish now explicitly releases the new revision.",
  ],
  currentPublished: [
    "Aktuell veröffentlichte Fassung",
    "Current published version",
  ],
  windowError: [
    "Prüfe Inhalte, Zeitzone und einen gültigen Beginn vor dem Ende.",
    "Check the content, time zone and a valid start before the end.",
  ],
  operationError: [
    "Die Änderung wurde nicht bestätigt. Dein Entwurf bleibt erhalten; du kannst es erneut versuchen.",
    "The change was not confirmed. Your draft is preserved; you may retry.",
  ],
  conflict: [
    "Diese Ankündigung wurde inzwischen geändert. Schließe die Bearbeitung und öffne den aktuellen Stand erneut.",
    "This announcement changed. Close the editor and reopen the current version.",
  ],
  saved: [
    "Die Änderung wurde serverseitig bestätigt.",
    "The server confirmed the change.",
  ],
  forbidden: [
    "Für die Verwaltung brauchst du die aktuelle Berechtigung.",
    "Management requires current permission.",
  ],
  unavailable: [
    "Diese Revision ist nicht mehr für dich freigegeben.",
    "This revision is no longer available to you.",
  ],
  owner: ["Inhaberschaft", "Owner"],
  admin: ["Administration", "Administrator"],
  management: ["Management", "Management"],
  senior_lecturer: ["Senior-Dozierende", "Senior lecturer"],
  lecturer: ["Dozierende", "Lecturer"],
  participant: ["Kursteilnehmende", "Course participant"],
  client: ["Unternehmen", "Company"],
};
for (const language of ["de", "en"] as const)
  i18n.addResourceBundle(
    language,
    "announcements",
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => [
        key,
        value[language === "de" ? 0 : 1],
      ]),
    ),
    true,
    true,
  );
