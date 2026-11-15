export interface ChatContact {
  id: string;
  display_name: string;
  roles: string[];
}
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
export interface ChatMember {
  user_id: string;
  display_name: string;
  joined_at: string;
}
export interface ChatReaction {
  emoji: string;
  count: number;
  mine: boolean;
}
export interface ChatMention {
  user_id: string;
  display_name: string;
}
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
export interface MessageCursor {
  at: string;
  id: string;
}
