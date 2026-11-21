// Private device RPCs use the current authenticated identity on the server;
// actor IDs appear only in cache keys and never authorize a registration.
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";

export const pushDevicesSchema = z.object({
  enabled: z.boolean(),
  public_key: z
    .string()
    .regex(/^[A-Za-z0-9_-]{87}$/)
    .nullable(),
  devices: z.array(
    z.object({
      id: z.string().uuid(),
      label: z.string(),
      device_token: z.string().uuid(),
      created_at: z.string().datetime({ offset: true }),
      expires_at: z.string().datetime({ offset: true }),
    }),
  ),
});
export const pushKey = (actor: string) => ["push-devices", actor];
export const pushDevicesQuery = (actor: string) =>
  queryOptions({
    queryKey: pushKey(actor),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("my_push_devices")
        .abortSignal(signal);
      if (error) throw error;
      return pushDevicesSchema.parse(data);
    },
  });

export async function registerPushDevice(
  subscription: PushSubscriptionJSON,
  token: string,
  label: string,
) {
  const { data, error } = await db().rpc("register_push_device", {
    p_subscription: subscription,
    p_device_token: token,
    p_label: label,
  });
  if (error) throw error;
  return z.string().uuid().parse(data);
}

export async function removePushDevice(id: string) {
  const { data, error } = await db().rpc("remove_push_device", {
    p_device_id: id,
  });
  if (error) throw error;
  return z.boolean().parse(data);
}
