import i18n from "../../lib/i18n";

const entries = {
    title: [
        "Fachgebiete im Personenverzeichnis",
        "Expertise in the people directory",
    ],
    help: [
        "Du entscheidest, ob deine Fachgebiete im Personenverzeichnis und internen Profil angezeigt und dort nach Fachgebiet gefunden werden. Deine eigenen Daten und die berechtigte Qualifikationsprüfung bleiben sichtbar; Auftragsberechtigung und andere Kursangaben ändern sich nicht.",
        "Choose whether your expertise appears in the people directory and internal profile and can be found there by topic. Your own data and authorized qualification review remain visible; job eligibility and other course information do not change.",
    ],
    visible: [
        "Meine Fachgebiete im Personenverzeichnis und Profil anzeigen",
        "Show my expertise in the people directory and profile",
    ],
    save: ["Sichtbarkeit speichern", "Save visibility"],
    saved: ["Sichtbarkeit gespeichert.", "Visibility saved."],
    error: [
        "Die Sichtbarkeit wurde nicht bestätigt. Dein Entwurf bleibt erhalten.",
        "The visibility change was not confirmed. Your draft is preserved.",
    ],
    conflict: [
        "Die Sichtbarkeit wurde inzwischen geändert. Lade den aktuellen Stand neu.",
        "Visibility changed elsewhere. Reload the current settings.",
    ],
    reload: ["Sichtbarkeit neu laden", "Reload visibility"],
} as const;
for (const [language, index] of [
    ["de", 0],
    ["en", 1],
] as const)
    i18n.addResourceBundle(
        language,
        "topicVisibility",
        Object.fromEntries(
            Object.entries(entries).map(([key, pair]) => [key, pair[index]]),
        ),
        true,
        true,
    );