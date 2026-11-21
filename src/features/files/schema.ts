/** Shared metadata shapes for the file browser and its reviewed API contract. */
import { z } from "zod";

const id = z.uuid();
const instant = z.iso.datetime({ offset: true });
const scope = z.enum(["personal", "room", "job_before", "job_after"]);
export const documentKind = z.enum([
  "material",
  "chat",
  "cv",
  "certificate",
  "contract",
  "invoice",
  "avatar",
]);
const scanStatus = z.enum([
  "quarantined",
  "scanning",
  "clean",
  "rejected",
  "scan_error",
]);
const personalFields = {
  personal_tags: z.array(z.string()),
  personal_folder: z.string(),
  personal_version: z.number().int().nonnegative(),
};
const metadataFields = {
  id,
  owner_id: id,
  uploaded_by: id,
  scope,
  kind: z.string(),
  room_id: id.nullable(),
  job_id: id.nullable(),
  original_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().nonnegative(),
  status: z.string(),
  current_version_id: id.nullable(),
  created_at: instant,
  deleted_at: instant.nullable(),
};

export type PortalDocument = z.infer<z.ZodObject<typeof metadataFields>> &
  Partial<z.infer<z.ZodObject<typeof personalFields>>>;

export const documentCursorSchema = z.object({ at: instant, id });
const discoveryRows = z.array(
  z.object({ ...metadataFields, ...personalFields }),
);
export const documentDiscoveryPageSchema = z
  .object({
    items: discoveryRows,
    has_more: z.boolean(),
    next_cursor: documentCursorSchema.nullable(),
  })
  .refine(
    (page) => page.has_more === Boolean(page.next_cursor),
    "Inconsistent document cursor",
  );
export type DocumentPage = z.infer<typeof documentDiscoveryPageSchema>;

// PostgREST exposes these two migrated document fields as part of the existing
// RPC. The browser projection only retains the metadata used by its interface.
const wireRows = z
  .array(
    z.strictObject({
      ...metadataFields,
      ...personalFields,
      kind: documentKind,
      status: scanStatus,
      size_bytes: z.number().int().min(1).max(104857600),
      deleted_at: z.null(),
      client_id: id,
      message_only: z.boolean(),
    }),
  )
  .max(100);
export const documentDiscoveryWireSchema = z.discriminatedUnion("has_more", [
  z.strictObject({
    items: wireRows,
    has_more: z.literal(true),
    next_cursor: documentCursorSchema,
  }),
  z.strictObject({
    items: wireRows,
    has_more: z.literal(false),
    next_cursor: z.null(),
  }),
]);

// eslint-disable-next-line no-control-regex
const labelPattern = /^[^\x00-\x1f\x7f]*$/;
const label = z.string().trim().regex(labelPattern);
const organisationFields = {
  tags: z.array(label.min(1).max(60)).max(20),
  folder: label.max(80),
};
export const documentOrganisationInputSchema =
  z.strictObject(organisationFields);
export const documentOrganisationSchema = z.object({
  ...organisationFields,
  version: z.number().int().positive(),
});

const archivedPersonalMaterialSchema = z.object({
  id,
  original_name: z.string().min(1).max(200),
  archived_at: instant,
});
export type ArchivedMaterial = z.infer<typeof archivedPersonalMaterialSchema>;
export const archivedPersonalMaterialPageSchema = z
  .array(archivedPersonalMaterialSchema)
  .max(50);

// eslint-disable-next-line no-control-regex
const fileNamePattern = /^[^/\\\x00-\x1f\x7f]+$/;
export const documentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(fileNamePattern);
