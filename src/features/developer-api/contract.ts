import {installationBrand, type InstallationBrand} from "../../lib/installation-brand.ts";
import { accountOpenApi } from "../../../supabase/functions/accounts/openapi.ts";
import { nativeDownloadPaths, nativeExplorerPaths } from "./native-contract.ts";
import {
  courseEnrolmentsResult,
  enrolmentState,
  meetingLinkResult,
  meetingUrl,
  myWorkspacesResult,
  participantInvitesResult,
  workspaceActionRequest,
  workspaceActionResult,
  workspaceResult,
} from "./learning-contract.ts";

const uuid = { type: "string", format: "uuid" };
const boolean = { type: "boolean" };
const version = { type: "integer", minimum: 0 };
const text = { type: "string" };
const organisation = { p_organisation_id: uuid };
const idempotency = { p_request_id: uuid };
const course = { p_run_id: uuid };
const optionalUsername = {
  type: ["null", "string"],
  minLength: 3,
  maxLength: 32,
  pattern: "^[a-z][a-z0-9._-]{1,30}[a-z0-9]$",
};
const welcomeText = { type: "string", maxLength: 4000 };
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
) => ({
  post: {
    operationId,
    tags: [tag],
    summary,
    description,
    requestBody: {
      required: Object.keys(input).length > 0,
      content: json(object(input)),
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

const nativePaths = {
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
    object({
      version,
      description: welcomeText,
      objectives: welcomeText,
      joining_instructions: welcomeText,
      published_at: { type: ["null", "string"], format: "date-time" },
    }),
  ),
  "/rest/v1/rpc/publish_course_welcome_content": rpc(
    "publishCourseWelcomeContent",
    "Courses",
    "Publish a new welcome revision",
    "Available to currently authorized teaching staff and company contacts. Submit the last read version to detect concurrent changes.",
    {
      ...course,
      p_description: welcomeText,
      p_objectives: welcomeText,
      p_joining_instructions: welcomeText,
      p_expected_version: version,
    },
    object({
      version,
      description: welcomeText,
      objectives: welcomeText,
      joining_instructions: welcomeText,
      published_at: { type: "string", format: "date-time" },
    }),
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
    "Requires current room access or read authority for a linked company contact on that Premium course. Deleted bodies are null. Use the message ID and returned attachment version at course-documents to request authorized bytes.",
    {
      p_room_id: uuid,
      p_before_at: nullableDateTime,
      p_before_id: nullableUuid,
      p_limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    {
      type: "array",
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
  ),
  "/rest/v1/rpc/send_course_chat_message": rpc(
    "sendCourseChatMessage",
    "Premium LMS",
    "Post a text message in a course participant room",
    "Requires current course Premium, room access and active enrolment for participants. The client ID makes retries idempotent. Files and mentions are not supported by this operation.",
    {
      p_room_id: uuid,
      p_body: { type: "string", minLength: 1 },
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
      p_body: text,
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
        {
          type: "array",
          items: object({
            user_id: uuid,
            display_name: text,
            luminovia_user_id: text,
          }),
          maxItems: 100,
        },
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
    "Requires current Premium and this course's management, teaching or company contact access. Returns only enrolled or completed participants for the requested session, with current versions, retained PDF evidence and correction history.",
    { ...course, p_session_id: uuid },
    object({
      session_id: uuid,
      starts_at: { type: "string", format: "date-time" },
      ends_at: { type: "string", format: "date-time" },
      time_zone: text,
      rows: {
        type: "array",
        items: object({
          user_id: uuid,
          name: text,
          status: {
            type: ["string", "null"],
            enum: ["present", "absent", "excused", null],
          },
          arrival_at: nullableDateTime,
          departure_at: nullableDateTime,
          note: { type: "string", maxLength: 1000 },
          version,
        }),
      },
      evidence: {
        type: "array",
        items: object({
          id: uuid,
          resource_id: uuid,
          version_id: uuid,
          name: text,
          attached_at: { type: "string", format: "date-time" },
        }),
      },
      history: {
        type: "array",
        items: object({
          id: uuid,
          user_id: uuid,
          actor_id: uuid,
          old_state: { type: ["object", "null"], additionalProperties: true },
          new_state: { type: "object", additionalProperties: true },
          reason: text,
          created_at: { type: "string", format: "date-time" },
        }),
      },
    }),
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
    "Requires Premium and current participant management rights for the requested company.",
    organisation,
    {
      type: "array",
      items: object({
        user_id: uuid,
        luminovia_user_id: text,
        display_name: text,
        joined_at: { type: "string", format: "date-time" },
        version,
      }),
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
  "/rest/v1/rpc/set_company_premium": rpc(
    "setCompanyPremium",
    "Administration",
    "Change the company Premium entitlement",
    "Requires the active admin role and a current version. Review the requested change before submitting. A 200 result with status conflict means nothing changed.",
    {
      ...organisation,
      p_enabled: boolean,
      p_expected_version: version,
      ...idempotency,
    },
    object({
      status: { enum: ["updated", "unchanged", "conflict"] },
      enabled: boolean,
      version,
    }),
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

const companyWebhookDestination = {
  type: "string",
  pattern: "^[a-z][a-z0-9-]{0,39}$",
};
const companyWebhookTypes = {
  enum: [
    "course.published",
    "course.updated",
    "course.schedule_changed",
    "course.assignment_changed",
    "course.enrolment_changed",
    "course.exam_published",
    "course.attendance_changed",
    "course.completion_changed",
    "course.material_published",
  ],
};
const companyWebhookList = rpc(
  "companyCourseWebhookList",
  "Server integrations",
  "List company webhook subscriptions",
  "Active admins and owners can inspect this company's recent deliveries. Signing keys are omitted. The response includes up to 100 subscriptions with up to ten deliveries each.",
  { p_organisation: uuid },
  {
    type: "array",
    items: object({
      id: uuid,
      destination: companyWebhookDestination,
      created_at: { type: "string", format: "date-time" },
      integration_label: text,
      premium_events: boolean,
      active: boolean,
      deliveries: {
        type: "array",
        items: object({
          id: uuid,
          event_type: companyWebhookTypes,
          occurred_at: { type: "string", format: "date-time" },
          attempts: { type: "integer", minimum: 0, maximum: 5 },
          state: { enum: ["pending", "delivered", "failed", "cancelled"] },
        }),
      },
    }),
  },
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

const paths: Record<string, Record<string, unknown>> = {
  ...nativeExplorerPaths,
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
};

const integrationPath = {
  get: {
    operationId: "integrationCourseIndex",
    tags: ["Server integrations"],
    summary: "List published courses for the key's company",
    description:
      "Call this operation from your backend. Browser and portal-session requests are rejected.",
    security: [{ integrationKey: [] }],
    parameters: [
      {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 50, default: 25 },
      },
      { name: "after", in: "query", schema: uuid },
    ],
    responses: {
      "200": {
        description: "Current published course index",
        content: json(
          object({
            items: {
              type: "array",
              items: object({ id: uuid, title: text, time_zone: text }),
            },
            next_cursor: { type: ["null", "string"], format: "uuid" },
          }),
        ),
      },
      "400": { description: "Invalid page parameters" },
      "401": { description: "Missing, invalid or inactive integration key" },
      "403": { description: "Browser origin denied" },
      "429": {
        description: "Key rate limit reached",
        headers: { "Retry-After": { schema: { type: "integer" } } },
      },
      "503": { description: "Integration temporarily unavailable" },
    },
  },
};

const credentialPaths = {
  "/functions/v1/human-login": {
    post: {
      operationId: "humanLogin",
      tags: ["Authentication"],
      summary: "Establish a native Supabase session with a username or email",
      description:
        "Pass credentials in the TLS request body. Existing users keep their current Supabase identity and permissions.",
      security: [],
      requestBody: {
        required: true,
        content: json(
          object({
            identifier: { ...text, maxLength: 254 },
            password: {
              ...text,
              minLength: 1,
              maxLength: 128,
              format: "password",
              writeOnly: true,
            },
          }),
        ),
      },
      responses: {
        "200": {
          description: "Native short-lived access token and refresh token",
          content: json(
            object({
              access_token: text,
              refresh_token: text,
              expires_in: { type: "integer" },
              token_type: { const: "bearer" },
            }),
          ),
        },
        "400": { description: "Invalid request" },
        "401": { description: "Invalid credentials or unavailable account" },
        "403": { description: "Browser origin denied" },
        "429": { description: "Credential attempt limit reached" },
        "503": { description: "Authentication temporarily unavailable" },
      },
    },
  },
  "/functions/v1/human-recovery": {
    post: {
      operationId: "humanRecovery",
      tags: ["Authentication"],
      summary: "Request username recovery using native PKCE",
      description:
        "A browser must supply an allowed Origin and that origin's exact /auth/callback URL. The client keeps the PKCE verifier.",
      security: [],
      requestBody: {
        required: true,
        content: json(
          object({
            username: { ...text, pattern: "^[a-z][a-z0-9._-]{1,30}[a-z0-9]$" },
            code_challenge: { ...text, pattern: "^[A-Za-z0-9_-]{43}$" },
            code_challenge_method: { const: "s256" },
            redirect_to: { ...text, format: "uri" },
          }),
        ),
      },
      responses: {
        "202": {
          description:
            "Request accepted without revealing the account or delivery status",
          content: json(object({})),
        },
        "400": { description: "Invalid alias, challenge or callback" },
        "403": { description: "Browser origin denied" },
        "415": { description: "JSON body required" },
      },
    },
  },
};

/** Describe the receiver contract in the download without offering a live Swagger send. */
const companyCourseWebhook = {
  post: {
    operationId: "receiveCompanyCourseEvent",
    summary: "Receive a signed company course event",
    description:
      "The operator-approved receiver verifies the HMAC-SHA256 of the timestamp, a period and the exact UTF-8 request body using the hex-decoded subscription signing key. It deduplicates by the stable event ID and tolerates out-of-order delivery.",
    security: [],
    parameters: [
      {
        name: "X-Luminovia-Event-Id",
        in: "header",
        required: true,
        schema: uuid,
      },
      {
        name: "X-Luminovia-Timestamp",
        in: "header",
        required: true,
        schema: { type: "string", pattern: "^[0-9]+$" },
        description: "Unix time in seconds.",
      },
      {
        name: "X-Luminovia-Signature",
        in: "header",
        required: true,
        schema: { type: "string", pattern: "^v1=[0-9a-f]{64}$" },
      },
    ],
    requestBody: {
      required: true,
      content: json(
        object({
          id: uuid,
          type: companyWebhookTypes,
          version: { const: 1 },
          occurred_at: { type: "string", format: "date-time" },
          course_id: uuid,
        }),
      ),
    },
    responses: {
      "2XX": { description: "Event accepted or already processed." },
      "429": {
        description: "Receiver throttled the request. Delivery may be retried.",
      },
      "5XX": {
        description: "Transient receiver failure. Delivery may be retried.",
      },
    },
  },
};

/** Publish only supported, explicitly described product operations. */
export function portalOpenApi(
  backend: string,
  includeNonInteractive = true,
  brand: InstallationBrand = installationBrand,
) {
  const documentedPaths: typeof paths = includeNonInteractive
    ? {
        ...nativeDownloadPaths,
        ...paths,
        ...credentialPaths,
        "/rest/v1/rpc/company_course_webhook_subscribe": companyWebhookCreate,
        "/functions/v1/company-integration": integrationPath,
      }
    : paths;
  // Customer package readiness is currently fail-closed. Do not advertise the
  // internal marketplace, account or commercial endpoints through its public contract.
  if (brand.edition !== "internal") return {
    openapi: accountOpenApi.openapi,
    info: {
      title: `${brand.name} API`,
      version: "1.1.0",
      description: "Customer operations become available only when the installation has passed the edition readiness checks.",
    },
    paths: {} as typeof paths,
    webhooks: undefined,
    "x-portal-installation": {
      installation_id: brand.installationId,
      edition: brand.edition,
      customer_ready: false,
    },
    servers: [{url: backend.replace(/\/+$/, "") || "/"}],
    components: {securitySchemes: {}},
  };
  return {
    ...accountOpenApi,
    info: {
      title: `${brand.name} API`,
      version: "1.1.0",
      description:
        "Account and business contracts with native RPC schemas derived from the migrated database. Current permissions, company scope and entitlements still apply. The repository API reference describes feature-specific JSON payloads and integration flows.",
    },
    servers: [{ url: backend.replace(/\/+$/, "") || "/" }],
    components: {
      ...accountOpenApi.components,
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
) {
  const target = URL.parse(rawUrl, backend + "/");
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
