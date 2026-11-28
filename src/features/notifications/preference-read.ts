import { useState } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { isTemporaryReadError } from "../../lib/paged-read";

/** Keep an authorised editor mounted through a temporary refresh failure. */
export function usePreferenceEditorData<T>(query: UseQueryResult<T>) {
  const [rejected, setRejected] = useState(false);
  const temporary = isTemporaryReadError(query.error);
  if (rejected && query.isSuccess) setRejected(false);
  if (!rejected && query.isError && !temporary) setRejected(true);

  if (query.isSuccess) return query.data;
  return !rejected && temporary && query.isRefetchError
    ? query.data
    : undefined;
}
