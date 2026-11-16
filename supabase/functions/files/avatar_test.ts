/**
 * Synthetic PNG pieces with real CRC/Deflate data exercise valid and altered avatars. Structural tests do not replace ClamAV.
 */
import { crc32, validateAvatar } from "./avatar.ts";
// Fail a specific fixture condition as a real test failure; never substitute silent success.
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
// Concatenate only the synthetic PNG fixture's byte fragments.
function join(...parts: Uint8Array[]) {
  const result = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0),
  );
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
// Build a synthetic PNG chunk with a matching CRC before deliberate mutations.
function chunk(type: string, bytes: Uint8Array) {
  const result = new Uint8Array(bytes.length + 12),
    view = new DataView(result.buffer);
  view.setUint32(0, bytes.length);
  result.set(new TextEncoder().encode(type), 4);
  result.set(bytes, 8);
  view.setUint32(8 + bytes.length, crc32(result.subarray(4, 8 + bytes.length)));
  return result;
}
// Build a small synthetic PNG with real Deflate payload for structural validation.
async function image(
  width = 1,
  height = 1,
  row = new Uint8Array([0, 20, 40, 60, 255]),
  extra?: Uint8Array,
) {
  const ihdr = new Uint8Array(13),
    view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const compressed = new Uint8Array(
    await new Response(
      new Blob([new Uint8Array(row)])
        .stream()
        .pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  return join(
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    ...(extra ? [extra] : []),
    chunk("IDAT", compressed),
    chunk("IEND", new Uint8Array()),
  );
}
// Require the operation to reject and optionally check its stable failure reason.
async function rejects(bytes: Uint8Array) {
  let failed = false;
  try {
    await validateAvatar(bytes);
  } catch {
    failed = true;
  }
  assert(failed, "Unsafe avatar image must be rejected");
}
Deno.test(
  "canonical PNG validates real zlib scanlines and rejects CRC corruption/truncation/trailing bytes",
  async () => {
    assert(
      crc32(new TextEncoder().encode("123456789")) === 0xcbf43926,
      "Known CRC-32 vector",
    );
    const png = await image();
    await validateAvatar(png);
    const corrupt = png.slice();
    corrupt[45] ^= 1;
    await rejects(corrupt);
    await rejects(png.subarray(0, png.length - 1));
    await rejects(join(png, new Uint8Array([0])));
  },
);
Deno.test(
  "avatar validation rejects source metadata, oversized dimensions, malformed decoded rows and PNG inflation bombs",
  async () => {
    await rejects(
      await image(
        1,
        1,
        undefined,
        chunk("tEXt", new TextEncoder().encode("Location\0Private GPS")),
      ),
    );
    await rejects(await image(513, 1));
    await rejects(await image(1, 1, new Uint8Array([0, 1, 2])));
    await rejects(await image(1, 1, new Uint8Array([7, 1, 2, 3, 4])));
    await rejects(await image(1, 1, new Uint8Array(1048576)));
  },
);
Deno.test(
  "safe encoder density/colour intent is accepted but EXIF and compressed profiles never pass",
  async () => {
    await validateAvatar(
      await image(1, 1, undefined, chunk("sRGB", new Uint8Array([0]))),
    );
    for (const type of ["eXIf", "iCCP", "iTXt", "zTXt"])
      await rejects(
        await image(1, 1, undefined, chunk(type, new Uint8Array([0]))),
      );
    await rejects(new Uint8Array(2097153));
  },
);
