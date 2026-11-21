import {
  searchKinds,
  unifiedSearchPageSchema,
} from "../search/unified-schema.ts";
import {
  internalMailDownload,
  internalMailRead,
} from "./academy-mail-contract.ts";
import { knowledgeDocument, knowledgeSchemas } from "./knowledge-contract.ts";
import { sessionPaths } from "./session-contract.ts";
import { humanAuthPaths } from "./human-auth-contract.ts";
import { companyCourseIndexPath } from "./company-course-index-contract.ts";
import {
  companyCourseWebhook,
  companyWebhookDestination,
  companyWebhookListSchema,
} from "./course-webhook-contract.ts";
import {
  installationBrand,
  type InstallationBrand,
} from "../../lib/installation-brand.ts";
import { accountOpenApi } from "../../../supabase/functions/accounts/openapi.ts";
import { accountingPaths } from "./accounting-contract.ts";
import { academyExplorerOpenApi, academyOpenApi } from "./academy-contract.ts";
import { enquiriesSupportPaths } from "./enquiries-support-contract.ts";
import { courseBuildingBlockPaths } from "./course-building-block-contract.ts";
import {
  contractRecordsSchema,
  invoicePaymentsSchema,
  invoiceRecordsSchema,
} from "./commercial-records-contract.ts";
import {
  financePendingInvoiceExceptionsSchema,
  invoiceExceptionOptionsSchema,
  myInvoiceExceptionsSchema,
} from "../commercial/invoice-exception-schema.ts";
import { fileDiscoveryPaths } from "./file-discovery-contract.ts";
import { personalPreferencesPaths } from "./personal-preferences-contract.ts";
import { nativeDownloadPaths, nativeExplorerPaths } from "./native-contract.ts";
import {
  notificationCredentialPaths,
  notificationPaths,
} from "./notifications-contract.ts";
import {
  courseEnrolmentCandidatesResult,
  courseEnrolmentsResult,
  courseWelcomePublishedResult,
  courseWelcomeResult,
  courseWelcomeWrite,
  enrolmentState,
  meetingLinkResult,
  meetingUrl,
  myWorkspacesResult,
  participantInvitesResult,
  workspaceActionRequest,
  workspaceActionResult,
  workspaceResult,
} from "./learning-contract.ts";
import { z } from "zod";
import {
  calendarColorsSchema,
  calendarExportSchema,
  calendarImportReceipt,
  calendarSubscriptionSchema,
  calendarSwatchSchema,
} from "../calendar/schema.ts";
import {
  globalEventSchema,
  globalEventsPageSchema,
} from "../calendar/publications-schema.ts";
import { courseDestinationsSchema } from "../learning/destinations-schema.ts";
import { attendanceRegisterSchema } from "../learning/attendance-schema.ts";
import {
  courseClassAssignment,
  courseClassOptions,
} from "../learning/course-classes-schema.ts";
import { courseChatProtectionSchema } from "../learning/course-chat-protection-schema.ts";
import {
  readinessListSchema,
  readinessReceiptSchema,
  readinessSettingsInputSchema,
  readinessTaskInputSchema,
} from "../readiness/schema.ts";
import { assignmentChangeSchema, candidateSchema } from "../changes/schema.ts";
import {
  candidatesSchema as substitutionCandidatesSchema,
  ownWaitlistSchema,
  substitutionReceiptSchema,
  substitutionsSchema,
  waitlistSchema,
} from "../jobs/handover-schema.ts";
import {
  assignmentCalendarMetadataSchema,
  cursorSchema,
  discoveryPageSchema,
  jobDashboardSchema,
  jobFilterFieldsSchema,
  jobFiltersSchema,
  jobSchema,
  savedViewSchema,
} from "../jobs/discovery-schema.ts";
import {
  preparationIds,
  preparationSchema,
  teachingDaySchema,
} from "../dashboard/personal-schema.ts";
import {
  qualificationCertificatePage,
  qualificationHistoryPage,
  qualificationReviewSchema,
} from "../qualifications/schema.ts";
import {
  adminAnnouncementPageSchema,
  adminAnnouncementSchema,
  announcementFormSchema,
  announcementPageSchema,
  announcementSchema,
} from "../announcements/schema.ts";
import { controlSchema, forecastSchema } from "../workbench/finance-schema.ts";
import {
  companyPremiumCommandSchema,
  companyPremiumSettingsSchema,
  retainedCompanyLmsSchema,
} from "../operations/company-premium-schema.ts";
import {
  companyAssignableCoursesSchema,
  companyCourseAssignmentLimit,
  companyCourseAssignmentReceiptSchema,
  companyCourseSearchLimit,
  companyParticipantHistorySchema,
  companyParticipantOverviewSchema,
  companyParticipantReferenceSchema,
  companyParticipantsSchema,
  companyReferenceLimit,
} from "../operations/company-participant-schema.ts";

const uuid = { type: "string", format: "uuid" };
const boolean = { type: "boolean" };
const version = { type: "integer", minimum: 0 };
const text = { type: "string" };
const date = { type: "string", format: "date" };
const managedProfileFields = {
  display_name: { ...text, maxLength: 120 },
  locale: { enum: ["de", "en"] },
  time_zone: {
    ...text,
    description:
      "Time zone name recognized by the server, such as Europe/Berlin.",
  },
};
const operationsPeriod = { p_from: date, p_until: date };
const organisation = { p_organisation_id: uuid };
const idempotency = { p_request_id: uuid };
const course = { p_run_id: uuid };
const optionalUsername = {
  type: ["null", "string"],
  minLength: 3,
  maxLength: 32,
  pattern: "^[a-z][a-z0-9._-]{1,30}[a-z0-9]$",
};
const nullableUuid = { type: ["string", "null"], format: "uuid" };
const nullableDateTime = { type: ["string", "null"], format: "date-time" };
const attendanceStatus = { enum: ["present", "absent", "excused"] };
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const json = (schema: unknown) => ({ "application/json": { schema } });
const bytes = { type: "string", format: "binary" };
const courseChatAuditReason = { ...text, minLength: 8, maxLength: 300 };
const courseChatAttachment = {
  anyOf: [
    { type: "null" },
    object({
      version_id: uuid,
      name: text,
      size_bytes: { type: "integer", minimum: 1 },
    }),
  ],
};
const error = {
  description: "PostgREST error",
  content: json({
    type: "object",
    required: ["message", "code"],
    properties: {
      message: text,
      code: text,
      details: { type: ["null", "string"] },
      hint: { type: ["null", "string"] },
    },
  }),
};
const rpc = (
  operationId: string,
  tag: string,
  summary: string,
  description: string,
  input: Record<string, unknown>,
  result: unknown,
  optional: readonly string[] = [],
) => ({
  post: {
    operationId,
    tags: [tag],
    summary,
    description,
    requestBody: {
      required: Object.keys(input).some((name) => !optional.includes(name)),
      content: json({
        ...object(input),
        required: Object.keys(input).filter((name) => !optional.includes(name)),
      }),
    },
    responses: {
      "200": { description: "Current server result", content: json(result) },
      "400": error,
      "401": error,
      "403": error,
      "404": error,
      "409": error,
      "429": error,
      "503": error,
    },
  },
});

/** PostgreSQL void RPCs return HTTP 204 without a JSON response. */
function voidRpc(
  operationId: string,
  tag: string,
  summary: string,
  description: string,
  input: Record<string, unknown>,
) {
  const { post } = rpc(operationId, tag, summary, description, input, {});
  const { "200": success, ...errors } = post.responses;
  return {
    post: {
      ...post,
      responses: {
        ...errors,
        "204": { description: success.description + ". No response body." },
      },
    },
  };
}

const workspaceAction = {
  post: {
    ...rpc(
      "courseWorkspaceAction",
      "Premium LMS",
      "Apply a course workspace command",
      "Requires current Premium, course scope and action-specific authority. For a versioned edit, submit the current version shown in the workspace. Resource sharing requires a clean personal material version, except that authorised staff may share material from the same course job. The server assigns immutable staff, company or lecturer ownership. Retained attendance evidence cannot be removed. Quiz attempts are idempotent by request ID and return only the score and pass result. Completion issuance requires current completed enrolment, verified attendance and a pass on any published quiz.",
      {},
      workspaceActionResult,
    ).post,
    requestBody: { required: true, content: json(workspaceActionRequest) },
  },
};

const courseDocuments = {
  post: {
    operationId: "downloadCourseDocument",
    tags: ["Premium LMS"],
    summary: "Download an authorized course document or chat attachment",
    description:
      "Returns protected bytes only after current access and file integrity checks. The id is an exam share, resource, completion record, course run for attendance, or message for a chat attachment. A chat request uses the exact attachment version. Inspecting a retained company chat attachment as an active administrator requires both the organisation and an audit reason.",
    requestBody: {
      required: true,
      content: json({
        oneOf: [
          object({
            kind: { enum: ["resource", "exam", "completion", "attendance"] },
            id: uuid,
          }),
          object({
            kind: { const: "course_chat_attachment" },
            id: uuid,
            version_id: uuid,
          }),
          object({
            kind: { const: "course_chat_attachment" },
            id: uuid,
            version_id: uuid,
            organisation_id: uuid,
            reason: courseChatAuditReason,
          }),
        ],
      }),
    },
    responses: {
      "200": {
        description: "Authorized document bytes",
        content: {
          "application/pdf": { schema: bytes },
          "application/octet-stream": { schema: bytes },
          "*/*": { schema: bytes },
        },
      },
      "400": { description: "Invalid request" },
      "401": { description: "Authentication required" },
      "403": { description: "Document unavailable" },
      "503": { description: "Document access or integrity unavailable" },
    },
  },
};

/** Document the actual file gateway and its scoped, scanned byte paths. */
const fileGateway = {
  post: {
    // Preserve the existing operation ID for generated API clients.
    operationId: "uploadCourseMaterial",
    tags: ["Files"],
    summary: "Upload scanned documents or read authorized bytes",
    description:
      "Use multipart form data to upload up to 100 MiB. A clean response identifies the resulting document and exact version. Keep the same client_id and bytes for a retry. To read protected bytes, send the JSON action and current authorized reference. The gateway requires an approved browser Origin and checks permissions, scope and clean status.",
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            type: "object",
            required: ["file", "client_id"],
            properties: {
              file: { type: "string", format: "binary" },
              client_id: uuid,
              scope: {
                enum: ["personal", "room", "job_before", "job_after"],
                default: "personal",
              },
              kind: {
                enum: [
                  "material",
                  "chat",
                  "cv",
                  "certificate",
                  "contract",
                  "invoice",
                  "avatar",
                ],
                description:
                  "Defaults to chat for a room or material otherwise.",
              },
              room_id: { ...uuid, description: "Required for room uploads." },
              job_id: { ...uuid, description: "Required for job attachments." },
              replace_id: {
                ...uuid,
                description: "Existing authorized document to version.",
              },
              owner_id: {
                ...uuid,
                description:
                  "For an authorized upload on behalf of another user.",
              },
              message_only: {
                const: "true",
                description:
                  "Restricts a chat upload to an authorized room message. Requires room scope, chat kind and room_id. Omit job_id, replace_id and owner_id.",
              },
              course_chat: {
                const: "true",
                description:
                  "Use for a Premium participant course room. Requires message_only=true, scope=room, kind=chat and room_id.",
              },
            },
            additionalProperties: false,
          },
        },
        ...json({
          oneOf: [
            {
              ...object({
                action: { const: "download" },
                id: uuid,
                version_id: nullableUuid,
              }),
              required: ["action", "id"],
            },
            object({ action: { const: "avatar" }, user_id: uuid }),
            object({
              action: { const: "qualification_evidence_download" },
              evidence_id: uuid,
            }),
          ],
        }),
      },
    },
    responses: {
      "200": {
        description:
          "Clean document metadata after upload or authorized bytes for a download.",
        content: {
          ...json({
            type: "object",
            required: ["document"],
            properties: {
              document: {
                type: "object",
                required: ["id", "status", "current_version_id"],
                properties: {
                  id: uuid,
                  status: { const: "clean" },
                  current_version_id: uuid,
                },
                additionalProperties: true,
              },
            },
            additionalProperties: false,
          }),
          "application/octet-stream": { schema: bytes },
          "image/png": { schema: bytes },
          "application/pdf": { schema: bytes },
          "*/*": { schema: bytes },
        },
      },
      "400": { description: "Invalid file or request" },
      "401": { description: "Authentication required" },
      "403": { description: "Upload not allowed" },
      "404": { description: "File unavailable" },
      "409": { description: "Conflicting retry or replacement" },
      "413": { description: "File size limit exceeded" },
      "415": { description: "Unsupported file type" },
      "422": { description: "Malware scan rejected" },
      "503": { description: "Scanner or upload unavailable" },
    },
  },
};

