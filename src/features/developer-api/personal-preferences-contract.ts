/** Reviewed internal contracts for the authenticated account's presentation state. */
import { z } from "zod";
import { uiPreferencesSchema } from "../../lib/ui-preferences-schema.ts";
import { dashboardPreferencesSchema } from "../dashboard/personal-schema.ts";
import { welcomeProgressSchema } from "../onboarding/schema.ts";

const int32Max = 2147483647;
const version = z.number().int().min(0).max(int32Max);
const noArguments = z.strictObject({});
const uiPatch = uiPreferencesSchema
  .omit({ version: true })
  .partial()
  .strict()
  .meta({ minProperties: 1 });
const dashboardPayload = dashboardPreferencesSchema
  .omit({ version: true })
  .strict();
const uiPreferences = uiPreferencesSchema.extend({ version }).strict();
const dashboardPreferences = dashboardPreferencesSchema
  .extend({ version })
  .strict();
const welcomeProgress = welcomeProgressSchema.extend({ version }).strict();

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
const conflict = error(
  "The expected version does not match the current state. Reload before editing.",
  errorSchema.extend({ code: z.literal("PT409") }),
);

function operation(
  operationId: string,
  summary: string,
  description: string,
  request: z.ZodType,
  result: z.ZodType,
  versioned = false,
) {
  return {
    post: {
      operationId,
      tags: ["Personal preferences"],
      summary,
      description,
      requestBody: {
        required: request !== noArguments,
        content: json(request),
      },
      responses: {
        "200": {
          description: "The current result for the authenticated account.",
          content: json(result),
        },
        "400": error("Invalid preference values or version."),
        "401": error("Authentication required."),
        "403": error("The current account cannot use this operation."),
        "404": error("The supplied named arguments do not match this RPC."),
        ...(versioned ? { "409": conflict } : {}),
      },
    },
  };
}

export const personalPreferencesPaths = {
  "/rest/v1/rpc/ui_preferences": operation(
    "readOwnUiPreferences",
    "Read own language, appearance and sidebar state",
    "Reads the current account's profile language and saved presentation settings. The initial appearance is system, the sidebar is expanded, and the version is zero. Active guest accounts and active, confirmed participant-only accounts can read their own settings.",
    noArguments,
    uiPreferences,
  ),
  "/rest/v1/rpc/save_ui_preferences": operation(
    "saveOwnUiPreferences",
    "Patch own language, appearance or sidebar state",
    "Send one or more settings. Omitted settings keep their current values. Changing the language also updates the current account's profile locale. The server increments the version and returns all three settings. Active guest accounts and active, confirmed participant-only accounts can save their own settings.",
    z.strictObject({ p_patch: uiPatch }),
    uiPreferences,
  ),
  "/rest/v1/rpc/get_welcome_progress": operation(
    "readOwnWelcomeProgress",
    "Read own saved progress in the portal guide",
    "Requires an operational session. The initial result is step welcome, status active and version zero. Reading the default does not create a progress record.",
    noArguments,
    welcomeProgress,
  ),
  "/rest/v1/rpc/save_welcome_progress": operation(
    "saveOwnWelcomeProgress",
    "Save own progress in the portal guide",
    "Requires an operational session. Send the step, status and version from the latest read. Version zero creates the first record. A successful save increments the version and returns the committed progress.",
    z.strictObject({
      p_step: welcomeProgressSchema.shape.step,
      p_status: welcomeProgressSchema.shape.status,
      p_expected_version: version.max(int32Max - 1),
    }),
    welcomeProgress,
    true,
  ),
  "/rest/v1/rpc/dashboard_preferences": operation(
    "readOwnDashboardPreferences",
    "Read own dashboard widget order and visibility",
    "Requires an operational session. The initial result contains the default widget order, no hidden widgets and version zero. The result contains layout settings only.",
    noArguments,
    dashboardPreferences,
  ),
  "/rest/v1/rpc/save_dashboard_preferences": operation(
    "saveOwnDashboardPreferences",
    "Save own dashboard widget order and visibility",
    "Requires an operational session. Include all five widgets in the desired order and a unique list of hidden widgets. Send the version from the latest read. The saved layout does not grant access to the data shown in any widget.",
    z.strictObject({
      p_payload: dashboardPayload,
      p_expected_version: version,
    }),
    dashboardPreferences,
    true,
  ),
};
