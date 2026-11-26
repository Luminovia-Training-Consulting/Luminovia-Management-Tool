import { currencyCodes } from "../../lib/currencies.ts";
import { administrationAuditPaths } from "./administration-audit-contract.ts";
import {
  isPortalHttpAliasRequest,
  portalHttpAliasPrefix,
  withPortalHttpAliases,
} from "./portal-http-contract.ts";
import { legacyHandoverOperations } from "../jobs/handover-schema.ts";
import {
  searchKinds,
  unifiedSearchPageSchema,
} from "../search/unified-schema.ts";
import {
  internalMailDownload,
  internalMailRead,
  internalMailRecoveryPaths,
} from "./academy-mail-contract.ts";
import { knowledgeDocument, knowledgeSchemas } from "./knowledge-contract.ts";
import { sessionPaths } from "./session-contract.ts";
import { humanAuthPaths } from "./human-auth-contract.ts";
import {
  companyCourseIndexPath,
  companyCourseOperationPaths,
} from "./company-course-index-contract.ts";
import { companyIntegrationScopes } from "../operations/company-integration-scopes.ts";
import {
  companyAccountingWebhook,
  companyCourseWebhook,
  companyWebhookDestination,
  internalCompanyWebhookListSchema,
} from "./course-webhook-contract.ts";
import {
  installationBrand,
  type InstallationBrand,
} from "../../lib/installation-brand.ts";
import { accountOpenApi } from "../../../supabase/functions/accounts/openapi.ts";
import {
  analyticsAccessSchema,
  analyticsReportSchema,
  analyticsScopes,
} from "../analytics/schema.ts";
import { accountingPaths } from "./accounting-contract.ts";
import { deliveryEvidencePaths } from "./delivery-evidence-contract.ts";
import { academyExplorerOpenApi, academyOpenApi } from "./academy-contract.ts";
import {
  enquiriesSupportPaths,
  websiteEnquiryIntakePath,
} from "./enquiries-support-contract.ts";
import { courseSeriesPaths } from "./course-series-contract.ts";
import { learningProgramPaths } from "./learning-program-contract.ts";
import { courseBuildingBlockPaths } from "./course-building-block-contract.ts";
import { courseEvaluationPaths } from "./course-evaluation-contract.ts";
import { companyClassFeedbackPaths } from "./company-class-feedback-contract.ts";
import { learningAnalyticsPaths } from "./learning-analytics-contract.ts";
import { timedExamPaths } from "./timed-exam-contract.ts";
import {
  calendarExpectedRevision,
  calendarInvitationRecipients,
  calendarInvitationRoster,
  calendarInvitationVersion,
  calendarRecipientCode,
  calendarResponse,
  ownCalendarInvitations,
} from "../calendar/invitations-schema.ts";
import { companyLecturerBlockPaths } from "./company-lecturer-block-contract.ts";
import {
  contractRecordsSchema,
  invoicePaymentsSchema,
  invoiceRecordsSchema,
} from "./commercial-records-contract.ts";
import {
  clientSpendSummarySchema,
  commercialAccessSchema,
  commissionAccessSchema,
  commissionOfferPolicySchema,
  companyInvoiceReviewsSchema,
  companyLecturerDecisionsSchema,
  companyRejectedLecturersSchema,
  lecturerCompensationSchema,
  saveLecturerCompensationSchema,
} from "./commercial-scope-contract.ts";
import {
  financePendingInvoiceExceptionsSchema,
  invoiceExceptionOptionsSchema,
  myInvoiceExceptionsSchema,
} from "../commercial/invoice-exception-schema.ts";
import {
  invoiceSeriesKindSchema,
  invoiceSeriesOptionsSchema,
  invoiceSeriesRecordsSchema,
} from "../commercial/invoice-series-schema.ts";
import { invoiceSeriesCorrectionsSchema } from "../commercial/invoice-series-correction-schema.ts";
import { fileDiscoveryPaths } from "./file-discovery-contract.ts";
import {
  commonDocumentErrors,
  documentGatewayError,
  fileByteContent,
  fileMediaTypes,
  gatewayOriginHeader,
  privateDownloadHeaders,
  renderedDocumentErrors,
} from "./document-transport-contract.ts";
import { cleanUploadReceipt } from "../files/schema.ts";
import { personalPreferencesPaths } from "./personal-preferences-contract.ts";
import { profileContracts } from "./profile-contract.ts";
import { nativeDownloadPaths, nativeExplorerPaths } from "./native-contract.ts";
import {
  notificationCredentialPaths,
  notificationPaths,
} from "./notifications-contract.ts";
import {
  courseEnrolmentCandidatesResult,
  courseEnrolmentsResult,
  courseCompletionStatusParameters,
  courseCompletionStatusResult,
  courseGradebookExportResult,
  courseGradebookHistoryParameters,
  courseGradebookHistoryResult,
  courseGradebookParameters,
  courseGradebookResult,
  questionBankParameters,
  questionBankOptionalParameters,
  questionBankResult,
  questionBankActionParameters,
  questionBankActionVariants,
  questionBankActionResult,
  courseWelcomePublishedResult,
  courseWelcomeResult,
  courseWelcomeWrite,
  enrolmentState,
  meetingLinkResult,
  meetingUrl,
  myWorkspacesResult,
  importRowParameters,
  importRowResult,
  materialHistoryParameters,
  materialHistoryResult,
  materialMetadataParameters,
  materialMetadataRevision,
  materialReuseParameters,
  materialReuseResult,
  materialReuseTargetsParameters,
  materialReuseTargetsResult,
  materialSearchParameters,
  materialSearchResult,
  participantInvitesResult,
  workspaceActionRequest,
  workspaceActionResult,
  internalWorkspaceResult,
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
import {
  cancelledPersonalSeriesCount,
  createPersonalSeriesInput,
  personalSeriesReceipt,
} from "../calendar/personal-series-schema.ts";
import { courseDestinationsSchema } from "../learning/destinations-schema.ts";
import {
  attendanceRegisterSchema,
  attendanceSummarySchema,
} from "../learning/attendance-schema.ts";
import {
  courseClassAssignment,
  courseClassOptions,
} from "../learning/course-classes-schema.ts";
import { courseAssignmentsProjection } from "../learning/course-assignment-schema.ts";
import { courseSubmissionPage } from "../learning/course-submission-schema.ts";
import { courseChatProtectionSchema } from "../learning/course-chat-protection-schema.ts";
import {
  courseStartInput,
  courseStartResponse,
} from "../readiness/course-start-schema.ts";
import {
  courseCloseoutFollowupSchema,
  courseCloseoutRequest,
  courseCloseoutResponse,
} from "../learning/course-closeout-schema.ts";
import {
  readinessListSchema,
  readinessReceiptSchema,
  readinessSettingsInputSchema,
  readinessTaskInputSchema,
} from "../readiness/schema.ts";
import {
  assignmentChangeActions,
  assignmentChangeSchema,
  candidateSchema,
} from "../changes/schema.ts";
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
  retainedCourseAttendanceSchema,
  retainedCourseFilesSchema,
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
const operationsPeriod = { p_from: date, p_until: date };
const organisation = { p_organisation_id: uuid };
const idempotency = { p_request_id: uuid };
const course = { p_run_id: uuid };
const invoiceRecordPage = {
  p_all: { type: ["boolean", "null"] },
  p_page_limit: { type: "integer", minimum: 1, maximum: 250 },
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

const scheduleChangeResponses = {
  "200": { description: "Confirmed request ID", content: json(uuid) },
  "400": error,
  "401": error,
  "403": error,
  "404": error,
  "409": error,
  "422": {
    ...error,
    description:
      "The schedule change would alter the agreed day or time-based billed units.",
  },
  "423": {
    ...error,
    description:
      "The first proposed session would precede the live claim deadline.",
  },
  "429": error,
  "503": error,
};

/** PostgreSQL void RPCs return HTTP 204 without a JSON response. */
function voidRpc(
  operationId: string,
  tag: string,
  summary: string,
  description: string,
  input: Record<string, unknown>,
  optional: readonly string[] = [],
) {
  const { post } = rpc(
    operationId,
    tag,
    summary,
    description,
    input,
    {},
    optional,
  );
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
      "Requires current Premium, course scope and action-specific authority. For a versioned edit, submit the current version shown in the workspace. Resource sharing requires a clean personal material version, except that authorised staff may share material from the same course job. The server assigns immutable staff, company or lecturer ownership. Assigned lecturers can withdraw their own material shares. Authorised company contacts can withdraw visible material and report shares in their course. Scoped course managers can withdraw course shares. Withdrawal keeps the original file. Attendance evidence remains protected. Quiz attempts are idempotent by request ID and return only the score and pass result. Staff can publish versioned grading policies, release a grade from the best current quiz attempt, and append reasoned corrections; participants receive only their own published grade.",
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
      "Returns protected bytes only after current access and file integrity checks. Request attendance with the course-run ID for a course-wide PDF. Request attendance_session with a session ID for an exact-session PDF or CSV. Current course staff and authorised company contacts can download the selected register. Request uploaded attendance evidence using its course resource ID. Chat requests use the message ID and exact attachment version. Inspecting a retained company chat attachment as an active administrator requires both the organisation and an audit reason. With company Premium turned off, the retained_course_file request requires exact archived exam or material scope and a fresh audit reason. Only a current internal administrator may download retained bytes. For participant_submission use the Premium course ID and exact submission version ID. Only the submitting learner or the current scoped course team can download it.",
    parameters: [gatewayOriginHeader],
    requestBody: {
      required: true,
      content: json({
        oneOf: [
          object({
            kind: {
              enum: ["resource", "exam", "completion", "wiki_resource"],
            },
            id: uuid,
          }),
          {
            ...object({
              kind: { const: "attendance" },
              id: uuid,
              format: { const: "pdf", default: "pdf" },
            }),
            required: ["kind", "id"],
          },
          {
            ...object({
              kind: { const: "attendance_session" },
              id: uuid,
              format: { enum: ["pdf", "csv"], default: "pdf" },
            }),
            required: ["kind", "id"],
          },
          object({
            kind: { const: "qualification_passport" },
            locale: { enum: ["de", "en"] },
          }),
          object({
            kind: { const: "request_resource" },
            id: uuid,
            request_id: uuid,
          }),
          object({
            kind: { const: "assignment_confirmation" },
            id: uuid,
          }),
          {
            ...object({
              kind: { const: "earnings_statement" },
              from: date,
              until: date,
              all: { ...boolean, default: false },
            }),
            required: ["kind", "from", "until"],
          },
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
          object({
            kind: { const: "retained_course_file" },
            organisation_id: uuid,
            run_id: uuid,
            id: uuid,
            version_id: uuid,
            file_kind: { enum: ["exam", "material"] },
            reason: courseChatAuditReason,
          }),
          object({
            kind: { const: "participant_submission" },
            id: uuid,
            version_id: uuid,
          }),
        ],
      }),
    },
    responses: {
      "200": {
        description: "Authorized document bytes",
        headers: privateDownloadHeaders,
        content: {
          ...fileByteContent,
          "text/csv": fileByteContent["text/plain"],
        },
      },
      ...renderedDocumentErrors,
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
      "Use multipart form data to upload up to 100 MiB. A clean response identifies the resulting document and exact version. Keep the same client_id and bytes for a retry. To read protected bytes, send the JSON action and current authorized reference. The gateway requires an approved browser Origin and checks permissions, scope and clean status. Use ?mode=course-submission for an enrolled participant to privately submit up to 10 MiB to a Premium course that explicitly accepts submissions. Use ?mode=exam-submission for a scanned draft during the current exam window, then confirm it with submit_course_exam. Use ?mode=assignment-submission for the current published assignment, with assignment_id as an additional field. Confirm the exact scan-bound version with course_assignment_action. The two other scoped modes accept only course_run_id, client_id and file.",
    parameters: [
      gatewayOriginHeader,
      {
        name: "mode",
        in: "query",
        required: false,
        schema: {
          enum: [
            "course-submission",
            "exam-submission",
            "assignment-submission",
          ],
          type: "string",
        },
      },
    ],
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          encoding: { file: { contentType: fileMediaTypes.join(", ") } },
          schema: {
            type: "object",
            required: ["file", "client_id"],
            properties: {
              file: { type: "string", format: "binary" },
              client_id: uuid,
              assignment_id: {
                ...uuid,
                description: "Required only for assignment-submission.",
              },
              course_run_id: {
                ...uuid,
                description:
                  "Required for assignment-submission, course-submission, and exam-submission. Omit for generic transfers.",
              },
              contract_organisation_id: {
                ...uuid,
                description:
                  "Required with kind=organisation_contract. Active members may file PDFs for their own company; staff require both company and contract management permissions, and their uploads stay internal. Send only file, client_id, kind and this field in that case.",
              },
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
                  "organisation_contract",
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
            dependentSchemas: {
              course_run_id: object({
                course_run_id: uuid,
                client_id: uuid,
                file: { type: "string", format: "binary" },
              }),
              contract_organisation_id: object({
                contract_organisation_id: uuid,
                client_id: uuid,
                kind: { const: "organisation_contract" },
                file: { type: "string", format: "binary" },
              }),
            },
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
            {
              ...object({
                action: { const: "avatar" },
                user_id: uuid,
                version_id: uuid,
              }),
              required: ["action", "user_id"],
            },
            object({
              action: { const: "qualification_evidence_download" },
              evidence_id: uuid,
            }),
            object({
              action: { const: "organisation_contract_download" },
              organisation_id: uuid,
              id: uuid,
            }),
            object({
              action: { enum: ["job_source_available", "job_source_download"] },
              job_id: uuid,
              source_id: uuid,
            }),
          ],
        }),
      },
    },
    responses: {
      "204": {
        description:
          "The requested private job source is available to the caller.",
      },
      "200": {
        description:
          "Clean document metadata after upload or authorized bytes for a download.",
        headers: {
          "Cache-Control": privateDownloadHeaders["Cache-Control"],
          "X-Content-Type-Options":
            privateDownloadHeaders["X-Content-Type-Options"],
          "X-Avatar-Version": {
            description:
              "Returned only for avatar responses; confirms the exact selected version.",
            schema: uuid,
          },
          "Content-Disposition": {
            ...privateDownloadHeaders["Content-Disposition"],
            description: "Present for binary responses only.",
          },
        },
        content: {
          ...json(z.toJSONSchema(cleanUploadReceipt)),
          ...fileByteContent,
        },
      },
      ...commonDocumentErrors,
      "400": documentGatewayError("Invalid file or request", [
        "invalid_request",
        "avatar_image_invalid",
      ]),
      "403": documentGatewayError("Origin, upload or file access denied", [
        "origin_not_allowed",
        "access_denied",
        "upload_not_allowed",
      ]),
      "404": documentGatewayError("File unavailable", [
        "file_not_found",
        "avatar_unavailable",
      ]),
      "409": documentGatewayError("Unclean file or conflicting retry", [
        "file_not_clean",
        "idempotency_conflict",
        "version_superseded",
        "avatar_changed",
      ]),
      "413": documentGatewayError("File empty or size limit exceeded", [
        "file_size",
      ]),
      "415": documentGatewayError("Unsupported file type", [
        "unsupported_type",
      ]),
      "422": documentGatewayError(
        "Malware scan rejected",
        ["scan_rejected"],
        true,
      ),
      "503": documentGatewayError(
        "Scanner or upload unavailable",
        [
          "scanner_unavailable",
          "upload_failed",
          "deletion_unavailable",
          "download_unavailable",
        ],
        true,
      ),
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
  gross_amount: { ...proposedAmount, minimum: 0 },
  gross_total_amount: { ...proposedAmount, minimum: 0 },
  currency: { enum: [...currencyCodes] },
  rate_unit: rateUnit,
};
const companyLecturerOnlyInput = {
  type: "boolean",
  description:
    "Restrict a new request to the organisation’s active assigned lecturers. The resulting internal assignment has no portal compensation, commission, contract requirement or invoices.",
};
const clientRequestRequiredFields = ["title", "delivery_type", "sessions"];
const clientRequestInput = {
  oneOf: [
    {
      title: "Company lecturers",
      ...object({
        ...clientRequestFields,
        own_lecturers_only: { ...companyLecturerOnlyInput, const: true },
      }),
      required: [...clientRequestRequiredFields, "own_lecturers_only"],
    },
    {
      title: "Marketplace",
      ...object({
        ...clientRequestFields,
        gross_amount: proposedAmount,
        gross_total_amount: proposedAmount,
        own_lecturers_only: { ...companyLecturerOnlyInput, const: false },
      }),
      required: [
        ...clientRequestRequiredFields,
        "gross_amount",
        "gross_total_amount",
        "currency",
        "rate_unit",
      ],
    },
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
const wikiPageFields = {
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
};
const wikiPage = object({
  ...wikiPageFields,
  content: knowledgeDocument,
});
const knowledgeCategoryKind = { enum: ["wiki", "forum"] };
const knowledgeCategory = object({
  id: uuid,
  kind: knowledgeCategoryKind,
  slug: text,
  label_de: text,
  label_en: text,
  archived: boolean,
});
const forumThreadFields = {
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
};
const knowledgeListFilters = {
  p_search: { type: ["string", "null"], default: "" },
  p_category_id: { ...nullableUuid, default: null },
  p_include_archived: { ...boolean, default: false },
};
const forumMetadataEdit = rpc(
  "native_edit_forum_thread_metadata",
  "Knowledge",
  "Change a forum thread's title and category",
  "Requires access to the thread. Its owner can edit an unlocked, unarchived thread. A forum moderator can also edit locked or archived threads. Select an active forum category and pass the last-read metadata version. The result is the new metadata version.",
  {
    p_thread_id: uuid,
    p_title: { ...text, minLength: 1, maxLength: 200 },
    p_category_id: uuid,
    p_expected_version: wikiVersion,
  },
  wikiVersion,
);
const forumPostReport = rpc(
  "native_report_forum_post",
  "Knowledge",
  "Report an accessible discussion post",
  "The caller must be able to read the thread and the post must still exist without a tombstone. At most five new reports per reporter are accepted in an hour. A repeat of a valid request for the same post returns the reporter's existing report ID.",
  { p_post_id: uuid, p_reason: { ...text, minLength: 5, maxLength: 2000 } },
  uuid,
);
const wikiCourseReference = voidRpc(
  "native_manage_wiki_course_template",
  "Knowledge",
  "Add or remove a visible course template on a wiki draft",
  "Requires staff access and page ownership or wiki management permission. Only the current unpublished draft can change. With a company ID, the caller needs current company authoring access and the template must belong to that company. Without it, the global editorial scope applies. The template must be readable and active when adding it. A draft supports at most 20 distinct references. Repeated additions or removals leave the same result.",
  {
    p_page_id: uuid,
    p_revision: wikiVersion,
    p_template_id: uuid,
    p_remove: boolean,
    p_organisation_id: nullableUuid,
  },
  ["p_organisation_id"],
);
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
  fallback_contact: {
    anyOf: [object({ name: text, email: text, phone: text }), { type: "null" }],
  },
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
  "native_manage_announcement",
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

const timestampInterval = {
  starts_at: sessionInstant,
  ends_at: sessionInstant,
};
const withdrawalStatus = {
  enum: ["pending", "approved", "rejected", "withdrawn", "superseded"],
};
const withdrawalReceipt = object({ id: uuid, status: withdrawalStatus });
const replacementRefusal = {
  enum: [
    "unavailable",
    "filled",
    "already_assigned",
    "not_eligible",
    "conflict",
    "idempotency_conflict",
    "terms_changed",
    "quote_unavailable",
    "prerequisite_missing",
  ],
};
const lecturerQuote = {
  amount: { type: "number", minimum: 0 },
  total_amount: { type: "number", minimum: 0 },
  currency: { enum: [...currencyCodes] },
  rate_unit: rateUnit,
};
const replacementQuote = object({
  ...lecturerQuote,
  terms: text,
  terms_version: version,
});
const lifecycleInput = {
  p_job_id: uuid,
  p_expected_version: { ...version, minimum: 1 },
  ...idempotency,
};
const dispatchText = { type: ["string", "null"] };
const dispatchContact = object({
  name: text,
  email: dispatchText,
  phone: dispatchText,
});
const dispatchClasses = {
  type: "array",
  items: object({ id: uuid, name: text, meeting_url: dispatchText }),
};
const dispatchDirectory = object({
  classes: dispatchClasses,
  contact_id: nullableUuid,
  contacts: {
    type: "array",
    items: object({
      id: uuid,
      name: text,
      email: dispatchText,
      phone: dispatchText,
    }),
  },
});
const manualAssignmentCandidates = {
  type: "array",
  maxItems: 50,
  items: object({
    id: uuid,
    name: text,
    eligibility: {
      enum: [
        "eligible",
        "unavailable",
        "not_eligible",
        "conflict",
        "prerequisite_missing",
        "quote_unavailable",
      ],
    },
    terms_version: { ...version, minimum: 1 },
    quote: { anyOf: [object(lecturerQuote), { type: "null" }] },
  }),
};
const manualAssignmentReceipt = {
  anyOf: [
    object({ status: replacementRefusal }),
    object({
      status: { enum: ["confirmed", "cancelled"] },
      claim_id: uuid,
    }),
  ],
};
const lifecycleCommand = rpc(
  "native_manage_job_offer",
  "Jobs",
  "Edit, reopen or change a versioned job offer",
  "Requires current job management authority and the last-read version. Editing or changing visibility must preserve accepted history. Reopening requires an available position, future sessions and a reason. Duplicating requires course and applicable pricing authority. Repeat the same request ID and values after an uncertain confirmation.",
  {},
  uuid,
);
const lifecycleReason = { ...text, maxLength: 1000 };
const lifecycleDeadline = { anyOf: [nullableDateTime, { const: "" }] };

function offerAction(actions: string[], payload: Record<string, unknown>) {
  return {
    ...object({
      ...lifecycleInput,
      p_action: { enum: actions },
      p_payload: { ...object(payload), required: [], default: {} },
    }),
    required: [...Object.keys(lifecycleInput), "p_action"],
  };
}

const pickerCursor = object({
  at: sessionInstant,
  id: uuid,
  fingerprint: { ...text, pattern: "^[0-9a-f]{32}$" },
});
const pickerJob = object({
  id: uuid,
  title: text,
  customer_name: text,
  course_run_id: nullableUuid,
  starts_at: nullableDateTime,
  time_zone: text,
});
const capacityOfferFields = {
  ...clientRequestFields,
  customer_name: { ...text, minLength: 1, maxLength: 200 },
  status: { enum: ["draft", "published"] },
  terms: { ...text, minLength: 1, maxLength: 12000 },
  requires_contract: boolean,
  claim_deadline: nullableDateTime,
};
const capacityInputRequired = [
  "title",
  "delivery_type",
  "sessions",
  "currency",
  "rate_unit",
];
const { gross_amount, gross_total_amount, ...capacityNetFields } =
  capacityOfferFields;
const capacityGrossOffer = {
  ...object({ ...capacityNetFields, gross_amount, gross_total_amount }),
  required: [...capacityInputRequired, "gross_amount", "gross_total_amount"],
};
const capacityNetOffer = {
  ...object({
    ...capacityNetFields,
    amount: { ...proposedAmount, minimum: 0 },
    total_amount: { ...proposedAmount, minimum: 0 },
  }),
  required: [
    ...capacityInputRequired,
    "customer_name",
    "amount",
    "total_amount",
    "terms",
  ],
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

const organisationContactPayload = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { ...text, minLength: 1, maxLength: 120 },
    position: { type: ["string", "null"], maxLength: 120 },
    email: {
      anyOf: [
        { type: "null" },
        { const: "" },
        { ...text, format: "email", maxLength: 254 },
      ],
    },
    phone: { type: ["string", "null"], maxLength: 50 },
    notes: { type: ["string", "null"], maxLength: 4000 },
    archived: { type: ["boolean", "null"], default: false },
  },
};

const organisationPayload = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { ...text, minLength: 1, maxLength: 200 },
    country: { type: ["string", "null"], maxLength: 100 },
    time_zone: {
      type: ["string", "null"],
      default: "Europe/Berlin",
      description: "Time zone name recognized by the server.",
    },
    industry: { type: ["string", "null"], maxLength: 120 },
    city: { type: ["string", "null"], maxLength: 120 },
    tags: { type: "array", maxItems: 20, items: { ...text, maxLength: 60 } },
    private_notes: { type: ["string", "null"], maxLength: 8000 },
    archived: { type: ["boolean", "null"], default: false },
    premium_request_id: {
      ...uuid,
      description:
        "An active admin may include a fresh request UUID to enable Premium atomically when creating an unarchived organisation. Reuse the same UUID to retry that creation.",
    },
  },
};