// Use the same validation schemas the UI consumes. Input mode permits
// extra server snapshot details without widening the documented proposal.
const assignmentChangeResult = z.toJSONSchema(z.array(assignmentChangeSchema), {
  io: "input",
});
const changeCandidatesResult = z.toJSONSchema(z.array(candidateSchema), {
  io: "input",
});
const rateUnit = {
  enum: ["per_day", "per_hour", "per_teaching_unit", "fixed_total"],
};
const proposedAmount = {
  type: "number",
  minimum: 0.01,
  maximum: 9999999999.99,
  multipleOf: 0.01,
};
const listAssignmentChanges = rpc(
  "assignmentChanges",
  "Assignments",
  "Read your scoped change proposals",
  "Send an optional request ID to read one request. Authorised views include the original and proposed version plus audit events. Shared proposals include the number of required and accepted assignment consents and the group status. The server redacts commercial values based on current authority.",
  { p_id: nullableUuid },
  assignmentChangeResult,
);
const sessionInstant = {
  type: "string",
  format: "date-time",
  pattern: "(Z|[+-][0-9]{2}:[0-9]{2})$",
};
const courseRunRequest = {
  ...object({
    template_id: uuid,
    organisation_id: { anyOf: [nullableUuid, { const: "" }] },
    time_zone: { ...text, default: "Europe/Berlin" },
    delivery_type: { enum: ["online", "onsite"], default: "online" },
    venue: { ...text, default: "" },
    published: { ...boolean, default: false },
    archived: { ...boolean, default: false },
    sessions: {
      type: "array",
      minItems: 1,
      maxItems: 60,
      items: object({ starts_at: sessionInstant, ends_at: sessionInstant }),
    },
  }),
  required: ["template_id", "sessions"],
};
const readinessRun = { p_course_run_id: uuid };
const clientRequestStatus = { enum: ["submitted", "published", "cancelled"] };
const clientRequestFields = {
  title: { ...text, minLength: 1, maxLength: 200 },
  description: { ...text, maxLength: 12000, default: "" },
  delivery_type: { enum: ["online", "onsite"] },
  location: { ...text, maxLength: 500, default: "" },
  time_zone: { ...text, default: "Europe/Berlin" },
  sessions: courseRunRequest.properties.sessions,
  topic_ids: { type: "array", items: uuid, maxItems: 100, default: [] },
  gross_amount: proposedAmount,
  gross_total_amount: proposedAmount,
  currency: { enum: ["EUR", "AUD"] },
  rate_unit: rateUnit,
};
const clientRequestInput = {
  ...object(clientRequestFields),
  required: [
    "title",
    "delivery_type",
    "sessions",
    "gross_amount",
    "gross_total_amount",
    "currency",
    "rate_unit",
  ],
};
const clientRequestDocument = {
  version_id: uuid,
  category: { enum: ["material", "report"] },
};
const clientRequestBriefFields = {
  teaching_units: { type: "integer", minimum: 1, maximum: 9999 },
  unit_minutes: { enum: [45, 60] },
  instructions: { ...text, maxLength: 4000 },
  required_documents: {
    type: "array",
    maxItems: 30,
    items: { ...text, minLength: 1, maxLength: 300 },
  },
  documents: {
    type: "array",
    maxItems: 20,
    items: object(clientRequestDocument),
  },
};
const clientRequestBriefInput = {
  ...object(clientRequestBriefFields),
  required: ["teaching_units", "unit_minutes"],
};
const nullableClientRequestBrief = {
  anyOf: [object(clientRequestBriefFields), { type: "null" }],
};

const wikiVersion = { ...version, minimum: 1 };
const wikiPublishedVersion = { type: ["integer", "null"], minimum: 1 };
const wikiLocale = { enum: ["de", "en"] };
const wikiStatus = { enum: ["draft", "published", "archived"] };
const wikiPage = object({
  id: uuid,
  title: text,
  locale: wikiLocale,
  category_id: uuid,
  category_label_de: text,
  category_label_en: text,
  owner_id: uuid,
  owner_name: text,
  status: wikiStatus,
  version: wikiVersion,
  published_version: wikiPublishedVersion,
  has_draft: boolean,
  updated_at: sessionInstant,
  content: knowledgeDocument,
});
const jobBriefingFields = {
  reference_url: { ...text, maxLength: 2048 },
  reference_label: { ...text, maxLength: 120 },
  reference_description: { ...text, maxLength: 4000 },
  contact_name: { ...text, maxLength: 120 },
  contact_email: { ...text, maxLength: 254 },
  contact_phone: { ...text, maxLength: 50 },
  contact_description: { ...text, maxLength: 2000 },
  contact_visibility: { enum: ["after_claim", "offer_viewers"] },
};
const jobBriefingResult = object({
  ...jobBriefingFields,
  version,
  has_contact: boolean,
  contact_visible: boolean,
  can_manage: boolean,
  can_edit: boolean,
});

const qualificationTarget = { p_user_id: uuid, p_topic_id: uuid };
const qualificationPage = {
  p_before_at: { ...nullableDateTime, default: null },
  p_before_id: { ...nullableUuid, default: null },
  p_limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
};
const qualificationReview = z.toJSONSchema(qualificationReviewSchema);
const taxonomyKinds = ["topic", "tool", "language"];
const taxonomyFields = {
  label_de: { ...text, minLength: 1, maxLength: 120 },
  label_en: { ...text, minLength: 1, maxLength: 120 },
  kind: { enum: taxonomyKinds },
  parent_id: nullableUuid,
  aliases: {
    type: "array",
    maxItems: 20,
    items: { ...text, minLength: 1, maxLength: 120 },
  },
  description_de: { ...text, maxLength: 4000 },
  description_en: { ...text, maxLength: 4000 },
};

const chatMention = object({ user_id: uuid, display_name: text });
const chatMemberHistory = {
  p_before_at: { ...nullableDateTime, default: null },
  p_before_id: { ...nullableUuid, default: null },
};
const commentResource = { p_kind: { enum: ["job", "template"] }, p_id: uuid };
const announcementHistory = {
  ...qualificationPage,
  p_search: { ...text, maxLength: 160, default: "" },
};
const announcementAdminResponse = z.toJSONSchema(adminAnnouncementSchema);
const announcementCommand = rpc(
  "manageStaffAnnouncement",
  "Announcements",
  "Save, publish, archive or recover a staff announcement",
  "Requires current announcement management authority. Submit a complete bilingual draft when saving. To create an announcement, use a null ID and version zero. Other operations require the current version and ID. Publishing requires a due and unexpired draft. Repeat the same values and request ID for a safe retry.",
  {},
  announcementAdminResponse,
);
const announcementCommandIdentity = {
  p_expected_version: version,
  ...idempotency,
};

const announcementDraftCommand = {
  ...announcementCommandIdentity,
  p_action: { const: "save" },
  p_payload: z.toJSONSchema(
    announcementFormSchema.strict().extend({
      starts_at: z.iso.datetime({ offset: true }),
      ends_at: z.iso.datetime({ offset: true }),
      audience_roles: announcementFormSchema.shape.audience_roles.meta({
        uniqueItems: true,
      }),
    }),
    { io: "input" },
  ),
};

const readinessVersion = { p_expected_version: version, ...idempotency };
const readinessReceipt = z.toJSONSchema(readinessReceiptSchema);

const calendarInstant = { ...text, format: "date-time" };
const calendarColors = z.toJSONSchema(calendarColorsSchema);
const calendarSwatch = z.toJSONSchema(calendarSwatchSchema);
const calendarSubscription = z.toJSONSchema(calendarSubscriptionSchema);
const calendarSubscriptionToken = {
  ...text,
  format: "password",
  pattern: "^[a-f0-9]{64}$",
};
const saveCalendarSubscription = rpc(
  "saveCalendarSubscription",
  "Calendar",
  "Create or rotate my private calendar subscription",
  "The current actor owns the subscription. Generate a random 256-bit token, submit its lowercase hexadecimal representation and keep it private. Send a null ID and version zero to create. On rotation send the current ID and version. A retry needs the same version, payload, token and request ID. Each actor can have up to 20 retained subscriptions. A stale version requires a fresh read.",
  {
    p_id: nullableUuid,
    p_label: { ...text, minLength: 1, maxLength: 80 },
    p_include_private: boolean,
    p_token: calendarSubscriptionToken,
    p_expected_version: version,
    p_client_id: uuid,
  },
  calendarSubscription,
);

const invoiceSubmission = rpc(
  "submitLecturerInvoice",
  "Finance",
  "Submit an invoice for an eligible assignment",
  "An active lecturer can submit their own clean invoice PDF for confirmed assignments in one original currency. Each final scheduled session must have ended. Cancelled, partially delivered or inconsistent blocks go through request_invoice_review. The server calculates the amount from accepted compensation. Retry with the same request ID, invoice details and set of claims to receive the existing invoice ID.",
  {
    p_number: {
      ...text,
      minLength: 1,
      description:
        "Invoice number. The server trims surrounding spaces and accepts 1–80 characters after trimming.",
    },
    p_claim_ids: {
      type: "array",
      items: uuid,
      minItems: 1,
      maxItems: 50,
      uniqueItems: true,
    },
    p_document_version_id: {
      ...uuid,
      description: "Exact clean version of the lecturer's own invoice PDF.",
    },
    p_issued_on: date,
    p_due_on: {
      type: ["string", "null"],
      format: "date",
      description:
        "Omit or send null for a due date 30 calendar days after issue. An explicit date cannot precede the issue date.",
    },
    p_client_id: {
      ...uuid,
      description:
        "Caller-generated request ID. Reuse it for an identical retry.",
    },
  },
  uuid,
  ["p_due_on"],
);

const substitutionResponse = rpc(
  "respondToJobSubstitution",
  "Assignments",
  "Accept, decline or withdraw a substitution offer",
  "Only the recipient can accept or decline. The proposer, original lecturer or a current assignment manager can withdraw. Acceptance requires explicit consent to the exact quote, as returned by job_substitutions. The server checks eligibility and transfers the entire block in one transaction. Only status confirmed is an allocation. Repeating acceptance after a subsequent cancellation returns the current cancelled receipt.",
  {
    p_offer_id: uuid,
    p_action: { enum: ["accept", "decline", "withdraw"] },
    p_quote_hash: { type: ["string", "null"] },
    ...idempotency,
    p_accept_terms: { type: ["boolean", "null"], default: false },
  },
  z.toJSONSchema(substitutionReceiptSchema),
  ["p_accept_terms"],
);

const handoverPaths = {
  "/rest/v1/rpc/job_waitlist": rpc(
    "getJobWaitlistStatus",
    "Assignments",
    "Read my interest and availability for a job",
    "Requires a current lecturer account. Returns only the caller's waitlist state. It never reveals other waiters and cannot reserve a place.",
    { p_job_id: uuid },
    z.toJSONSchema(waitlistSchema),
  ),
  "/rest/v1/rpc/my_job_waitlist": rpc(
    "listMyJobWaitlist",
    "Assignments",
    "List my waitlisted jobs",
    "Requires a current lecturer account. Returns up to 100 rows for the caller, most recently joined first. Nonvisible titles are redacted.",
    {},
    z.toJSONSchema(ownWaitlistSchema),
  ),
  "/rest/v1/rpc/set_job_waitlist": rpc(
    "setJobWaitlistInterest",
    "Assignments",
    "Join or leave a job waitlist",
    "Joining requires current lecturer access and a full future offer when adding new interest. Joining never allocates sessions. An active caller can remove their own interest even after losing lecturer access. Leave is idempotent and always returns an empty title and false flags.",
    { p_job_id: uuid, p_join: boolean },
    z.toJSONSchema(waitlistSchema),
  ),
  "/rest/v1/rpc/substitution_candidates": rpc(
    "listSubstitutionCandidates",
    "Assignments",
    "Find currently eligible substitute lecturers",
    "For the original lecturer or a caller with jobs.manage. Searches display names by literal case-insensitive substring. The server checks the full future uninvoiced assignment and short-notice rules. Eligibility is checked again at acceptance.",
    {
      p_claim_id: uuid,
      p_search: { ...text, maxLength: 120, default: "" },
      p_limit: { type: "integer", minimum: 1, maximum: 50, default: 30 },
    },
    z.toJSONSchema(substitutionCandidatesSchema),
    ["p_search", "p_limit"],
  ),
  "/rest/v1/rpc/propose_job_substitution": rpc(
    "proposeJobSubstitution",
    "Assignments",
    "Offer a full future assignment to a substitute lecturer",
    "For the current original lecturer or a caller with jobs.manage, subject to the short-notice rule. The server checks the recipient and sends an offer with a fixed quote. It does not release the assignment. Repeat the exact request with the same request ID to receive the original offer ID. A competing outstanding offer can produce HTTP 409.",
    {
      p_claim_id: uuid,
      p_target_user_id: uuid,
      p_reason: {
        ...text,
        minLength: 5,
        description: "Between 5 and 1000 characters after trimming.",
      },
      ...idempotency,
    },
    uuid,
  ),
  "/rest/v1/rpc/job_substitutions": rpc(
    "listJobSubstitutions",
    "Assignments",
    "List incoming offers or scoped job substitution history",
    "Omit the job ID or send null for the current recipient's inbox. Job history requires a related assignment or jobs.manage and shows only authorised offers. Quote amounts, currency, rate unit, terms, terms version and fingerprint are visible only to the recipient of a current-format quote or a caller with finance.gross.read. A redacted quote cannot be used to accept an offer.",
    { p_job_id: nullableUuid },
    z.toJSONSchema(substitutionsSchema),
    ["p_job_id"],
  ),
  "/rest/v1/rpc/respond_job_substitution": {
    post: {
      ...substitutionResponse.post,
      requestBody: {
        required: true,
        content: json({
          oneOf: [
            object({
              p_offer_id: uuid,
              p_action: { const: "accept" },
              p_quote_hash: { ...text, pattern: "^[a-f0-9]{64}$" },
              ...idempotency,
              p_accept_terms: { const: true },
            }),
            {
              ...object({
                p_offer_id: uuid,
                p_action: { enum: ["decline", "withdraw"] },
                p_quote_hash: { type: ["string", "null"] },
                ...idempotency,
                p_accept_terms: { type: ["boolean", "null"], default: false },
              }),
              required: [
                "p_offer_id",
                "p_action",
                "p_quote_hash",
                "p_request_id",
              ],
            },
          ],
        }),
      },
    },
  },
};

const globalEventInstant = { type: "string", format: "date-time" };
const globalEventWindow = {
  p_from: globalEventInstant,
  p_to: globalEventInstant,
  p_manage: { ...boolean, default: false },
  p_search: { ...text, maxLength: 160, default: "" },
  p_before_at: nullableDateTime,
  p_before_id: nullableUuid,
  p_limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
};
const globalEventWrite = {
  p_id: nullableUuid,
  p_action: { enum: ["save", "publish", "unpublish", "archive", "recover"] },
  p_expected_version: version,
  ...idempotency,
  p_payload: object({
    title: {
      ...text,
      minLength: 1,
      description: "Between 1 and 200 characters after trimming.",
    },
    description: { ...text, maxLength: 8000 },
    link_url: {
      ...text,
      maxLength: 2000,
      description: "An empty string or a valid HTTPS link without credentials.",
    },
    starts_at: globalEventInstant,
    ends_at: globalEventInstant,
    time_zone: {
      ...text,
      description: "The original event time zone, as an IANA identifier.",
    },
  }),
};
const globalEventManagement = rpc(
  "manageGlobalEvent",
  "Calendar",
  "Save, publish, unpublish, archive or recover a global event",
  "Requires courses.manage. Create with a null event ID, action save and version zero. Saving changes to an existing event returns it to a draft. Publish explicitly to show the event to ordinary viewers. Archive preserves the event, and recover returns it as a draft. Submit absolute start/end instants with offsets and the original time zone. Replay the exact same action, payload, version and request ID for the original receipt.",
  globalEventWrite,
  z.toJSONSchema(globalEventSchema),
);

