/**
 * Hold a database upload lease across every awaited quarantine/scan/promotion
 * write. Permanent deletion fences new leases and waits for existing writers;
 * a crashed process leaves an explicit pending lease rather than false success.
 */
export interface UploadLeaseDependencies {
    begin: () => Promise<string>;
    end: (leaseId: string) => Promise<void>;
}

/** A Storage request can outlive a failed transport; only a definite response
 * acknowledges that this request can no longer create bytes in the backend. */
export interface UploadWrites {
    begin: () => () => void;
}

/** Release only after all work, including cleanup, has settled on every path. */
export async function withUploadLease<T>(
    deps: UploadLeaseDependencies,
    write: (writes: UploadWrites) => Promise<T>,
): Promise<T> {
    const lease = await deps.begin();
    let unacknowledged = 0;
    const writes: UploadWrites = {
        begin: () => {
            unacknowledged++;
            let acknowledged = false;
            return () => {
                if (!acknowledged) {
                    acknowledged = true;
                    unacknowledged--;
                }
            };
        },
    };
    try {
        const result = await write(writes);
        if (unacknowledged > 0) throw new Error("deletion_unavailable");
        return result;
    } finally {
        // A transport failure settles the client promise, not the remote writer.
        // Retain its barrier for explicit operator recovery; no timer assumes that
        // a missing Storage metadata row proves an unfinished byte write is absent.
        if (unacknowledged === 0) await deps.end(lease);
    }
}