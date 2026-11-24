import i18n from "../../lib/i18n";

const entries = {
  inbox: ["Gruppeneinladungen", "Group invitations"],
  from: ["Eingeladen von {{name}}", "Invited by {{name}}"],
  accept: ["Annehmen", "Accept"],
  reject: ["Ablehnen", "Reject"],
  manage: ["Personen einladen", "Invite people"],
  select: ["Person auswählen", "Select a person"],
  invite: ["Einladung senden", "Send invitation"],
  pending: ["Offene Einladungen", "Pending invitations"],
  revoke: [
    "Einladung für {{name}} zurückziehen",
    "Revoke invitation for {{name}}",
  ],
  saved: ["Einladung aktualisiert.", "Invitation updated."],
  failed: [
    "Die Aktion wurde nicht bestätigt. Bitte erneut versuchen.",
    "The action was not confirmed. Please try again.",
  ],
  hint: [
    "Eingeladene erhalten erst nach ihrer Annahme Zugriff auf Verlauf und Anhänge.",
    "Invitees gain access to history and attachments only after accepting.",
  ],
} as const;
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const)
  i18n.addResourceBundle(
    language,
    "topicInvitations",
    Object.fromEntries(
      Object.entries(entries).map(([key, pair]) => [key, pair[index]]),
    ),
    true,
    true,
  );