const jobDiscoveryFilters = z.toJSONSchema(jobFiltersSchema, { io: "input" });
const jobViewVersion = { p_id: uuid, p_expected_version: version };
const jobViewMutation = (
  operation: ReturnType<typeof rpc> | ReturnType<typeof voidRpc>,
) => ({
  post: {
    ...operation.post,
    responses: {
      ...operation.post.responses,
      "500": {
        ...error,
        description:
          "An outdated view version returns SQLSTATE 40001. Refresh the list before retrying.",
      },
    },
  },
});

const nativePaths = {
  "/rest/v1/rpc/managed_profile": rpc(
    "native_managed_profile",
    "Accounts",
    "Read the editable fields of a subordinate account",
    "Requires current account-management authority over the target, even if the target account is inactive. Private contact fields, authentication data and role changes are outside this operation.",
    { p_user_id: uuid },
    object(managedProfileFields),
  ),
  "/rest/v1/rpc/save_managed_profile": rpc(
    "native_save_managed_profile",
    "Accounts",
    "Update the editable fields of a subordinate account",
    "Send the three new fields and the three previously read values. The operation trims the new display name, validates the time zone, records a privacy-safe audit entry and rejects a stale snapshot with 40001.",
    {
      p_user_id: uuid,
      p_payload: object({
        ...managedProfileFields,
        display_name: { ...managedProfileFields.display_name, minLength: 1 },
      }),
      p_expected: object(managedProfileFields),
    },
    object(managedProfileFields),
  ),
  "/rest/v1/rpc/unified_search": rpc(
    "native_unified_search",
    "Search",
    "Search records visible to the signed-in account",
    "Search text is trimmed and matched literally. Use an empty kind to search all applicable categories. Standalone learners can search their permitted courses and chats. Supply the three next_cursor fields together for pagination, or omit all three for the first page.",
    {
      p_query: { ...text, minLength: 2, maxLength: 100 },
      p_kind: { enum: ["", ...searchKinds], default: "" },
      p_after_kind: { enum: [...searchKinds, null] },
      p_after_title: { type: ["string", "null"], maxLength: 1000 },
      p_after_id: nullableUuid,
      p_limit: { type: "integer", minimum: 1, maximum: 80, default: 40 },
    },
    z.toJSONSchema(unifiedSearchPageSchema),
    ["p_kind", "p_after_kind", "p_after_title", "p_after_id", "p_limit"],
  ),
  ...sessionPaths(false),
  ...internalMailRead,
  "/rest/v1/rpc/course_class_options": rpc(
    "readCourseClass",
    "Courses",
    "Read the school class of a course",
    "Requires access to this Premium course. Course managers and scoped company contacts can also see their permitted class options and grouped courses.",
    { p_course_id: uuid },
    z.toJSONSchema(courseClassOptions),
  ),
  "/rest/v1/rpc/set_course_class": {
    post: {
      ...rpc(
        "setCourseClass",
        "Courses",
        "Assign a course to a school class",
        "Requires current course management or an authorised company contact for this Premium course. Use the latest version. Supply an existing class ID or a new class name. Send null for both to clear the class. Enrolments and course access remain independent of the class assignment.",
        {},
        z.toJSONSchema(courseClassOptions),
      ).post,
      requestBody: {
        required: true,
        content: json(z.toJSONSchema(courseClassAssignment)),
      },
    },
  },
  "/rest/v1/rpc/course_chat_protection": rpc(
    "readCourseChatProtection",
    "Premium LMS",
    "Read course-chat spam protection",
    "Company contacts can read the company rule for a Premium course they manage and see whether the global rule is enforced. Only an active administrator can inspect the global setting or omit the course.",
    { p_run_id: nullableUuid },
    z.toJSONSchema(courseChatProtectionSchema),
    ["p_run_id"],
  ),
  "/rest/v1/rpc/set_course_chat_protection": rpc(
    "setCourseChatProtection",
    "Premium LMS",
    "Set versioned course-chat spam protection",
    "Only an active administrator can change the global rule. For a company rule, supply a Premium course and the observed company version. Company contacts can change the rule only for their own company. A global rule remains enforced when the company switch is off. Reload the settings after a version conflict.",
    {
      p_run_id: nullableUuid,
      p_global: boolean,
      p_enabled: boolean,
      p_expected_version: version,
    },
    z.toJSONSchema(courseChatProtectionSchema),
  ),
  ...fileDiscoveryPaths,
  ...personalPreferencesPaths,
  ...courseBuildingBlockPaths,
  ...notificationPaths,
  ...enquiriesSupportPaths,
  ...handoverPaths,
  "/rest/v1/rpc/job_discovery": rpc(
    "native_job_discovery",
    "Jobs",
    "Browse currently visible job offers",
    "Requires an active lecturer or job-management permission. Open upcoming offers are the default. Use include_history for permitted past offers. Date filters use the supplied IANA time zone. Select one currency for price sorting/filtering and one fee unit for rate sorting/filtering. Return the entire next_cursor unchanged with the same filters. A changed quoting role or policy invalidates it.",
    {
      p_filters: jobDiscoveryFilters,
      p_cursor: z.toJSONSchema(
        cursorSchema.safeExtend({ text: z.string().max(200) }).nullable(),
      ),
      p_limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    },
    z.toJSONSchema(discoveryPageSchema),
    ["p_filters", "p_cursor", "p_limit"],
  ),
  "/rest/v1/rpc/job_detail": rpc(
    "native_job_detail",
    "Jobs",
    "Read one currently visible job offer",
    "Returns exact sessions and topic requirements for a job the account can read. Private lecturer amount and total are null when current role and offer policy withhold the quote.",
    { p_job_id: uuid },
    z.toJSONSchema(jobSchema),
  ),
  "/rest/v1/rpc/job_dashboard": rpc(
    "native_job_dashboard",
    "Jobs",
    "Read the current job and assignment summary",
    "Requires an active lecturer or job-management permission. Own upcoming assignments and currently visible offer suggestions use the same current scope as discovery. Only authorised management receives the management counters.",
    {},
    z.toJSONSchema(jobDashboardSchema),
  ),
  "/rest/v1/rpc/saved_job_views": rpc(
    "native_saved_job_views",
    "Jobs",
    "List the current account's saved views",
    "Requires an active lecturer or job-management permission. Up to 20 actor-owned views are ordered by name and ID. A historic view may omit the later include_history filter.",
    {},
    z.toJSONSchema(
      z
        .array(
          z.object({
            ...savedViewSchema.shape,
            filters: jobFilterFieldsSchema.extend({
              include_history: z.boolean().optional(),
            }),
          }),
        )
        .max(20),
    ),
  ),
  "/rest/v1/rpc/save_job_view": jobViewMutation(
    rpc(
      "native_save_job_view",
      "Jobs",
      "Save or update a private job view",
      "Requires an active lecturer or job-management permission. Use version zero and a new UUID to create. Repeating the same initial save recovers its receipt. Updates require the current row version. The server checks title uniqueness and normalises filters.",
      {
        ...jobViewVersion,
        p_name: { type: "string", minLength: 1, maxLength: 80 },
        p_filters: jobDiscoveryFilters,
      },
      z.toJSONSchema(savedViewSchema),
    ),
  ),
  "/rest/v1/rpc/remove_job_view": jobViewMutation(
    voidRpc(
      "native_remove_job_view",
      "Jobs",
      "Remove a private saved job view",
      "Requires an active lecturer or job-management permission, ownership of the view and its current version. Refresh the list after a stale version error.",
      jobViewVersion,
    ),
  ),
  "/rest/v1/rpc/assignment_calendar_metadata": rpc(
    "native_assignment_calendar_metadata",
    "Calendar",
    "Read customer and topic labels for own assignments",
    "Looks up titles, organisations and German/English topic labels for up to 1,000 requested jobs. Returns only the caller's own confirmed teaching assignments. The response has no compensation or other lecturers' information.",
    { p_job_ids: { type: "array", maxItems: 1000, items: uuid } },
    z.toJSONSchema(assignmentCalendarMetadataSchema),
  ),
  "/rest/v1/rpc/contract_records": rpc(
    "listContractRecords",
    "Contracts",
    "Read exact contract versions and receipt metadata",
    "Active callers receive only their own records by default. Asking for all records requires contracts.manage or contracts.read. Historic drafts can have no file version or checksum. A receipt timestamp records acknowledgement of the file, while downloading its PDF remains separately authorised.",
    { p_all: { type: ["boolean", "null"], default: false } },
    z.toJSONSchema(contractRecordsSchema),
    ["p_all"],
  ),
  "/rest/v1/rpc/invoice_records": rpc(
    "listLecturerInvoiceRecords",
    "Finance",
    "Read invoice snapshots and their current tracked balance",
    "Active callers receive their own invoices. Asking for all requires finance.manage. Original currency, PDF version, linked assignments and accepted totals come from the invoice. Paid amount sums only the non-voided ledger entries. Paid at is the latest recorded non-voided payment date, including partial payment.",
    { p_all: { type: ["boolean", "null"], default: false } },
    z.toJSONSchema(invoiceRecordsSchema),
    ["p_all"],
  ),
  "/rest/v1/rpc/invoice_payments": rpc(
    "listLecturerInvoicePayments",
    "Finance",
    "Read the payment history for one invoice",
    "Requires invoice ownership or finance.manage. The list keeps voided entries, including the reversal time and reason. Only non-voided entries count toward the invoice balance.",
    { p_invoice_id: uuid },
    z.toJSONSchema(invoicePaymentsSchema),
  ),
  "/rest/v1/rpc/record_invoice_payment": rpc(
    "recordLecturerInvoicePayment",
    "Finance",
    "Record an actual invoice payment",
    "Requires finance.manage. Record an amount in the invoice currency, with no more than two decimal places, against an approved unpaid balance. The server rejects overpayment and dates more than five minutes in the future. Full balance marks the invoice paid. Repeat an unchanged payment with its client ID to receive the original payment identifier.",
    {
      p_invoice_id: uuid,
      p_amount: { type: "number", exclusiveMinimum: 0 },
      p_paid_at: { type: "string", format: "date-time" },
      p_reference: { ...text, maxLength: 200 },
      p_client_id: uuid,
    },
    uuid,
  ),
  "/rest/v1/rpc/void_invoice_payment": voidRpc(
    "voidLecturerInvoicePayment",
    "Finance",
    "Void a mistaken lecturer invoice payment record",
    "Requires finance.manage. A reason is required. The history row remains visible and its amount no longer counts. The first successful reversal returns the invoice to approved. Repeating an already completed reversal preserves the first record.",
    {
      p_payment_id: uuid,
      p_reason: {
        ...text,
        minLength: 1,
        description: "Between 1 and 2000 characters after trimming.",
      },
    },
  ),
  "/rest/v1/rpc/global_calendar_events": rpc(
    "listGlobalCalendarEvents",
    "Calendar",
    "Page through the global calendar in an absolute time window",
    "Requires an active operational account. Overlaps the supplied window, with an exclusive end, of at most 93 days. Only published unarchived items are visible by default. An explicit management view requires courses.manage and includes drafts and archives. Search is a literal case-insensitive substring. Pass both next_cursor fields on continuation. Results preserve each event's original IANA time zone and absolute instants.",
    globalEventWindow,
    z.toJSONSchema(globalEventsPageSchema),
    ["p_manage", "p_search", "p_before_at", "p_before_id", "p_limit"],
  ),
  "/rest/v1/rpc/manage_global_event": {
    post: {
      ...globalEventManagement.post,
      requestBody: {
        required: true,
        content: json({
          oneOf: [
            object({
              ...globalEventWrite,
              p_id: { type: "null" },
              p_action: { const: "save" },
              p_expected_version: { const: 0 },
            }),
            object({
              ...globalEventWrite,
              p_id: uuid,
              p_action: { const: "save" },
              p_expected_version: { ...version, minimum: 1 },
            }),
            {
              ...object({
                ...globalEventWrite,
                p_id: uuid,
                p_action: {
                  enum: ["publish", "unpublish", "archive", "recover"],
                },
                p_expected_version: { ...version, minimum: 1 },
                p_payload: object({}),
              }),
              required: [
                "p_id",
                "p_action",
                "p_expected_version",
                "p_request_id",
              ],
            },
          ],
        }),
      },
      responses: {
        ...globalEventManagement.post.responses,
        "500": {
          ...error,
          description:
            "Includes PostgreSQL 40001 for a changed event version or state. Reload the current event before applying a new change.",
        },
      },
    },
  },
  "/rest/v1/rpc/submit_invoice": {
    post: {
      ...invoiceSubmission.post,
      responses: {
        ...invoiceSubmission.post.responses,
        "400": {
          ...error,
          description:
            "Invalid invoice data, multiple currencies, no positive compensation, request ID reused with different details, invoice_not_ready, or invoice_review_required. The workflow errors use PostgreSQL code 22023.",
        },
        "403": {
          ...error,
          description:
            "Active lecturer authority, ownership of the accepted assignments or access to the exact clean invoice PDF is missing.",
        },
        "409": {
          ...error,
          description:
            "An assignment already has an active invoice or the submission conflicts with a unique invoice record.",
        },
      },
    },
  },
  "/rest/v1/rpc/request_invoice_review": rpc(
    "requestLecturerInvoiceReview",
    "Finance",
    "Request a review of an invoicing exception",
    "An active lecturer can request review of their own cancelled, partial or inconsistent assignment block unless it already has an active invoice. The same request ID for the same claim returns the original review ID. An already pending review for this claim is also reused. This command records the request without creating an invoice.",
    { p_claim_id: uuid, ...idempotency },
    uuid,
  ),
  "/rest/v1/rpc/finance_pending_invoice_exceptions": rpc(
    "financePendingInvoiceExceptions",
    "Finance",
    "List exceptional invoice approvals awaiting submission",
    "Current internal finance staff can find the reviewed requests that still have an approval and no active invoice.",
    {},
    z.toJSONSchema(financePendingInvoiceExceptionsSchema),
  ),
  "/rest/v1/rpc/invoice_exception_options": rpc(
    "invoiceExceptionOptions",
    "Finance",
    "Read approval options for an exceptional invoice",
    "Current internal finance staff can read the eligible contract versions, original currency, amount ceiling and an active approval for one review request.",
    { p_request_id: uuid },
    z.toJSONSchema(invoiceExceptionOptionsSchema),
  ),
  "/rest/v1/rpc/approve_invoice_exception": rpc(
    "approveInvoiceException",
    "Finance",
    "Approve a reviewed final exception for one assignment",
    "Requires current internal finance authority and a mature eligible assignment. Select the contract version and enter the reviewed amount, contractual due date and review note. Approval records eligibility to submit a final invoice. The lecturer submits the PDF separately.",
    {
      p_request_id: uuid,
      p_contract_id: uuid,
      p_amount: proposedAmount,
      p_due_on: date,
      p_note: { ...text, minLength: 10, maxLength: 1000 },
    },
    uuid,
  ),
  "/rest/v1/rpc/revoke_invoice_exception": voidRpc(
    "revokeInvoiceException",
    "Finance",
    "Revoke an exceptional invoice approval",
    "Current internal finance staff may revoke an approval before an active invoice exists. The original approval and reason remain in the audit history.",
    {
      p_exception_id: uuid,
      p_note: { ...text, minLength: 10, maxLength: 1000 },
    },
  ),
  "/rest/v1/rpc/my_invoice_exceptions": rpc(
    "myInvoiceExceptions",
    "Finance",
    "List my approved exceptional invoices awaiting submission",
    "An active internal lecturer sees only their own current approvals. The projection contains the contract version, exact due date and approved amount in original currency.",
    {},
    z.toJSONSchema(myInvoiceExceptionsSchema),
  ),
  "/rest/v1/rpc/submit_exception_invoice": rpc(
    "submitExceptionInvoice",
    "Finance",
    "Submit a scanned PDF for an approved final exception",
    "Requires the lecturer's current approval and an exact clean version of their own invoice PDF. The server takes the amount, currency and due date from that approval. An identical request retried with its client ID returns the original invoice ID.",
    {
      p_exception_id: uuid,
      p_number: { ...text, minLength: 1, maxLength: 80 },
      p_document_version_id: uuid,
      p_issued_on: date,
      p_client_id: uuid,
    },
    uuid,
  ),
  "/rest/v1/rpc/finance_forecast": rpc(
    "getFinanceForecast",
    "Finance",
    "Read the finance forecast by month and currency",
    "Requires finance.manage. Dates cover up to 93 days in the caller's time zone, with an exclusive end date. Pipeline estimates use the supplied probability. Unpriced positions have an unknown lecturer cost. Gross and margin fields are null unless the caller has finance.gross.read. Payments are based on recorded lecturer invoice payments.",
    {
      ...operationsPeriod,
      p_pipeline_probability: {
        type: "number",
        minimum: 0,
        maximum: 1,
        default: 0,
      },
    },
    z.toJSONSchema(forecastSchema),
    ["p_pipeline_probability"],
  ),
  "/rest/v1/rpc/control_center": rpc(
    "getControlCenter",
    "Operations",
    "Read the operations review queues",
    "Requires jobs.manage. Dates cover up to 93 days in the caller's time zone, with an exclusive end date. Each queue contains up to 200 rows. Private tasks require the caller's existing access. The contract, qualification and course queues require their respective permissions. Average ratings are suppressed below three responses.",
    operationsPeriod,
    z.toJSONSchema(controlSchema),
  ),
  "/rest/v1/rpc/export_my_calendar": rpc(
    "exportMyCalendar",
    "Calendar",
    "Export my calendar snapshot",
    "The caller can read only their own current confirmed assignments and may opt in to their own private events. Use a period of at most 93 days and shorten it if it contains more than 500 events.",
    {
      p_from: calendarInstant,
      p_until: calendarInstant,
      p_include_private: { ...boolean, default: false },
    },
    z.toJSONSchema(calendarExportSchema),
    ["p_include_private"],
  ),
  "/rest/v1/rpc/import_my_calendar": rpc(
    "importMyCalendar",
    "Calendar",
    "Import reviewed private appointments",
    "The current session owns all imported appointments. Review the list first. Supply finite instants with offsets, a valid IANA zone and a stable event UID. Existing UIDs for the same account are skipped. Invalid or conflicting rows roll back the entire batch.",
    {
      p_events: {
        type: "array",
        minItems: 1,
        maxItems: 500,
        items: {
          ...object({
            uid: { ...text, minLength: 1, maxLength: 1024 },
            title: { ...text, minLength: 1, maxLength: 200 },
            description: { type: ["string", "null"], maxLength: 10000 },
            starts_at: calendarInstant,
            ends_at: calendarInstant,
            time_zone: text,
          }),
          required: ["uid", "title", "starts_at", "ends_at", "time_zone"],
        },
      },
    },
    z.toJSONSchema(calendarImportReceipt),
  ),
  "/rest/v1/rpc/get_my_calendar_color_preferences": rpc(
    "readMyCalendarColours",
    "Calendar",
    "Read my private calendar colours",
    "Returns the caller's saved light palette or version-zero defaults.",
    {},
    calendarColors,
  ),
  "/rest/v1/rpc/save_my_calendar_color_preferences": rpc(
    "saveMyCalendarColours",
    "Calendar",
    "Save my private calendar colours",
    "Send the caller's current version and three reviewed light swatches. A stale version requires a fresh read.",
    {
      p_expected_version: version,
      p_personal_event_color: calendarSwatch,
      p_assignment_event_color: calendarSwatch,
      p_customer_event_color: calendarSwatch,
    },
    calendarColors,
  ),
  "/rest/v1/rpc/my_calendar_subscriptions": rpc(
    "listMyCalendarSubscriptions",
    "Calendar",
    "List my private calendar subscriptions",
    "Only the caller's metadata is returned. Tokens and token hashes are kept out of this response.",
    {},
    z.toJSONSchema(z.array(calendarSubscriptionSchema).max(20)),
  ),
  "/rest/v1/rpc/revoke_calendar_subscription": rpc(
    "revokeMyCalendarSubscription",
    "Calendar",
    "Revoke my private calendar subscription",
    "Only the current owner can revoke a subscription using its current version. A subsequent request for the old feed is denied.",
    { p_id: uuid, p_expected_version: { type: "integer", minimum: 1 } },
    { const: true },
  ),
  "/rest/v1/rpc/save_course_run": rpc(
    "saveCourseRun",
    "Courses",
    "Create or update a scheduled course",
    "Use a null ID for a new course run. Sessions use explicit offsets and must not overlap. A run linked to a job cannot be edited by this operation. The server validates the intended IANA time zone.",
    { p_id: nullableUuid, p_payload: courseRunRequest },
    uuid,
  ),
  "/rest/v1/rpc/set_course_visibility": voidRpc(
    "setCourseVisibility",
    "Courses",
    "Apply publication and archive state",
    "Published runs require a schedule. A run linked to a published or filled job cannot be archived through this operation.",
    { p_id: uuid, p_published: boolean, p_archived: boolean },
  ),
  "/rest/v1/rpc/duplicate_course_run": rpc(
    "duplicateCourseRun",
    "Courses",
    "Duplicate a course schedule",
    "Creates an unpublished copy of the template reference and scheduled sessions and returns its ID.",
    { p_id: uuid },
    uuid,
  ),
  "/rest/v1/rpc/course_readiness": rpc(
    "courseReadiness",
    "Course readiness",
    "Read current course readiness",
    "Course managers and currently assigned lecturers can read the applicable checks, actor-scoped jobs and clean document references. Omit the course ID or send null for up to 250 current courses. An exact course ID returns a one-item array and requires access to that course. Manager-only navigation and assignee choices are scoped to the current actor.",
    { p_course_run_id: nullableUuid },
    z.toJSONSchema(readinessListSchema),
    ["p_course_run_id"],
  ),
  "/rest/v1/rpc/save_readiness_settings": rpc(
    "saveReadinessSettings",
    "Course readiness",
    "Save the course preparation requirements",
    "Requires course-management authority. Submit every editable setting with the current settings version. Readiness and confirmation state are server-derived. A successful call returns the course ID. Reuse the request ID only for the same payload and expected version. A stale expected version returns HTTP 409.",
    {
      ...readinessRun,
      p_payload: z.toJSONSchema(readinessSettingsInputSchema),
      ...readinessVersion,
    },
    readinessReceipt,
  ),
  "/rest/v1/rpc/confirm_course_sessions": rpc(
    "confirmCourseSessions",
    "Course readiness",
    "Confirm the current course schedule",
    "Requires course-management authority and at least one session. Binds confirmation to the current persisted course schedule and settings version. A subsequent schedule change invalidates confirmation. Returns the course ID. A stale expected version returns HTTP 409.",
    { ...readinessRun, ...readinessVersion },
    readinessReceipt,
  ),
  "/rest/v1/rpc/save_readiness_task": rpc(
    "saveReadinessTask",
    "Course readiness",
    "Create, update or archive a course preparation task",
    "Requires course-management authority. Send a null task ID, expected version zero and archived=false to create. Updates and archival require the current task version. The acting manager or a currently assigned active lecturer can be the responsible person. Returns the task ID. A stale expected version returns HTTP 409.",
    {
      ...readinessRun,
      p_task_id: nullableUuid,
      p_payload: z.toJSONSchema(readinessTaskInputSchema),
      ...readinessVersion,
    },
    readinessReceipt,
  ),
  "/rest/v1/rpc/complete_readiness_task": rpc(
    "completeReadinessTask",
    "Course readiness",
    "Record or revoke preparation task completion",
    "Requires the responsible assignee with current course access or course-management authority. Submit the current version of an active task. Returns the task ID. An identical actor-bound retry returns the same result. A stale expected version returns HTTP 409.",
    { p_task_id: uuid, p_completed: boolean, ...readinessVersion },
    readinessReceipt,
  ),
  "/rest/v1/rpc/acknowledge_course_instructions": rpc(
    "acknowledgeCourseInstructions",
    "Course readiness",
    "Acknowledge the current course instructions",
    "Requires a current confirmed lecturer assignment and nonempty authored instructions. Acknowledges the exact instruction version and returns the receipt ID. An identical actor-bound retry and repeat acknowledgement of that version return the same ID. An obsolete instruction version returns HTTP 409.",
    {
      ...readinessRun,
      p_instruction_version: { ...version, minimum: 1 },
      ...idempotency,
    },
    readinessReceipt,
  ),
  "/rest/v1/rpc/assignment_changes": {
    post: {
      ...listAssignmentChanges.post,
      requestBody: {
        required: false,
        content: json({ ...object({ p_id: nullableUuid }), required: [] }),
      },
    },
  },
  "/rest/v1/rpc/changeable_assignments": rpc(
    "changeableAssignments",
    "Assignments",
    "Find assignments that can be amended",
    "Lists scoped future assignments with their current schedules and permission flags. The shared-schedule-only flag identifies candidates that allow a coordinated date change. Eligibility is checked again when a proposal is saved or applied.",
    {},
    changeCandidatesResult,
  ),
  "/rest/v1/rpc/save_assignment_change": rpc(
    "saveAssignmentChange",
    "Assignments",
    "Save a versioned change proposal",
    "Use version zero and a null ID for a new draft. Retry an uncertain request with the same request UUID and exact payload. Company contacts can propose dates, location and scope for their own course. A coordinated shared schedule changes dates only and retains the number of sessions.",
    {
      p_id: nullableUuid,
      p_claim_id: uuid,
      p_expected_version: version,
      ...idempotency,
      p_payload: object({
        reason: { ...text, minLength: 5, maxLength: 2000 },
        changes: {
          type: "object",
          additionalProperties: false,
          properties: {
            sessions: {
              type: "array",
              minItems: 1,
              maxItems: 60,
              items: object({
                starts_at: { type: "string", format: "date-time" },
                ends_at: { type: "string", format: "date-time" },
              }),
            },
            location: { ...text, maxLength: 500 },
            scope: { ...text, maxLength: 12000 },
            amount: proposedAmount,
            total_amount: proposedAmount,
            rate_unit: rateUnit,
            terms: { ...text, minLength: 1, maxLength: 8000 },
            cancel: boolean,
          },
        },
      }),
    },
    uuid,
  ),
  "/rest/v1/rpc/assignment_change_action": rpc(
    "assignmentChangeAction",
    "Assignments",
    "Submit, respond to or apply a change proposal",
    "Use the current proposal version and a new request UUID for each transition. A rejection requires a reason. Management submission of an eligible shared schedule creates a proposal for each affected assignment. Applying a shared schedule requires all recorded consents for the same dates and updates the whole group in one transaction.",
    {
      p_id: uuid,
      p_action: { enum: ["submit", "accept", "reject", "withdraw", "apply"] },
      p_expected_version: { ...version, minimum: 1 },
      p_note: { ...text, maxLength: 2000 },
      ...idempotency,
    },
    uuid,
  ),
  "/rest/v1/rpc/claim_job": rpc(
    "claimJob",
    "Jobs",
    "Claim a complete teaching block",
    "Submit the current reviewed terms version and keep the same request UUID and payload on retry. Only a confirmed result with a claim ID confirms a complete allocation. Eligibility, schedule conflicts, capacity and immutable financial terms are decided in the database.",
    { p_job_id: uuid, p_idempotency_key: uuid, p_terms_version: version },
    {
      type: "object",
      required: ["status"],
      properties: { status: text, claim_id: uuid },
    },
  ),
  "/rest/v1/rpc/account_username": rpc(
    "accountUsername",
    "Accounts",
    "Read your login username",
    "Returns the current actor's username and version. An unset username is null.",
    {},
    object({ username: optionalUsername, version }),
  ),
  "/rest/v1/rpc/save_account_username": rpc(
    "saveAccountUsername",
    "Accounts",
    "Change or clear your login username",
    "The username is normalized to lowercase. Clearing an alias does not change the account email, password, roles or UUID.",
    { p_username: optionalUsername, p_expected_version: version },
    object({ username: optionalUsername, version }),
  ),
  "/rest/v1/rpc/course_welcome_content": rpc(
    "courseWelcomeContent",
    "Courses",
    "Read the published welcome revision",
    "Requires an available Premium workspace. Only the current published revision is returned.",
    course,
    courseWelcomeResult,
  ),
  "/rest/v1/rpc/publish_course_welcome_content": {
    post: {
      ...rpc(
        "publishCourseWelcomeContent",
        "Courses",
        "Publish a new welcome revision",
        "Available to currently authorised teaching staff and company contacts. Submit the last-read version and the full p_payload. Select up to 12 existing learner-visible course materials. Authorised management or company contacts control instruction protection. Legacy named text arguments remain supported and preserve the extended fields.",
        {},
        courseWelcomePublishedResult,
      ).post,
      requestBody: { required: true, content: json(courseWelcomeWrite) },
    },
  },
  "/rest/v1/rpc/client_requests": rpc(
    "readCompanyCourseRequests",
    "Courses",
    "List the current company course requests",
    "Returns up to 500 requests in the caller's current company or authorised finance scope. An optional organisation ID narrows this scope. Amounts and their currency refer to the requested or saved company quote.",
    { p_organisation_id: nullableUuid },
    {
      type: "array",
      maxItems: 500,
      items: object({
        ...clientRequestFields,
        gross_amount: { type: "number" },
        gross_total_amount: { type: "number" },
        id: uuid,
        organisation_id: uuid,
        organisation_name: text,
        status: { enum: [...clientRequestStatus.enum, "assigned"] },
        job_id: nullableUuid,
        assigned_lecturer_id: nullableUuid,
        assigned_lecturer_name: { type: ["string", "null"] },
        assigned_lecturers: {
          type: "array",
          items: object({ id: uuid, display_name: text }),
        },
        created_at: sessionInstant,
      }),
    },
    ["p_organisation_id"],
  ),
  "/rest/v1/rpc/client_request_brief": rpc(
    "readCompanyCourseRequestBrief",
    "Courses",
    "Read the current course request brief",
    "Requires current company access or the finance permission for the exact request. The brief may be null for older requests. Document names and checksums are returned only for currently readable versions.",
    { p_request_id: uuid },
    object({
      version,
      brief: nullableClientRequestBrief,
      editable: boolean,
      documents: {
        type: "array",
        maxItems: 20,
        items: object({
          ...clientRequestDocument,
          name: text,
          sha256: { ...text, pattern: "^[0-9a-f]{64}$" },
        }),
      },
    }),
  ),
  "/rest/v1/rpc/client_request_history": rpc(
    "readCompanyCourseRequestHistory",
    "Courses",
    "Read immutable course request revisions",
    "Requires current company access or the finance permission for the exact request. Returns up to 25 revisions from newest to oldest. Use the oldest returned ID to read the previous page.",
    {
      p_request_id: uuid,
      p_before: { type: ["integer", "null"], format: "int64" },
    },
    {
      type: "array",
      maxItems: 25,
      items: object({
        id: { type: "integer", format: "int64", minimum: 1 },
        event: {
          enum: [...clientRequestStatus.enum, "baseline", "brief_saved"],
        },
        created_at: sessionInstant,
        snapshot: object({
          status: clientRequestStatus,
          brief_version: version,
          brief: nullableClientRequestBrief,
          payload: object(clientRequestFields),
          job_id: nullableUuid,
        }),
      }),
    },
    ["p_before"],
  ),
  "/rest/v1/rpc/create_client_request_with_brief": rpc(
    "createCompanyCourseRequestWithBrief",
    "Courses",
    "Submit a company course request with a teaching brief",
    "Requires a current company contact or finance permission for the selected organisation. The whole request and brief are saved together. Planned sessions must cover the teaching time. The caller can share exact clean material versions. Repeat the same client ID and values to recover the original request.",
    {
      p_organisation_id: uuid,
      p_client_id: uuid,
      p_payload: clientRequestInput,
      p_brief: clientRequestBriefInput,
    },
    uuid,
  ),
  "/rest/v1/rpc/save_client_request_brief": rpc(
    "saveCompanyCourseRequestBrief",
    "Courses",
    "Revise the teaching brief of a submitted course request",
    "Requires current company access or the finance permission. The request must be unpublished. Send the previously confirmed brief version, or zero for an older request with no brief. The response is the next confirmed version.",
    {
      p_request_id: uuid,
      p_brief: clientRequestBriefInput,
      p_expected_version: version,
    },
    { ...version, minimum: 1 },
  ),
  "/rest/v1/rpc/job_related_navigation": rpc(
    "readVisibleJobCourseDestinations",
    "Courses",
    "List the course and chat destinations for a visible job",
    "Requires access to the job. The server checks the linked course and each chat room independently. A course outside the current relationship appears as null.",
    { p_job_id: uuid },
    object({
      course_id: nullableUuid,
      rooms: {
        type: "array",
        items: object({
          id: uuid,
          kind: { enum: ["lecturer_course", "participant_course"] },
        }),
      },
    }),
  ),
  "/rest/v1/rpc/repeat_client_request": rpc(
    "repeatClientCourseRequest",
    "Courses",
    "Request a new course using an existing delivered request",
    "Requires a current contact of the exact company and an original request linked to a course whose sessions have ended. Provide new future nonoverlapping sessions. The original course brief is copied without its documents. The result identifies the new request. Reuse the client ID for an exact retry.",
    {
      p_request_id: uuid,
      p_client_id: uuid,
      p_sessions: courseRunRequest.properties.sessions,
    },
    uuid,
  ),
  "/rest/v1/rpc/profile_courses": rpc(
    "readVisibleTaughtCourses",
    "Courses",
    "List visible courses taught by a lecturer",
    "Both the person's profile and each course must be visible to the current caller. Course summaries may be visible without direct workspace access. Check can_open before offering a course link.",
    { p_user_id: uuid },
    {
      type: "array",
      items: object({
        course_run_id: uuid,
        title: text,
        time_zone: text,
        starts_at: sessionInstant,
        ends_at: sessionInstant,
        state: { enum: ["past", "current", "upcoming"] },
        can_open: boolean,
        topic_ids: { type: "array", items: uuid },
      }),
    },
  ),
  "/rest/v1/rpc/reviewable_courses": rpc(
    "readReviewableCourses",
    "Courses",
    "List completed courses that the current actor can review",
    "The server verifies current Premium and course relationship for every result. Each entry includes the current actor's own review or null. A withdrawn review may be shown to its author with deleted set to true.",
    {},
    {
      type: "array",
      items: object({
        course_run_id: uuid,
        title: text,
        lecturer_id: uuid,
        lecturer_name: text,
        ends_at: sessionInstant,
        review: {
          anyOf: [
            { type: "null" },
            object({
              id: uuid,
              rating: { type: "integer", minimum: 1, maximum: 5 },
              comment: text,
              version: { ...version, minimum: 1 },
              hidden: boolean,
              moderation_reason: text,
              deleted: boolean,
            }),
          ],
        },
      }),
    },
  ),
  "/rest/v1/rpc/lecturer_reviews": rpc(
    "readVisibleLecturerReviews",
    "Courses",
    "List the latest visible course reviews for a lecturer",
    "The current actor must be able to read the profile and reviewed course. The response shows the caller's own reviews and permitted reviews by others. Only the author or an authorised moderator receives a reviewer ID and moderation details.",
    { p_user_id: uuid },
    {
      type: "array",
      maxItems: 100,
      items: object({
        id: uuid,
        course_run_id: uuid,
        course_title: text,
        rating: { type: "integer", minimum: 1, maximum: 5 },
        comment: text,
        version: { ...version, minimum: 1 },
        created_at: sessionInstant,
        updated_at: sessionInstant,
        mine: boolean,
        reviewer_label: { enum: ["self", "participant"] },
        reviewer_id: nullableUuid,
        hidden: boolean,
        moderation_reason: text,
      }),
    },
  ),
  "/rest/v1/rpc/chat_group_settings": rpc(
    "readChatGroupSettings",
    "Chat",
    "Read group title, description and settings version",
    "Requires current membership of the exact topic or course group. The settings version is required to submit a change.",
    { p_room_id: uuid },
    object({
      title: text,
      description: { ...text, maxLength: 2000 },
      version: { ...version, minimum: 1 },
    }),
  ),
  "/rest/v1/rpc/chat_mention_candidates": rpc(
    "readChatMentionCandidates",
    "Chat",
    "Read the people eligible for a mention in this room",
    "Only current room members can request this projection. The server excludes the caller and checks each recipient's current eligibility.",
    { p_room_id: uuid },
    { type: "array", items: chatMention },
  ),
  "/rest/v1/rpc/chat_messages_with_mentions": rpc(
    "readChatHistoryWithMentions",
    "Chat",
    "Read the current room's visible messages and mentions",
    "Requires current room membership. Hidden messages are omitted. Deleted entries retain timestamps but expose no content, attached file or mentions. Pass the last timestamp and ID together to continue, keeping the same search. Fetch reply previews separately using each selected message's exact content version.",
    {
      p_room_id: uuid,
      ...chatMemberHistory,
      p_search: { type: ["string", "null"], maxLength: 200, default: "" },
      p_limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    },
    {
      type: "array",
      maxItems: 100,
      items: object({
        id: uuid,
        room_id: uuid,
        sender_id: uuid,
        sender_name: text,
        body: { ...text, maxLength: 8000 },
        document_id: nullableUuid,
        created_at: sessionInstant,
        edited_at: nullableDateTime,
        deleted_at: nullableDateTime,
        reactions: {
          type: "array",
          items: object({
            emoji: text,
            count: { type: "integer", minimum: 1 },
            mine: boolean,
          }),
        },
        content_version: { ...version, minimum: 1 },
        mentions: { type: "array", maxItems: 20, items: chatMention },
        can_moderate: boolean,
      }),
    },
    [...Object.keys(chatMemberHistory), "p_search", "p_limit"],
  ),
  "/rest/v1/rpc/chat_reply_previews": rpc(
    "readChatReplyPreviews",
    "Chat",
    "Read reply previews for the current message versions",
    "Requires current membership. Pass up to 40 message IDs and their versions in the same order. A changed message invalidates the entire request. The response maps replies by child message ID. A null preview indicates that the original message is no longer visible.",
    {
      p_room_id: uuid,
      p_message_ids: { type: "array", maxItems: 40, items: uuid },
      p_versions: {
        type: "array",
        maxItems: 40,
        items: { ...version, minimum: 1 },
      },
    },
    {
      type: "object",
      maxProperties: 40,
      propertyNames: uuid,
      additionalProperties: {
        anyOf: [
          object({
            id: uuid,
            sender_name: text,
            body: { ...text, maxLength: 200 },
          }),
          { type: "null" },
        ],
      },
    },
  ),
  "/rest/v1/rpc/chat_topic_pinned_messages": rpc(
    "readChatTopicMessagePins",
    "Chat",
    "Read the currently visible pinned messages of a topic group",
    "Requires a current member of the exact topic group. Deleted and personally hidden messages are omitted.",
    { p_room_id: uuid },
    {
      type: "array",
      maxItems: 50,
      items: object({
        id: uuid,
        sender_name: text,
        body: { ...text, maxLength: 8000 },
        created_at: sessionInstant,
      }),
    },
  ),
  "/rest/v1/rpc/edit_message_with_mentions": rpc(
    "editOwnChatMessageWithMentions",
    "Chat",
    "Edit an authored message and its selected mentions",
    "Requires the active author, current room membership and the last-read message version. The server rechecks mention eligibility. A textless edit requires the message to retain an attachment. Repeat the same payload with the original client ID.",
    {
      p_message_id: uuid,
      p_body: { ...text, maxLength: 8000 },
      p_expected_version: { ...version, minimum: 1 },
      p_client_id: uuid,
      p_mention_ids: {
        type: "array",
        maxItems: 20,
        uniqueItems: true,
        items: uuid,
        default: [],
      },
    },
    object({ id: uuid, version: { ...version, minimum: 1 } }),
    ["p_mention_ids"],
  ),
  "/rest/v1/rpc/comment_context": rpc(
    "readResourceCommentAccess",
    "Comments",
    "Check current staff discussion and moderation access",
    "Requires current staff access to the specified job or course template. An archived resource cannot receive new comments.",
    commentResource,
    object({ can_post: boolean, can_moderate: boolean }),
  ),
  "/rest/v1/rpc/resource_comments": rpc(
    "readResourceComments",
    "Comments",
    "Read the current staff discussion for a job or course template",
    "Requires current staff access to the exact resource. Hidden comments and moderation reasons are visible only to their authors and authorised moderators. A withdrawn comment has an empty body. Send both cursor fields to continue.",
    {
      ...commentResource,
      ...chatMemberHistory,
      p_limit: { type: "integer", minimum: 1, maximum: 100, default: 40 },
    },
    {
      type: "array",
      maxItems: 100,
      items: object({
        id: uuid,
        author_id: uuid,
        author_name: text,
        body: { ...text, maxLength: 5000 },
        version: { ...version, minimum: 1 },
        hidden: boolean,
        withdrawn: boolean,
        moderation_reason: text,
        created_at: sessionInstant,
        updated_at: sessionInstant,
        mine: boolean,
      }),
    },
    [...Object.keys(chatMemberHistory), "p_limit"],
  ),
  "/rest/v1/rpc/announcement": rpc(
    "readVisibleAnnouncement",
    "Announcements",
    "Read an announcement visible to the current actor",
    "Requires an active account in the current publication's audience and display window. The acknowledgement is specific to the authenticated actor and exact revision.",
    { p_revision_id: uuid },
    z.toJSONSchema(announcementSchema),
  ),
  "/rest/v1/rpc/announcements": rpc(
    "readVisibleAnnouncements",
    "Announcements",
    "List the current actor's announcements",
    "Current audience and display window determine visibility. Filter by literal text or outstanding acknowledgement. Use both cursor fields from the result to continue.",
    {
      ...announcementHistory,
      p_unacknowledged: { ...boolean, default: false },
    },
    z.toJSONSchema(announcementPageSchema),
    [...Object.keys(announcementHistory), "p_unacknowledged"],
  ),
  "/rest/v1/rpc/admin_announcement": rpc(
    "readStaffAnnouncementAdministration",
    "Announcements",
    "Read the draft and published announcement revisions",
    "Requires current announcement management authority. Returns the retained draft, current publication and version needed for a change.",
    { p_id: uuid },
    announcementAdminResponse,
  ),
  "/rest/v1/rpc/admin_announcements": rpc(
    "readStaffAnnouncementAdministrationList",
    "Announcements",
    "List announcements available for administration",
    "Requires current announcement management authority. Search the stored draft and current publication. Filter by state and pass both cursor fields from the result to continue.",
    {
      ...announcementHistory,
      p_state: { enum: ["", "draft", "published", "archived"], default: "" },
    },
    z.toJSONSchema(adminAnnouncementPageSchema),
    [...Object.keys(announcementHistory), "p_state"],
  ),
  "/rest/v1/rpc/manage_announcement": {
    post: {
      ...announcementCommand.post,
      requestBody: {
        required: true,
        content: json({
          oneOf: [
            object({
              ...announcementDraftCommand,
              p_id: { type: "null" },
              p_expected_version: { const: 0 },
            }),
            object({
              ...announcementDraftCommand,
              p_id: uuid,
              p_expected_version: { ...version, minimum: 1 },
            }),
            {
              ...object({
                ...announcementCommandIdentity,
                p_id: uuid,
                p_action: { enum: ["publish", "archive", "recover"] },
                p_payload: { ...object({}), default: {} },
              }),
              required: [
                ...Object.keys(announcementCommandIdentity),
                "p_id",
                "p_action",
              ],
            },
          ],
        }),
      },
    },
  },
  "/rest/v1/rpc/qualification_review": rpc(
    "readLecturerQualificationReview",
    "Qualifications",
    "Read a lecturer's selected qualification and current evidence",
    "Requires the lecturer's own account or current qualification review authority. The exact shared scanned version is returned when its grant remains current. Downloads recheck evidence authority.",
    qualificationTarget,
    qualificationReview,
  ),
  "/rest/v1/rpc/save_qualification_evidence": rpc(
    "saveOwnQualificationEvidence",
    "Qualifications",
    "Share or withdraw a clean certificate version for a selected topic",
    "Requires the current lecturer's own selected topic and own scanned certificate. Pass null for the version ID to withdraw. Use the last-read qualification version and repeat an unchanged request with the same request ID.",
    {
      p_topic_id: uuid,
      p_version_id: nullableUuid,
      p_expected_version: version,
      ...idempotency,
    },
    qualificationReview,
  ),
  "/rest/v1/rpc/attest_qualification": rpc(
    "attestLecturerQualification",
    "Qualifications",
    "Record a current qualification decision",
    "Requires qualification verification authority and a topic selected by the lecturer. A verified decision may reference the current shared evidence or use management attestation. Use a future timestamp or null for expiry. Pass the current version and a request ID.",
    {
      ...qualificationTarget,
      p_verified: boolean,
      p_valid_until: nullableDateTime,
      p_evidence_id: nullableUuid,
      p_expected_version: version,
      ...idempotency,
    },
    qualificationReview,
  ),
  "/rest/v1/rpc/own_qualification_certificates": rpc(
    "readOwnQualificationCertificates",
    "Qualifications",
    "List the current lecturer's scanned private certificate versions",
    "Optional search matches the file name. For another page send both parts of the returned cursor with the same filters. The operation excludes deleted, unscanned and foreign certificates.",
    {
      p_search: { ...text, maxLength: 160, default: "" },
      ...qualificationPage,
    },
    z.toJSONSchema(qualificationCertificatePage),
    ["p_search", ...Object.keys(qualificationPage)],
  ),
  "/rest/v1/rpc/qualification_history": rpc(
    "readQualificationHistory",
    "Qualifications",
    "Read the qualification's recorded evidence and decisions",
    "Requires the lecturer's own account or current qualification review authority. For another page send both parts of the returned cursor. The result records evidence changes and attestation decisions.",
    { ...qualificationTarget, ...qualificationPage },
    z.toJSONSchema(qualificationHistoryPage),
    Object.keys(qualificationPage),
  ),
  "/rest/v1/rpc/taxonomy_catalogue": rpc(
    "readCourseTaxonomyCatalogue",
    "Courses",
    "Read the searchable topic, tool and language catalogue",
    "Requires an active account. Archived entries require taxonomy management authority. Each topic includes only course templates that the caller may read.",
    {
      p_search: { type: ["string", "null"], maxLength: 120, default: "" },
      p_kind: { enum: ["", ...taxonomyKinds], default: "" },
      p_include_archived: { ...boolean, default: false },
    },
    {
      type: "array",
      maxItems: 500,
      items: object({
        ...taxonomyFields,
        id: uuid,
        archived_at: nullableDateTime,
        version: { ...version, minimum: 1 },
        related_courses: {
          type: "array",
          items: object({ id: uuid, title: text }),
        },
      }),
    },
    ["p_search", "p_kind", "p_include_archived"],
  ),
  "/rest/v1/rpc/save_taxonomy_topic": rpc(
    "saveCourseTaxonomyTopic",
    "Courses",
    "Create or revise a topic, tool or language",
    "Requires current taxonomy management authority. To create an entry, send null for the ID and version zero. To update, send the last-read version. The server verifies hierarchy, active parents and unique labels.",
    {
      p_id: nullableUuid,
      p_payload: {
        ...object({
          ...taxonomyFields,
          parent_id: { anyOf: [nullableUuid, { const: "" }] },
        }),
        required: ["label_de", "label_en", "kind"],
      },
      p_version: { ...version, default: 0 },
    },
    uuid,
    ["p_version"],
  ),
  "/rest/v1/rpc/knowledge_access": rpc(
    "readKnowledgeAccess",
    "Knowledge",
    "Read this session's authoring and moderation permissions",
    "Current database role and permissions determine which actions are available. Every subsequent operation independently checks the specific resource and current authority.",
    {},
    object({
      can_author: boolean,
      can_publish_wiki: boolean,
      can_moderate_forum: boolean,
    }),
  ),
  "/rest/v1/rpc/wiki_page": rpc(
    "readVisibleWikiPage",
    "Knowledge",
    "Read the current visible wiki revision",
    "The page owner and wiki managers can read the latest revision. Other eligible readers receive the published revision of a current page.",
    { p_id: uuid },
    wikiPage,
  ),
  "/rest/v1/rpc/wiki_page_history": rpc(
    "readVisibleWikiHistory",
    "Knowledge",
    "Read the wiki page's authorised revision history",
    "Returns latest revisions first. The page owner and wiki managers can see drafts. Other eligible readers receive published revisions.",
    { p_id: uuid },
    {
      type: "array",
      items: object({
        version: wikiVersion,
        title: text,
        locale: wikiLocale,
        editor_name: text,
        created_at: sessionInstant,
        published: boolean,
        content: knowledgeDocument,
      }),
    },
  ),
  "/rest/v1/rpc/save_wiki_page": rpc(
    "saveWikiRevision",
    "Knowledge",
    "Save a wiki draft or publish an authorised revision",
    "Supply null as the page ID for a new page. For an existing page, send its last-read version to detect a concurrent edit. Requires current authoring access and an active wiki category. Publishing and archiving require wiki management authority. Published content must contain text.",
    {
      p_id: nullableUuid,
      p_title: { ...text, minLength: 1, maxLength: 200 },
      p_locale: wikiLocale,
      p_category_id: uuid,
      p_content: knowledgeDocument,
      p_status: wikiStatus,
      p_expected_version: wikiPublishedVersion,
    },
    object({
      page_id: uuid,
      version: wikiVersion,
      published_version: wikiPublishedVersion,
    }),
    ["p_expected_version"],
  ),
  "/rest/v1/rpc/wiki_attachments": rpc(
    "readVisibleWikiAttachments",
    "Knowledge",
    "List attachments of the visible wiki revision",
    "The reader needs access to the exact page and selected revision. A listed attachment refers to a scanned version. Use the authorised files operation to download it.",
    { p_page_id: uuid },
    {
      type: "array",
      maxItems: 20,
      items: object({ id: uuid, version_id: uuid, name: text }),
    },
  ),
  "/rest/v1/rpc/forum_thread": rpc(
    "readStaffForumThread",
    "Knowledge",
    "Read the current staff discussion",
    "Requires current staff forum access. Includes the caller's subscription state, current moderation flags and the metadata version needed for a reviewed edit.",
    { p_id: uuid },
    object({
      id: uuid,
      title: text,
      category_id: uuid,
      category_label_de: text,
      category_label_en: text,
      owner_id: uuid,
      owner_name: text,
      locked: boolean,
      pinned: boolean,
      archived: boolean,
      accepted_post_id: nullableUuid,
      post_count: { type: "integer", minimum: 0 },
      subscribed: boolean,
      created_at: sessionInstant,
      updated_at: sessionInstant,
      metadata_version: wikiVersion,
    }),
  ),
  "/rest/v1/rpc/forum_posts": rpc(
    "readStaffForumPosts",
    "Knowledge",
    "Read the visible staff discussion posts",
    "Requires access to the thread. Posts are ordered oldest first. A removed post has a deletion timestamp and a blank structured document.",
    { p_thread_id: uuid },
    {
      type: "array",
      maxItems: 500,
      items: object({
        id: uuid,
        thread_id: uuid,
        author_id: uuid,
        author_name: text,
        content: knowledgeDocument,
        created_at: sessionInstant,
        edited_at: nullableDateTime,
        deleted_at: nullableDateTime,
        version: wikiVersion,
      }),
    },
  ),
  "/rest/v1/rpc/create_forum_thread": rpc(
    "createStaffForumThread",
    "Knowledge",
    "Start a staff discussion",
    "Requires a current staff account and an active forum category. The structured first post must contain text. The current author is subscribed automatically.",
    {
      p_category_id: uuid,
      p_title: { ...text, minLength: 1, maxLength: 200 },
      p_content: knowledgeDocument,
    },
    uuid,
  ),
  "/rest/v1/rpc/add_forum_post": rpc(
    "addStaffForumPost",
    "Knowledge",
    "Reply to a staff discussion",
    "Requires an accessible discussion that is open for posting. The structured reply must contain text. Repeat an unchanged reply to the same thread with the original client ID.",
    { p_thread_id: uuid, p_content: knowledgeDocument, p_client_id: uuid },
    uuid,
  ),
  "/rest/v1/rpc/edit_forum_post": voidRpc(
    "editOwnStaffForumPost",
    "Knowledge",
    "Save a new revision of an authored discussion post",
    "Requires the author's own visible post in an open thread. Pass its last-read version. The edited document must contain text.",
    {
      p_post_id: uuid,
      p_content: knowledgeDocument,
      p_expected_version: wikiVersion,
    },
  ),
  "/rest/v1/rpc/job_briefing": rpc(
    "readVisibleJobBriefing",
    "Courses",
    "Read the authorised teaching brief and contact for a job",
    "Requires current job management or an eligible lecturer with access to the job. Contact fields are empty when the selected contact visibility or current claim does not allow disclosure.",
    { p_job_id: uuid },
    jobBriefingResult,
  ),
  "/rest/v1/rpc/save_job_briefing": rpc(
    "saveJobBriefing",
    "Courses",
    "Save job briefing references and contact visibility",
    "Requires current job management. Send the job ID, last-read version and a request ID. Omitted briefing fields are cleared or set to their default. Repeating an identical request returns the latest authorised brief.",
    {
      p_job_id: uuid,
      p_expected_version: { ...version, maximum: 2147483646 },
      p_request_id: uuid,
      p_payload: { ...object(jobBriefingFields), required: [] },
    },
    jobBriefingResult,
  ),
  "/rest/v1/rpc/wiki_course_templates": rpc(
    "readWikiCourseTemplateReferences",
    "Courses",
    "List visible course template references on a wiki page",
    "The read follows the caller's visible wiki revision and independent course template authority. The page owner and wiki managers may see the current revision. Other permitted readers see the published revision.",
    { p_page_id: uuid },
    {
      type: "array",
      maxItems: 20,
      items: object({ template_id: uuid, title: text, archived: boolean }),
    },
  ),
  "/rest/v1/rpc/teaching_day": rpc(
    "readOwnTeachingDay",
    "Courses",
    "Read the current local day's teaching and course preparation",
    "Uses the current profile's IANA time zone. The response includes the lecturer's current confirmed sessions, authorised course resources, deliberately selected course contacts and personal preparation. Other active roles receive an empty list.",
    {},
    z.toJSONSchema(teachingDaySchema),
  ),
  "/rest/v1/rpc/save_teaching_preparation": rpc(
    "saveOwnTeachingPreparation",
    "Courses",
    "Save one item of the assigned lecturer's preparation",
    "Requires the current lecturer's own confirmed assignment with an unreleased session. Send the last-read preparation version or zero for a new preparation record.",
    {
      p_claim_id: uuid,
      p_item: z.toJSONSchema(z.enum(preparationIds)),
      p_done: boolean,
      p_expected_version: version,
    },
    z.toJSONSchema(preparationSchema),
  ),
  "/rest/v1/rpc/set_course_exam_required": rpc(
    "setCourseExamRequired",
    "Premium LMS",
    "Set whether the course requires an exam",
    "Available to authorized editors. Disabling the exam hides the learner exam paper and retains the uploaded versions.",
    { ...course, p_required: boolean, p_expected_version: version },
    object({ required: boolean, version }),
  ),
  "/rest/v1/rpc/share_course_exam_pdf": rpc(
    "shareCourseExamPdf",
    "Premium LMS",
    "Share an exact clean exam PDF version",
    "A share needs a previously verified clean PDF version. Only the teaching team can share an answer key.",
    {
      ...course,
      p_version_id: uuid,
      p_audience: { enum: ["students", "exam_staff"] },
    },
    uuid,
  ),
  "/rest/v1/rpc/remove_course_exam_pdf": voidRpc(
    "removeCourseExamPdf",
    "Premium LMS",
    "Remove a course exam share",
    "Authorized course exam editors can remove the share; the underlying uploaded version is retained.",
    { ...course, p_exam_id: uuid },
  ),
  "/rest/v1/rpc/inspect_company_course_chat": rpc(
    "inspectCompanyCourseChat",
    "Administration",
    "Inspect one company's course chat with an audit reason",
    "Requires the active admin role and an exact company/course match. Each request records a reason and can inspect retained participant course text while Premium is off.",
    {
      ...organisation,
      ...course,
      p_reason: courseChatAuditReason,
      p_before_at: nullableDateTime,
      p_before_id: nullableUuid,
    },
    object({
      items: {
        type: "array",
        maxItems: 50,
        items: object({
          id: uuid,
          created_at: { type: "string", format: "date-time" },
          sender_name: text,
          room_title: { type: ["string", "null"] },
          body: text,
          attachment: courseChatAttachment,
        }),
      },
      next_cursor: {
        anyOf: [
          { type: "null" },
          object({ at: { type: "string", format: "date-time" }, id: uuid }),
        ],
      },
    }),
  ),
  "/rest/v1/rpc/course_chat_rooms": rpc(
    "courseChatRooms",
    "Premium LMS",
    "List accessible course participant chat rooms",
    "Requires current course access and Premium. Only participant course rooms are returned; private and operational chat directories are excluded.",
    course,
    {
      type: "array",
      items: object({
        id: uuid,
        title: { type: ["string", "null"] },
        can_post: boolean,
      }),
    },
  ),
  "/rest/v1/rpc/course_chat_messages": rpc(
    "courseChatMessages",
    "Premium LMS",
    "Read messages from a course participant room",
    "Requires current room access or read authority for a linked company contact on that Premium course. Supply the timestamp and ID of the oldest visible message together for an earlier page. The server selects the latest matching window and returns it oldest-first. Deleted bodies are null. Use the message ID and returned attachment version at course-documents to request authorized bytes.",
    {
      p_room_id: uuid,
      p_before_at: nullableDateTime,
      p_before_id: nullableUuid,
      p_limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    },
    {
      type: "array",
      maxItems: 100,
      items: object({
        id: uuid,
        sender_id: uuid,
        sender_name: text,
        body: { type: ["string", "null"] },
        created_at: { type: "string", format: "date-time" },
        deleted_at: nullableDateTime,
        attachment: courseChatAttachment,
      }),
    },
    ["p_before_at", "p_before_id", "p_limit"],
  ),
  "/rest/v1/rpc/send_course_chat_message": rpc(
    "sendCourseChatMessage",
    "Premium LMS",
    "Post a text message in a course participant room",
    "Requires current course Premium, room access and active enrolment for participants. The client ID makes retries idempotent. Files and mentions are not supported by this operation.",
    {
      p_room_id: uuid,
      p_body: { type: "string", minLength: 1, maxLength: 8000 },
      p_client_id: uuid,
    },
    uuid,
  ),
  "/rest/v1/rpc/send_course_chat_attachment": rpc(
    "sendCourseChatAttachment",
    "Premium LMS",
    "Post a scanned attachment in a course participant room",
    "First upload the file using the course chat form fields at the files gateway. Pass the returned document ID and exact clean version. Current room, Premium and sender ownership are rechecked. Reuse the client ID and unchanged payload when retrying the post.",
    {
      p_room_id: uuid,
      p_body: { ...text, maxLength: 8000 },
      p_client_id: uuid,
      p_document_id: uuid,
      p_version_id: uuid,
    },
    uuid,
  ),
  "/rest/v1/rpc/my_course_workspaces": rpc(
    "myCourseWorkspaces",
    "Premium LMS",
    "List my current course workspaces",
    "Returns at most 200 nonarchived courses in scope. A verified participant-only account sees its enrolled or completed courses only while the owning company has Premium enabled. Staff and company contacts can also see scoped base courses with lms_enabled=false.",
    {},
    myWorkspacesResult,
  ),
  "/rest/v1/rpc/course_workspace": rpc(
    "readCourseWorkspace",
    "Premium LMS",
    "Read an authorised Premium course workspace",
    "Requires current Premium and course access. Each response contains actor-scoped sessions, the current online meeting link, course resources, optional exam material and personal learning records. Learners have no roster, staff audit history, quiz answer indices or exam answer keys.",
    course,
    workspaceResult,
  ),
  "/rest/v1/rpc/set_course_meeting_link": rpc(
    "setCourseMeetingLink",
    "Premium LMS",
    "Publish or clear an online course meeting link",
    "Requires a currently confirmed instructor or course manager of an online course. The internal edition requires active company Premium. Customer editions require an enabled course profile for the active release licence. Licence grace permits reading the saved link. Submit the last read version. A stale version returns HTTP 409. Use a credential-free HTTPS URL with a domain name. Send null to return to the existing course venue.",
    { ...course, p_url: meetingUrl, p_expected_version: version },
    meetingLinkResult,
  ),
  "/rest/v1/rpc/course_enrolments": rpc(
    "courseEnrolments",
    "Premium LMS",
    "Read a course enrolment roster",
    "Requires current Premium and course-management authority or a current contact of the exact company. The response retains removed entries. A participant cannot request these records.",
    { p_course_run_id: uuid },
    courseEnrolmentsResult,
  ),
  "/rest/v1/rpc/course_enrolment_candidates": {
    post: {
      ...rpc(
        "courseEnrolmentCandidates",
        "Premium LMS",
        "Find participants eligible for course enrolment",
        "Requires current Premium and course-management authority or a current contact of the exact company. Searches display names or Luminovia User IDs literally within active accepted company associations. Excludes current enrolled and completed entries. Returns at most 100 matches.",
        {},
        courseEnrolmentCandidatesResult,
      ).post,
      requestBody: {
        required: true,
        content: json({
          ...object({
            p_course_run_id: uuid,
            p_search: { ...text, maxLength: 120, default: "" },
          }),
          required: ["p_course_run_id"],
        }),
      },
    },
  },
  "/rest/v1/rpc/course_withdrawal_window": rpc(
    "courseWithdrawalWindow",
    "Premium LMS",
    "Check the deadline for my course withdrawal",
    "Only a current participant of the course can request this projection. The server checks the current enrolment and deadline using its clock. A subsequent withdrawal still rechecks authority and the deadline in PostgreSQL.",
    { p_course_run_id: uuid },
    object({ deadline_at: nullableDateTime, can_withdraw: boolean }),
  ),
  "/rest/v1/rpc/manage_course_enrolment": voidRpc(
    "manageCourseEnrolment",
    "Premium LMS",
    "Set a participant's course enrolment status",
    "Requires current Premium, course-management authority or a current company contact, and an active participant-only association with the same company. Status completed requires a course with ended sessions. The server updates scoped participant chat membership.",
    { p_course_run_id: uuid, p_user_id: uuid, p_status: enrolmentState },
  ),
  "/rest/v1/rpc/cancel_own_course_enrolment": voidRpc(
    "cancelOwnCourseEnrolment",
    "Premium LMS",
    "Cancel my own enrolment",
    "A currently enrolled participant can withdraw at least seven days before the first scheduled session while the company has Premium enabled. The membership with the company and other course enrolments remain intact.",
    { p_course_run_id: uuid },
  ),
  "/rest/v1/rpc/course_workspace_action": workspaceAction,
  "/rest/v1/rpc/import_course_session_attendance": rpc(
    "importCourseSessionAttendance",
    "Premium LMS",
    "Apply a reviewed session register import",
    "Checks current Premium, session authority, enrolment and the expected version of every row. One invalid or stale row rolls back the entire command.",
    {
      ...course,
      p_session_id: uuid,
      p_rows: {
        type: "array",
        minItems: 1,
        maxItems: 200,
        items: object({
          user_id: uuid,
          status: attendanceStatus,
          arrival_at: nullableDateTime,
          departure_at: nullableDateTime,
          note: { ...text, maxLength: 1000 },
          reason: { ...text, maxLength: 500 },
          expected_version: version,
        }),
      },
    },
    object({ saved: { type: "integer", minimum: 1, maximum: 200 } }),
  ),
  "/rest/v1/rpc/course_session_register": rpc(
    "courseSessionRegister",
    "Premium LMS",
    "Read an exact course session attendance register",
    "Requires current Premium and this course's management, teaching or company contact access. Returns enrolled or completed participants for the requested session, with current versions, retained PDF evidence and correction history. Historical verification receipts have only state and minutes. Register receipts include the recorded status, arrival, departure and note. Learners cannot call this staff and company register.",
    { ...course, p_session_id: uuid },
    z.toJSONSchema(attendanceRegisterSchema),
  ),
  "/rest/v1/rpc/save_course_session_attendance": rpc(
    "saveCourseSessionAttendance",
    "Premium LMS",
    "Mark or correct one participant's session attendance",
    "Requires current Premium and this course's management, teaching or company contact access. The session must have started and the participant must be currently enrolled. Submit the register row version; corrections after version zero need a 3–500 character reason. Present rows may carry arrival and departure instants; absent and excused rows must not. An active completion must be revoked before correction. Minutes are calculated by the server.",
    {
      ...course,
      p_session_id: uuid,
      p_user_id: uuid,
      p_status: attendanceStatus,
      p_arrival_at: nullableDateTime,
      p_departure_at: nullableDateTime,
      p_note: { type: "string", maxLength: 1000 },
      p_reason: { type: "string", maxLength: 500 },
      p_expected_version: version,
    },
    object({
      status: attendanceStatus,
      version,
      minutes: { type: "integer", minimum: 0 },
    }),
  ),
  "/rest/v1/rpc/attach_course_session_evidence": rpc(
    "attachCourseSessionEvidence",
    "Premium LMS",
    "Attach an immutable attendance PDF version",
    "Requires current Premium and this course's management, teaching or company contact access. The version must be the caller's own current, clean personal material PDF. The resulting course resource is retained as evidence and cannot be unshared or deleted through ordinary file actions.",
    { ...course, p_session_id: uuid, p_version_id: uuid },
    object({ id: uuid, resource_id: uuid, version_id: uuid }),
  ),
  "/functions/v1/course-documents": courseDocuments,
  "/functions/v1/files": fileGateway,
  "/rest/v1/rpc/company_monthly_accepted_spending": rpc(
    "companyMonthlyAcceptedSpending",
    "Company spending",
    "Read accepted gross course spending by local month",
    "Only current company memberships are returned. Pass null for all accessible organisations; a UUID selects one accessible organisation. The chart groups the returned rows by organisation and currency.",
    { p_organisation_id: nullableUuid },
    {
      type: "array",
      items: object({
        organisation_id: uuid,
        organisation_name: text,
        time_zone: text,
        currency: { enum: ["EUR", "AUD"] },
        month_start: { type: "string", format: "date" },
        gross_amount: { type: "number" },
        claim_count: { type: "integer", minimum: 0 },
      }),
    },
  ),
  "/rest/v1/rpc/company_participant_access": rpc(
    "companyParticipantAccess",
    "Premium LMS",
    "Check company participant management",
    "Company contacts may inspect their own organisation. Authorised staff may inspect managed companies.",
    organisation,
    object({ organisation_id: uuid, premium_enabled: boolean }),
  ),
  "/rest/v1/rpc/company_participants": rpc(
    "companyParticipants",
    "Premium LMS",
    "List current participants",
    "Requires Premium and current participant management rights for the requested company. References belong to this company membership and can be null.",
    organisation,
    z.toJSONSchema(companyParticipantsSchema),
  ),
  "/rest/v1/rpc/company_participant_overview": rpc(
    "companyParticipantOverview",
    "Premium LMS",
    "Read one participant's company course and attendance summary",
    "Requires current participant management rights, current Premium and an active participant membership in the requested company. Returns only that company's enrolments and confirmed attendance counts. Notes and other participants are excluded.",
    {
      ...organisation,
      p_user_id: uuid,
      p_limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
      p_offset: { type: "integer", minimum: 0, default: 0 },
    },
    z.toJSONSchema(companyParticipantOverviewSchema),
    ["p_limit", "p_offset"],
  ),
  "/rest/v1/rpc/company_participant_history": rpc(
    "companyParticipantHistory",
    "Premium LMS",
    "Read the company's participant invitation and action history",
    "Requires current participant management rights and active internal Premium for the exact company. Request receipts use the same event kind across all delivery and matching outcomes. The history records consent separately and exposes timestamps, event kinds and opaque entry IDs. For older entries, send both cursor fields from the last entry in the current page.",
    {
      ...organisation,
      p_before_at: nullableDateTime,
      p_before_id: nullableUuid,
      p_limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
    },
    z.toJSONSchema(companyParticipantHistorySchema),
    ["p_before_at", "p_before_id", "p_limit"],
  ),
  "/rest/v1/rpc/company_participant_assignable_courses": rpc(
    "companyParticipantAssignableCourses",
    "Premium LMS",
    "Find published upcoming courses that a company participant can join",
    "Requires current internal participant management rights, active company Premium and an active company participant membership. Filters titles by literal search text. The result excludes currently enrolled and completed courses and is ordered by first start time and course ID.",
    {
      ...organisation,
      p_user_id: uuid,
      p_search: {
        type: "string",
        maxLength: companyCourseSearchLimit,
        default: "",
      },
      p_limit: { type: "integer", minimum: 1, maximum: 100, default: 30 },
      p_offset: { type: "integer", minimum: 0, default: 0 },
    },
    z.toJSONSchema(companyAssignableCoursesSchema),
    ["p_search", "p_limit", "p_offset"],
  ),
  "/rest/v1/rpc/assign_company_participant_courses": rpc(
    "assignCompanyParticipantCourses",
    "Premium LMS",
    "Enrol one active company participant in multiple whole courses",
    "Applies the selection in one transaction. Courses must still belong to the company and remain eligible. An unavailable course returns HTTP 409 and rolls back the selection. Already enrolled or completed courses stay unchanged, including on retry. Each selected ID appears once in the receipt.",
    {
      ...organisation,
      p_user_id: uuid,
      p_run_ids: {
        type: "array",
        minItems: 1,
        maxItems: companyCourseAssignmentLimit,
        uniqueItems: true,
        items: uuid,
      },
    },
    z.toJSONSchema(companyCourseAssignmentReceiptSchema),
  ),
  "/rest/v1/rpc/set_company_participant_reference": rpc(
    "setCompanyParticipantReference",
    "Premium LMS",
    "Set or clear a company-owned participant reference",
    "Requires current participant management rights, Premium and an active company participant membership. Submit the observed membership version. Send null to clear the reference. An outdated version or a duplicate reference for that company returns HTTP 409.",
    {
      ...organisation,
      p_user_id: uuid,
      p_reference: {
        type: ["string", "null"],
        minLength: 1,
        maxLength: companyReferenceLimit,
      },
      p_expected_version: { ...version, minimum: 1 },
    },
    z.toJSONSchema(companyParticipantReferenceSchema),
  ),
  "/rest/v1/rpc/my_company_participant_invitations": rpc(
    "myCompanyParticipantInvitations",
    "Premium LMS",
    "List my pending company invitations",
    "Requires a verified participant-only account. Expired invitations and companies with Premium disabled are excluded. Source distinguishes invitations requested through email from association requests made using Luminovia User ID.",
    {},
    participantInvitesResult,
  ),
  "/rest/v1/rpc/accept_company_participant_invitation": rpc(
    "acceptCompanyParticipantInvitation",
    "Premium LMS",
    "Accept my invitation to one company",
    "Requires a verified participant-only account and a current, unexpired invitation for the specified company while Premium is enabled. Send the invitation's version and retain the request ID for retries; acceptance does not create a course enrolment.",
    {
      ...organisation,
      p_expected_version: { ...version, minimum: 1 },
      ...idempotency,
    },
    object({
      status: { const: "accepted" },
      organisation_id: uuid,
      version: { ...version, minimum: 1 },
    }),
  ),
  "/rest/v1/rpc/remove_company_participant": rpc(
    "removeCompanyParticipant",
    "Premium LMS",
    "Remove an association from one company",
    "Requires current company participant management and Premium. Send the current membership version and retain the request ID for retries. Open enrolments for that company are withdrawn, with other companies' associations and retained evidence preserved.",
    {
      ...organisation,
      p_user_id: uuid,
      p_expected_version: { ...version, minimum: 1 },
      ...idempotency,
    },
    object({
      status: { const: "removed" },
      organisation_id: uuid,
      user_id: uuid,
      version: { ...version, minimum: 1 },
    }),
  ),
  "/rest/v1/rpc/request_company_participant_link": rpc(
    "requestParticipantLink",
    "Premium LMS",
    "Request participant association",
    "Requires Premium and scoped company authority. An opaque acknowledgement does not confirm that an ID exists or membership was granted. The participant must accept.",
    {
      ...organisation,
      p_luminovia_user_id: { ...text, minLength: 1, maxLength: 32 },
      ...idempotency,
    },
    object({ status: { const: "request_submitted" } }),
  ),
  "/rest/v1/rpc/company_premium_settings": rpc(
    "companyPremiumSettings",
    "Administration",
    "Read the current company Premium settings",
    "Requires active organisation management. A company without a stored setting has enabled=false, version=0 and updated_at=null. Use this version when requesting a toggle.",
    {},
    z.toJSONSchema(companyPremiumSettingsSchema),
  ),
  "/rest/v1/rpc/retained_company_lms": rpc(
    "retainedCompanyLms",
    "Administration",
    "Inspect a company's retained Premium course summaries",
    "Requires the active admin role and records an audit event. Includes counts and resource display metadata for current and archived courses, regardless of the Premium switch. The response contains aggregate activity, never learner identities, attendance notes, message bodies, answer keys or file bytes.",
    organisation,
    z.toJSONSchema(retainedCompanyLmsSchema),
  ),
  "/rest/v1/rpc/set_company_premium": rpc(
    "setCompanyPremium",
    "Administration",
    "Change the company Premium entitlement",
    "Requires the active admin role and a current version. Review the requested change before submitting. Reuse the request ID only with the same company, version and requested state. A 200 result with status conflict means the setting was unchanged and contains the current state and version.",
    {
      ...organisation,
      p_enabled: boolean,
      p_expected_version: version,
      ...idempotency,
    },
    z.toJSONSchema(companyPremiumCommandSchema),
  ),
  "/rest/v1/rpc/course_operation_destinations": rpc(
    "courseOperationDestinations",
    "Courses",
    "List the company, teaching team and accessible course links",
    "Requires the current Premium course workspace. Job and lecturer course-chat links retain their own access checks. Each result contains the authorised resource ID and its display label.",
    course,
    z.toJSONSchema(courseDestinationsSchema),
  ),
  "/rest/v1/rpc/course_workspace_entitlement": rpc(
    "courseWorkspaceEntitlement",
    "Courses",
    "Check workspace availability",
    "The actor must already have access to the underlying course.",
    { p_run_id: uuid },
    object({ lms_enabled: boolean }),
  ),
};

