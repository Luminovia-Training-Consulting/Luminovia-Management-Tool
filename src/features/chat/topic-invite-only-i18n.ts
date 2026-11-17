import i18n from "../../lib/i18n";
const pairs: Record<string, [string, string]> = {
  create: ["Nur mit angenommener Einladung", "Invitation acceptance required"],
  createHint: [
    "Ausgewählte Personen erhalten Einladungen und werden erst nach Annahme Mitglied.",
    "Selected people receive invitations and join only after accepting.",
  ],
  title: ["Gruppenzugang", "Group access"],
  strict: ["Nur nach angenommener Einladung", "Invitation acceptance required"],
  direct: [
    "Direkte Aufnahme oder Einladung möglich",
    "Direct addition or invitation allowed",
  ],
  hint: [
    "Änderungen gelten für zukünftige Aufnahmen. Bestehende Mitglieder bleiben erhalten.",
    "Changes apply to future additions. Existing members remain.",
  ],
  enable: ["Einladungsmodus aktivieren", "Require invitations"],
  disable: ["Direkte Aufnahme erlauben", "Allow direct additions"],
  failed: [
    "Der Gruppenmodus konnte nicht bestätigt werden. Lade den aktuellen Stand neu.",
    "The group mode could not be confirmed. Reload the current state.",
  ],
};
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "topicInviteOnly",
    Object.fromEntries(
      Object.entries(pairs).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
