import { sha256FileHex, webFileBytes } from "./file-bytes.ts";

Deno.test("file digest and response restrict output to the selected range without copying the buffer", async () => {
  const original = new TextEncoder().encode("prefixabcsuffix");
  const selection = original.subarray(6, 9);
  const body = webFileBytes(selection);
  if (
    body.buffer !== original.buffer || body.byteOffset !== 6 ||
    body.byteLength !== 3
  ) {
    throw new Error(
      "expected the exact byte range in the original file buffer",
    );
  }
  if (await new Response(body).text() !== "abc") {
    throw new Error("unrelated bytes entered the response");
  }
  const expected =
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  if (
    await sha256FileHex(selection) !== expected ||
    await sha256FileHex(selection.slice().buffer) !== expected
  ) {
    throw new Error("incorrect SHA-256 for the selected file bytes");
  }
});

Deno.test("a shared buffer becomes an isolated snapshot of only the selected bytes", () => {
  const shared = new Uint8Array(new SharedArrayBuffer(4));
  shared.set([1, 2, 3, 4]);
  const body = webFileBytes(shared.subarray(1, 3));
  shared.fill(0);
  if (!(body.buffer instanceof ArrayBuffer) || body.toString() !== "2,3") {
    throw new Error("expected a stable snapshot of the selected shared bytes");
  }
});
