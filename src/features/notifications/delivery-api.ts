import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { validZone } from "../../lib/dates";
import { db } from "../../lib/supabase";

const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const deliveryPreferencesSchema = z
  .object({
    email_enabled: z.boolean(),
    quiet_start: localTime.nullable(),
    quiet_end: localTime.nullable(),
    time_zone: z.string().refine(validZone),
    version: z.number().int().positive(),
  })
  .refine(
    ({ quiet_start, quiet_end }) =>
      (quiet_start === null && quiet_end === null) ||
      (quiet_start !== null && quiet_end !== null && quiet_start !== quiet_end),
  );
export type DeliveryPreferences = z.infer<typeof deliveryPreferencesSchema>;
export const deliveryKey = (actor: string) => ["notification-delivery", actor];
export const deliveryPreferencesQuery = (actor: string) =>
  queryOptions({
    queryKey: deliveryKey(actor),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("delivery_preferences")
        .abortSignal(signal);
      if (error) throw error;
      return deliveryPreferencesSchema.parse(data);
    },
    staleTime: 15000,
  });
export async function saveDeliveryPreferences(values: DeliveryPreferences) {
  const { version, ...payload } = deliveryPreferencesSchema.parse(values);
  const { data, error } = await db().rpc("save_delivery_preferences", {
    p_payload: payload,
    p_expected_version: version,
  });
  if (error) throw error;
  return deliveryPreferencesSchema.parse(data);
}
