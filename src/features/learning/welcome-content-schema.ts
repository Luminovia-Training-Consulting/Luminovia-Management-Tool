/** Shared wire contract for course welcome planning and published revisions. */
import { z } from "zod";

export const welcomeHeadingLimit = 120;
export const welcomeTextLimit = 4000;
export const welcomeAttachmentLimit = 12;

const welcomeText = z.string().max(welcomeTextLimit);
const additionalFields = {
  heading: z.string().max(welcomeHeadingLimit),
  welcome_message: welcomeText,
  schedule_information: welcomeText,
  contact_instructions: welcomeText,
  protect_instructions: z.boolean(),
  attachment_ids: z.array(z.uuid()).max(welcomeAttachmentLimit),
};
const existingFields = {
  description: welcomeText,
  objectives: welcomeText,
  joining_instructions: welcomeText,
};

export const courseWelcomePayloadSchema = z.strictObject({
  ...existingFields,
  ...additionalFields,
});

const welcomeTargetFields = {
  p_run_id: z.uuid(),
  p_expected_version: z.int().nonnegative(),
};

/** PostgREST resolves legacy and current writes by their distinct named arguments. */
export const courseWelcomePublishRequestSchema = z.union([
  z.strictObject({
    ...welcomeTargetFields,
    p_payload: courseWelcomePayloadSchema,
  }),
  z.strictObject({
    ...welcomeTargetFields,
    p_description: welcomeText,
    p_objectives: welcomeText,
    p_joining_instructions: welcomeText,
  }),
]);

/** Legacy databases may omit the new fields during a staged rollout. */
export const courseWelcomeRevisionSchema = z.object({
  ...existingFields,
  heading: additionalFields.heading.default(""),
  welcome_message: additionalFields.welcome_message.default(""),
  schedule_information: additionalFields.schedule_information.default(""),
  contact_instructions: additionalFields.contact_instructions.default(""),
  protect_instructions: additionalFields.protect_instructions.default(false),
  attachment_ids: additionalFields.attachment_ids.default([]),
  version: z.int().nonnegative(),
  published_at: z.iso.datetime({ offset: true }).nullable(),
});

export type CourseWelcomePayload = z.infer<typeof courseWelcomePayloadSchema>;
export type CourseWelcomeRevision = z.infer<typeof courseWelcomeRevisionSchema>;
