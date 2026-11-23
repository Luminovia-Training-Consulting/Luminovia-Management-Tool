import { z } from "zod";
import {
  academyAppearancePatchSchema,
  academyAppearanceSchema,
  academyPersonalSettingsSchema,
  academyUsernameRequestSchema,
  academyUsernameSchema,
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

const usernameSave = operation(
  "saveOwnAcademyUsername",
  "Set or clear your academy username",
  "Use the current username version. Submit null to clear the alias. The server trims and lowercases the value. The normalized name must be 3–32 characters, start with a letter and end with a letter or digit. Letters, digits, periods, underscores and hyphens are accepted. Reserved names are refused. The same native Auth account continues to accept its email and password.",
  academyUsernameRequestSchema,
  academyUsernameSchema,
);

export const academyPersonalSettingsPaths = {
  "/rest/v1/rpc/academy_personal_settings": operation(
    "readOwnAcademyPersonalSettings",
    "Read your academy username and appearance",
    "Requires a confirmed eligible academy account and the current operator-enabled academy profile. Licence grace permits this read. An unset alias is null with version zero for a new account. Appearance includes the current profile locale and the saved theme.",
    noArguments,
    academyPersonalSettingsSchema,
    true,
  ),
  "/rest/v1/rpc/academy_save_username": {
    post: {
      ...usernameSave.post,
      responses: {
        ...usernameSave.post.responses,
        "409": failure(
          "The username is unavailable or the expected version is stale.",
          nativeError.extend({ code: z.enum(["23505", "PT409"]) }),
        ),
      },
    },
  },
  "/rest/v1/rpc/academy_save_appearance": operation(
    "saveOwnAcademyAppearance",
    "Save your academy language or theme",
    "Requires an active licence and the current academy profile. Send one or both settings. Omitted values keep their current state. A successful save returns the current appearance and increments its version.",
    z.strictObject({ p_patch: academyAppearancePatchSchema }),
    academyAppearanceSchema,
  ),
};
