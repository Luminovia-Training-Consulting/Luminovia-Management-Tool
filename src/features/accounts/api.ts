/**
 * Typisierte HTTP-Anbindung der Accounts-Edge-Function samt paginierter Suche. Der Akteur trennt Browser-Caches; die Edge-Function prüft das native JWT und aktuelle Datenbankrechte selbst.
 */
import { queryOptions } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { db } from "../../lib/supabase";
/** Unterstützte fachliche Rollen für validierte Formulare; diese Liste verleiht keine Zuweisungsrechte. */
export const accountRoles = [
  "owner",
  "admin",
  "management",
  "senior_lecturer",
  "lecturer",
  "client",
  "participant",
] as const;
/** Aus der Rollenliste abgeleitete Eingabemenge; aktuelle Zuweisungsrechte entscheidet der Server. */
export type AccountRole = (typeof accountRoles)[number];
/** Verwaltungsprojektion eines Kontos mit Aktivierung, Locale und servergelieferten Rollen. */
export interface AccountPerson {
  id: string;
  display_name: string;
  email: string;
  active: boolean;
  locale: string;
  time_zone: string;
  roles: AccountRole[];
}
/** Paginierte Kontoantwort samt Gesamtzahl und tatsächlich angewendeten Seitengrenzen. */
export interface AccountList {
  items: AccountPerson[];
  total: number;
  limit: number;
  offset: number;
}
/** Ruft den Accounts-HTTP-Vertrag auf und propagiert sowohl Transport- als auch gemeldete Fachfehler. */
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
/** Lädt 25 Konten je Seite; vorherige Suchdaten bleiben nur innerhalb derselben Akteursidentität als Platzhalter sichtbar. */
export const accountListQuery = (
  actor: string,
  search: string,
  offset: number,
) =>
  queryOptions({
    queryKey: ["accounts", actor, search, offset],
    // Innerhalb derselben Person darf die vorige Seite ruhig sichtbar bleiben.
    // Ein Kontowechsel darf jedoch niemals einen fremden Verzeichnisplatzhalter erhalten.
    placeholderData: (previous, query) =>
      query?.queryKey[1] === actor ? previous : undefined,
    queryFn: () =>
      accountRequest<AccountList>(
        `users?q=${encodeURIComponent(search)}&limit=25&offset=${offset}`,
      ),
  });