const companyWebhookList = rpc(
  "companyCourseWebhookList",
  "Server integrations",
  "List company webhook subscriptions",
  "Active admins and owners can inspect this company's recent deliveries. Signing keys are omitted. The response includes up to 100 subscriptions with up to ten deliveries each.",
  { p_organisation: uuid },
  companyWebhookListSchema,
);
const companyWebhookCreateBase = rpc(
  "companyCourseWebhookSubscribe",
  "Server integrations",
  "Create a course webhook subscription",
  "Active admins and owners attach an active key from this company to an operator-configured receiver alias. Store the one-time signing key securely. The portal explicitly supplies p_premium_events. Only an active admin can choose this scope, and only for a currently enabled company. At most five active subscriptions are allowed per key.",
  {
    p_organisation: uuid,
    p_integration: uuid,
    p_destination: companyWebhookDestination,
    p_premium_events: boolean,
  },
  object({
    id: uuid,
    signing_secret: { type: "string", pattern: "^[0-9a-f]{64}$" },
  }),
);
const companyWebhookCreate = {
  post: {
    ...companyWebhookCreateBase.post,
    requestBody: {
      required: true,
      content: json({
        ...object({
          p_organisation: uuid,
          p_integration: uuid,
          p_destination: companyWebhookDestination,
          p_premium_events: { ...boolean, default: false },
        }),
        required: ["p_organisation", "p_integration", "p_destination"],
      }),
    },
  },
};
const companyWebhookRevoke = {
  post: {
    ...rpc(
      "companyCourseWebhookRevoke",
      "Server integrations",
      "Revoke a company webhook subscription",
      "Active admins and owners cancel this company's pending deliveries and invalidate the subscription. An already in-flight HTTP request can finish.",
      { p_organisation: uuid, p_subscription: uuid },
      null,
    ).post,
    responses: {
      "204": { description: "Revocation confirmed." },
      "400": error,
      "401": error,
      "403": error,
      "404": error,
      "503": error,
    },
  },
};

