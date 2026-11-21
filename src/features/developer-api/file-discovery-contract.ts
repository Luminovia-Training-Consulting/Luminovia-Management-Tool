/** Internal native contracts for scoped discovery and personal file organisation. */
import { z } from "zod";
import {
  archivedPersonalMaterialPageSchema,
  documentDiscoveryWireSchema,
  documentKind,
  documentNameSchema,
  documentOrganisationInputSchema,
  documentOrganisationSchema,
} from "../files/schema.ts";

const id = z.uuid();
const instant = z.iso.datetime({ offset: true });
const filterFields = {
  p_search: z.string().max(160).optional().meta({ default: "" }),
  p_tag: z.string().max(60).optional().meta({ default: "" }),
  p_folder: z.string().max(80).nullable().optional(),
  p_owner: id.nullable().optional(),
  p_kind: z
    .union([documentKind, z.literal("")])
    .optional()
    .meta({ default: "" }),
  p_job: id.nullable().optional(),
};

function pageRequest(
  filters: z.ZodRawShape,
  upperBound: number,
  defaultSize: number,
) {
  const common = {
    ...filters,
    p_limit: z
      .number()
      .int()
      .min(1)
      .max(upperBound)
      .optional()
      .meta({ default: defaultSize }),
  };
  return z.union([
    z.strictObject({
      ...common,
      p_before_at: z.null().optional(),
      p_before_id: z.null().optional(),
    }),
    z.strictObject({ ...common, p_before_at: instant, p_before_id: id }),
  ]);
}

const errorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.string().nullable().optional(),
  hint: z.string().nullable().optional(),
});
const json = (schema: z.ZodType) => ({
  "application/json": { schema: z.toJSONSchema(schema) },
});
const error = (description: string, schema: z.ZodType = errorSchema) => ({
  description,
  content: json(schema),
});

function operation(
  operationId: string,
  summary: string,
  description: string,
  request: z.ZodType,
  result: z.ZodType | null,
  options: { optional?: boolean; compareVersion?: boolean } = {},
) {
  return {
    post: {
      operationId,
      summary,
      description,
      tags: ["Files"],
      requestBody: { required: !options.optional, content: json(request) },
      responses: {
        ...(result
          ? {
              "200": {
                description: "Current server result",
                content: json(result),
              },
            }
          : {
              "204": { description: "Operation confirmed. No response body." },
            }),
        "400": error("Invalid filters, cursor or request data."),
        "401": error("Authentication required."),
        "403": error(
          "The caller does not have current access to the file or operation.",
        ),
        "404": error("The supplied named arguments do not match this RPC."),
        ...(options.compareVersion
          ? {
              "409": error(
                "The personal organisation version has changed. Reload before editing.",
                errorSchema.extend({ code: z.literal("PT409") }),
              ),
            }
          : {}),
      },
    },
  };
}

export const fileDiscoveryPaths = {
  "/rest/v1/rpc/document_discovery": operation(
    "discoverDocuments",
    "Search currently accessible file metadata",
    "Search uses literal case-insensitive filename matching. Tags and virtual folders apply only to the current account's own labels. A null folder accepts any folder and an empty folder selects files without a personal folder. Owner, kind and job filters never add permission. Results exclude archived files and sort by creation time and ID, newest first. Continue with both values from next_cursor.",
    pageRequest(filterFields, 100, 40),
    documentDiscoveryWireSchema,
    { optional: true },
  ),
  "/rest/v1/rpc/save_document_organisation": operation(
    "saveDocumentOrganisation",
    "Save my tags and virtual folder for an accessible document",
    "Requires current access to the document. Send version zero to create the first personal annotation, or the latest personal version to edit it. The update changes the caller's tags and virtual folder only. Tags are trimmed and deduplicated case-insensitively. An empty string clears the folder label. Returns the committed personal annotation.",
    z.strictObject({
      p_document_id: id,
      p_payload: documentOrganisationInputSchema,
      p_expected_version: z.number().int().min(0).max(2147483647),
    }),
    documentOrganisationSchema,
    { compareVersion: true },
  ),
  "/rest/v1/rpc/archived_personal_materials": operation(
    "listArchivedPersonalMaterials",
    "List my restorable archived personal materials",
    "Returns the caller's own ordinary personal materials whose current exact version is clean and recoverable. Dedicated registries, other file kinds and deletion-fenced material are excluded. Continue using the last item's archive time and ID. Rows are newest first by archive time and ID.",
    pageRequest({}, 50, 30),
    archivedPersonalMaterialPageSchema,
    { optional: true },
  ),
  "/rest/v1/rpc/restore_personal_material": operation(
    "restorePersonalMaterial",
    "Restore my archived personal material",
    "Restores an eligible own material with an unchanged clean current version. The server checks the current deletion fence and dedicated evidence registry. Repeating a confirmed restore while access persists preserves the existing restoration.",
    z.strictObject({ p_id: id }),
    null,
  ),
  "/rest/v1/rpc/rename_document": operation(
    "renameOrArchiveOwnedDocument",
    "Rename or archive my accessible document",
    "Requires current document ownership and access. The new filename updates document metadata. Set p_delete to true to archive the document.",
    z.strictObject({
      p_id: id,
      p_name: documentNameSchema,
      p_delete: z.boolean().nullable().optional().meta({ default: false }),
    }),
    null,
  ),
};
