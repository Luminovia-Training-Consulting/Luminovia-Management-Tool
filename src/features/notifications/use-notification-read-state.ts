import { useMutation, useQueryClient } from "@tanstack/react-query";
import { requireOnline } from "../../lib/online";
import { markNotifications, notificationKeys } from "./api";

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
      if (!ids) return markNotifications(null, before, read);
      let count = 0;
      for (let index = 0; index < ids.length; index += 100)
        count += await markNotifications(
          ids.slice(index, index + 100),
          null,
          read,
        );
      return count;
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: notificationKeys.all(actor) }),
  });
}
