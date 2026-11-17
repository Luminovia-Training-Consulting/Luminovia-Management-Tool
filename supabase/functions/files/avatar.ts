/**
 * Additional structural validation for canonical small PNG avatars. Check headers, CRCs, allowed chunks and bounded decompressed scanlines; malware scanning remains mandatory and separate.
 */
export const MAX_AVATAR_SIZE = 1_000_000;
// Images accepted before the smaller upload limit remain readable.
export const LEGACY_MAX_AVATAR_SIZE = 2 * 1024 * 1024;
const MAX_AVATAR_EDGE = 512;
const signature = [137, 80, 78, 71, 13, 10, 26, 10];
const table = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
// Compute the PNG chunk CRC over type and payload bytes to detect altered chunks.
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = table[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
// Return a stable structural error without including bytes or private file contents.
function invalid(): never {
  throw new Error("avatar_image_invalid");
}

/** Canonical browser output only: small RGB/RGBA PNG, no textual/EXIF/profile
 * chunks, correct CRCs and bounded decoded scanlines. ClamAV remains mandatory;
 * image structure validation is an additional boundary, not a scan substitute. */
// Validate the bounded canonical PNG and decompressed row length; reject foreign metadata chunks.
export async function validateAvatar(
  bytes: Uint8Array,
  maxExclusive = MAX_AVATAR_SIZE,
): Promise<void> {
  if (bytes.length >= maxExclusive || bytes.length < 57) invalid();
  if (!signature.every((value, i) => bytes[i] === value)) invalid();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8,
    width = 0,
    height = 0,
    channels = 0,
    ended = false;
  let seenData = false,
    dataEnded = false;
  const compressed: Uint8Array<ArrayBuffer>[] = [];
  while (at < bytes.length) {
    if (at + 12 > bytes.length) invalid();
    const size = view.getUint32(at),
      end = at + 12 + size;
    if (end > bytes.length) invalid();
    const type = new TextDecoder().decode(bytes.subarray(at + 4, at + 8));
    const chunk = bytes.subarray(at + 8, at + 8 + size);
    if (
      crc32(bytes.subarray(at + 4, at + 8 + size)) !==
      view.getUint32(at + 8 + size)
    )
      invalid();
    if (type === "IHDR") {
      if (at !== 8 || size !== 13 || width) invalid();
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      channels = chunk[9] === 6 ? 4 : chunk[9] === 2 ? 3 : 0;
      if (
        width < 1 ||
        height < 1 ||
        width > MAX_AVATAR_EDGE ||
        height > MAX_AVATAR_EDGE ||
        chunk[8] !== 8 ||
        !channels ||
        chunk[10] ||
        chunk[11] ||
        chunk[12]
      )
        invalid();
    } else if (!width) invalid();
    else if (type === "IDAT") {
      if (dataEnded) invalid();
      seenData = true;
      compressed.push(new Uint8Array(chunk));
    } else if (type === "IEND") {
      if (!seenData || size || end !== bytes.length) invalid();
      ended = true;
    } else {
      if (seenData) dataEnded = true;
      // Canvas encoders may include colour intent or pixel density. Neither
      // can carry an EXIF location, a textual comment or a compressed ICC blob.
      if (!(
        (type === "sRGB" && size === 1 && chunk[0] <= 3) ||
        (type === "pHYs" && size === 9 && chunk[8] <= 1)
      ))
        invalid();
    }
    at = end;
  }
  if (!ended) invalid();
  const expected = (1 + width * channels) * height;
  const reader = new Blob(compressed)
    .stream()
    .pipeThrough(new DecompressionStream("deflate"))
    .getReader();
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (length + next.value.length > expected) {
        await reader.cancel();
        invalid();
      }
      for (let i = 0; i < next.value.length; i++)
        if ((length + i) % (1 + width * channels) === 0 && next.value[i] > 4)
          invalid();
      length += next.value.length;
    }
  } catch {
    invalid();
  } finally {
    reader.releaseLock();
  }
  if (length !== expected) invalid();
}
