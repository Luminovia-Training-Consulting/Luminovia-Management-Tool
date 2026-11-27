/** Profile projections share the database's current access and disclosure rules. */
import { z } from "zod";
import { accountLanguages } from "../../lib/account-languages.ts";
import {
  contactPreferencesSchema,
  contactVisibilityInput,
  personContactSchema,
  topicPreferencesSchema,
} from "../profile/privacy-schema.ts";

const jsonSchema = z.toJSONSchema;
const uuid = z.string().meta({ format: "uuid" });
const user = { p_user_id: jsonSchema(uuid) };
const companyParticipant = { ...user, p_organisation_id: jsonSchema(uuid) };
const version = { type: "integer", minimum: 0, maximum: 2_147_483_647 };
const profileDetails = z.object({
  country: z.string().max(100),
  languages: z.array(z.string()),
  teaching_experience: z.string().max(4_000),
  labels: z.array(z.string()),
});
const teachingMinutes = z.number().int().nonnegative().nullable();
const profileDetailsInput = profileDetails
  .extend({
    country: profileDetails.shape.country.nullable(),
    languages: profileDetails.shape.languages.max(15),
    teaching_experience: profileDetails.shape.teaching_experience.nullable(),
    labels: profileDetails.shape.labels.max(20),
  })
  .partial();
const visiblePerson = profileDetails
  .omit({ teaching_experience: true })
  .extend({
    id: uuid,
    luminovia_user_id: z.string().regex(/^LV-(?:[0-9A-F]{4}-){4}[0-9A-F]{4}$/),
    display_name: z.string().max(120),
    bio_de: z.string().max(4_000),
    bio_en: z.string().max(4_000),
    time_zone: z.string(),
    topics: z.array(
      z.object({
        id: uuid,
        label_de: z.string(),
        label_en: z.string(),
        kind: z.enum(["topic", "tool", "language"]),
        verified: z.boolean(),
      }),
    ),
  });
const managedProfile = z.object({
  display_name: z.string().max(120),
  locale: z.enum(accountLanguages),
  time_zone: z.string(),
});
const managedProfileInput = managedProfile.extend({ display_name: z.string() });
const avatar = z
  .object({
    version_id: uuid,
    updated_at: z.iso.datetime({ offset: true }),
  })
  .nullable();

type ProfileContract = {
  summary: string;
  description: string;
  request?: Record<string, unknown>;
  result: z.ZodType | null;
  optional?: readonly string[];
  staleCode?: "PT409" | "40001";
};

