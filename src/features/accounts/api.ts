import { queryOptions } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { db } from "../../lib/supabase";
export const accountRoles = [
  "owner",
  "admin",
  "management",
  "senior_lecturer",
  "lecturer",
  "client",
  "participant",
] as const;
export type AccountRole = (typeof accountRoles)[number];
export interface AccountPerson {
  id: string;
  display_name: string;
  email: string;
  active: boolean;
  locale: string;
  time_zone: string;
  roles: AccountRole[];
}
export interface AccountList {
  items: AccountPerson[];
  total: number;
  limit: number;
  offset: number;
}
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
export const accountListQuery = (
  actor: string,
  search: string,
  offset: number,
) =>
  queryOptions({
    queryKey: ["accounts", actor, search, offset],
    placeholderData: (previous, query) =>
      query?.queryKey[1] === actor ? previous : undefined,
    queryFn: () =>
      accountRequest<AccountList>(
        `users?q=${encodeURIComponent(search)}&limit=25&offset=${offset}`,
      ),
  });
