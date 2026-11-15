import type { JSONContent } from "@tiptap/react";
export interface KnowledgeAccess {
  can_author: boolean;
  can_publish_wiki: boolean;
  can_moderate_forum: boolean;
}
export interface KnowledgeCategory {
  id: string;
  kind: "wiki" | "forum";
  slug: string;
  label_de: string;
  label_en: string;
  archived: boolean;
}
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
export interface WikiRevision {
  version: number;
  title: string;
  locale: string;
  editor_name: string;
  created_at: string;
  published: boolean;
  content: JSONContent;
}
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
export interface ForumReport {
  id: string;
  post_id: string;
  thread_id: string;
  reason: string;
  status: string;
  reporter_name: string;
  created_at: string;
}
