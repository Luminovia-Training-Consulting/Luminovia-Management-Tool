import i18n from "../../lib/i18n";

const pairs: Record<string, [string, string]> = {
  transfer: ["Gruppenverantwortung übertragen", "Transfer group ownership"],
  transferTo: ["Verantwortung übertragen an", "Transfer ownership to"],
  select: ["Mitglied auswählen", "Choose a member"],
  transferQuestion: [
    "Gruppenverantwortung übertragen?",
    "Transfer group ownership?",
  ],
  transferHint: [
    "Die ausgewählte Person kann danach Mitglieder und Gruppeninformationen verwalten. Du bleibst Mitglied.",
    "The selected person can then manage members and group information. You remain a member.",
  ],
  transferDone: [
    "Die Gruppenverantwortung wurde übertragen.",
    "Group ownership transferred.",
  ],
  leave: ["Gruppe verlassen", "Leave group"],
  leaveQuestion: ["Gruppe verlassen?", "Leave group?"],
  leaveHint: [
    "Du verlierst den Zugriff auf Nachrichten und Anhänge dieser Gruppe.",
    "You will lose access to this group's messages and attachments.",
  ],
  ownerHint: [
    "Übertrage zuerst die Gruppenverantwortung, bevor du die Gruppe verlässt.",
    "Transfer group ownership before leaving the group.",
  ],
  failed: [
    "Die Änderung konnte nicht bestätigt werden. Prüfe deine Berechtigung und versuche es erneut.",
    "The change could not be confirmed. Check your permissions and try again.",
  ],
};
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "chatOwnership",
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => [key, value[index]]),
    ),
    true,
    true,
  );
