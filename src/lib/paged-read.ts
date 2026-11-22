import { isDatabasePermissionDenied } from "./database-errors";

class PageTemporarilyUnavailable extends Error {}

/** Retain a fetched page only for an explicitly temporary transport failure. */
export function throwPagedReadError(error: unknown, status: number): never {
  if (!isDatabasePermissionDenied(error) && [0, 502, 503, 504].includes(status))
    throw new PageTemporarilyUnavailable("Page temporarily unavailable", {
      cause: error,
    });
  throw error;
}

export function canRetryNextPage(query: {
  error: unknown;
  isFetchNextPageError: boolean;
}) {
  return (
    query.isFetchNextPageError &&
    query.error instanceof PageTemporarilyUnavailable
  );
}
