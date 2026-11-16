/**
 * Private Verfügbarkeitsfenster, bewusst reduzierte Managementfreigabe und versionierte Änderungen. Bestehende exakte Instants bleiben bei reinen Metadatenänderungen erhalten; neue lokale Zeiten müssen eindeutig auflösbar sein.
 */
import { queryOptions } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { validZone, zonedInstant } from "../../lib/dates";
/** Eigener versionierter Zeitraum mit privater Notiz und ausdrücklicher Managementfreigabe. */
export interface AvailabilityWindow {
  id: string;
  user_id: string;
  kind: "available" | "unavailable";
  starts_at: string;
  ends_at: string;
  time_zone: string;
  notes: string;
  share_with_management: boolean;
  version: number;
}
/** Reduzierte Managementprojektion ohne private Notizen oder bearbeitbare Versionsinformation. */
export type SharedAvailabilityWindow = Omit<
  AvailabilityWindow,
  "notes" | "share_with_management" | "version"
> & { display_name: string };
/** Lokale Eingabegrenzen des Fachformulars; Rechte, Fremdschlüssel und verbindliche Zustandsregeln prüft der Server zusätzlich. */
export const availabilitySchema = z.object({
  kind: z.enum(["available", "unavailable"]),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
  time_zone: z.string().refine(validZone),
  notes: z.string().max(2000),
  share_with_management: z.boolean(),
});
/** Aus dem Formularschema abgeleiteter Entwurf vor der Umrechnung lokaler Zeiten in Instants. */
export type AvailabilityValues = z.infer<typeof availabilitySchema>;
/** Validiert Fensterdaten und bewahrt unveränderte exakte Instants, die ein minutenweises Formular nicht verlustfrei repräsentiert. */
export function availabilityPayload(
  values: AvailabilityValues,
  previous?: Pick<AvailabilityWindow, "starts_at" | "ends_at" | "time_zone">,
) {
  const parsed = availabilitySchema.parse(values);
  const exact = (field: "starts_at" | "ends_at") =>
    previous &&
    previous.time_zone === parsed.time_zone &&
    DateTime.fromISO(previous[field])
      .setZone(previous.time_zone)
      .toFormat("yyyy-MM-dd'T'HH:mm") === parsed[field]
      ? previous[field]
      : zonedInstant(parsed[field], parsed.time_zone);
  // Metadata-only edits retain server instants, including existing seconds and
  // an already disambiguated DST offset that a minute input cannot represent.
  const starts = exact("starts_at"),
    ends = exact("ends_at");
  if (
    !starts ||
    !ends ||
    !Number.isFinite(Date.parse(starts)) ||
    !Number.isFinite(Date.parse(ends)) ||
    Date.parse(ends) <= Date.parse(starts)
  )
    throw new Error("invalid-time");
  return { ...parsed, starts_at: starts, ends_at: ends };
}
/** Begrenzt lokale inklusive Datumseingaben auf ein gültiges halboffenes UTC-Lesefenster. */
export function availabilityRange(from: string, to: string, zone: string) {
  const start = DateTime.fromISO(from, { zone }).startOf("day"),
    end = DateTime.fromISO(to, { zone }).plus({ days: 1 }).startOf("day");
  if (
    !start.isValid ||
    !end.isValid ||
    end <= start ||
    end.diff(start, "days").days > 93
  )
    return null;
  return { from: start.toUTC().toISO()!, to: end.toUTC().toISO()! };
}
/** Lädt die Serverprojektion über my_availability und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const myAvailabilityQuery = (actor: string, from: string, to: string) =>
  queryOptions({
    queryKey: ["availability", actor, from, to],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("my_availability", { p_from: from, p_to: to })
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as AvailabilityWindow[];
    },
    staleTime: 15000,
  });
/** Lädt die Serverprojektion über shared_availability und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const sharedAvailabilityQuery = (
  actor: string,
  from: string,
  to: string,
) =>
  queryOptions({
    queryKey: ["shared-availability", actor, from, to],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("shared_availability", { p_from: from, p_to: to })
        .abortSignal(signal);
      if (error) throw error;
      return (data ?? []) as SharedAvailabilityWindow[];
    },
    staleTime: 15000,
  });
/** Übermittelt eigene Fensterdaten samt erwarteter Version; die RPC entscheidet über Konflikte und aktuelle Rechte. */
export async function saveAvailability(
  id: string,
  version: number,
  values: AvailabilityValues,
  previous?: AvailabilityWindow,
) {
  requireOnline();
  // Nutzeridentität und Konfliktprüfung kommen aus der nativen Serversession.
  // Die erwartete Version verhindert das Überschreiben eines neueren Fensterstands.
  const { data, error } = await db().rpc("save_lecturer_availability", {
    p_id: id,
    p_payload: availabilityPayload(values, previous),
    p_version: version,
  });
  if (error) throw error;
  return data as string;
}
/** Entfernt das angegebene eigene Fenster nur gegen seine erwartete Version und bei echter Onlineantwort. */
export async function removeAvailability(window: AvailabilityWindow) {
  requireOnline();
  const { error } = await db().rpc("remove_lecturer_availability", {
    p_id: window.id,
    p_version: window.version,
  });
  if (error) throw error;
}