const integrationKeyVersion = { type: "integer", minimum: 1 };
const keyVersionConflict = {
  ...error,
  description:
    "The key changed or is no longer available. Read the list again before retrying.",
};
const companyIntegrationKeys = rpc(
  "listCompanyIntegrationKeys",
  "Server integrations",
  "List a company's integration keys",
  "Only an active administrator or owner can read the most recent 100 keys for the specified company. The list contains public key metadata and never returns key material.",
  organisation,
  {
    type: "array",
    maxItems: 100,
    items: object({
      id: uuid,
      label: { ...text, minLength: 1, maxLength: 120 },
      created_at: { ...text, format: "date-time" },
      expires_at: { ...text, format: "date-time" },
      revoked_at: nullableDateTime,
      version: integrationKeyVersion,
      last_used_at: nullableDateTime,
    }),
  },
);
const companyIntegrationKeyIssue = rpc(
  "issueCompanyIntegrationKey",
  "Server integrations",
  "Issue or rotate a company integration key",
  "Only an active administrator or owner can issue or rotate a key for a non-archived company. For a new key send null for the key ID and version. For rotation send the current key ID and its version. Expiry must be after the database's current time and within 180 days. The response contains the one-time credential for secure storage by the receiving backend.",
  {
    ...organisation,
    p_label: { ...text, minLength: 1, maxLength: 120 },
    p_expires_at: { ...text, format: "date-time" },
    p_rotate_id: nullableUuid,
    p_expected_version: { type: ["integer", "null"], minimum: 1 },
  },
  object({
    id: uuid,
    version: integrationKeyVersion,
    credential: {
      ...text,
      format: "password",
      pattern: "^lvi_[a-f0-9-]{36}_[a-f0-9]{64}$",
    },
  }),
);
const companyIntegrationKeyRevoke = voidRpc(
  "revokeCompanyIntegrationKey",
  "Server integrations",
  "Revoke a company integration key",
  "Only an active administrator or owner can revoke a key using its current version. Subsequent use of the key is denied.",
  { p_id: uuid, p_expected_version: integrationKeyVersion },
);
const internalCapabilities = {
  tags: ["Installation"],
  summary: "Read internal installation capabilities",
  description:
    "Returns the public edition and capability flags. The public key can be used before sign-in.",
  security: [{ publicApiKey: [] }],
  responses: {
    "200": {
      description: "Current internal edition flags",
      content: json(
        object({
          installation_id: uuid,
          edition: { const: "internal" },
          licence_status: { const: "not-required" },
          customer_ready: { const: false },
          lms_available: { const: true },
          marketplace_available: { const: true },
          company_premium_switch_available: { const: true },
        }),
      ),
    },
    "401": error,
    "403": error,
    "503": error,
  },
};

