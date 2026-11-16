/**
 * Typed accounts Edge HTTP adapter with paginated search. Actor IDs partition browser caches;
 * the Edge handler independently verifies the native JWT and current database permissions.
 */
import { queryOptions } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { db } from "../../lib/supabase";
/** Supported business roles for validated forms; this list grants no assignment authority. */
export const accountRoles = [
  "owner",
  "admin",
  "management",
  "senior_lecturer",
  "lecturer",
  "client",
  "participant",
] as const;
/** Derive input roles from the role list; the server decides current assignment permission. */
export type AccountRole = (typeof accountRoles)[number];
/** Administrative account projection with activation, locale and server-provided roles. */
export interface AccountPerson {
  id: string;
  display_name: string;
  email: string;
  active: boolean;
  locale: string;
  time_zone: string;
  roles: AccountRole[];
}
/** Account page with total count and the actual applied pagination bounds. */
export interface AccountList {
  items: AccountPerson[];
  total: number;
  limit: number;
  offset: number;
}
/** Call the accounts HTTP contract and propagate both transport and reported business errors. */
export async function accountRequest<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" = "GET",
  body?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db().functions.invoke(`accounts/v1/${path}`, {
    method,
    ...(body === undefined ? {} : { body }),
  });
  if (error) {
    let code = "service_unavailable";
    if (error instanceof FunctionsHttpError) {
      try {
        code = (await error.context.clone().json()).error ?? code;
      } catch {
        /* keep safe error */
      }
    }
    throw new Error(code);
  }
  return data as T;
}
/** Fetch 25 accounts per page; previous results are placeholders only within the same actor identity. */
export const accountListQuery = (
  actor: string,
  search: string,
  offset: number,
) =>
  queryOptions({
    queryKey: ["accounts", actor, search, offset],
    // Keep the previous page visible while the same actor changes the search.
    // An actor change must never reuse another person's directory placeholder.
    placeholderData: (previous, query) =>
      query?.queryKey[1] === actor ? previous : undefined,
    queryFn: () =>
      accountRequest<AccountList>(
        `users?q=${encodeURIComponent(search)}&limit=25&offset=${offset}`,
      ),
  });
