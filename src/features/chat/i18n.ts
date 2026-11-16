/**
 * DE/EN-Oberflächentexte für chat. Die Registrierung erweitert i18next beim Modulimport; verfasste Fachinhalte werden nicht automatisch übersetzt.
 */
import i18n from "../../lib/i18n";
const pairs: Record<string, [string, string]> = {
  title: ["Chats", "Chats"],
  intro: [
    "Austausch, der verbindet. Für dein Team, deine Themen und deine Kurse.",
    "Conversations that connect. For your team, interests and courses.",
  ],
  rooms: ["Unterhaltungen", "Conversations"],
  newMessage: ["Neue Nachricht", "New message"],
  newGroup: ["Gruppe erstellen", "Create group"],
  lecturerLounge: ["Dozierenden-Lounge öffnen", "Open lecturer lounge"],
  lecturerLoungeHint: [
    "Ein gemeinsamer Raum ausschließlich für Dozierende.",
    "A shared space exclusively for lecturers.",
  ],
  noRooms: ["Hier beginnt der Austausch.", "A conversation starts here."],
  noRoomsHint: [
    "Starte eine Direktnachricht oder öffne einen deiner Kursräume.",
    "Start a direct message or open one of your course rooms.",
  ],
  noMessages: [
    "Noch ganz viel Platz für gute Gedanken.",
    "Room for good ideas.",
  ],
  noMessagesHint: [
    "Schreibe die erste Nachricht in dieser Unterhaltung.",
    "Write the first message in this conversation.",
  ],
  chooseRoom: ["Eine Unterhaltung auswählen", "Choose a conversation"],
  chooseRoomHint: [
    "Deine persönlichen Chats und Kursräume findest du links.",
    "Find your personal conversations and course rooms in the list.",
  ],
  contactTitle: [
    "Wem möchtest du schreiben?",
    "Who would you like to message?",
  ],
  contactHint: [
    "Hier siehst du die Personen, die du im Portal kontaktieren darfst.",
    "These are the people you can contact in the portal.",
  ],
  searchPeople: ["Person suchen", "Search people"],
  noContacts: [
    "Keine passenden Kontakte gefunden.",
    "No matching contacts found.",
  ],
  startDm: ["{{name}} eine Nachricht schreiben", "Message {{name}}"],
  unnamed: ["Person ohne Anzeigenamen", "Person without a display name"],
  searchRooms: ["Unterhaltungen suchen", "Search conversations"],
  selected: ["Ausgewählt", "Selected"],
  kind_dm: ["Direktnachricht", "Direct message"],
  kind_general: ["Dozierenden-Lounge", "Lecturer lounge"],
  kind_topic: ["Themengruppe", "Interest group"],
  kind_lecturer_course: ["Dozierenden-Kursraum", "Lecturer course room"],
  kind_participant_course: [
    "Teilnehmenden-Kursraum",
    "Participant course room",
  ],
  unread: ["{{count}} ungelesen", "{{count}} unread"],
  muted: ["Stummgeschaltet", "Muted"],
  mute: ["Unterhaltung stummschalten", "Mute conversation"],
  unmute: ["Stummschaltung aufheben", "Unmute conversation"],
  read: ["Gelesen", "Read"],
  searchMessages: ["Nachrichten durchsuchen", "Search messages"],
  runSearch: ["Suchen", "Search"],
  clearSearch: ["Suche aufheben", "Clear search"],
  noSearch: [
    "Keine Nachrichten zu dieser Suche gefunden.",
    "No messages match this search.",
  ],
  loadOlder: ["Ältere Nachrichten laden", "Load older messages"],
  message: ["Deine Nachricht", "Your message"],
  messageHint: [
    "Nur Mitglieder dieser Unterhaltung können die Nachrichten lesen.",
    "Only members of this conversation can read its messages.",
  ],
  messagePrivate: ["Private Direktnachricht", "Private direct message"],
  participantNote: [
    "Dieser Raum ist für den Austausch mit Kursteilnehmenden vorgesehen.",
    "This room is for conversations with course participants.",
  ],
  lecturerNote: [
    "Dieser Kursraum ist ausschließlich für Dozierende vorgesehen.",
    "This course room is exclusively for lecturers.",
  ],
  send: ["Nachricht senden", "Send message"],
  sending: ["Wird gesendet …", "Sending …"],
  sent: ["Nachricht gesendet.", "Message sent."],
  sendError: [
    "Die Nachricht wurde nicht bestätigt. Dein Entwurf bleibt erhalten; du kannst es erneut versuchen.",
    "The message was not confirmed. Your draft is preserved; you can try again.",
  ],
  actionError: [
    "Die Änderung konnte nicht bestätigt werden. Bitte versuche es erneut.",
    "The change could not be confirmed. Please try again.",
  ],
  accessLost: [
    "Du hast keinen Zugriff mehr auf diese Unterhaltung.",
    "You no longer have access to this conversation.",
  ],
  accessLostHint: [
    "Die Ansicht wurde geschlossen. Wähle eine andere Unterhaltung aus.",
    "This view has been closed. Choose another conversation.",
  ],
  roomUnavailable: [
    "Diese Unterhaltung ist nicht verfügbar oder du bist kein Mitglied.",
    "This conversation is unavailable or you are not a member.",
  ],
  members: ["Mitglieder", "Members"],
  manageMembers: ["Mitglieder verwalten", "Manage members"],
  membersHint: [
    "Mitglieder erhalten Zugriff auf den bisherigen Verlauf und die freigegebenen Anhänge.",
    "Members gain access to conversation history and shared attachments.",
  ],
  memberCount_one: ["{{count}} Mitglied", "{{count}} member"],
  memberCount_other: ["{{count}} Mitglieder", "{{count}} members"],
  owner: ["Gruppenverantwortung", "Group owner"],
  addMember: ["Mitglied hinzufügen", "Add member"],
  memberToAdd: ["Person hinzufügen", "Add a person"],
  removeMember: ["{{name}} entfernen", "Remove {{name}}"],
  removeConfirm: ["Mitglied entfernen?", "Remove member?"],
  removeDescription: [
    "{{name}} verliert den Zugriff auf diese Unterhaltung und ihre Anhänge.",
    "{{name}} will lose access to this conversation and its attachments.",
  ],
  remove: ["Mitglied entfernen", "Remove member"],
  membershipSaved: [
    "Die Mitgliedschaft wurde aktualisiert.",
    "Membership updated.",
  ],
  groupTitle: ["Neue Gruppe", "New group"],
  groupHint: [
    "Wähle einen Namen und die Personen für eure Unterhaltung.",
    "Choose a name and the people for your conversation.",
  ],
  groupName: ["Gruppenname", "Group name"],
  groupKind: ["Art der Gruppe", "Group type"],
  groupJob: ["Kursauftrag", "Course assignment"],
  selectJob: ["Kursauftrag auswählen", "Choose a course assignment"],
  selectMembers: ["Personen auswählen", "Select people"],
  groupError: [
    "Die Gruppe konnte nicht erstellt werden. Prüfe deine Auswahl und Berechtigungen.",
    "The group could not be created. Check your selection and permissions.",
  ],
  groupCreate: ["Gruppe erstellen", "Create group"],
  edited: ["bearbeitet", "edited"],
  deleted: ["Diese Nachricht wurde gelöscht.", "This message was deleted."],
  edit: ["Nachricht bearbeiten", "Edit message"],
  delete: ["Nachricht löschen", "Delete message"],
  editHint: [
    "Die Änderung wird im Verlauf als Bearbeitung gekennzeichnet.",
    "The change will be marked as an edit in the conversation.",
  ],
  deleteConfirm: ["Nachricht löschen?", "Delete message?"],
  deleteHint: [
    "Der Inhalt wird durch einen Löschhinweis ersetzt. Die Bearbeitung bleibt nachvollziehbar.",
    "The content will be replaced by a deletion notice. The action remains recorded.",
  ],
  messageActions: ["Nachrichtenaktionen", "Message actions"],
  reactionAdd: ["{{emoji}} hinzufügen", "Add {{emoji}}"],
  reactionRemove: ["{{emoji}} entfernen", "Remove {{emoji}}"],
  reactions: ["Reaktionen", "Reactions"],
  yourMessage: ["Du", "You"],
  attachment: ["Datei anhängen", "Attach file"],
  attachmentHint: [
    "PDF, Bilder, Office oder Text · bis 100 MiB",
    "PDF, images, Office or text · up to 100 MiB",
  ],
  attachmentScanning: [
    "Datei wird hochgeladen und geprüft … {{progress}} %",
    "Uploading and checking file … {{progress}}%",
  ],
  attachmentFailed: [
    "Die Datei konnte nicht freigegeben werden. Versuche eine zulässige Datei erneut hochzuladen.",
    "The file could not be approved. Try uploading an allowed file again.",
  ],
  removeAttachment: [
    "Anhang aus dem Entwurf entfernen",
    "Remove attachment from draft",
  ],
  onlineOnly: [
    "Zum Senden und Hochladen brauchst du eine Verbindung.",
    "You need a connection to send messages and upload files.",
  ],
  reconnecting: ["Verbindung wird wiederhergestellt …", "Reconnecting …"],
  staffOnly: ["Nur Mitarbeitende und Dozierende", "Staff and lecturers only"],
};
for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    language,
    "chat",
    Object.fromEntries(
      Object.entries(pairs).map(([key, value]) => [key, value[index]]),
    ),
    true,
    true,
  );
}
