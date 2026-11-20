/** DE/EN labels for restoring the actor's own archived personal materials. */
import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
    open: ["Archivierte eigene Materialien", "Archived personal materials"],
    description: [
        "Hier kannst du deine eigenen persönlichen Materialien wiederherstellen. Andere Dateibereiche und spezielle Nachweise werden hier nicht angezeigt.",
        "Restore your own personal materials here. Other file scopes and specialised evidence are not listed.",
    ],
    empty: [
        "Keine wiederherstellbaren Materialien gefunden.",
        "No restorable materials found.",
    ],
    more: ["Weitere laden", "Load more"],
    restore: ["{{name}} wiederherstellen", "Restore {{name}}"],
    confirm: ["Material wiederherstellen?", "Restore material?"],
    confirmHint: [
        "Das Material wird wieder verfügbar. Bestehende berechtigte Verknüpfungen können wieder darauf zugreifen.",
        "The material becomes available again. Existing authorised links may regain access.",
    ],
    done: ["Material wiederhergestellt.", "Material restored."],
    failed: [
        "Die Wiederherstellung wurde nicht bestätigt. Prüfe deinen Zugriff und versuche es erneut.",
        "Restoration was not confirmed. Check your access and try again.",
    ],
    offline: [
        "Zum Anzeigen und Wiederherstellen benötigst du eine Verbindung.",
        "You need a connection to view and restore materials.",
    ],
};
for (const [language, index] of [
    ["de", 0],
    ["en", 1],
] as const)
    i18n.addResourceBundle(
        language,
        "archivedMaterials",
        Object.fromEntries(
            Object.entries(pairs).map(([key, value]) => [key, value[index]]),
        ),
        true,
        true,
    );