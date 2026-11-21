/** Stable HTTP response shapes shared by the protected document gateways. */
export const fileMediaTypes = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

const text = { type: "string" };
const uuid = { ...text, format: "uuid" };

export const gatewayOriginHeader = {
  name: "Origin",
  in: "header",
  required: true,
  schema: { ...text, format: "uri" },
};

export const privateDownloadHeaders = {
  "Cache-Control": { schema: { const: "no-store, private" } },
  "Content-Disposition": { schema: text },
  "X-Content-Type-Options": { schema: { const: "nosniff" } },
};

const byteSchema = { schema: { ...text, format: "binary" } };
export const fileByteContent = Object.fromEntries(
  [...fileMediaTypes, "application/octet-stream"].map((type) => [
    type,
    byteSchema,
  ]),
) as Record<
  (typeof fileMediaTypes)[number] | "application/octet-stream",
  typeof byteSchema
>;

export function documentGatewayError(
  description: string,
  codes: string[],
  includeDocumentId = false,
) {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["error"],
          properties: {
            error: { enum: codes },
            ...(includeDocumentId ? { document_id: uuid } : {}),
          },
          additionalProperties: false,
        },
      },
    },
  };
}

export const commonDocumentErrors = {
  "400": documentGatewayError("Invalid request", ["invalid_request"]),
  "401": documentGatewayError("Authentication required", [
    "authentication_required",
  ]),
  "405": documentGatewayError("Unsupported HTTP method", [
    "method_not_allowed",
  ]),
};

export const renderedDocumentErrors = {
  ...commonDocumentErrors,
  "403": documentGatewayError("Origin or current document access denied", [
    "origin_not_allowed",
    "document_unavailable",
    "document_changed_or_revoked",
  ]),
  "422": documentGatewayError(
    "PDF font cannot represent a retained character",
    ["unsupported_glyph"],
  ),
  "503": documentGatewayError("Document integrity or service unavailable", [
    "document_unavailable",
    "document_integrity_failed",
  ]),
};
