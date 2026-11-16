/**
 * Private availability, explicitly reduced management sharing and versioned changes. Preserve
 * exact instants for metadata-only edits; new local times must resolve unambiguously.
 */
import { queryOptions } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { validZone, zonedInstant } from "../../lib/dates";
/** Own versioned interval with a private note and explicit management-sharing flag. */
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
/** Reduced management projection without private notes or editable version information. */
export type SharedAvailabilityWindow = Omit<
  AvailabilityWindow,
  "notes" | "share_with_management" | "version"
> & { display_name: string };
/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
export const availabilitySchema = z.object({
  kind: z.enum(["available", "unavailable"]),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
  time_zone: z.string().refine(validZone),
  notes: z.string().max(2000),
  share_with_management: z.boolean(),
});
/** Draft values derived from the form schema before converting local times to instants. */
export type AvailabilityValues = z.infer<typeof availabilitySchema>;
/** Validate windows and preserve unchanged instants that minute-precision inputs cannot represent losslessly. */
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
/** Convert inclusive local date input into a valid half-open UTC read window. */
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
/** Read the my_availability server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
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
/** Read the shared_availability server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
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
/** Submit own window data with its expected version; the RPC decides conflicts and current permission. */
export async function saveAvailability(
  id: string,
  version: number,
  values: AvailabilityValues,
  previous?: AvailabilityWindow,
) {
  requireOnline();
  // Actor identity and conflict checks come from the native server session.
  // The expected version prevents overwriting a more recent window revision.
  const { data, error } = await db().rpc("save_lecturer_availability", {
    p_id: id,
    p_payload: availabilityPayload(values, previous),
    p_version: version,
  });
  if (error) throw error;
  return data as string;
}
/** Remove the own window only against its expected version and a successful online response. */
export async function removeAvailability(window: AvailabilityWindow) {
  requireOnline();
  const { error } = await db().rpc("remove_lecturer_availability", {
    p_id: window.id,
    p_version: window.version,
  });
  if (error) throw error;
}
