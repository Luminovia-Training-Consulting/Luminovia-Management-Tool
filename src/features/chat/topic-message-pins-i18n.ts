/** Bilingual labels for group-wide message pins, distinct from personal room pins. */
import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  title: ["Angeheftete Nachrichten", "Pinned messages"],
  none: [
    "In dieser Gruppe sind keine Nachrichten angeheftet.",
    "No messages are pinned in this group.",
  ],
  pin: ["Nachricht in Gruppe anheften", "Pin message in group"],
  unpin: ["Nachricht in Gruppe lösen", "Unpin message in group"],
  jump: [
    "Zur ursprünglichen Nachricht von {{name}}",
    "Go to original message from {{name}}",
  ],
  clearSearch: [
    "Hebe die Nachrichtensuche auf, um zum Original zu springen.",
    "Clear the message search to navigate to the original.",
  ],
  jumpFailed: [
    "Die Nachricht konnte nicht gefunden werden. Lade ältere Nachrichten und versuche es erneut.",
    "The message could not be located. Load older messages and try again.",
  ],
  failed: [
    "Die Änderung wurde nicht bestätigt. Bitte versuche es erneut.",
    "The change was not confirmed. Please try again.",
  ],
};
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "topicMessagePins",
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => [key, value[index]]),
    ),
    true,
    true,
  );
