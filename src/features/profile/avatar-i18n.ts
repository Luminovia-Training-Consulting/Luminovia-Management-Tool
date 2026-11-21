/**
 * DE/EN UI resources for the avatar namespace. Module import registers these strings with
 * i18next; authored business content is not translated.
 */
import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  title: ["Profilbild", "Profile picture"],
  help: [
    "PNG, JPEG oder WebP unter 1 MB (1.000.000 Bytes). Das Bild wird mittig zugeschnitten, auf höchstens 480 Pixel verkleinert und ohne ursprüngliche Metadaten gespeichert. Sichtbar ist es für Personen, die dein Profil sehen dürfen.",
    "PNG, JPEG or WebP under 1 MB (1,000,000 bytes). The image is centre-cropped, resized to at most 480 pixels and stored without the original metadata. People who can view your profile can see it.",
  ],
  choose: ["Profilbild auswählen", "Choose profile picture"],
  remove: ["Profilbild entfernen", "Remove profile picture"],
  busy: [
    "Bild wird verarbeitet und geprüft …",
    "Processing and scanning image…",
  ],
  saved: ["Profilbild gespeichert.", "Profile picture saved."],
  removed: ["Profilbild entfernt.", "Profile picture removed."],
  error: [
    "Das Profilbild konnte nicht gespeichert werden. Verwende ein gültiges PNG-, JPEG- oder WebP-Bild innerhalb der Grenzen und versuche es erneut.",
    "The profile picture could not be saved. Use a valid PNG, JPEG or WebP image within the limits and try again.",
  ],
  tooLarge: [
    "Das Bild muss kleiner als 1 MB (1.000.000 Bytes) sein.",
    "The image must be smaller than 1 MB (1,000,000 bytes).",
  ],
  image: ["Profilbild von {{name}}", "Profile picture of {{name}}"],
};
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "avatar",
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => [key, value[index]]),
    ),
    true,
    true,
  );
