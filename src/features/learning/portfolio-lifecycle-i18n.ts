/** German and English copy for the owner-only portfolio lifecycle. */
import i18n from "../../lib/i18n";

const messages = {
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
