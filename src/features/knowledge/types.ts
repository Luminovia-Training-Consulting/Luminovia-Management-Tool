/**
 * DTOs für Wissensrechte, Kategorien, Wiki-/Revisionsstände und Forumobjekte. Entwurfs-/Publikationszustand sowie Moderationsdaten bleiben explizit und werden nicht aus der bloßen Route abgeleitet.
 */
import type { JSONContent } from "@tiptap/react";
/** Aktuelle Lese-/Autoren-/Moderationsfähigkeiten für die Wissensbereiche. */
export interface KnowledgeAccess {
  can_author: boolean;
  can_publish_wiki: boolean;
  can_moderate_forum: boolean;
}
/** Freigegebene Kategorie mit bewusst getrennten DE/EN-Navigationslabels. */
export interface KnowledgeCategory {
  id: string;
  kind: "wiki" | "forum";
  slug: string;
  label_de: string;
  label_en: string;
  archived: boolean;
}
/** Wiki-Metadaten und erlaubter aktueller Inhalts-/Publikationsstand. */
export interface WikiPageRecord {
  id: string;
  title: string;
  locale: string;
  category_id: string;
  category_label_de: string;
  category_label_en: string;
  owner_id: string;
  owner_name: string;
  status: "draft" | "published" | "archived";
  version: number;
  published_version: number | null;
  has_draft: boolean;
  updated_at: string;
  content: JSONContent;
}
/** Unveränderlicher gespeicherter Wiki-Versionsstand für die zugelassene Historienansicht. */
export interface WikiRevision {
  version: number;
  title: string;
  locale: string;
  editor_name: string;
  created_at: string;
  published: boolean;
  content: JSONContent;
}
/** Themenprojektion einschließlich sichtbarem Moderations-/Abonnementzustand. */
export interface ForumThread {
  id: string;
  title: string;
  category_id: string;
  category_label_de: string;
  category_label_en: string;
  owner_id: string;
  owner_name: string;
  locked: boolean;
  pinned: boolean;
  archived: boolean;
  accepted_post_id: string | null;
  post_count: number;
  subscribed: boolean;
  created_at: string;
  updated_at: string;
}
/** Freigegebener Forumsbeitrag mit strukturierter Inhaltsdarstellung und Autor-/Änderungsinformationen. */
export interface ForumPost {
  id: string;
  thread_id: string;
  author_id: string;
  author_name: string;
  content: JSONContent;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  version: number;
}
/** Berechtigte Moderationsmeldung, die nicht zum allgemeinen Foruminhalt gehört. */
export interface ForumReport {
  id: string;
  post_id: string;
  thread_id: string;
  reason: string;
  status: string;
  reporter_name: string;
  created_at: string;
}
