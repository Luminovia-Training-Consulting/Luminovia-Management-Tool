// Web Crypto and Fetch take ArrayBuffer-backed views. Preserve the exact byte
// range without copying an entire file; shared memory requires a snapshot.
export function webFileBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const { buffer, byteOffset, byteLength } = bytes;
  return buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer, byteOffset, byteLength)
    : new Uint8Array(bytes);
}

export async function sha256FileHex(
  bytes: ArrayBuffer | Uint8Array,
): Promise<string> {
  const source = bytes instanceof Uint8Array ? webFileBytes(bytes) : bytes;
  const hash = await crypto.subtle.digest("SHA-256", source);
  return Array.from(
    new Uint8Array(hash),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Verify the stored upload with one bounded buffer for the scanner and promotion. */
export async function readMatchingFileBytes(
  stream: ReadableStream<Uint8Array>,
  size: number,
  digest: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  const bytes = new Uint8Array(size);
  const reader = stream.getReader();
  let offset = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.byteLength > size - offset) {
        void reader.cancel().catch(() => undefined);
        return null;
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return offset === size && await sha256FileHex(bytes) === digest
    ? bytes
    : null;
}
