import {useMutation, useQueryClient} from "@tanstack/react-query";
import {requireOnline} from "../../lib/online";
import {markNotifications, notificationKeys} from "./api";

/** Connect confirmed read-state mutations to targeted revalidation of the actor's inbox. */
export function useReadState(actor: string) {
    const client = useQueryClient();
    return useMutation({
        mutationFn: async ({
                               ids,
                               before,
                               read,
                           }: {
            ids: string[] | null;
            before: string | null;
            read: boolean;
        }) => {
            requireOnline();
            return markNotifications(ids, before, read);
        },
        onSuccess: () =>
            client.invalidateQueries({queryKey: notificationKeys.all(actor)}),
    });
}