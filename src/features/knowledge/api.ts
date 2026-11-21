/**
 * Actor-scoped categories/wiki/forum queries. Published content, own drafts, revisions and
 * moderation reports retain separate server projections.
 */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import type {
  ForumPost,
  ForumReport,
  ForumThread,
  KnowledgeAccess,
  KnowledgeCategory,
  WikiPageRecord,
  WikiRevision,
} from "./types";

/** Shared actor-scoped knowledge, revision and forum cache prefixes for targeted revalidation. */
export const knowledgeKeys = {
  access: (actor: string) => ["knowledge-access", actor] as const,
  categories: (actor: string, kind: string) =>
    ["knowledge-categories", actor, kind] as const,
  wiki: (actor: string) => ["wiki", actor] as const,
  forum: (actor: string) => ["forum", actor] as const,
};
/** Read the knowledge_access server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const knowledgeAccessQuery = (actor: string) =>
  queryOptions({
    queryKey: knowledgeKeys.access(actor),
    queryFn: async () => {
      const { data, error } = await db().rpc("knowledge_access");
      if (error) throw error;
      return data as KnowledgeAccess;
    },
    staleTime: 1000,
  });
/** Read the knowledge_categories server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const categoriesQuery = (actor: string, kind: "wiki" | "forum") =>
  queryOptions({
    queryKey: knowledgeKeys.categories(actor, kind),
    queryFn: async () => {
      const { data, error } = await db().rpc("knowledge_categories", {
        p_kind: kind,
      });
      if (error) throw error;
      return (data ?? []) as KnowledgeCategory[];
    },
  });
/** Read the wiki_pages_list server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const wikiListQuery = (
  actor: string,
  search: string,
  locale: string,
  category: string,
  archived: boolean,
) =>
  queryOptions({
    queryKey: [
      ...knowledgeKeys.wiki(actor),
      "list",
      search,
      locale,
      category,
      archived,
    ],
    queryFn: async () => {
      const { data, error } = await db().rpc("wiki_pages_list", {
        p_search: search,
        p_locale: locale,
        p_category_id: category || null,
        p_include_archived: archived,
      });
      if (error) throw error;
      return (data ?? []) as WikiPageRecord[];
    },
  });
/** Read the wiki_page server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const wikiPageQuery = (actor: string, id: string) =>
  queryOptions({
    queryKey: [...knowledgeKeys.wiki(actor), "page", id],
    queryFn: async () => {
      const { data, error } = await db().rpc("wiki_page", { p_id: id });
      if (error) throw error;
      return data as WikiPageRecord | null;
    },
    refetchOnWindowFocus: false,
  });
/** Read the wiki_page_history server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const wikiHistoryQuery = (actor: string, id: string) =>
  queryOptions({
    queryKey: [...knowledgeKeys.wiki(actor), "history", id],
    queryFn: async () => {
      const { data, error } = await db().rpc("wiki_page_history", { p_id: id });
      if (error) throw error;
      return (data ?? []) as WikiRevision[];
    },
  });
/** Read the forum_threads_list server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const forumListQuery = (
  actor: string,
  search: string,
  category: string,
  archived: boolean,
) =>
  queryOptions({
    queryKey: [
      ...knowledgeKeys.forum(actor),
      "list",
      search,
      category,
      archived,
    ],
    queryFn: async () => {
      const { data, error } = await db().rpc("forum_threads_list", {
        p_search: search,
        p_category_id: category || null,
        p_include_archived: archived,
      });
      if (error) throw error;
      return (data ?? []) as ForumThread[];
    },
  });
/** Read the forum_thread server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const forumThreadQuery = (actor: string, id: string) =>
  queryOptions({
    queryKey: [...knowledgeKeys.forum(actor), "thread", id],
    queryFn: async () => {
      const { data, error } = await db().rpc("forum_thread", { p_id: id });
      if (error) throw error;
      return data as ForumThread | null;
    },
  });
/** Read the forum_posts server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const forumPostsQuery = (actor: string, id: string) =>
  queryOptions({
    queryKey: [...knowledgeKeys.forum(actor), "posts", id],
    queryFn: async () => {
      const { data, error } = await db().rpc("forum_posts", {
        p_thread_id: id,
      });
      if (error) throw error;
      return (data ?? []) as ForumPost[];
    },
  });
/** Read the forum_reports server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const forumReportsQuery = (actor: string) =>
  queryOptions({
    queryKey: [...knowledgeKeys.forum(actor), "reports"],
    queryFn: async () => {
      const { data, error } = await db().rpc("forum_reports");
      if (error) throw error;
      return (data ?? []) as ForumReport[];
    },
  });
