import { z } from "zod";
import {
  academyAppearancePatchSchema,
  academyAppearanceSchema,
  academyPersonalSettingsSchema,
} from "../accounts/academy-personal-settings-schema.ts";

const noArguments = z.strictObject({});
const jwt = [{ apiKey: [], bearerAuth: [] }];
const nativeError = z.strictObject({
  code: z.string(),
  message: z.string(),
  details: z.string().nullable(),
  hint: z.string().nullable(),
});
const json = (schema: z.ZodType) => ({
  "application/json": { schema: z.toJSONSchema(schema) },
});
const failure = (description: string, schema: z.ZodType = nativeError) => ({
  description,
  content: json(schema),
});

function operation(
  operationId: string,
  summary: string,
  description: string,
  request: z.ZodType,
  result: z.ZodType,
  grace = false,
) {
  return {
    post: {
      operationId,
      tags: ["Academy account settings"],
      summary,
      description,
      security: jwt,
      "x-portal-licence": grace ? "active-or-grace" : "active",
      requestBody: {
        required: request !== noArguments,
        content: json(request),
      },
      responses: {
        "200": {
          description: "Current settings for the authenticated actor.",
          content: json(result),
        },
        "400": failure("Invalid settings or expected version."),
        "401": failure("Authentication required."),
        "403": failure(
          "The current account or academy profile cannot use this operation.",
        ),
      },
    },
  };
}

export const academyPersonalSettingsPaths = {
  "/rest/v1/rpc/academy_personal_settings": operation(
    "readOwnAcademyPersonalSettings",
    "Read your academy display name and appearance",
    "Requires a confirmed eligible academy account and the current operator-enabled academy profile. Licence grace permits this read. Appearance includes the current profile locale and the saved theme.",
    noArguments,
    academyPersonalSettingsSchema,
    true,
  ),
  "/rest/v1/rpc/academy_save_display_name": operation(
    "saveOwnAcademyDisplayName",
    "Save your academy display name",
    "Updates the current account's display name only. Requires active Academy access.",
    z.strictObject({ p_display_name: z.string().trim().min(1).max(120) }),
    z.string(),
  ),
  "/rest/v1/rpc/academy_save_appearance": operation(
    "saveOwnAcademyAppearance",
    "Save your academy language or theme",
    "Requires an active licence and the current academy profile. Send one or both settings. Omitted values keep their current state. A successful save returns the current appearance and increments its version.",
    z.strictObject({ p_patch: academyAppearancePatchSchema }),
    academyAppearanceSchema,
  ),
};