export const profileContracts: Record<string, ProfileContract> = {
  own_profile_details: {
    summary: "Read your own additional profile details",
    description:
      "An active account without a saved record receives empty text and lists. Teaching minutes reflect confirmed delivery and approved legacy time records and are null for accounts without a lecturer role. An approved break is deducted when its time record matches the confirmed delivery interval.",
    result: profileDetails.extend({ teaching_minutes: teachingMinutes }),
  },
  save_profile_details: {
    summary: "Replace your own additional profile details",
    description:
      "Omitted fields are cleared. The server trims and deduplicates language and label entries without regard to case. After trimming, each language must have 1–50 characters and each label 1–40 characters. Control characters are rejected in these lists.",
    request: { p_payload: jsonSchema(profileDetailsInput) },
    result: null,
  },
  people_directory: {
    summary: "Search the visible staff directory",
    description:
      "At most 200 visible staff profiles are returned. An omitted or null filter has no effect. Topic filters match only expertise currently visible to the caller. A profile with no visible ratings has rating_average and review_count set to zero.",
    request: {
      p_search: jsonSchema(z.string().max(100).nullable()),
      p_label: jsonSchema(z.string().max(40).nullable()),
      p_topic_id: jsonSchema(uuid.nullable()),
    },
    optional: ["p_search", "p_label", "p_topic_id"],
    result: z
      .array(
        visiblePerson.extend({
          rating_average: z.number().min(0).max(5),
          review_count: z.number().int().nonnegative(),
        }),
      )
      .max(200),
  },
  person_profile: {
    summary: "Read an authorised person's profile",
    description:
      "Returns the target visible profile and the caller's review moderation capability. Hidden expertise is represented by an empty array. Private contact details are handled by the separate opt-in contact endpoint.",
    request: user,
    result: visiblePerson.extend({
      teaching_experience: profileDetails.shape.teaching_experience,
      teaching_minutes: teachingMinutes,
      can_moderate: z.boolean(),
    }),
  },
  person_contact: {
    summary: "Read staff contact details explicitly shared with you",
    description:
      "Only active staff can read contact fields an authorised staff member explicitly shared. Unshared or inaccessible values are null, including for administrators.",
    request: { p_user_id: jsonSchema(uuid.nullable()) },
    result: personContactSchema,
  },
  contact_visibility_preferences: {
    summary: "Read your own contact visibility preferences",
    description:
      "An active account receives its current contact fields, whether it can share as staff, and the version of the two opt-in settings. New accounts have both sharing options off at version zero.",
    result: contactPreferencesSchema,
  },
  save_contact_visibility_preferences: {
    summary: "Set which of your own contact fields staff can see",
    description:
      "Send both visibility settings and the last-read version. Enabling either requires a current staff role. A stale version returns HTTP 409.",
    request: {
      p_payload: jsonSchema(contactVisibilityInput),
      p_expected_version: version,
    },
    result: contactPreferencesSchema,
    staleCode: "PT409",
  },
  profile_topic_preferences: {
    summary: "Read your own expertise visibility preference",
    description:
      "The initial value is visible at version zero. The version is independent from contact visibility, and can_share reflects the current staff role.",
    result: topicPreferencesSchema,
  },
  save_profile_topic_preferences: {
    summary: "Set whether your expertise appears to other directory users",
    description:
      "Send the previous version. Enabling visibility requires current staff authority. The owner and authorised qualification reviewers can still see expertise. Existing eligibility checks remain in force.",
    request: { p_visible: { type: "boolean" }, p_expected_version: version },
    result: topicPreferencesSchema,
    staleCode: "40001",
  },
  managed_profile: {
    summary: "Read a subordinate's manageable profile fields",
    description:
      "Requires current users.manage permission and a subordinate account. Returns the display name, locale and time zone used for optimistic concurrency.",
    request: user,
    result: managedProfile,
  },
  save_managed_profile: {
    summary: "Update a subordinate's manageable profile fields",
    description:
      "Requires current users.manage permission and a subordinate account. Send all three fields and the complete previous result. The new display name must have 1–120 characters after trimming, and the time zone must be an IANA zone recognised by the database.",
    request: {
      ...user,
      p_payload: jsonSchema(managedProfileInput),
      p_expected: jsonSchema(managedProfile),
    },
    result: managedProfile,
    staleCode: "40001",
  },
  company_participant_profile: {
    summary: "Read manageable profile fields for a company participant",
    description:
      "Requires current Premium and an active association. Company staff can manage a participant-only account exclusively associated with their company. Portal staff with current subordinate account authority can manage a shared account.",
    request: companyParticipant,
    result: managedProfile,
  },
  save_company_participant_profile: {
    summary: "Update a company participant's basic account fields",
    description:
      "Uses the same live company and account checks as company_participant_profile. Send all three account fields and the complete previous result. Writes are audited.",
    request: {
      ...companyParticipant,
      p_payload: jsonSchema(managedProfileInput),
      p_expected: jsonSchema(managedProfile),
    },
    result: managedProfile,
    staleCode: "40001",
  },
  set_lecturer_expertise: {
    summary: "Add or remove a topic for a subordinate lecturer",
    description:
      "Requires qualification verification and subordinate account authority. Adding a topic does not attest the qualification. Revoke an existing verification before removing the topic.",
    request: {
      ...user,
      p_topic_id: jsonSchema(uuid),
      p_selected: { type: "boolean" },
    },
    result: null,
  },
  profile_avatar: {
    summary: "Read the current visible avatar reference",
    description:
      "Requires access to the target's profile. Returns the selected scanned image version and its selection timestamp, or null when there is no currently eligible avatar. The image bytes are read via the authenticated file gateway.",
    request: user,
    result: avatar,
  },
  set_profile_avatar: {
    summary: "Set or clear your own selected avatar",
    description:
      "Select your own eligible scanned PNG document version. Passing null or omitting the argument clears the selection and returns null.",
    request: { p_version_id: jsonSchema(uuid.nullable()) },
    optional: ["p_version_id"],
    result: avatar,
  },
};