const profilePaths = Object.fromEntries(
  Object.entries(profileContracts).map(([name, entry]) => {
    const operationId = `native_${name}`;
    const tag = "Profiles and people";
    const request = entry.request ?? {};
    const operation = entry.result
      ? rpc(
          operationId,
          tag,
          entry.summary,
          entry.description,
          request,
          z.toJSONSchema(entry.result),
          entry.optional,
        )
      : voidRpc(operationId, tag, entry.summary, entry.description, request);
    const responses = entry.staleCode
      ? {
          ...operation.post.responses,
          [entry.staleCode === "PT409" ? "409" : "500"]: {
            description:
              "The submitted state is stale. Reload the current profile or preferences before retrying.",
            content: json(
              object({
                code: { const: entry.staleCode },
                message: text,
                details: { type: ["string", "null"] },
                hint: { type: ["string", "null"] },
              }),
            ),
          },
        }
      : operation.post.responses;
    return [`/rest/v1/rpc/${name}`, { post: { ...operation.post, responses } }];
  }),
);

const companyLecturerRosterDescription =
  "Requires organisation management or membership in the selected company. Only organisation management receives potential new lecturers.";
const companyLecturerList = {
  type: "array",
  items: object({ id: uuid, display_name: text }),
};
const companyLecturerRosterSchema = object({
  members: companyLecturerList,
  candidates: companyLecturerList,
  can_add: boolean,
});

