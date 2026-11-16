/**
 * DTOs der berechtigungsgefilterten Chat-RPCs. Raumart, Mitgliedschaft, Nachrichtenstatus und Cursor bleiben explizit, damit private DMs und getrennte Kurskanäle nicht durch UI-Annahmen vermischt werden.
 */
/** Serverfreigegebener Kontakt für echte DM-/Gruppenaktionen. */
export interface ChatContact {
  id: string;
  display_name: string;
  roles: string[];
}
/** Berechtigte Raumprojektion einschließlich Raumart, Lesestand und Stummschaltung. */
export interface ChatRoom {
  id: string;
  kind: "dm" | "general" | "topic" | "lecturer_course" | "participant_course";
  title: string;
  job_id: string | null;
  owner_id: string | null;
  unread_count: number;
  last_message_at: string | null;
  muted: boolean;
}
/** Mitgliedschaftsprojektion im aktuell zugänglichen Raum. */
export interface ChatMember {
  user_id: string;
  display_name: string;
  joined_at: string;
}
/** Zusammengefasste Reaktion mit aktueller eigener Beteiligung. */
export interface ChatReaction {
  emoji: string;
  count: number;
  mine: boolean;
}
/** Persistierte Nachricht mit sichtbarem Autor, Änderungs-/Löschstand und erlaubten Anhängen. */
export interface ChatMessage {
  id: string;
  room_id: string;
  sender_id: string;
  sender_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  document_id: string | null;
  reactions: ChatReaction[];
}
/** Fortsetzung der Nachrichtenhistorie anhand des letzten Zeit/ID-Paares. */
export interface MessageCursor {
  at: string;
  id: string;
}
