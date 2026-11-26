/** Shared byte handling for inert, locally validated course archives. */
import type { FileEntry } from "@zip.js/zip.js";

export class PackageEntryOverflowError extends Error {}

/** Consume one already-bounded entry with CRC and overlap checks. */
export async function consumePackageEntry(
  entry: FileEntry,
  buffer: Uint8Array | null,
  signal?: AbortSignal,
) {
  let received = 0;
  await entry.getData(
    new WritableStream<Uint8Array>({
      write(chunk) {
        signal?.throwIfAborted();
        const next = received + chunk.byteLength;
        if (next > entry.uncompressedSize)
          throw new PackageEntryOverflowError("package_entry_overflow");
        buffer?.set(chunk, received);
        received = next;
      },
    }),
    { checkSignature: true, checkOverlappingEntry: true, signal },
  );
  if (received !== entry.uncompressedSize)
    throw new Error("package_entry_truncated");
}

/** Hash the complete original archive, including entries the importer ignores. */
export async function coursePackageDigest(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
