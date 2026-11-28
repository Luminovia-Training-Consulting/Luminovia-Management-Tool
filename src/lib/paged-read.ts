/** Shared bounded reads and retry classification for authenticated lists. */
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

/** Identify a recoverable transport error without treating access denial as stale data. */
export function isTemporaryReadError(error: unknown): boolean {
  return error instanceof PageTemporarilyUnavailable;
}

export function canRetryNextPage(query: {
  error: unknown;
  isFetchNextPageError: boolean;
}) {
  return query.isFetchNextPageError && isTemporaryReadError(query.error);
}

/** Read past the configured REST response cap using a stable order and abortable pages. */
export async function readDirectoryPages<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{
    data: unknown[] | null;
    error: unknown;
  }>,
): Promise<T[]> {
  const size = 250;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    const received = data ?? [];
    rows.push(...(received as T[]));
    if (received.length < size) return rows;
  }
}
