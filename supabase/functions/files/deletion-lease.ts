/**
 * Hold a database upload lease across every awaited quarantine/scan/promotion
 * write. Permanent deletion fences new leases and waits for existing writers;
 * a crashed process leaves an explicit pending lease rather than false success.
 */
export interface UploadLeaseDependencies {
  begin: () => Promise<string>;
  end: (leaseId: string) => Promise<void>;
}
/** Release only after all work, including cleanup, has settled on every path. */
export async function withUploadLease<T>(
  deps: UploadLeaseDependencies,
  write: () => Promise<T>,
): Promise<T> {
  const lease = await deps.begin();
  try {
    return await write();
  } finally {
    await deps.end(lease);
  }
}
