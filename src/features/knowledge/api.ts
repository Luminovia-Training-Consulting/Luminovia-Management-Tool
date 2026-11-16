/**
 * Actor-bezogene Wissensqueries für Kategorien, Wiki und Forum. Veröffentlichte Inhalte, eigene Entwürfe, Revisionen und Moderationsberichte behalten getrennte Serverprojektionen.
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
/** Einheitliche akteursbezogene Cachepräfixe für Wissen, Revisionen, Forum und gezielte Revalidierung. */
export const knowledgeKeys = {
  access: (actor: string) => ["knowledge-access", actor] as const,
  categories: (actor: string, kind: string) =>
    ["knowledge-categories", actor, kind] as const,
  wiki: (actor: string) => ["wiki", actor] as const,
  forum: (actor: string) => ["forum", actor] as const,
};
/** Lädt die Serverprojektion über knowledge_access und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
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
/** Lädt die Serverprojektion über knowledge_categories und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
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
/** Lädt die Serverprojektion über wiki_pages_list und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
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
/** Lädt die Serverprojektion über wiki_page und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
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
/** Lädt die Serverprojektion über wiki_page_history und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const wikiHistoryQuery = (actor: string, id: string) =>
  queryOptions({
    queryKey: [...knowledgeKeys.wiki(actor), "history", id],
    queryFn: async () => {
      const { data, error } = await db().rpc("wiki_page_history", { p_id: id });
      if (error) throw error;
      return (data ?? []) as WikiRevision[];
    },
  });
/** Lädt die Serverprojektion über forum_threads_list und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
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
/** Lädt die Serverprojektion über forum_thread und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const forumThreadQuery = (actor: string, id: string) =>
  queryOptions({
    queryKey: [...knowledgeKeys.forum(actor), "thread", id],
    queryFn: async () => {
      const { data, error } = await db().rpc("forum_thread", { p_id: id });
      if (error) throw error;
      return data as ForumThread | null;
    },
  });
/** Lädt die Serverprojektion über forum_posts und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
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
/** Lädt die Serverprojektion über forum_reports und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const forumReportsQuery = (actor: string) =>
  queryOptions({
    queryKey: [...knowledgeKeys.forum(actor), "reports"],
    queryFn: async () => {
      const { data, error } = await db().rpc("forum_reports");
      if (error) throw error;
      return (data ?? []) as ForumReport[];
    },
  });
