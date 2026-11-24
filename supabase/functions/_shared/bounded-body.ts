/** Edge request readers enforce byte limits before parsing or invoking downstream services. */

/** Endpoints use their existing HTTP error envelopes for oversize input. */
export class RequestBodyTooLarge extends Error {
  constructor() {
    super("request_too_large");
  }
}

function checkDeclaredLength(request: Request, limit: number) {
  if (Number(request.headers.get("content-length") ?? 0) > limit) {
    throw new RequestBodyTooLarge();
  }
}

/** Read at most the supplied byte limit, checking both the header and actual stream. */
export async function boundedBytes(
  request: Request,
  limit: number,
): Promise<Uint8Array<ArrayBuffer>> {
  checkDeclaredLength(request, limit);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) {
        // The size response must not wait for the underlying stream to finish cancelling.
        void reader.cancel().catch(() => undefined);
        throw new RequestBodyTooLarge();
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Bound multipart bytes as they reach the native parser without copying the full upload. */
export async function boundedFormData(request: Request, limit: number): Promise<FormData> {
  checkDeclaredLength(request, limit);
  let size = 0;
  const body = request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) throw new RequestBodyTooLarge();
      controller.enqueue(chunk);
    },
  }));
  const contentType = request.headers.get("content-type");
  return await new Response(body, {
    headers: contentType ? { "Content-Type": contentType } : undefined,
  }).formData();
}

/** Parse JSON strictly as UTF-8. Callers validate the endpoint-specific shape. */
export async function boundedJson(request: Request, limit: number): Promise<unknown> {
  try {
    const bytes = await boundedBytes(request, limit);
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof RequestBodyTooLarge) throw error;
    throw new Error("invalid_request");
  }
}
