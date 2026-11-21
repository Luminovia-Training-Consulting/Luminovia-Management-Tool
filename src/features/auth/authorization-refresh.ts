import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** Role/permission polling is advisory UI freshness; the database authorises every request.
 * Reset private data as soon as a changed server capability arrives, including inactive
 * reports, so a demoted account cannot redisplay previously cached pricing on navigation.
 */
export function useAuthorizationRefresh(
  actor: string,
  roles: string[] | undefined,
  permissions: string[] | undefined,
) {
  const client = useQueryClient();
  const previous = useRef<string | null>(null);
  const signature =
    roles && permissions
      ? JSON.stringify([actor, [...roles].sort(), [...permissions].sort()])
      : null;
  useEffect(() => {
    if (signature === null) return;
    const changed = previous.current !== null && previous.current !== signature;
    previous.current = signature;
    if (!changed) return;
    void client.resetQueries({
      predicate: (query) =>
        !["permissions", "user-roles"].includes(String(query.queryKey[0])),
    });
  }, [client, signature]);
}
