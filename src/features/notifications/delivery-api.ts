import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { throwPagedReadError } from "../../lib/paged-read";

import { deliveryPreferencesSchema, type DeliveryPreferences } from "./schema";
export { deliveryPreferencesSchema, type DeliveryPreferences } from "./schema";

export const deliveryKey = (actor: string) => ["notification-delivery", actor];
export const deliveryPreferencesQuery = (actor: string) =>
  queryOptions({
    queryKey: deliveryKey(actor),
    queryFn: async ({ signal }) => {
      const { data, error, status } = await db()
        .rpc("delivery_preferences")
        .abortSignal(signal);
      if (error) throwPagedReadError(error, status);
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
