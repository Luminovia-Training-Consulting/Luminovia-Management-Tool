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

/** Accept a stored object only when it matches the validated upload exactly. */
export async function readMatchingFileBytes(
  object: Blob,
  size: number,
  digest: string,
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (object.size !== size) return null;
  const bytes = new Uint8Array(await object.arrayBuffer());
  return bytes.byteLength === size && await sha256FileHex(bytes) === digest
    ? bytes
    : null;
}
