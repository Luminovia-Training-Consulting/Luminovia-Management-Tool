/**
 * DTOs from permission-filtered chat RPCs. Explicit room types, membership, message state and
 * cursors prevent UI assumptions from merging private DMs with separate course channels.
 */
/** Server-authorized contact for actual DM/group actions. */
export interface ChatContact {
  id: string;
  display_name: string;
  roles: string[];
}
/** Permitted room projection with type, read state and mute status. */
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
/** Membership projection for the currently accessible room. */
export interface ChatMember {
  user_id: string;
  display_name: string;
  joined_at: string;
}
/** Aggregated reaction with the current actor's participation flag. */
export interface ChatReaction {
  emoji: string;
  count: number;
  mine: boolean;
}
/** Explicit member selection resolved for the persisted message content version. */
export interface ChatMention {
  user_id: string;
  display_name: string;
}
/** Persisted message with permitted attachments, versioned mentions and server-projected moderation controls. */
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
  content_version?: number;
  mentions?: ChatMention[];
  can_moderate?: boolean;
}
/** History continuation using the last timestamp/ID pair. */
export interface MessageCursor {
  at: string;
  id: string;
}
