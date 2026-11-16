/** Translated passport labels distinguish recorded checks from authored claims. */
import i18n from "../../lib/i18n";
const de = {
  title: "Dein Qualifikationspass",
  help: "Lade eine persönliche PDF-Übersicht deiner ausgewählten Fachgebiete herunter. Sie nennt geprüft, ungeprüft oder abgelaufen sowie vorhandene Prüfzeitpunkte und Nachweis-Hashes. Eigene Angaben zur Lehrerfahrung bleiben als ungeprüfte Selbstauskunft gekennzeichnet.",
  privacy:
    "Die PDF enthält keine Zertifikatsdateien und wird nur auf deine Aktion heruntergeladen. Du entscheidest anschließend selbst über eine Weitergabe. Bestehende Prüfstatus werden nicht verändert.",
  download: "Qualifikationspass als PDF herunterladen",
  pending: "Qualifikationspass wird erstellt…",
  error:
    "Der Qualifikationspass konnte nicht erstellt werden. Prüfe deine Verbindung und deinen aktuellen Kontozugang.",
  glyph:
    "Ein Zeichen deiner Angaben wird von der PDF-Schrift nicht unterstützt. Prüfe die Schreibweise deiner Angaben.",
};
const en: Record<keyof typeof de, string> = {
  title: "Your qualification passport",
  help: "Download a personal PDF summary of your selected expertise. It distinguishes verified, unverified and expired records, with recorded attestation dates and evidence hashes. Your own teaching-experience statements remain labelled as unverified self-declarations.",
  privacy:
    "The PDF contains no certificate files and downloads only on your explicit action. You decide whether to share it afterwards. Existing verification states remain unchanged.",
  download: "Download qualification passport as PDF",
  pending: "Preparing qualification passport…",
  error:
    "The qualification passport could not be created. Check your connection and current account access.",
  glyph:
    "A character in your details is not supported by the PDF font. Check the spelling of your details.",
};
i18n.addResourceBundle("de", "qualificationPassport", de);
i18n.addResourceBundle("en", "qualificationPassport", en);
