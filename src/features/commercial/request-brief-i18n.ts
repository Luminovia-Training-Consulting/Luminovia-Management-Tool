import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
    title: ["Unterrichtsbedarf und Unterlagen", "Teaching brief and documents"],
    units: ["Benötigte Unterrichtseinheiten", "Required teaching units"],
    unitMinutes: ["Dauer je Unterrichtseinheit", "Minutes per teaching unit"],
    minutes: ["{{count}} Minuten", "{{count}} minutes"],
    timeHint: [
        "Unterrichtszeit muss in die geplanten Termine passen. Pausen können zusätzlich eingeplant werden; Preise werden dadurch nicht verändert.",
        "Teaching time must fit within the planned sessions. Sessions may include additional breaks; this does not change prices.",
    ],
    total: [
        "Benötigte Unterrichtszeit: {{minutes}} Minuten",
        "Required teaching time: {{minutes}} minutes",
    ],
    requirements: [
        "Benötigte Unterlagen (eine Anforderung pro Zeile)",
        "Required documents (one requirement per line)",
    ],
    instructions: [
        "Hinweise zur Kursvorbereitung",
        "Course preparation instructions",
    ],
    edit: ["Anforderungsprofil bearbeiten", "Edit teaching brief"],
    save: ["Anforderungen speichern", "Save teaching brief"],
    invalid: [
        "Bitte prüfe ganze Unterrichtseinheiten, Terminlänge und Unterlagen (höchstens 30 Zeilen mit je 300 Zeichen).",
        "Check whole teaching units, session duration and requirements (up to 30 lines, 300 characters each).",
    ],
    failed: [
        "Speichern nicht bestätigt. Deine Eingabe bleibt erhalten. Lade bei einem Versionskonflikt den aktuellen Stand und prüfe ihn vor dem erneuten Speichern.",
        "Save was not confirmed. Your draft is retained. After a version conflict, reload the current version and review it before saving again.",
    ],
    reload: ["Aktuellen Stand neu laden", "Reload current version"],
    saved: ["Anforderungen gespeichert.", "Teaching brief saved."],
    missing: [
        "Für diese ältere Anfrage wurden noch keine Unterrichtseinheiten angegeben.",
        "No teaching units were recorded for this earlier request.",
    ],
    locked: [
        "Nach Veröffentlichung oder Absage ist diese Anfrage schreibgeschützt.",
        "Published or cancelled requests are read-only.",
    ],
    files: ["Freigegebene Anfrageunterlagen", "Shared request documents"],
    fileHint: [
        "Nur eigene, durch den Virenscanner geprüfte Materialien oder Berichte freigeben. Die konkrete Dateiversion wird für diese Organisation freigegeben. Verträge, Lebensläufe, Nachweise und Rechnungen sind hier ausgeschlossen.",
        "Share only your own scanned materials or reports. The exact file version is shared with this organisation. Contracts, CVs, evidence and invoices are excluded here.",
    ],
    upload: [
        "Geprüfte Datei hochladen und freigeben",
        "Upload and share scanned file",
    ],
    file: ["Datei für diese Anfrage", "File for this request"],
    category: ["Art der Freigabe", "Sharing category"],
    material: ["Material", "Material"],
    report: ["Bericht", "Report"],
    remove: ["Freigabe entfernen", "Remove sharing"],
    download: ["Herunterladen", "Download"],
    history: ["Änderungsverlauf der Anfrage", "Request revision history"],
    more: ["Ältere Änderungen laden", "Load earlier changes"],
    noHistory: ["Keine weiteren Änderungen.", "No further revisions."],
    submitted: ["Anfrage eingereicht", "Request submitted"],
    brief_saved: ["Anforderungsprofil gespeichert", "Teaching brief saved"],
    published: ["Anfrage veröffentlicht", "Request published"],
    cancelled: ["Anfrage abgesagt", "Request cancelled"],
    baseline: [
        "Ausgangsstand beim Einführen des Verlaufs",
        "Baseline when history was introduced",
    ],
    revision: ["Version {{version}}", "Version {{version}}"],
    repeatHint: [
        "Bei einer Wiederbuchung werden Unterrichtsbedarf und Anforderungen übernommen. Dateien müssen für die neue Anfrage erneut freigegeben werden.",
        "Repeat bookings copy teaching time and requirements. Files must be shared again for the new request.",
    ],
};
for (const [locale, index] of [
    ["de", 0],
    ["en", 1],
] as const)
    i18n.addResourceBundle(
        locale,
        "requestBrief",
        Object.fromEntries(
            Object.entries(pairs).map(([key, values]) => [key, values[index]]),
        ),
        true,
        true,
    );