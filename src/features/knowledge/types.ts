/**
 * DTOs for knowledge capabilities, categories, wiki/revisions and forum objects.
 * Draft/publication and moderation state stay explicit rather than being inferred from a route.
 */
import type { JSONContent } from "@tiptap/react";

/** Current read/author/moderator capabilities for knowledge areas. */
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

/** Wiki metadata and the currently permitted content/publication state. */
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

/** Immutable saved wiki revision for the authorized history view. */
export interface WikiRevision {
  version: number;
  title: string;
  locale: string;
  editor_name: string;
  created_at: string;
  published: boolean;
  content: JSONContent;
}

/** Thread projection with visible moderation/subscription state. */
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
  metadata_version?: number;
  accepted_post_id: string | null;
  post_count: number;
  subscribed: boolean;
  created_at: string;
  updated_at: string;
}

/** Permitted forum post with structured content and author/edit metadata. */
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

/** Authorized moderation report separate from general forum content. */
export interface ForumReport {
  id: string;
  post_id: string;
  thread_id: string;
  reason: string;
  status: string;
  reporter_name: string;
  created_at: string;
}
