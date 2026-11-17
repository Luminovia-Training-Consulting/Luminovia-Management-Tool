import i18n from "../../lib/i18n";

const entries = {
  deleteTitle: ["Privaten Termin löschen?", "Delete private appointment?"],
  deleteDescription: [
    "Der private Termin wird gelöscht und blockiert deine Verfügbarkeit nicht mehr.",
    "The private appointment will be deleted and will no longer block your availability.",
  ],
  deleteFailed: [
    "Die Löschung wurde nicht bestätigt. Bitte versuche es erneut.",
    "The deletion was not confirmed. Please try again.",
  ],
} as const;
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    language,
    "calendarConfirmation",
    Object.fromEntries(
      Object.entries(entries).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
}
