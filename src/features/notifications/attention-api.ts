import {queryOptions} from "@tanstack/react-query";
import {z} from "zod";
import {db} from "../../lib/supabase";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const attentionSchema = z
    .object({
        enabled: z.boolean(),
        start_time: time,
        end_time: time,
        time_zone: z
            .string()
            .min(1)
            .max(100)
            .refine((zone) => {
                try {
                    new Intl.DateTimeFormat("en", {timeZone: zone}).format();
                    return true;
                } catch {
                    return false;
                }
            }),
        version: z.number().int().nonnegative(),
    })
    .refine((value) => value.start_time !== value.end_time);
export type AttentionPreferences = z.infer<typeof attentionSchema>;
export const attentionKey = (actor: string) =>
    ["notification-attention", actor] as const;
export const attentionQuery = (actor: string) =>
    queryOptions({
        queryKey: attentionKey(actor),
        queryFn: async ({signal}) => {
            const {data, error} = await db()
                .rpc("attention_preferences")
                .abortSignal(signal);
            if (error) throw error;
            return attentionSchema.parse(data);
        },
        staleTime: 15000,
    });

export async function saveAttentionPreferences(values: AttentionPreferences) {
    const {version, ...payload} = values;
    const {data, error} = await db().rpc("save_attention_preferences", {
        p_payload: payload,
        p_expected_version: version,
    });
    if (error) throw error;
    return attentionSchema.parse(data);
}