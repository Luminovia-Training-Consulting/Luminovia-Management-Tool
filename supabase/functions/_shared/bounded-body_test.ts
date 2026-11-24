/** Exercise the Edge reader with in-memory streams and fictional JSON. */
import assert from "node:assert/strict";
import { boundedBytes, boundedFormData, boundedJson, RequestBodyTooLarge } from "./bounded-body.ts";

const url = "https://edge.example.invalid/";
const encode = (value: string) => new TextEncoder().encode(value);

/** Split a request across chunks, including inside a multibyte character. */
Deno.test("bounded JSON counts bytes and accepts valid UTF-8 at the exact limit", async () => {
  const bytes = encode('{"name":"März"}');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 11));
      controller.enqueue(bytes.subarray(11));
      controller.close();
    },
  });
  const request = new Request(url, { method: "POST", body });
  assert.deepEqual(await boundedJson(request, bytes.length), { name: "März" });
  assert.equal(body.locked, false);
});

/** A low declared length cannot bypass the byte count or delay returning the limit error. */
Deno.test("oversize stream releases its lock immediately and requests cancellation", async () => {
  const cancellation = Promise.withResolvers<void>();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encode("12"));
      controller.enqueue(encode("34"));
    },
    cancel() {
      cancelled = true;
      return cancellation.promise;
    },
  });
  const request = new Request(url, {
    method: "POST",
    headers: { "content-length": "1" },
    body,
  });
  try {
    await assert.rejects(boundedJson(request, 3), RequestBodyTooLarge);
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
  } finally {
    cancellation.resolve();
  }
});

/** Malformed text is never repaired into an accepted field value. */
Deno.test("bounded JSON rejects invalid UTF-8, malformed JSON and a missing body", async () => {
  for (const body of [new Uint8Array([0x22, 0xc3, 0x22]), "{", undefined]) {
    const request = new Request(url, { method: "POST", body });
    await assert.rejects(boundedJson(request, 32), { message: "invalid_request" });
  }
});

/** Byte reads support binary callers and can reject excessive Content-Length without reading. */
Deno.test("bounded binary reads keep their bytes and reject a large declared length", async () => {
  const bytes = new Uint8Array([0xff, 0xfe, 0x00]);
  const request = new Request(url, { method: "POST", body: bytes });
  assert.deepEqual(await boundedBytes(request, bytes.length), bytes);
  const oversized = new Request(url, {
    method: "POST",
    headers: { "content-length": "4" },
    body: bytes,
  });
  await assert.rejects(boundedBytes(oversized, bytes.length), RequestBodyTooLarge);
  assert.equal(oversized.bodyUsed, false);
});


Deno.test("bounded multipart preserves a Unicode filename and binary file bytes at the exact limit", async () => {
  const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x1f]);
  const fields = new FormData();
  fields.set("title", "März");
  fields.set("file", new File([bytes], "Übung.pdf", { type: "application/pdf" }));
  const encoded = new Request(url, { method: "POST", body: fields });
  const body = new Uint8Array(await encoded.arrayBuffer());
  const parsed = await boundedFormData(new Request(url, {
    method: "POST",
    headers: encoded.headers,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < body.length; offset += 11) {
          controller.enqueue(body.subarray(offset, offset + 11));
        }
        controller.close();
      },
    }),
  }), body.length);
  assert.equal(parsed.get("title"), "März");
  const file = parsed.get("file");
  assert.ok(file instanceof File);
  assert.equal(file.name, "Übung.pdf");
  assert.equal(file.type, "application/pdf");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
});

Deno.test("bounded multipart rejects declared and streamed overflow with the same size error", async () => {
  const contentType = "multipart/form-data; boundary=fixture";
  const declared = new Request(url, {
    method: "POST",
    headers: { "content-type": contentType, "content-length": "2" },
    body: "12",
  });
  await assert.rejects(boundedFormData(declared, 1), RequestBodyTooLarge);
  assert.equal(declared.bodyUsed, false);

  const cancelled = Promise.withResolvers<void>();
  const streamed = new Request(url, {
    method: "POST",
    headers: { "content-type": contentType, "content-length": "1" },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode("12"));
      },
      cancel() {
        cancelled.resolve();
      },
    }),
  });
  await assert.rejects(boundedFormData(streamed, 1), RequestBodyTooLarge);
  await cancelled.promise;
});
