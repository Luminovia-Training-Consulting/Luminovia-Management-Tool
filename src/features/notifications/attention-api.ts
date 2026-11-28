import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { throwPagedReadError } from "../../lib/paged-read";

import {
  attentionSchema,
  savedAttentionSchema,
  type AttentionPreferences,
} from "./schema";
export { attentionSchema, type AttentionPreferences } from "./schema";

export const attentionKey = (actor: string) =>
  ["notification-attention", actor] as const;
export const attentionQuery = (actor: string) =>
  queryOptions({
    queryKey: attentionKey(actor),
    queryFn: async ({ signal }) => {
      const { data, error, status } = await db()
        .rpc("attention_preferences")
        .abortSignal(signal);
      if (error) throwPagedReadError(error, status);
      return attentionSchema.parse(data);
    },
    staleTime: 15000,
  });

export async function saveAttentionPreferences(values: AttentionPreferences) {
  const { version, ...payload } = values;
  const { data, error } = await db().rpc("save_attention_preferences", {
    p_payload: payload,
    p_expected_version: version,
  });
  if (error) throw error;
  return savedAttentionSchema.parse(data);
}
