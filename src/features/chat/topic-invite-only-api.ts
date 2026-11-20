import {useQuery} from "@tanstack/react-query";
import {db} from "../../lib/supabase";

export const topicInviteOnlyKey = (actor: string, room: string) =>
    ["topic-invite-only", actor, room] as const;

export function useTopicInviteOnly(
    actor: string,
    room: string,
    enabled: boolean,
) {
    return useQuery({
        queryKey: topicInviteOnlyKey(actor, room),
        enabled,
        retry: false,
        queryFn: async () => {
            const {data, error} = await db().rpc("topic_invitation_only", {
                p_room_id: room,
            });
            if (error) throw error;
            if (typeof data !== "boolean") throw new Error("invalid_mode");
            return data;
        },
    });
}