const nativePaths = {
  "/rest/v1/rpc/academy_customer_setup": rpc(
    "academyCustomerSetup",
    "Organisations",
    "Read or save customer White Label settings",
    "Internal administrators and owners only. Read by company ID. To save, send the observed revision and complete operator settings. See the platform API reference. A stale revision returns 409.",
    {
      p_organisation_id: uuid,
      p_expected_revision: version,
      p_settings: { type: "object" },
    },
    object({ revision: version, settings: { type: ["object", "null"] } }),
    ["p_expected_revision", "p_settings"],
  ),
  "/rest/v1/rpc/save_organisation": rpc(
    "native_save_organisation",
    "Organisations",
    "Create, update or archive an organisation",
    "Requires organisations.manage. Send a null ID to create an organisation. For an update, send the complete metadata to retain and the intended archived state. Private notes remain restricted to authorised staff. The response is the organisation ID.",
    { p_id: nullableUuid, p_payload: organisationPayload },
    uuid,
  ),
  "/rest/v1/rpc/save_organisation_contact": rpc(
    "native_save_organisation_contact",
    "Organisations",
    "Create, update or archive an organisation contact",
    "Requires organisations.manage. Send a null ID to create a contact. An existing contact must belong to the specified organisation. Contact data and notes stay private. The response is the contact ID.",
    {
      p_id: nullableUuid,
      p_organisation_id: uuid,
      p_payload: organisationContactPayload,
    },
    uuid,
  ),
  ...administrationAuditPaths,
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
  ...profilePaths,
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
  ...courseSeriesPaths(),
  ...learningProgramPaths(),
  ...courseEvaluationPaths(false),
  ...companyClassFeedbackPaths,
  ...learningAnalyticsPaths(false),
  ...timedExamPaths(false),
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
    "Returns exact sessions and visible topic requirements for a job the account can read. A company-only caller can open its own job using the reduced dispatch_only projection without lecturer rates or contract terms.",
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
  "/rest/v1/rpc/client_spend_summary": rpc(
    "native_client_spend_summary",
    "Company spending",
    "Summarise gross spending by organisation and currency",
    "Company contacts see current memberships. finance.gross.read can view all organisations in the spending projection. Totals use original currencies. The teacher list covers confirmed positions and contains only teacher IDs and display names.",
    {},
    z.toJSONSchema(clientSpendSummarySchema),
  ),
  "/rest/v1/rpc/commercial_access": rpc(
    "native_commercial_access",
    "Finance",
    "Read current contract and invoice capabilities",
    "Reports the caller's server-derived capabilities. Submitting an invoice requires an explicit active teaching role. Contract and finance management use their own permissions. Individual actions still check scope and eligibility.",
    {},
    z.toJSONSchema(commercialAccessSchema),
  ),
  "/rest/v1/rpc/commission_access": rpc(
    "native_commission_access",
    "Finance",
    "Read pricing and company request capabilities",
    "Reports current request and management capabilities, including whether Management can explicitly price its own offers. Only finance.gross.read receives default policy rates and version. For those callers, an unconfigured policy has null rates and version zero.",
    {},
    z.toJSONSchema(commissionAccessSchema),
  ),
  "/rest/v1/rpc/commission_offer_policy": rpc(
    "native_commission_offer_policy",
    "Finance",
    "Read the pricing policy captured for a job",
    "With finance.gross.read, returns the captured tiers, policy version and explicit platform share when configured. Otherwise authorized Management can access only its own explicitly priced offers and their full price. Returns null when no captured policy exists.",
    { p_job_id: uuid },
    z.toJSONSchema(commissionOfferPolicySchema),
  ),
  "/rest/v1/rpc/company_invoice_reviews": rpc(
    "native_company_invoice_reviews",
    "Finance",
    "Read outstanding company rejections that require finance review",
    "Requires finance.manage. Returns assignment and lecturer labels with invoice numbers and statuses, without amounts or document access.",
    {},
    z.toJSONSchema(companyInvoiceReviewsSchema),
  ),
  "/rest/v1/rpc/company_lecturer_decisions": rpc(
    "native_company_lecturer_decisions",
    "Company assignments",
    "Read company decisions on confirmed positions for a job",
    "Requires current company membership for the job's organisation, with all ownership links in agreement. Decisions are tracked separately from the confirmed lecturer claim. If the claim has no unreleased assignment session, can_reject is null.",
    { p_job_id: uuid },
    z.toJSONSchema(companyLecturerDecisionsSchema),
  ),
  "/rest/v1/rpc/company_rejected_lecturers": rpc(
    "native_company_rejected_lecturers",
    "Company assignments",
    "Read current lecturer rejections for a job",
    "Requires current company membership for the job's organisation, with all ownership links in agreement. The list contains the latest unreleased rejection per lecturer.",
    { p_job: uuid },
    z.toJSONSchema(companyRejectedLecturersSchema),
  ),
  "/rest/v1/rpc/lecturer_compensation": rpc(
    "native_lecturer_compensation",
    "Finance",
    "Read the current future-offer compensation for one lecturer",
    "Requires finance.gross.read and an active lecturer target. Without a personal override the result contains the role-based default and version one. Accepted agreements keep their captured compensation.",
    { p_user_id: uuid },
    z.toJSONSchema(lecturerCompensationSchema),
  ),
  "/rest/v1/rpc/save_lecturer_compensation": {
    post: {
      ...rpc(
        "native_save_lecturer_compensation",
        "Finance",
        "Save a versioned individual compensation override",
        "Requires finance.gross.read and an active lecturer target. Submit the current version and both decimal fields. A stale version requires reloading the record. This updates future offers only.",
        {},
        z.toJSONSchema(lecturerCompensationSchema),
      ).post,
      requestBody: {
        required: true,
        content: json(z.toJSONSchema(saveLecturerCompensationSchema)),
      },
    },
  },
  "/rest/v1/rpc/contract_records": rpc(
    "listContractRecords",
    "Contracts",
    "Read exact contract versions and receipt metadata",
    "Active callers receive only their own records by default. Asking for all records requires contracts.manage or contracts.read. Historic drafts can have no file version or checksum. A receipt timestamp records acknowledgement of the file, while downloading its PDF remains separately authorised.",
    { p_all: { type: ["boolean", "null"], default: false } },
    z.toJSONSchema(contractRecordsSchema),
    ["p_all"],
  ),
  "/rest/v1/rpc/invoice_records": {
    post: {
      ...rpc(
        "listLecturerInvoiceRecords",
        "Finance",
        "Read invoice snapshots and their current tracked balance",
        "Active callers receive their own invoices. Asking for all requires finance.manage. Original currency, PDF version, linked assignments and accepted totals come from the invoice. Paid amount sums only the non-voided ledger entries. Paid at is the latest recorded non-voided payment date, including partial payment. For a complete history, set a page size and use the previous page’s last created_at and id as the paired cursor. A short or empty page ends the listing.",
        {},
        z.toJSONSchema(invoiceRecordsSchema),
      ).post,
      requestBody: {
        required: false,
        content: json({
          oneOf: [
            {
              ...object({
                p_all: { type: ["boolean", "null"], default: false },
              }),
              required: [],
            },
            {
              ...object({
                ...invoiceRecordPage,
                p_before_at: { type: "null" },
                p_before_id: { type: "null" },
              }),
              required: Object.keys(invoiceRecordPage),
            },
            object({
              ...invoiceRecordPage,
              p_before_at: {
                anyOf: [
                  { type: "string", format: "date-time" },
                  { enum: ["infinity", "-infinity"] },
                ],
              },
              p_before_id: uuid,
            }),
          ],
        }),
      },
    },
  },
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
  "/rest/v1/rpc/calendar_invitations": {
    post: {
      ...rpc(
        "readCalendarInvitations",
        "Calendar",
        "Read personal invitations or the roster of an exact published event",
        "Internal portal only. An empty request pages upcoming invitations for the current operational account. Pass both next_cursor fields to continue. Supply only the event ID to read the caller’s invitation to that event. Supplying its exact published version as well requires courses.manage and returns the current recipient roster.",
        {},
        {
          anyOf: [
            z.toJSONSchema(ownCalendarInvitations),
            z.toJSONSchema(calendarInvitationRoster),
          ],
        },
      ).post,
      requestBody: {
        required: false,
        content: json({
          oneOf: [
            object({}),
            object({
              p_after_at: { type: "string", format: "date-time" },
              p_after_id: uuid,
            }),
            object({ p_event_id: uuid }),
            object({
              p_event_id: uuid,
              p_event_version: z.toJSONSchema(calendarInvitationVersion),
            }),
          ],
        }),
      },
    },
  },
  "/rest/v1/rpc/calendar_invitation_recipients": rpc(
    "findCalendarInvitationRecipients",
    "Calendar",
    "Find eligible recipients by name",
    "Requires courses.manage in the internal portal and the exact published event version. A literal search of at least two characters returns up to 25 active operational accounts that are not currently invited.",
    {
      p_event_id: uuid,
      p_event_version: z.toJSONSchema(calendarInvitationVersion),
      p_search: { ...text, maxLength: 120 },
    },
    z.toJSONSchema(calendarInvitationRecipients),
  ),
  "/rest/v1/rpc/set_calendar_invitation": rpc(
    "setCalendarInvitation",
    "Calendar",
    "Invite or withdraw an operational account by Luminovia User ID",
    "Internal portal only. Requires courses.manage and a current published event version. Send revision 0 for a new recipient or the roster revision for an existing recipient. An identical retry preserves the response. An event version holds at most 100 recipients.",
    {
      p_event_id: uuid,
      p_event_version: z.toJSONSchema(calendarInvitationVersion),
      p_user_code: z.toJSONSchema(calendarRecipientCode),
      p_invited: { type: "boolean" },
      p_expected_revision: z.toJSONSchema(calendarExpectedRevision),
    },
    { const: true },
  ),
  "/rest/v1/rpc/reply_calendar_invitation": rpc(
    "replyCalendarInvitation",
    "Calendar",
    "Accept, tentatively accept or decline your own invitation",
    "Internal portal only. Requires a current invitation belonging to the signed-in operational account. The event and invitation revision must still match. An identical retry returns the existing decision.",
    {
      p_event_id: uuid,
      p_event_version: z.toJSONSchema(calendarInvitationVersion),
      p_expected_revision: z.toJSONSchema(calendarInvitationVersion),
      p_response: z.toJSONSchema(calendarResponse),
    },
    { const: true },
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
  "/rest/v1/rpc/invoice_series_options": rpc(
    "invoiceSeriesOptions",
    "Finance",
    "Read the reviewed instalment options for one assignment",
    "Current internal finance staff can read the applicable executed contract versions, accepted ceiling, recorded credits and previous approvals. The server rechecks eligibility when a decision is saved.",
    { p_claim_id: uuid },
    z.toJSONSchema(invoiceSeriesOptionsSchema),
  ),
  "/rest/v1/rpc/approve_invoice_series_entry": rpc(
    "approveInvoiceSeriesEntry",
    "Finance",
    "Approve an instalment or a final settlement",
    "Requires current internal finance authority. Supply the exact executed contract version, reviewed amount, agreed due date and note. For a final settlement the amount is the reviewed total before crediting actual, unvoided interim payments. The net can be zero. Approval does not create an invoice or payment. The same decision and client ID can be retried.",
    {
      p_claim_id: uuid,
      p_contract_id: uuid,
      p_kind: z.toJSONSchema(invoiceSeriesKindSchema),
      p_amount: {
        type: "number",
        exclusiveMinimum: 0,
        maximum: 9999999999.99,
        multipleOf: 0.01,
      },
      p_due_on: date,
      p_note: { ...text, minLength: 10, maxLength: 1000 },
      p_client_id: uuid,
    },
    uuid,
  ),
  "/rest/v1/rpc/revoke_invoice_series_entry": voidRpc(
    "revokeInvoiceSeriesEntry",
    "Finance",
    "Revoke a decision awaiting invoice submission",
    "Requires current internal finance authority and a review reason. An active invoice prevents revocation. The original decision and the reason stay in the audit history.",
    {
      p_approval_id: uuid,
      p_note: { ...text, minLength: 10, maxLength: 1000 },
    },
  ),
  "/rest/v1/rpc/invoice_series_records": rpc(
    "invoiceSeriesRecords",
    "Finance",
    "List current and historical instalment decisions",
    "Pass false for the current lecturer's own series and true for internal finance management. Includes each exact prior payment credited to a final settlement. Commercial actions are unavailable in the Academy editions.",
    { p_all: boolean },
    z.toJSONSchema(invoiceSeriesRecordsSchema),
  ),
  "/rest/v1/rpc/submit_invoice_series_entry": rpc(
    "submitInvoiceSeriesEntry",
    "Finance",
    "Submit the exact PDF for an approved instalment or final invoice",
    "Requires the current lecturer's own clean scanned PDF and the exact current approval. The server retains the approved amount, currency, due date, and applicable credits. A stale approval returns HTTP 409. Retry uncertainty with the same client ID and identical metadata.",
    {
      p_approval_id: uuid,
      p_number: { ...text, minLength: 1, maxLength: 80 },
      p_document_version_id: uuid,
      p_issued_on: date,
      p_client_id: uuid,
    },
    uuid,
  ),
  "/rest/v1/rpc/invoice_series_corrections": rpc(
    "invoiceSeriesCorrections",
    "Finance",
    "List corrections for overpaid lecturer instalments",
    "Lecturers can list their own corrections. Current internal finance staff can query a particular assignment and read the approved contract and payment amounts available for review. The response retains exact credited receipts and all repayment entries, including their void history.",
    { p_claim_id: nullableUuid, p_all: boolean },
    z.toJSONSchema(invoiceSeriesCorrectionsSchema),
  ),
  "/rest/v1/rpc/propose_invoice_series_correction": rpc(
    "proposeInvoiceSeriesCorrection",
    "Finance",
    "Propose a correction after reviewing paid instalments",
    "Requires internal finance authority, an executed contract, a reviewed total below the actual unvoided instalment payments, and an agreed deadline. The amount is in the original currency. Retry delivery uncertainty with the same client ID and values.",
    {
      p_claim_id: uuid,
      p_contract_id: uuid,
      p_reviewed_total: {
        type: "number",
        minimum: 0,
        maximum: 9999999999.99,
        multipleOf: 0.01,
      },
      p_due_on: date,
      p_note: { ...text, minLength: 10, maxLength: 1000 },
      p_client_id: uuid,
    },
    uuid,
  ),
  "/rest/v1/rpc/acknowledge_invoice_series_correction": voidRpc(
    "acknowledgeInvoiceSeriesCorrection",
    "Finance",
    "Acknowledge a current correction as the assigned lecturer",
    "Requires the assigned lecturer and an unchanged set of paid receipts. Acknowledgement stores a response and opens repayment recording.",
    { p_correction_id: uuid },
  ),
  "/rest/v1/rpc/dispute_invoice_series_correction": voidRpc(
    "disputeInvoiceSeriesCorrection",
    "Finance",
    "Dispute a correction as the assigned lecturer",
    "The assigned lecturer can dispute a current proposal and record a reason. Finance must review the dispute before proposing a new correction.",
    {
      p_correction_id: uuid,
      p_note: { ...text, minLength: 10, maxLength: 1000 },
    },
  ),
  "/rest/v1/rpc/withdraw_invoice_series_correction": voidRpc(
    "withdrawInvoiceSeriesCorrection",
    "Finance",
    "Withdraw a correction before repayment",
    "Requires internal finance authority and a reason. The reviewed values and all prior responses remain in history.",
    {
      p_correction_id: uuid,
      p_note: { ...text, minLength: 10, maxLength: 1000 },
    },
  ),
  "/rest/v1/rpc/record_invoice_series_repayment": rpc(
    "recordInvoiceSeriesRepayment",
    "Finance",
    "Record a received lecturer repayment",
    "Internal finance staff can record receipt up to the remaining amount on an acknowledged correction. The receipt date must have arrived in the current operator's date zone. Retry with the same client ID and exact input.",
    {
      p_correction_id: uuid,
      p_amount: { type: "number", exclusiveMinimum: 0, multipleOf: 0.01 },
      p_received_on: date,
      p_reference: { ...text, minLength: 3, maxLength: 200 },
      p_client_id: uuid,
    },
    uuid,
  ),
  "/rest/v1/rpc/void_invoice_series_repayment": voidRpc(
    "voidInvoiceSeriesRepayment",
    "Finance",
    "Void a repayment receipt with an audit reason",
    "Internal finance staff can correct an erroneous receipt. The original amount, date and reference remain in the audit and the outstanding amount is recalculated.",
    {
      p_repayment_id: uuid,
      p_note: { ...text, minLength: 10, maxLength: 1000 },
    },
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
  "/rest/v1/rpc/analytics_access": rpc(
    "getAnalyticsAccess",
    "Operations",
    "List the caller's analytics perspectives and company filters",
    "Available in the internal edition. Staff access uses jobs.manage or finance.manage. A company perspective requires an active membership. The response includes each selectable company's reporting time zone.",
    {},
    z.toJSONSchema(analyticsAccessSchema),
  ),
  "/rest/v1/rpc/analytics_report": rpc(
    "getAnalyticsReport",
    "Operations",
    "Read role-scoped monthly workload and financial analytics",
    "The internal edition uses the actor's profile time zone or, in company view, the selected company's zone. Until is exclusive and the maximum range is 731 days. Confirmed amounts and assignment counts are attributed to the first unreleased session. Session duration is clipped to report boundaries. Cash totals include payments, refunds and repayments by effective date. Choose company scope with an active membership and organisation ID. Staff requires jobs.manage or finance.manage. Open positions require jobs.manage, lecturer costs require finance.manage or ownership, and customer figures require company membership or finance.gross.read. Null denotes an unavailable series.",
    {
      p_scope: { type: "string", enum: [...analyticsScopes] },
      ...operationsPeriod,
      p_organisation_id: { ...uuid, nullable: true, default: null },
    },
    z.toJSONSchema(analyticsReportSchema),
    ["p_organisation_id"],
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
  "/rest/v1/rpc/create_my_personal_event_series": rpc(
    "createMyPersonalEventSeries",
    "Calendar",
    "Save a reviewed private appointment series",
    "Saves the current account’s appointments atomically. Rejects conflicts with confirmed assignments. For a retry, reuse the same request ID and payload.",
    {
      p_request_id: uuid,
      ...z.toJSONSchema(createPersonalSeriesInput).properties,
    },
    z.toJSONSchema(personalSeriesReceipt),
  ),
  "/rest/v1/rpc/cancel_my_future_personal_events": rpc(
    "cancelMyFuturePersonalEvents",
    "Calendar",
    "Delete future private appointments in my series",
    "Deletes future appointments in an owned series and returns the deletion count. Started appointments are retained.",
    { p_series_id: uuid },
    z.toJSONSchema(cancelledPersonalSeriesCount),
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
    "Use a null ID for a new run. On the internal edition, active company members can only create unpublished drafts using an active template owned by their organisation. Sessions use explicit offsets and must not overlap. Course managers can edit venues on linked runs. Prospective lecturers discover live offers through the marketplace. Course access follows assignment. Direct changes to shared planning require the current job_lifecycle version, an idempotency key and the applicable permission on the sole linked offer. Accepted work uses the assignment amendment workflow.",
    {
      p_id: nullableUuid,
      p_payload: {
        ...courseRunRequest,
        properties: {
          ...courseRunRequest.properties,
          expected_job_version: { ...version, minimum: 1 },
          job_request_id: uuid,
        },
      },
    },
    uuid,
  ),
  "/rest/v1/rpc/set_course_visibility": voidRpc(
    "setCourseVisibility",
    "Courses",
    "Apply publication and archive state",
    "A run linked to a published or filled job cannot be archived through this operation. The retained publication field requires a schedule and does not list an internal course for lecturers. Publish or withdraw the linked offer through manage_job_offer.",
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
  "/rest/v1/rpc/course_closeout_followup": {
    ...rpc(
      "readCourseCloseoutFollowupBody",
      "Courses",
      "Read a course closeout follow-up",
      "Requires current course management and access to the exact follow-up task and its Premium course.",
      { p_task_id: uuid },
      z.toJSONSchema(courseCloseoutFollowupSchema),
    ),
    get: {
      operationId: "readCourseCloseoutFollowup",
      tags: ["Courses"],
      summary: "Read a course closeout follow-up",
      parameters: [
        { in: "query", name: "p_task_id", required: true, schema: uuid },
      ],
      responses: {
        "200": {
          description: "Scoped follow-up",
          content: json(z.toJSONSchema(courseCloseoutFollowupSchema)),
        },
        "403": {
          description:
            "Current access to this course and follow-up is required.",
        },
      },
    },
  },
  "/rest/v1/rpc/set_course_closeout_followup_state": rpc(
    "setCourseCloseoutFollowupState",
    "Courses",
    "Update one course closeout follow-up",
    "Reuses the work task and its existing version and audit history. Requires current scope and a version from a confirmed read. An unchanged retry returns the current confirmed state.",
    {
      p_task_id: uuid,
      p_state: { enum: ["open", "doing", "done"] },
      p_version: { ...version, minimum: 1 },
    },
    z.toJSONSchema(courseCloseoutFollowupSchema),
  ),
  "/rest/v1/rpc/course_closeout": {
    ...rpc(
      "readCourseCloseoutBody",
      "Courses",
      "Review current course closeout exceptions",
      "Requires internal course management and active company Premium. Lists missing attendance entries, assessment results and enabled submissions without revealing grades or document contents. Returns a review token for the exact current evidence.",
      { p_course_run_id: uuid },
      z.toJSONSchema(courseCloseoutResponse),
    ),
    get: {
      operationId: "readCourseCloseout",
      tags: ["Courses"],
      summary: "Review current course closeout exceptions",
      parameters: [
        { in: "query", name: "p_course_run_id", required: true, schema: uuid },
      ],
      responses: {
        "200": {
          description:
            "Current course closeout exceptions and assigned follow-up",
          content: json(z.toJSONSchema(courseCloseoutResponse)),
        },
        "403": {
          description:
            "Current internal course management and Premium are required.",
        },
      },
    },
  },
  "/rest/v1/rpc/confirm_course_closeout": rpc(
    "confirmCourseCloseout",
    "Courses",
    "Confirm course closeout and assign remaining work",
    "After the last session ends, submit the current review token and one currently authorised assignee per unresolved category. Confirmation and the follow-up tasks commit together. An identical review retry returns the existing result.",
    z.toJSONSchema(courseCloseoutRequest).properties!,
    z.toJSONSchema(courseCloseoutResponse),
  ),
  "/rest/v1/rpc/course_start_planning": {
    ...rpc(
      "readCourseStartPlanningBody",
      "Course readiness",
      "Read current course start status",
      "Managers can list at-risk published courses starting soon. A current course manager or assigned lecturer can read their own course. Staff IDs and choices are available only to course managers.",
      { p_course_run_id: nullableUuid },
      z.toJSONSchema(courseStartResponse),
      [],
    ),
    get: {
      operationId: "readCourseStartPlanning",
      tags: ["Course readiness"],
      summary: "Read the course start queue or one course",
      parameters: [{ in: "query", name: "p_course_run_id", schema: uuid }],
      responses: {
        "200": {
          description: "Current scoped course start status",
          content: json(z.toJSONSchema(courseStartResponse)),
        },
        "403": {
          description:
            "Current course management or a confirmed assignment is required.",
        },
      },
    },
  },
  "/rest/v1/rpc/set_course_start_responsibility": rpc(
    "setCourseStartResponsibility",
    "Course readiness",
    "Assign the course start owner and escalation contact",
    "Requires current course management. Both people must currently manage courses. Submit the last read version. A null backup selects the management fallback.",
    z.toJSONSchema(courseStartInput).properties!,
    { type: "integer", minimum: 1 },
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
    "Lists scoped assignments with their current schedules and permission flags. Dedicated assignments must be unstarted. Shared courses with eligible future sessions can be rescheduled with each affected lecturer's consent. The shared commercial flag identifies assignments for which finance can propose a lecturer-specific amendment.",
    {},
    changeCandidatesResult,
  ),
  "/rest/v1/rpc/save_assignment_change": {
    post: {
      ...rpc(
        "saveAssignmentChange",
        "Assignments",
        "Save a versioned change proposal",
        "Start a draft with version zero and a null ID. Retry an uncertain request with the same UUID and exact payload. Current company contacts can propose dates, location and scope for their dedicated course, or dates for a shared course. A permitted finance editor can combine shared dates with terms or compensation for the selected lecturer. Other lecturers receive their own schedule proposal. Retain the exact intervals of started sessions and sessions carrying delivery evidence. A proposed first date must respect current claim deadlines and learner withdrawal rights.",
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
                terms: { ...text, maxLength: 12000 },
                cancel: boolean,
              },
            },
          }),
        },
        uuid,
      ).post,
      responses: scheduleChangeResponses,
    },
  },
  "/rest/v1/rpc/assignment_change_action": {
    post: {
      ...rpc(
        "assignmentChangeAction",
        "Assignments",
        "Submit, respond to or apply a change proposal",
        "Use the current proposal version and a new request UUID for each transition. A rejection requires a reason. For a company-origin shared schedule, submit sends the request to management and coordinate opens a proposal for each affected assignment. Management submission can open its own shared proposal directly. Applying a shared schedule requires independent approval for each currently confirmed position and updates the whole group in one transaction. A new position claim, changed offer, or intervening protected evidence prevents apply.",
        {
          p_id: uuid,
          p_action: { enum: assignmentChangeActions },
          p_expected_version: { ...version, minimum: 1 },
          p_note: { ...text, maxLength: 2000 },
          ...idempotency,
        },
        uuid,
      ).post,
      responses: scheduleChangeResponses,
    },
  },
  "/rest/v1/rpc/job_board": rpc(
    "native_job_board",
    "Jobs",
    "List versioned offers for the authorised job board",
    "Requires current job management authority. Includes capacity and confirmed positions. Transition availability reflects accepted history. Each change rechecks current permissions and the offer version.",
    {},
    {
      type: "array",
      maxItems: 500,
      items: object({
        id: uuid,
        title: text,
        status: { enum: ["draft", "published", "filled", "archived"] },
        version: { ...version, minimum: 1 },
        capacity: { ...version, minimum: 1, maximum: 20 },
        confirmed_count: version,
        can_transition: boolean,
      }),
    },
  ),
  "/rest/v1/rpc/job_picker": rpc(
    "native_job_picker",
    "Jobs",
    "Find jobs for an administrative attachment or participant course",
    "The selected purpose determines current job or course authority and the fields in scope. Continue with the returned cursor and unchanged purpose and search. A currently authorised selected ID can be resolved outside the current results page.",
    {
      p_purpose: { enum: ["job_attachment", "participant_course"] },
      p_search: { ...text, maxLength: 160, default: "" },
      p_cursor: { anyOf: [pickerCursor, { type: "null" }], default: null },
      p_limit: { type: "integer", minimum: 1, maximum: 100, default: 40 },
      p_selected_id: { ...nullableUuid, default: null },
    },
    object({
      items: { type: "array", maxItems: 100, items: pickerJob },
      has_more: boolean,
      next_cursor: { anyOf: [pickerCursor, { type: "null" }] },
      selected: { anyOf: [pickerJob, { type: "null" }] },
    }),
    ["p_search", "p_cursor", "p_limit", "p_selected_id"],
  ),
  "/rest/v1/rpc/manual_assignment_candidates": rpc(
    "native_manual_assignment_candidates",
    "Jobs",
    "Read current instructor candidates for a job",
    "Requires current job management authority. Eligibility follows the complete block, scheduling conflicts and lecturer requirements. Only finance-authorised callers receive the candidate's quote. The current terms version identifies the terms to review.",
    { p_job_id: uuid, p_search: { ...text, maxLength: 200, default: "" } },
    manualAssignmentCandidates,
    ["p_search"],
  ),
  "/rest/v1/rpc/manual_assign_job": rpc(
    "native_manual_assign_job",
    "Jobs",
    "Allocate the complete job to the selected instructor",
    "Requires current job management authority, an eligible lecturer, the reviewed offer and terms versions, and an available position. Use the same request ID for an exact retry. Only a confirmed receipt with a claim ID confirms the allocation.",
    {
      p_job_id: uuid,
      p_lecturer_id: uuid,
      p_terms_version: { ...version, minimum: 1 },
      p_expected_job_version: { ...version, minimum: 1 },
      ...idempotency,
    },
    manualAssignmentReceipt,
  ),
  "/rest/v1/rpc/job_replacement_candidates": rpc(
    "native_job_replacement_candidates",
    "Jobs",
    "Read replacement candidates for a confirmed lecturer assignment",
    "Requires job management authority. Candidates are checked against the entire future assignment. Only finance-authorised callers receive quotes.",
    { p_claim_id: uuid, p_search: { ...text, maxLength: 200, default: "" } },
    manualAssignmentCandidates,
    ["p_search"],
  ),
  "/rest/v1/rpc/replace_job_lecturer": rpc(
    "native_replace_job_lecturer",
    "Jobs",
    "Transfer a confirmed assignment to another lecturer",
    "Requires job management authority and the reviewed job and terms versions. Release and reassignment commit together for a complete future block. Both lecturers receive a notification after confirmation. A retry must use the same parameters.",
    {
      p_claim_id: uuid,
      p_lecturer_id: uuid,
      p_terms_version: { ...version, minimum: 1 },
      p_expected_job_version: { ...version, minimum: 1 },
      p_reason: { ...text, minLength: 5, maxLength: 1000 },
      ...idempotency,
    },
    manualAssignmentReceipt,
  ),
  "/rest/v1/rpc/create_capacity_job": rpc(
    "native_create_capacity_job",
    "Jobs",
    "Create a job with one to twenty priced teaching positions",
    "Requires current job management authority. Use net fields for a direct offer, or gross fields with either finance authority or Management authority and an explicit platform share. An existing active organisation can be assigned on either pricing path. The assigned company supplies the customer name. Supply one to sixty future session intervals and a request ID for exact retries.",
    {
      p_payload: { oneOf: [capacityNetOffer, capacityGrossOffer] },
      p_capacity: { type: "integer", minimum: 1, maximum: 20 },
      ...idempotency,
      p_organisation_id: { ...nullableUuid, default: null },
      p_platform_percent: {
        type: ["number", "null"],
        default: null,
        minimum: 0,
        maximum: 100,
        multipleOf: 0.01,
        description:
          "Optional platform share for a gross offer. Null uses applicable role or lecturer rates. Net offers cannot set a share.",
      },
    },
    uuid,
    ["p_organisation_id", "p_platform_percent"],
  ),
  "/rest/v1/rpc/company_class_directory": rpc(
    "native_company_class_directory",
    "Jobs",
    "Read company classes and dispatch contacts",
    "Requires current authority for the internal company. Premium LMS is optional.",
    { p_organisation_id: uuid },
    dispatchDirectory,
  ),
  "/rest/v1/rpc/save_company_dispatch_class": rpc(
    "native_save_company_dispatch_class",
    "Jobs",
    "Save a company class and its default meeting room",
    "Requires current authority for the internal company. A null class ID creates a class. Set an HTTPS meeting URL or clear the optional link.",
    {
      p_organisation_id: uuid,
      p_class_id: nullableUuid,
      p_name: text,
      p_meeting_url: dispatchText,
    },
    dispatchDirectory,
  ),
  "/rest/v1/rpc/save_company_dispatch_settings": rpc(
    "native_save_company_dispatch_settings",
    "Jobs",
    "Set the default company job contact",
    "Select a current contact of the company, clear the default, or create and select a contact in one operation.",
    {
      p_organisation_id: uuid,
      p_contact_id: nullableUuid,
      p_new_contact: {
        anyOf: [
          object({ name: text, email: text, phone: text }),
          { type: "null" },
        ],
      },
    },
    dispatchDirectory,
    ["p_new_contact"],
  ),
  "/rest/v1/rpc/job_dispatch_options": rpc(
    "native_job_dispatch_options",
    "Jobs",
    "Read classes and defaults for a job",
    "Company contacts select classes of the job company. Job managers may inspect another company only while the job company is reassignable.",
    { p_job_id: uuid, p_organisation_id: uuid },
    object({
      classes: dispatchClasses,
      contact: { anyOf: [dispatchContact, { type: "null" }] },
    }),
  ),
  "/rest/v1/rpc/save_job_dispatch": rpc(
    "native_save_job_dispatch",
    "Jobs",
    "Assign or clear the class of a job",
    "Requires ownership or job-management permission and the current lifecycle version. Saves the meeting room and contact without changing accepted terms.",
    {
      p_job_id: uuid,
      p_class_id: nullableUuid,
      p_expected_version: { ...version, minimum: 1 },
    },
    uuid,
  ),
  "/rest/v1/rpc/job_lifecycle": rpc(
    "native_job_lifecycle",
    "Jobs",
    "Read current job lifecycle and visible assignment history",
    "Requires access to the job. Managers can see permitted assignment history. Lecturers receive only their own claims. Gross and role-based maximum budgets require the current finance capability. Historical claims may lack intervals or events.",
    { p_job_id: uuid },
    object({
      version: { ...version, minimum: 1 },
      capacity: { ...version, minimum: 1 },
      capacity_basis: { enum: ["single_position", "per_position"] },
      confirmed_count: version,
      open_positions: version,
      can_set_capacity: boolean,
      gross_budget: { type: ["number", "null"] },
      max_net_budget: { type: ["number", "null"] },
      can_manage: boolean,
      can_edit: boolean,
      can_edit_schedule: boolean,
      can_edit_course_details: boolean,
      can_edit_metadata: boolean,
      replaceable_claim_ids: { type: "array", items: uuid },
      can_duplicate: boolean,
      organisation_id: nullableUuid,
      can_reassign_company: boolean,
      can_edit_dispatch: boolean,
      class_id: nullableUuid,
      class_name: dispatchText,
      meeting_url: dispatchText,
      dispatch_contact: { anyOf: [dispatchContact, { type: "null" }] },
      claims: {
        type: "array",
        items: object({
          id: uuid,
          lecturer_id: uuid,
          lecturer_name: text,
          status: { enum: ["confirmed", "cancelled"] },
          created_at: sessionInstant,
          can_cancel: { type: ["boolean", "null"] },
          sessions: {
            type: ["array", "null"],
            items: object({
              ...timestampInterval,
              released_at: nullableDateTime,
            }),
          },
          events: {
            type: ["array", "null"],
            items: object({
              type: text,
              created_at: sessionInstant,
              reason: { type: ["string", "null"] },
            }),
          },
        }),
      },
    }),
  ),
  "/rest/v1/rpc/manage_job_offer": {
    post: {
      ...lifecycleCommand.post,
      requestBody: {
        required: true,
        content: json({
          oneOf: [
            offerAction(["draft", "published", "archived"], {
              reason: lifecycleReason,
            }),
            offerAction(["duplicate"], {
              reason: lifecycleReason,
              title: { ...text, minLength: 1, maxLength: 200 },
            }),
            offerAction(["reopen"], {
              reason: { ...lifecycleReason, minLength: 5 },
              claim_deadline: lifecycleDeadline,
            }),
            offerAction(["edit_metadata"], {
              title: { ...text, minLength: 1, maxLength: 200 },
              description: { ...text, maxLength: 12000 },
            }),
            offerAction(["edit"], {
              reason: lifecycleReason,
              title: { ...text, minLength: 1, maxLength: 200 },
              organisation_id: {
                ...uuid,
                description:
                  "Assign an active company to a draft or open unaccepted offer attached to its own unpublished course run, including legacy offers. Company requests, pricing records and dependent course activity prevent reassignment.",
              },
              class_id: nullableUuid,
              course_template_id: {
                ...uuid,
                description:
                  "Select an active template for an eligible linked draft.",
              },
              time_zone: {
                ...text,
                description:
                  "Set the IANA zone on both an eligible linked draft and its course.",
              },
              delivery_type: { enum: ["online", "onsite"] },
              description: { ...text, maxLength: 12000 },
              sessions: {
                type: "array",
                minItems: 1,
                maxItems: 60,
                items: object({
                  starts_at: sessionInstant,
                  ends_at: sessionInstant,
                }),
                description:
                  "Replacement of a complete, future, editable offer schedule. Shared course plans and existing assignments use their change workflows.",
              },
              topic_ids: {
                type: "array",
                maxItems: 500,
                items: uuid,
                description:
                  "Replacement required-topic list. An empty array clears the requirements.",
              },
              location: { ...text, maxLength: 500 },
              terms: { ...text, maxLength: 12000 },
              claim_deadline: lifecycleDeadline,
            }),
          ],
        }),
      },
    },
  },
  "/rest/v1/rpc/assignment_withdrawals": rpc(
    "native_assignment_withdrawals",
    "Jobs",
    "Read authorised teaching assignment withdrawal requests",
    "Returns the current lecturer's own requests or the managing actor's authorised review queue. An optional job ID restricts the result. The server checks which claims can still be withdrawn and whether review is required.",
    { p_job_id: { ...nullableUuid, default: null } },
    object({
      can_review: boolean,
      claims: {
        type: "array",
        items: object({
          claim_id: uuid,
          starts_at: nullableDateTime,
          can_withdraw: boolean,
          requires_approval: boolean,
        }),
      },
      items: {
        type: "array",
        maxItems: 200,
        items: object({
          id: uuid,
          claim_id: uuid,
          job_id: uuid,
          job_title: text,
          lecturer_id: uuid,
          lecturer_name: text,
          status: withdrawalStatus,
          reason: lifecycleReason,
          review_reason: { type: ["string", "null"], maxLength: 1000 },
          created_at: sessionInstant,
          resolved_at: nullableDateTime,
          can_review: boolean,
        }),
      },
    }),
    ["p_job_id"],
  ),
  "/rest/v1/rpc/request_assignment_withdrawal": rpc(
    "native_request_assignment_withdrawal",
    "Jobs",
    "Request withdrawal from an own confirmed teaching assignment",
    "Requires the current lecturer and an eligible future assignment. Withdrawal at short notice requires a reason of at least five characters and a management decision. The receipt reports the exact current state.",
    {
      p_claim_id: uuid,
      p_reason: { type: ["string", "null"], maxLength: 1000 },
      ...idempotency,
    },
    withdrawalReceipt,
  ),
  "/rest/v1/rpc/report_assignment_sick_day": rpc(
    "native_report_assignment_sick_day",
    "Jobs",
    "Release the upcoming sessions of an own teaching day",
    "Requires an own confirmed assignment. The selected session identifies the date in the job time zone. The database atomically reopens the upcoming sessions on that date as one urgent ordinary job, stores a retry receipt, and retains the other teaching days.",
    {
      p_claim_id: uuid,
      p_session_id: uuid,
      ...idempotency,
    },
    object({
      job_id: uuid,
      released_sessions: { type: "integer", minimum: 1 },
      teaching_date: { type: "string", format: "date" },
    }),
  ),
  "/rest/v1/rpc/review_assignment_withdrawal": rpc(
    "native_review_assignment_withdrawal",
    "Jobs",
    "Approve or reject a pending teaching assignment withdrawal",
    "Requires current job management authority and an application by another actor. The database rechecks the pending state, unstarted sessions and financial eligibility before release. Rejecting retains the assignment.",
    {
      p_withdrawal_id: uuid,
      p_approve: boolean,
      p_reason: { ...lifecycleReason, minLength: 5 },
      ...idempotency,
    },
    withdrawalReceipt,
  ),
  "/rest/v1/rpc/replacement_marketplace": rpc(
    "native_replacement_marketplace",
    "Jobs",
    "List visible offers to take over future teaching",
    "Current roles, participation and eligibility determine which offers appear. Only the current managing actor or original lecturer receives the reason. The quote is scoped to the eligible recipient. Read it before accepting.",
    {},
    {
      type: "array",
      maxItems: 200,
      items: object({
        id: uuid,
        job_id: uuid,
        title: text,
        time_zone: text,
        status: { enum: ["open", "cancelled", "completed"] },
        mode: { enum: ["open", "selected"] },
        emergency: boolean,
        version: { ...version, minimum: 1 },
        created_at: sessionInstant,
        can_cancel: boolean,
        can_claim: boolean,
        reason: { type: ["string", "null"], maxLength: 1000 },
        quote: { anyOf: [replacementQuote, { type: "null" }] },
        sessions: { type: ["array", "null"], items: object(timestampInterval) },
      }),
    },
  ),
  "/rest/v1/rpc/replacement_assignments": rpc(
    "native_replacement_assignments",
    "Jobs",
    "List assignments eligible for a replacement search",
    "Current lecturers receive their own eligible assignments. Current job managers can see other eligible assignments. The list excludes started, invoiced and already offered work.",
    {},
    {
      type: "array",
      items: object({
        claim_id: uuid,
        job_id: uuid,
        title: text,
        lecturer: text,
      }),
    },
  ),
  "/rest/v1/rpc/claim_replacement": rpc(
    "native_claim_replacement",
    "Jobs",
    "Accept the reviewed quote for an entire replacement assignment",
    "Requires a current eligible lecturer, the offer version and the reviewed quote terms version. Booking, release and relevant permissions are decided together. Only a confirmed receipt with a claim ID confirms the transfer.",
    {
      p_offer_id: uuid,
      p_expected_version: { ...version, minimum: 1 },
      p_terms_version: version,
      ...idempotency,
    },
    {
      anyOf: [
        object({ status: replacementRefusal }),
        object({
          status: { enum: ["confirmed", "cancelled", "unavailable"] },
          claim_id: uuid,
        }),
      ],
    },
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
  "/rest/v1/rpc/save_profile_display_name": rpc(
    "native_save_profile_display_name",
    "Accounts",
    "Update your display name",
    "Updates only the current actor’s display name.",
    { p_display_name: { ...text, minLength: 1, maxLength: 120 } },
    text,
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
    "native_client_requests",
    "Courses",
    "List the current company course requests",
    "Returns up to 500 requests in the caller's current company or authorised finance scope. An optional organisation ID narrows this scope. Amounts refer to the requested or saved company quote, or are null for internal staffing.",
    { p_organisation_id: nullableUuid },
    {
      type: "array",
      maxItems: 500,
      items: object({
        ...clientRequestFields,
        gross_amount: { type: ["number", "null"] },
        gross_total_amount: { type: ["number", "null"] },
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
    "native_client_request_brief",
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
    "native_client_request_history",
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
          payload: {
            ...object({
              ...clientRequestFields,
              own_lecturers_only: companyLecturerOnlyInput,
            }),
            required: Object.keys(clientRequestFields),
          },
          job_id: nullableUuid,
        }),
      }),
    },
    ["p_before"],
  ),
  "/rest/v1/rpc/company_lecturer_roster": {
    get: {
      operationId: "get_company_lecturer_roster",
      tags: ["Companies"],
      summary: "Read the company's own lecturer roster",
      description: companyLecturerRosterDescription,
      parameters: [
        {
          name: "p_organisation_id",
          in: "query",
          required: true,
          schema: uuid,
        },
      ],
      responses: {
        "200": {
          description: "Current lecturer roster",
          content: json(companyLecturerRosterSchema),
        },
        "400": error,
        "401": error,
        "403": error,
      },
    },
    ...rpc(
      "native_company_lecturer_roster",
      "Companies",
      "Read the company's own lecturer roster",
      companyLecturerRosterDescription,
      { p_organisation_id: uuid },
      companyLecturerRosterSchema,
    ),
  },
  "/rest/v1/rpc/set_company_lecturer": rpc(
    "native_set_company_lecturer",
    "Companies",
    "Assign or remove a company lecturer",
    "Adding an existing active lecturer requires organisation management. Company contacts may remove a lecturer from their own organisation. This changes membership without granting account roles.",
    { p_organisation_id: uuid, p_lecturer_id: uuid, p_remove: boolean },
    { type: "null" },
  ),
  "/rest/v1/rpc/create_client_request_with_brief": rpc(
    "native_create_client_request_with_brief",
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
    "native_save_client_request_brief",
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
    "native_job_related_navigation",
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
    "native_repeat_client_request",
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
    "native_profile_courses",
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
    "native_reviewable_courses",
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
    "native_lecturer_reviews",
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
  "/rest/v1/rpc/chat_directory_filters": rpc(
    "native_chat_directory_filters",
    "Chat",
    "List filter options for accessible chat rooms",
    "Returns categories and display labels for the caller’s accessible rooms. Course and job data require their own read access. Staff and lecturer labels come from current room members eligible as contacts. Company affiliation in direct messages follows existing membership permissions.",
    {},
    {
      type: "array",
      items: object({
        room_id: uuid,
        category: { enum: ["company", "staff", "course", "lecturer"] },
        facet_key: text,
        label: text,
      }),
    },
  ),
  "/rest/v1/rpc/chat_contacts": rpc(
    "native_chat_contacts",
    "Chat",
    "List eligible chat contacts",
    "Returns the names and role labels of currently eligible contacts for the authenticated portal actor. The caller is excluded. Visibility depends on current staff, course-management or shared-room authority.",
    {},
    {
      type: "array",
      items: object({
        id: uuid,
        display_name: text,
        roles: { type: "array", items: text },
      }),
    },
  ),
  "/rest/v1/rpc/chat_rooms_with_manual_unread": rpc(
    "native_chat_rooms_with_manual_unread",
    "Chat",
    "List accessible rooms and personal read indicators",
    "Returns only rooms the current caller can access, most recent first. The preview is at most 160 characters, excludes personally hidden messages and contains no deleted message body. Manual unread and mute values belong to the caller. The personal_deleted flag marks rooms omitted from the caller's directory until they have a new visible message.",
    {},
    {
      type: "array",
      items: object({
        id: uuid,
        kind: {
          enum: [
            "dm",
            "general",
            "topic",
            "lecturer_course",
            "participant_course",
          ],
        },
        title: text,
        job_id: nullableUuid,
        owner_id: nullableUuid,
        unread_count: version,
        last_message_at: nullableDateTime,
        muted: boolean,
        manual_unread: boolean,
        last_message_preview: { type: ["string", "null"], maxLength: 160 },
        personal_deleted: boolean,
      }),
    },
  ),
  "/rest/v1/rpc/chat_pinned_rooms": rpc(
    "native_chat_pinned_rooms",
    "Chat",
    "List the caller's pinned rooms in display order",
    "Returns IDs from the caller's own retained memberships, ordered by personal pin rank. Rooms that are currently inaccessible or whose membership has ended are excluded.",
    {},
    { type: "array", items: uuid },
  ),
  "/rest/v1/rpc/chat_personal_archives": rpc(
    "native_chat_personal_archives",
    "Chat",
    "List the caller's personally archived chats",
    "Returns still-accessible direct messages and topic groups archived by the caller. The personal archive never changes the shared room or another member's directory.",
    {},
    { type: "array", items: uuid },
  ),
  "/rest/v1/rpc/create_dm": rpc(
    "native_create_dm",
    "Chat",
    "Open the direct message room for an eligible contact",
    "Requires an eligible contact for the current portal actor. Repeated requests and reversed requests by the same pair return the same room ID. Current contact eligibility is checked before opening an existing room.",
    { p_user_id: uuid },
    uuid,
  ),
  "/rest/v1/rpc/ensure_general_chat": rpc(
    "native_ensure_general_chat",
    "Chat",
    "Join the shared lecturer chat",
    "Requires an active owner, administrator, lecturer or senior lecturer role. Exact and concurrent retries return the same shared room ID and keep one membership per caller.",
    {},
    uuid,
  ),
  "/rest/v1/rpc/create_chat_group": rpc(
    "native_create_chat_group",
    "Chat",
    "Create a topic group or participant course chat",
    "A topic group requires a current staff role and eligible staff members. A participant course chat requires course-management authority and a job belonging to a valid course with Premium enabled. An existing participant course chat returns a conflict. Each eligible participant and assigned lecturer is added through current enrolment and assignment checks.",
    {
      p_title: { ...text, minLength: 1, maxLength: 160 },
      p_member_ids: { type: ["array", "null"], maxItems: 100, items: uuid },
      p_kind: { enum: ["topic", "participant_course"], default: "topic" },
      p_job_id: nullableUuid,
    },
    uuid,
    ["p_kind", "p_job_id"],
  ),
  "/rest/v1/rpc/chat_group_settings": rpc(
    "native_chat_group_settings",
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
  "/rest/v1/rpc/update_chat_group_settings": (() => {
    const operation = rpc(
      "native_update_chat_group_settings",
      "Chat",
      "Update group information with its current version",
      "Requires current group access and ownership, or course-management authority for a course room. Read the current settings version first. A stale version returns PostgreSQL code 40001. Read the settings again before retrying a reviewed change.",
      {
        p_room_id: uuid,
        p_title: { ...text, minLength: 1, maxLength: 120 },
        p_description: { ...text, maxLength: 2000 },
        p_expected_version: { ...version, minimum: 1 },
      },
      { ...version, minimum: 2 },
    );
    return {
      post: {
        ...operation.post,
        responses: {
          ...operation.post.responses,
          "500": {
            ...error,
            description:
              "Server error, including SQLSTATE 40001 for a stale settings version",
          },
        },
      },
    };
  })(),
  "/rest/v1/rpc/chat_mention_candidates": rpc(
    "native_chat_mention_candidates",
    "Chat",
    "Read the people eligible for a mention in this room",
    "Only current room members can request this projection. The server excludes the caller and checks each recipient's current eligibility.",
    { p_room_id: uuid },
    { type: "array", items: chatMention },
  ),
  "/rest/v1/rpc/chat_messages_with_mentions": rpc(
    "native_chat_messages_with_mentions",
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
    "native_chat_reply_previews",
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
    "native_chat_topic_pinned_messages",
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
    "native_edit_message_with_mentions",
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
    "native_comment_context",
    "Comments",
    "Check current staff discussion and moderation access",
    "Requires current staff access to the specified job or course template. An archived resource cannot receive new comments.",
    commentResource,
    object({ can_post: boolean, can_moderate: boolean }),
  ),
  "/rest/v1/rpc/resource_comments": rpc(
    "native_resource_comments",
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
    "native_announcement",
    "Announcements",
    "Read an announcement visible to the current actor",
    "Requires an active account in the current publication's audience and display window. The acknowledgement is specific to the authenticated actor and exact revision.",
    { p_revision_id: uuid },
    z.toJSONSchema(announcementSchema),
  ),
  "/rest/v1/rpc/announcements": rpc(
    "native_announcements",
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
    "native_admin_announcement",
    "Announcements",
    "Read the draft and published announcement revisions",
    "Requires current announcement management authority. Returns the retained draft, current publication and version needed for a change.",
    { p_id: uuid },
    announcementAdminResponse,
  ),
  "/rest/v1/rpc/admin_announcements": rpc(
    "native_admin_announcements",
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
    "native_qualification_review",
    "Qualifications",
    "Read a lecturer's selected qualification and current evidence",
    "Requires the lecturer's own account or current qualification review authority. The exact shared scanned version is returned when its grant remains current. Downloads recheck evidence authority.",
    qualificationTarget,
    qualificationReview,
  ),
  "/rest/v1/rpc/save_qualification_evidence": rpc(
    "native_save_qualification_evidence",
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
    "native_attest_qualification",
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
    "native_own_qualification_certificates",
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
    "native_qualification_history",
    "Qualifications",
    "Read the qualification's recorded evidence and decisions",
    "Requires the lecturer's own account or current qualification review authority. For another page send both parts of the returned cursor. The result records evidence changes and attestation decisions.",
    { ...qualificationTarget, ...qualificationPage },
    z.toJSONSchema(qualificationHistoryPage),
    Object.keys(qualificationPage),
  ),
  "/rest/v1/rpc/taxonomy_catalogue": rpc(
    "native_taxonomy_catalogue",
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
    "native_save_taxonomy_topic",
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
    "native_knowledge_access",
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
  "/rest/v1/rpc/knowledge_categories": rpc(
    "native_knowledge_categories",
    "Knowledge",
    "List visible wiki or forum categories",
    "Requires current Knowledge staff access. Categories are ordered by German label and ID. Archived wiki categories are visible to wiki managers, and archived forum categories are visible to forum moderators.",
    { p_kind: knowledgeCategoryKind },
    { type: "array", items: knowledgeCategory },
  ),
  "/rest/v1/rpc/save_knowledge_category": rpc(
    "native_save_knowledge_category",
    "Knowledge",
    "Save or archive a bilingual category",
    "Requires wiki.manage for a wiki category or forum.moderate for a forum category. Pass null as the ID to create a category. Existing categories retain their kind. The slug must be unique within its kind. Omit the archived flag to save the category as active.",
    {
      p_id: nullableUuid,
      p_kind: knowledgeCategoryKind,
      p_slug: { ...text, maxLength: 80, pattern: "^[a-z0-9]+(-[a-z0-9]+)*$" },
      p_label_de: { ...text, minLength: 1, maxLength: 120 },
      p_label_en: { ...text, minLength: 1, maxLength: 120 },
      p_archived: { ...boolean, default: false },
    },
    uuid,
    ["p_archived"],
  ),
  "/rest/v1/rpc/wiki_pages_list": rpc(
    "native_wiki_pages_list",
    "Knowledge",
    "List and search authorised wiki revisions",
    "Requires current Knowledge staff access. Owners and wiki managers search the latest revision. Other staff search only visible published revisions. Search is a case-insensitive literal substring of the readable title or text. Archived pages require the archive flag and current owner or wiki management authority. Returns up to 200 pages, newest updated first.",
    {
      ...knowledgeListFilters,
      p_locale: { enum: ["", "de", "en", null], default: "" },
    },
    { type: "array", maxItems: 200, items: object(wikiPageFields) },
    [...Object.keys(knowledgeListFilters), "p_locale"],
  ),
  "/rest/v1/rpc/wiki_page": rpc(
    "native_wiki_page",
    "Knowledge",
    "Read the current visible wiki revision",
    "The page owner and wiki managers can read the latest revision. Other eligible readers receive the published revision of a current page.",
    { p_id: uuid },
    wikiPage,
  ),
  "/rest/v1/rpc/wiki_page_history": rpc(
    "native_wiki_page_history",
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
    "native_save_wiki_page",
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
    "native_wiki_attachments",
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
  "/rest/v1/rpc/manage_wiki_course_template": {
    post: {
      ...wikiCourseReference.post,
      responses: {
        ...wikiCourseReference.post.responses,
        "500": {
          ...error,
          description:
            "Database error, including a stale or published revision (40001) or the reference limit (54000).",
        },
      },
    },
  },
  "/rest/v1/rpc/wiki_course_template_choices": rpc(
    "native_wiki_course_template_choices",
    "Knowledge",
    "List course templates eligible for a wiki draft",
    "Returns IDs and titles of active, readable templates for the current unpublished draft. The caller must be staff and own the page or manage the wiki. Pass a company ID to get only templates owned by that company, subject to current company access. Pass null for the global editorial scope. If the draft or scope is unavailable, the result is empty.",
    { p_page_id: uuid, p_organisation_id: nullableUuid },
    { type: "array", items: object({ id: uuid, title: text }) },
  ),
  "/rest/v1/rpc/forum_threads_list": rpc(
    "native_forum_threads_list",
    "Knowledge",
    "List and search accessible staff discussions",
    "Requires current Knowledge staff access. Search matches the thread title and text of undeleted posts as case-insensitive literal substrings. Archived threads require the archive flag and current thread ownership or forum moderation authority. Returns up to 200 threads with pinned threads first and each caller's own subscription state.",
    knowledgeListFilters,
    { type: "array", maxItems: 200, items: object(forumThreadFields) },
    Object.keys(knowledgeListFilters),
  ),
  "/rest/v1/rpc/forum_thread": rpc(
    "native_forum_thread",
    "Knowledge",
    "Read the current staff discussion",
    "Requires current staff forum access. Includes the caller's subscription state, current moderation flags and the metadata version needed for a reviewed edit.",
    { p_id: uuid },
    object({
      ...forumThreadFields,
      metadata_version: wikiVersion,
    }),
  ),
  "/rest/v1/rpc/forum_posts": rpc(
    "native_forum_posts",
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
    "native_create_forum_thread",
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
    "native_add_forum_post",
    "Knowledge",
    "Reply to a staff discussion",
    "Requires an accessible discussion that is open for posting. The structured reply must contain text. Repeat an unchanged reply to the same thread with the original client ID.",
    { p_thread_id: uuid, p_content: knowledgeDocument, p_client_id: uuid },
    uuid,
  ),
  "/rest/v1/rpc/edit_forum_post": voidRpc(
    "native_edit_forum_post",
    "Knowledge",
    "Save a new revision of an authored discussion post",
    "Requires the author's own visible post in an open thread. Pass its last-read version. The edited document must contain text.",
    {
      p_post_id: uuid,
      p_content: knowledgeDocument,
      p_expected_version: wikiVersion,
    },
  ),
  "/rest/v1/rpc/edit_forum_thread_metadata": {
    post: {
      ...forumMetadataEdit.post,
      responses: {
        ...forumMetadataEdit.post.responses,
        "500": {
          ...error,
          description:
            "Database error, including a stale metadata version (40001). Read the current metadata before retrying.",
        },
      },
    },
  },
  "/rest/v1/rpc/delete_forum_post": voidRpc(
    "native_delete_forum_post",
    "Knowledge",
    "Remove an authored or moderated forum post",
    "Requires access to the thread and either post authorship or forum.moderate. Only moderators can remove posts inside a locked or archived thread. The server saves a revision, replaces the visible content with a tombstone and clears any accepted-answer pointer to this post. Repeating a permitted removal of the same tombstone is safe.",
    { p_post_id: uuid },
  ),
  "/rest/v1/rpc/moderate_forum_thread": voidRpc(
    "native_moderate_forum_thread",
    "Knowledge",
    "Set the lock, pin or archive state of a discussion",
    "Requires current forum.moderate permission. Send the flags to change and omit or pass null for those to retain. A missing discussion is rejected as invalid input. Changes are audited.",
    {
      p_thread_id: uuid,
      p_locked: { type: ["boolean", "null"], default: null },
      p_pinned: { type: ["boolean", "null"], default: null },
      p_archived: { type: ["boolean", "null"], default: null },
    },
    ["p_locked", "p_pinned", "p_archived"],
  ),
  "/rest/v1/rpc/accept_forum_answer": voidRpc(
    "native_accept_forum_answer",
    "Knowledge",
    "Select or clear the accepted reply to a discussion",
    "Requires access to the thread and either thread ownership or forum.moderate. Accept a current undeleted reply belonging to the thread. Pass null to clear the accepted answer.",
    { p_thread_id: uuid, p_post_id: nullableUuid },
  ),
  "/rest/v1/rpc/subscribe_forum_thread": voidRpc(
    "native_subscribe_forum_thread",
    "Knowledge",
    "Set the caller's subscription to a visible thread",
    "Requires access to the thread. The subscription belongs to the authenticated actor. Repeating the same subscription state is safe, and unsubscribing preserves previous notices.",
    { p_thread_id: uuid, p_subscribed: boolean },
  ),
  "/rest/v1/rpc/report_forum_post": {
    post: {
      ...forumPostReport.post,
      responses: {
        ...forumPostReport.post.responses,
        "500": {
          ...error,
          description:
            "Database error, including the hourly report limit (54000).",
        },
      },
    },
  },
  "/rest/v1/rpc/forum_reports": rpc(
    "native_forum_reports",
    "Knowledge",
    "List the caller's reports or the moderation queue",
    "Requires current Knowledge staff access. Staff see their own reports. Forum moderators can see the queue. Returns up to 200 latest reports first.",
    {},
    {
      type: "array",
      maxItems: 200,
      items: object({
        id: uuid,
        post_id: uuid,
        thread_id: uuid,
        reason: text,
        status: { enum: ["open", "resolved"] },
        reporter_name: text,
        created_at: sessionInstant,
      }),
    },
  ),
  "/rest/v1/rpc/resolve_forum_report": voidRpc(
    "native_resolve_forum_report",
    "Knowledge",
    "Resolve or reopen an existing report",
    "Requires current forum.moderate permission. Pass true to resolve a report or false to reopen it. A missing report is rejected as invalid input. The current reviewer and an audit event are recorded.",
    { p_report_id: uuid, p_resolved: boolean },
  ),
  "/rest/v1/rpc/job_briefing": rpc(
    "native_job_briefing",
    "Courses",
    "Read the authorised teaching brief and contact for a job",
    "Requires current job management or an eligible lecturer with access to the job. Contact fields are empty when the selected contact visibility or current claim does not allow disclosure.",
    { p_job_id: uuid },
    jobBriefingResult,
  ),
  "/rest/v1/rpc/save_job_briefing": rpc(
    "native_save_job_briefing",
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
    "native_wiki_course_templates",
    "Courses",
    "List visible course template references on a wiki page",
    "The read follows the caller's visible wiki revision and independent course template authority. The page owner and wiki managers may see the current revision. Other permitted readers see the published revision. With a company ID, the caller needs current access to that company and only its templates are listed. Without it, the global editorial scope applies.",
    { p_page_id: uuid, p_organisation_id: nullableUuid },
    {
      type: "array",
      maxItems: 20,
      items: object({ template_id: uuid, title: text, archived: boolean }),
    },
    ["p_organisation_id"],
  ),
  "/rest/v1/rpc/teaching_day": rpc(
    "native_teaching_day",
    "Courses",
    "Read the current local day's teaching and course preparation",
    "Uses the current profile's IANA time zone. The response includes the lecturer's current confirmed sessions, authorised course resources, deliberately selected course contacts and personal preparation. Other active roles receive an empty list.",
    {},
    z.toJSONSchema(teachingDaySchema),
  ),
  "/rest/v1/rpc/save_teaching_preparation": rpc(
    "native_save_teaching_preparation",
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
  "/rest/v1/rpc/import_table_row": rpc(
    "importTableRow",
    "Operations",
    "Create and confirm one spreadsheet row",
    "Uses the existing create permission for the kind. Use the organisation ID for contacts and course ID with the participant’s portal ID in payload.id for enrolments. Other kinds use a null scope and the same payload as their create RPC. Retry with the same row key, kind, scope and payload. Reusing the key for different data returns 409.",
    importRowParameters,
    importRowResult,
  ),
  "/rest/v1/rpc/search_course_materials": rpc(
    "searchCourseMaterials",
    "Premium LMS",
    "Search clean course materials across all authorised courses",
    "Filters by exact course ID and category and by a case-insensitive substring in file name, title, description, subject, learning objectives or tags. Use null to omit a filter. Returns at most 25 rows ordered by file name and resource ID. Metadata shares the file's audience. Rows without metadata return null and revision zero. Downloads require current access to the shared resource.",
    materialSearchParameters,
    materialSearchResult,
  ),
  "/rest/v1/rpc/set_course_material_metadata": rpc(
    "setCourseMaterialMetadata",
    "Premium LMS",
    "Revise educational metadata on an exact course share",
    "Requires course management or a current lecturer editing their own material in an enabled Premium course. Does not change the file version or audience. Send the last read metadata_revision (zero if missing); stale changes return 409. Identical retries return the current revision.",
    materialMetadataParameters,
    materialMetadataRevision,
  ),
  "/rest/v1/rpc/course_material_metadata_history": rpc(
    "readCourseMaterialMetadataHistory",
    "Premium LMS",
    "Read exact-share metadata revisions",
    "Current staff in an enabled course can read up to 21 metadata snapshots. Start with a null cursor and pass the last displayed revision to continue. Share withdrawal or loss of current course access disables history.",
    materialHistoryParameters,
    materialHistoryResult,
  ),
  "/rest/v1/rpc/course_material_reuse_targets": rpc(
    "listCourseMaterialReuseTargets",
    "Premium LMS",
    "Find a destination for an owned scanned course material",
    "Up to 51 authorized courses in the original organisation. The shared flag indicates an active share of this material version and audience. Filter by course title.",
    materialReuseTargetsParameters,
    materialReuseTargetsResult,
  ),
  "/rest/v1/rpc/reuse_course_material": rpc(
    "reuseCourseMaterial",
    "Premium LMS",
    "Share an exact scanned material version in another course",
    "Requires current publishing rights in both courses and personal ownership of the source. The audience and file version stay fixed. Optionally copy current metadata into the destination; existing destination metadata is preserved.",
    materialReuseParameters,
    materialReuseResult,
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
    "Read an authorised course workspace",
    "Returns the actor-scoped course. With Premium disabled, course managers, assigned lecturers and authorised company contacts receive course details and scheduled sessions. Active Premium enables scoped learning materials, participant workflows and meeting links. Learners have no roster, staff audit history, quiz answer indices or exam answer keys.",
    course,
    internalWorkspaceResult,
  ),
  "/rest/v1/rpc/course_question_bank": rpc(
    "readCourseQuestionBank",
    "Premium LMS",
    "List reusable course quiz questions",
    "Current course staff can search question prompts and topics in the course organisation. Returns up to twenty current revisions with answer keys and edit capability.",
    questionBankParameters,
    questionBankResult,
    questionBankOptionalParameters,
  ),
  "/rest/v1/rpc/course_question_bank_action": {
    post: {
      operationId: "saveCourseQuestionBank",
      tags: ["Premium LMS"],
      summary: "Save question revisions or configure a quiz from the bank",
      description:
        "Save, archive or restore an organisation question with its last-read revision. Configure pins selected revisions and saves the canonical quiz snapshot in one transaction. Optional shuffling covers the whole new quiz revision.",
      requestBody: {
        required: true,
        content: json({
          ...object(questionBankActionParameters),
          required: Object.keys(questionBankActionParameters),
          oneOf: questionBankActionVariants,
        }),
      },
      responses: {
        "200": {
          description: "Confirmed revision",
          content: json(questionBankActionResult),
        },
        "400": error,
        "401": error,
        "403": error,
        "409": error,
      },
    },
  },
  "/rest/v1/rpc/course_completion_status": rpc(
    "readCourseCompletionStatus",
    "Premium LMS",
    "Read current course completion requirements",
    "A current learner reads their own status by leaving p_user_id empty. Course staff may select a current enrolment. Reports the versioned attendance, quiz, enrolment, timing and post-revocation requirements used by certificate issuance and separately identifies an already issued document.",
    courseCompletionStatusParameters.properties,
    courseCompletionStatusResult,
    ["p_user_id"],
  ),
  "/rest/v1/rpc/course_gradebook": rpc(
    "readCourseGradebook",
    "Premium LMS",
    "Read a scoped, paginated course quiz gradebook",
    "Current course staff receive a paginated roster, the best attempt from the current published quiz version, its server-calculated grading-policy preview, and the latest published grade per learner. Participants receive only their own published grade and no roster, correction reason or attempt answers.",
    courseGradebookParameters.properties,
    courseGradebookResult,
    ["p_offset", "p_limit"],
  ),
  "/rest/v1/rpc/course_gradebook_history": rpc(
    "readCourseGradebookHistory",
    "Premium LMS",
    "Read published quiz grade history",
    "Current staff can read published revisions with their internal correction reasons for an enrolled or completed learner. Learners can read only their own published revisions and never receive internal reasons. Pass next_before as p_before_revision to fetch older revisions.",
    courseGradebookHistoryParameters.properties,
    courseGradebookHistoryResult,
    ["p_user_id", "p_before_revision", "p_limit"],
  ),
  "/rest/v1/rpc/course_gradebook_export": rpc(
    "exportCourseGradebook",
    "Premium LMS",
    "Export current published quiz grades",
    "Current course staff only. Returns a single snapshot of up to 5,000 latest published grades for current enrolled and completed learners, with no previews or correction reasons.",
    course,
    courseGradebookExportResult,
  ),
  "/rest/v1/rpc/course_assignments": rpc(
    "courseAssignments",
    "Premium LMS",
    "Read course assignments and feedback",
    "Scoped staff see the authoring definition and a bounded attempt page. An enrolled participant sees published definitions, their own attempts and released feedback.",
    {
      ...course,
      p_assignment_id: { type: ["string", "null"], format: "uuid" },
      p_offset: version,
    },
    z.toJSONSchema(courseAssignmentsProjection),
    ["p_assignment_id", "p_offset"],
  ),
  "/rest/v1/rpc/course_assignment_action": rpc(
    "courseAssignmentAction",
    "Premium LMS",
    "Save, publish, submit or assess a course assignment",
    "Staff can save and publish versioned rubrics, grant an extension or record a review. Participants submit the exact clean reservation assigned to their own course attempt. Writes compare the last read version.",
    {
      ...course,
      p_assignment_id: uuid,
      p_action: { enum: ["save", "publish", "extend", "submit", "review"] },
      p_payload: { type: "object" },
      p_expected_version: version,
    },
    object({ id: uuid }),
  ),
  "/rest/v1/rpc/course_submissions": rpc(
    "courseSubmissions",
    "Premium LMS",
    "List private participant file submissions",
    "Internal Premium LMS only. Participants see their own clean submissions. Assigned instructors, course management and authorised contacts of the course company can see its submissions. Pass next as p_after to page through older submissions. Closing intake preserves scoped reads.",
    { ...course, p_after: nullableUuid },
    z.toJSONSchema(courseSubmissionPage),
    ["p_after"],
  ),
  "/rest/v1/rpc/set_course_submissions": rpc(
    "setCourseSubmissions",
    "Premium LMS",
    "Open or close participant file submissions",
    "Requires active company Premium and course-management authority or a current contact of the exact company. Each course defaults to closed. Opening intake permits enrolled participants to submit private files.",
    { ...course, p_enabled: boolean },
    boolean,
  ),
  "/rest/v1/rpc/withdraw_course_submission": rpc(
    "withdrawCourseSubmission",
    "Premium LMS",
    "Withdraw an exact participant submission",
    "On an active Premium course, an enrolled participant can withdraw their own file while submissions are open. Course management and authorised contacts of the course company can withdraw a file in their course. The version stops appearing in all active course views.",
    { ...course, p_version_id: uuid },
    boolean,
  ),
  "/rest/v1/rpc/set_course_meeting_link": rpc(
    "setCourseMeetingLink",
    "Premium LMS",
    "Publish or clear an online course meeting link",
    "Requires a currently confirmed instructor, course manager or authorised contact of the exact company for an online course. The internal edition requires active company Premium. Customer editions require an enabled course profile for the active release licence. Licence grace permits reading the saved link. Submit the last read version. A stale version returns HTTP 409. Use a credential-free HTTPS URL with a domain name. Send null to return to the existing course venue.",
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
  "/rest/v1/rpc/course_attendance_summary": rpc(
    "courseAttendanceSummary",
    "Premium LMS",
    "Read verified attendance totals for a course or class",
    "Current managers, assigned instructors and authorised company contacts only. Linked classes include only unarchived courses in the caller’s scope. Returns verified present, absent and excused counts and recorded minutes for enrolled or completed participants without staff notes. Pass next_after as p_after_user_id for the next 50 participants.",
    { ...course, p_after_user_id: nullableUuid },
    z.toJSONSchema(attendanceSummarySchema),
    ["p_after_user_id"],
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
        currency: { enum: [...currencyCodes] },
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
  "/rest/v1/rpc/set_company_participant_class": voidRpc(
    "setCompanyParticipantClass",
    "Premium LMS",
    "Set or clear one company participant's class",
    "Requires current company participant management, Premium and an active membership. The class must belong to the specified company. Send the current membership version and null to clear the class. A stale version returns HTTP 409. Existing course enrolments keep their own lifecycle.",
    {
      ...organisation,
      p_user_id: uuid,
      p_class_id: nullableUuid,
      p_expected_version: { ...version, minimum: 1 },
    },
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
  "/rest/v1/rpc/inspect_retained_course_attendance": rpc(
    "inspectRetainedCourseAttendance",
    "Administration",
    "Inspect recorded attendance for a retained Premium course",
    "Requires the current explicit internal admin role, a company with Premium switched off and an exact company/course match. Each page audits the inspection purpose. The read returns up to 50 persisted attendance entries in session order. It includes only recorded marks and notes, with no learner email, evidence bytes or write authority. Omit all cursor fields on the first request and send the three returned cursor fields together on the next.",
    {
      ...organisation,
      ...course,
      p_reason: courseChatAuditReason,
      p_after_start: nullableDateTime,
      p_after_session_id: nullableUuid,
      p_after_user_id: nullableUuid,
    },
    z.toJSONSchema(retainedCourseAttendanceSchema),
    ["p_after_start", "p_after_session_id", "p_after_user_id"],
  ),
  "/rest/v1/rpc/inspect_retained_course_files": rpc(
    "inspectRetainedCourseFiles",
    "Administration",
    "List retained exam and material file versions",
    "Requires the current explicit internal admin role, a company with Premium switched off and an exact company/course match. Each page audits the inspection purpose. Up to 50 clean file versions are returned, including withdrawn course links. Omit both cursor fields on the first request and send both returned cursor fields together on the next. Use the exact returned file kind, ID and version with the course-documents gateway. This response contains no bytes or storage locations.",
    {
      ...organisation,
      ...course,
      p_reason: courseChatAuditReason,
      p_after_kind: { enum: ["exam", "material", null] },
      p_after_id: nullableUuid,
    },
    z.toJSONSchema(retainedCourseFilesSchema),
    ["p_after_kind", "p_after_id"],
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
  "Active admins and owners can inspect this company's recent deliveries. Customer accounting subscriptions additionally require gross-finance authority. Signing keys are omitted. The response includes up to 100 subscriptions with up to ten deliveries each.",
  { p_organisation: uuid },
  internalCompanyWebhookListSchema,
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
const companyAccountingWebhookCreate = rpc(
  "companyAccountingWebhookSubscribe",
  "Server integrations",
  "Subscribe to customer accounting events",
  "An active internal admin or owner with gross-finance authority attaches an active course-index key from the same company to an operator-configured receiver alias. Store the one-time signing key securely. Each subscription receives only its own company's customer invoice and settlement events. A duplicate receiver alias returns 409. The key can have at most five active subscriptions, including course subscriptions. At that limit, a new subscription returns 429.",
  {
    p_organisation: uuid,
    p_integration: uuid,
    p_destination: companyWebhookDestination,
  },
  object({
    id: uuid,
    signing_secret: { type: "string", pattern: "^[0-9a-f]{64}$" },
  }),
);
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
const companyIntegrationKeyListFields = {
  id: uuid,
  label: { ...text, minLength: 1, maxLength: 120 },
  created_at: { ...text, format: "date-time" },
  expires_at: nullableDateTime,
  revoked_at: nullableDateTime,
  version: integrationKeyVersion,
  last_used_at: nullableDateTime,
  scope: { type: "string", enum: companyIntegrationScopes },
};
const companyIntegrationKeys = rpc(
  "listCompanyIntegrationKeys",
  "Server integrations",
  "List a company's integration keys",
  "An active administrator, owner or authorised manager can list keys. Company accounts can read only their own current companies. Returns at most 100 keys without key material. A null expiry denotes a permanent key.",
  organisation,
  {
    type: "array",
    maxItems: 100,
    items: {
      ...object({
        ...companyIntegrationKeyListFields,
        webhook_eligible: {
          ...boolean,
          description:
            "Returned to administration for key selection when setting up webhooks.",
        },
      }),
      required: Object.keys(companyIntegrationKeyListFields),
    },
  },
);
const companyIntegrationKeyParameters = {
  ...organisation,
  p_label: { ...text, minLength: 1, maxLength: 120 },
  p_expires_at: {
    ...nullableDateTime,
    description:
      "Use null for a key without an expiry. A finite expiry must be within 180 days.",
  },
  p_rotate_id: nullableUuid,
  p_expected_version: { type: ["integer", "null"], minimum: 1 },
};
const companyIntegrationKeyReceipt = object({
  id: uuid,
  version: integrationKeyVersion,
  credential: {
    ...text,
    format: "password",
    pattern: "^lvi_[a-f0-9-]{36}_[a-f0-9]{64}$",
  },
});
const companyIntegrationKeyIssue = rpc(
  "issueCompanyIntegrationKey",
  "Server integrations",
  "Issue or rotate a company integration key",
  "An active administrator, owner or authorised manager can issue or rotate a key. Company accounts can do so only for their own current companies. For a new key send null for the key ID and version. For rotation send the current key ID and its version. Send null for no expiry or a future timestamp within 180 days. The response contains the one-time credential for secure storage by the receiving backend.",
  companyIntegrationKeyParameters,
  companyIntegrationKeyReceipt,
);
const scopedCompanyIntegrationKeyIssue = rpc(
  "issueScopedCompanyIntegrationKey",
  "Server integrations",
  "Issue or rotate a key with one explicit scope",
  "Available to active administrators, owners and authorised management, and to company accounts for their own current companies. The selected scope is immutable on rotation. Send null for no expiry or a future timestamp within 180 days. The response contains the one-time credential.",
  {
    ...companyIntegrationKeyParameters,
    p_scope: { type: "string", enum: companyIntegrationScopes },
  },
  companyIntegrationKeyReceipt,
);
const companyIntegrationKeyRevoke = voidRpc(
  "revokeCompanyIntegrationKey",
  "Server integrations",
  "Revoke a company integration key",
  "An active administrator, owner or authorised manager can revoke a key. Company accounts can revoke only keys belonging to their own current companies. Supply the current version. Subsequent use is denied.",
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
  ...deliveryEvidencePaths,
  ...internalMailRecoveryPaths,
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
      {
        ...operation,
        post: { ...nativeExplorerPaths[path]?.post, ...operation.post },
      },
    ]),
  ),
  ...companyLecturerBlockPaths,
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

const legacyHandover = new Set(
  legacyHandoverOperations.map((name) => `/rest/v1/rpc/${name}`),
);

const legacyInvitationResponse = (
  description: string,
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({
  description,
  content: json({ ...object(properties), required }),
});

function credentialPaths(nativePaths: ReturnType<typeof nativeDownloadPaths>) {
  return {
    "/functions/v1/invite-lecturer": {
      post: {
        operationId: "legacyInviteLecturer",
        tags: ["Accounts"],
        summary:
          "Invite a subordinate lecturer through the compatibility endpoint",
        description:
          "Requires an approved origin, enabled local invitation delivery and current authority to invite the lecturer role. Send at most 2048 UTF-8 bytes with a stable retry key. Only sent confirms delivery during this call. Retry with the original key and do not send again while the result is uncertain. Prefer the current Accounts invitation operation for new clients.",
        parameters: [
          {
            name: "Origin",
            in: "header",
            required: true,
            schema: { ...text, format: "uri" },
          },
        ],
        requestBody: {
          required: true,
          content: json({
            ...object({
              email: { ...text, format: "email", maxLength: 254 },
              display_name: { ...text, maxLength: 120 },
              idempotency_key: uuid,
            }),
            required: ["email", "idempotency_key"],
          }),
        },
        responses: {
          "200": {
            description: "Invitation outcome",
            content: json({
              oneOf: [
                object({
                  status: { enum: ["sent", "already_sent", "failed"] },
                  invitation_id: uuid,
                }),
                {
                  ...object({
                    status: { const: "in_progress" },
                    invitation_id: uuid,
                  }),
                  required: ["status"],
                },
              ],
            }),
          },
          "400": legacyInvitationResponse("Invalid invitation", {
            error: { const: "invalid_request" },
          }),
          "401": legacyInvitationResponse("Authentication required", {
            error: { const: "authentication_required" },
          }),
          "403": legacyInvitationResponse("Origin or authority refused", {
            error: { enum: ["origin_not_allowed", "permission_required"] },
          }),
          "405": legacyInvitationResponse("Unsupported method", {
            error: { const: "method_not_allowed" },
          }),
          "409": legacyInvitationResponse(
            "Invitation request conflicts with the stored reservation",
            { status: { const: "idempotency_conflict" }, invitation_id: uuid },
            ["status"],
          ),
          "413": legacyInvitationResponse("Request exceeds 2048 bytes", {
            error: { const: "request_too_large" },
          }),
          "429": legacyInvitationResponse("Invitation rate limit reached", {
            status: { const: "throttled" },
          }),
          "502": legacyInvitationResponse(
            "Delivery failed or could not be confirmed",
            {
              status: { const: "failed" },
              invitation_id: uuid,
            },
          ),
          "503": legacyInvitationResponse("Invitation delivery unavailable", {
            error: { enum: ["invitations_disabled", "invitation_unavailable"] },
          }),
        },
      },
    },
    "/rest/v1/rpc/save_calendar_subscription": {
      post: {
        ...nativePaths["/rest/v1/rpc/save_calendar_subscription"].post,
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
    ...notificationCredentialPaths(nativePaths),
    ...humanAuthPaths,
    ...internalMailDownload,
  };
}

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

/** The signed-in internal browser only needs its interactive document. */
export function internalExplorerDocument(
  backend: string,
  brand: InstallationBrand,
) {
  return internalDocument(backend, brand, interactivePaths);
}

const interactivePaths = withPortalHttpAliases(
  Object.fromEntries(
    Object.entries(paths).filter(([path]) => !legacyHandover.has(path)),
  ),
);

function internalOpenApi(
  backend: string,
  includeNonInteractive: boolean,
  brand: InstallationBrand,
) {
  if (!includeNonInteractive) return internalExplorerDocument(backend, brand);
  const nativePaths = nativeDownloadPaths();
  const documentedPaths = {
    ...nativePaths,
    ...Object.fromEntries(
      Object.entries(paths).map(([path, operations]) => [
        path,
        legacyHandover.has(path)
          ? { post: { ...(operations.post as object), deprecated: true } }
          : operations,
      ]),
    ),
    ...credentialPaths(nativePaths),
    "/functions/v1/website-enquiries": websiteEnquiryIntakePath,
    "/rest/v1/rpc/issue_company_integration_key": {
      post: {
        ...companyIntegrationKeyIssue.post,
        responses: {
          ...companyIntegrationKeyIssue.post.responses,
          "409": keyVersionConflict,
        },
      },
    },
    "/rest/v1/rpc/issue_scoped_company_integration_key": {
      post: {
        ...scopedCompanyIntegrationKeyIssue.post,
        responses: {
          ...scopedCompanyIntegrationKeyIssue.post.responses,
          "409": keyVersionConflict,
        },
      },
    },
    "/rest/v1/rpc/company_course_webhook_subscribe": companyWebhookCreate,
    "/rest/v1/rpc/company_accounting_webhook_subscribe":
      companyAccountingWebhookCreate,
    "/functions/v1/company-integration": companyCourseIndexPath,
    ...companyCourseOperationPaths,
  };
  return internalDocument(
    backend,
    brand,
    withPortalHttpAliases(documentedPaths),
    {
      securitySchemes: {
        websiteIntakeToken: {
          type: "apiKey",
          in: "header",
          name: "X-Luminovia-Integration-Token",
          description: "Dedicated server-only Website intake credential.",
        },
        integrationKey: {
          type: "http",
          scheme: "bearer",
          description: "Dedicated company integration key for server use.",
        },
      },
      webhooks: {
        companyCourseEvent: companyCourseWebhook,
        companyAccountingEvent: companyAccountingWebhook,
      },
    },
  );
}

function internalDocument(
  backend: string,
  brand: InstallationBrand,
  documentPaths: typeof paths,
  download?: {
    securitySchemes: {
      websiteIntakeToken: {
        type: string;
        in: string;
        name: string;
        description: string;
      };
      integrationKey: { type: string; scheme: string; description: string };
    };
    webhooks: {
      companyCourseEvent: typeof companyCourseWebhook;
      companyAccountingEvent: typeof companyAccountingWebhook;
    };
  },
) {
  return {
    ...accountOpenApi,
    info: {
      title: `${brand.name} API`,
      version: "1.16.0",
      description:
        "Account and business contracts with documented operation rules and native RPC signatures verified against the migrated database. Current permissions, company scope and entitlements apply. The repository API reference includes integration flows.",
    },
    servers: [{ url: backend.replace(/\/+$/, "") || "/" }],
    components: {
      ...accountOpenApi.components,
      schemas: knowledgeSchemas,
      securitySchemes: {
        ...accountOpenApi.components.securitySchemes,
        ...download?.securitySchemes,
      },
    },
    paths: documentPaths,
    ...(download && { webhooks: download.webhooks }),
  };
}

/** Compare the rendered operation with the exact configured backend and method. */
export function isDocumentedRequest(
  rawUrl: string,
  method: string,
  backend: string,
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
  if (route.startsWith(portalHttpAliasPrefix))
    return isPortalHttpAliasRequest(target, route, verb, interactivePaths);
  if (legacyHandover.has(route)) return false;
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