const paths: Record<string, Record<string, unknown>> = {
  ...nativeExplorerPaths,
  ...accountingPaths,
  ...Object.fromEntries(
    Object.entries(accountOpenApi.paths).map(([path, methods]) => [
      "/functions/v1/accounts" + path,
      Object.fromEntries(
        Object.entries(methods).map(([method, operation]) => [
          method,
          { ...operation, tags: ["Accounts"] },
        ]),
      ),
    ]),
  ),
  ...Object.fromEntries(
    Object.entries(nativePaths).map(([path, operation]) => [
      path,
      { post: { ...nativeExplorerPaths[path]?.post, ...operation.post } },
    ]),
  ),
  "/rest/v1/rpc/company_course_webhook_list": companyWebhookList,
  "/rest/v1/rpc/company_course_webhook_revoke": companyWebhookRevoke,
  "/rest/v1/rpc/company_integration_keys": {
    post: {
      ...nativeExplorerPaths["/rest/v1/rpc/company_integration_keys"].post,
      ...companyIntegrationKeys.post,
    },
  },
  "/rest/v1/rpc/revoke_company_integration_key": {
    post: {
      ...nativeExplorerPaths["/rest/v1/rpc/revoke_company_integration_key"]
        .post,
      ...companyIntegrationKeyRevoke.post,
      responses: {
        ...companyIntegrationKeyRevoke.post.responses,
        "409": keyVersionConflict,
      },
    },
  },
  "/rest/v1/rpc/installation_capabilities": {
    get: { ...internalCapabilities, operationId: "readInternalCapabilities" },
    post: { ...internalCapabilities, operationId: "postInternalCapabilities" },
  },
};

const credentialPaths = {
  "/rest/v1/rpc/save_calendar_subscription": {
    post: {
      ...nativeDownloadPaths["/rest/v1/rpc/save_calendar_subscription"].post,
      ...saveCalendarSubscription.post,
      responses: { ...saveCalendarSubscription.post.responses, "500": error },
    },
  },
  "/functions/v1/calendar-feed": {
    get: {
      operationId: "fetchPrivateCalendarFeed",
      tags: ["Calendar"],
      summary: "Fetch a private iCalendar subscription",
      description:
        "Configure a calendar client with the private feed URL. Treat the opaque token as a password. Expired, revoked and invalid links receive the same response.",
      security: [],
      parameters: [
        {
          name: "token",
          in: "query",
          required: true,
          schema: calendarSubscriptionToken,
        },
      ],
      responses: {
        "200": {
          description: "Private iCalendar feed",
          content: { "text/calendar": { schema: text } },
        },
        "404": {
          description: "Calendar unavailable",
          content: {
            "text/plain": { schema: { const: "calendar_unavailable" } },
          },
        },
      },
    },
  },
  ...notificationCredentialPaths,
  ...humanAuthPaths,
  ...internalMailDownload,
};

/** Publish only supported, explicitly described product operations. */
export function portalOpenApi(
  backend: string,
  includeNonInteractive?: boolean,
): ReturnType<typeof internalOpenApi>;
export function portalOpenApi(
  backend: string,
  includeNonInteractive: boolean,
  brand: InstallationBrand,
): ReturnType<typeof internalOpenApi> | ReturnType<typeof academyOpenApi>;
export function portalOpenApi(
  backend: string,
  includeNonInteractive = true,
  brand: InstallationBrand = installationBrand,
) {
  return brand.edition === "internal"
    ? internalOpenApi(backend, includeNonInteractive, brand)
    : includeNonInteractive
      ? academyOpenApi(backend, brand)
      : academyExplorerOpenApi(backend, brand);
}

function internalOpenApi(
  backend: string,
  includeNonInteractive: boolean,
  brand: InstallationBrand,
) {
  const documentedPaths: typeof paths = includeNonInteractive
    ? {
        ...nativeDownloadPaths,
        ...paths,
        ...credentialPaths,
        "/rest/v1/rpc/issue_company_integration_key": {
          post: {
            ...nativeDownloadPaths["/rest/v1/rpc/issue_company_integration_key"]
              .post,
            ...companyIntegrationKeyIssue.post,
            responses: {
              ...companyIntegrationKeyIssue.post.responses,
              "409": keyVersionConflict,
            },
          },
        },
        "/rest/v1/rpc/company_course_webhook_subscribe": companyWebhookCreate,
        "/functions/v1/company-integration": companyCourseIndexPath,
      }
    : paths;
  return {
    ...accountOpenApi,
    info: {
      title: `${brand.name} API`,
      version: "1.2.0",
      description:
        "Account and business contracts with native RPC schemas derived from the migrated database. Current permissions, company scope and entitlements still apply. The repository API reference describes feature-specific JSON payloads and integration flows.",
    },
    servers: [{ url: backend.replace(/\/+$/, "") || "/" }],
    components: {
      ...accountOpenApi.components,
      schemas: knowledgeSchemas,
      securitySchemes: {
        ...accountOpenApi.components.securitySchemes,
        ...(includeNonInteractive
          ? {
              integrationKey: {
                type: "http",
                scheme: "bearer",
                description:
                  "Dedicated company integration key for server use.",
              },
            }
          : {}),
      },
    },
    paths: documentedPaths,
    ...(includeNonInteractive
      ? { webhooks: { companyCourseEvent: companyCourseWebhook } }
      : {}),
  };
}

/** Compare the rendered operation with the exact configured backend and method. */
export function isDocumentedRequest(
  rawUrl: string,
  method: string,
  backend: string,
  brand?: InstallationBrand,
) {
  const target = URL.parse(rawUrl, backend.replace(/\/+$/, "") + "/");
  const base = URL.parse(backend);
  if (!target || !base) return false;
  const verb = method.toLowerCase();
  if (
    target.origin !== base.origin ||
    target.username ||
    target.password ||
    target.hash
  )
    return false;
  const prefix = base.pathname.replace(/\/+$/, "");
  if (!target.pathname.startsWith(prefix + "/")) return false;
  const route = target.pathname.slice(prefix.length);
  if (brand && brand.edition !== "internal") {
    if (target.search || (verb !== "get" && verb !== "post")) return false;
    const operations = academyExplorerOpenApi(backend, brand).paths;
    return (
      Object.hasOwn(operations, route) && Object.hasOwn(operations[route], verb)
    );
  }
  if (Object.hasOwn(paths, route)) return Object.hasOwn(paths[route], verb);
  return Object.entries(paths).some(([path, operations]) => {
    if (!path.includes("{") || !Object.hasOwn(operations, verb)) return false;
    const segments = path.split("/");
    const candidate = route.split("/");
    return (
      segments.length === candidate.length &&
      segments.every((part, index) =>
        /^\{(?:id|organisationId)\}$/.test(part)
          ? /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
              candidate[index],
            )
          : part === candidate[index],
      )
    );
  });
}
