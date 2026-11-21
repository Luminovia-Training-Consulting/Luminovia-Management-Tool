import type { InstallationBrand } from "../../lib/installation-brand.ts";
import { z } from "zod";
import {
  academyDraftOptions,
  academyDraftPayload,
  academyDraftReceipt,
  academyDraftScheduleInput,
  academyDraftScheduleReceipt,
} from "../learning/academy-draft-schema.ts";
import {
  academyCourseCapacity,
  academyCoursePublication,
  academyPublishedCourse,
} from "../learning/academy-publication-schema.ts";
import {
  attendanceImportReceiptSchema,
  attendanceImportRowSchema,
  attendanceRegisterSchema,
  maxAttendanceImportRows,
} from "../learning/attendance-schema.ts";
import { notificationPaths } from "./notifications-contract.ts";
import { academyAdministrationPaths } from "./academy-administration-contract.ts";
import {
  academyTimetableRequestSchema,
  academyTimetableSchema,
} from "../learning/academy-timetable-schema.ts";
import {
  meetingLinkResult,
  meetingUrl,
  myWorkspacesResult,
  workspaceActionRequest,
  workspaceActionResult,
  workspaceResult,
} from "./learning-contract.ts";

const string = { type: "string" };
const uuid = { ...string, format: "uuid" };
const dateTime = { ...string, format: "date-time" };
const boolean = { type: "boolean" };
const nil = { type: "null" };
const nullable = (schema: object) => ({ anyOf: [schema, nil] });
const list = (items: object) => ({ type: "array", items });
const record = (
  properties: Record<string, object>,
  required = Object.keys(properties),
) => ({ type: "object", properties, required, additionalProperties: false });
const content = (schema: object) => ({ "application/json": { schema } });
const ok = (schema: object) => ({
  description: "Current server result",
  content: content(schema),
});
const error = (description: string) => ({
  description,
  content: content(
    record({
      code: string,
      message: string,
      details: nullable(string),
      hint: nullable(string),
    }),
  ),
});
const credentials = [{ apiKey: [], bearerAuth: [] }];
const materialBytes = 10 * 1024 * 1024;
const materialMime = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];
const readAccess =
  "Requires an operator-enabled course profile for the exact installed release, an active or grace-period licence and current course authority. Licence grace permits reads only.";
const writeAccess =
  "Requires an operator-enabled course profile for the exact installed release, an active licence and current course authority. Writes are disabled during licence grace.";

function courseOperation(
  operationId: string,
  summary: string,
  description: string,
  licence: "active" | "active-or-grace",
  request: object & { required?: string[]; oneOf?: object[] },
  response: object,
  staleVersion = false,
) {
  const access = licence === "active" ? writeAccess : readAccess;
  return {
    post: {
      operationId,
      tags: ["Licensed course profile"],
      summary,
      description: `${access} ${description}`,
      security: credentials,
      "x-portal-licence": licence,
      requestBody: {
        required: Boolean(request.required?.length),
        content: content(request),
      },
      responses: {
        "200": ok(response),
        "400": error("Invalid input"),
        "401": error("Authentication required"),
        "403": error(
          "Course authority or licence unavailable for this operation",
        ),
        ...(staleVersion
          ? { "409": error("The expected version is stale") }
          : {}),
      },
    },
  };
}

const run = { p_run_id: uuid };
const materialAudience = { enum: ["staff", "client", "participants", "all"] };
const materialCategory = { enum: ["material", "report"] };
const materialAction = {
  ...record(
    {
      ...run,
      p_action: { enum: ["resource_share", "resource_remove"] },
      p_id: uuid,
      p_audience: nullable(materialAudience),
      p_category: nullable(materialCategory),
    },
    ["p_run_id", "p_action", "p_id"],
  ),
  oneOf: [
    {
      properties: {
        p_action: { const: "resource_share" },
        p_audience: materialAudience,
        p_category: materialCategory,
      },
      required: ["p_audience", "p_category"],
    },
    {
      properties: {
        p_action: { const: "resource_remove" },
        p_audience: nil,
        p_category: nil,
      },
    },
  ],
};
const materialUploadResult = record({
  document: {
    ...record({
      id: uuid,
      owner_id: uuid,
      uploaded_by: uuid,
      scope: { enum: ["personal", "room"] },
      kind: { enum: ["material", "chat"] },
      room_id: nullable(uuid),
      job_id: nil,
      original_name: { ...string, minLength: 1, maxLength: 200 },
      mime_type: { enum: materialMime },
      size_bytes: { type: "integer", minimum: 1, maximum: materialBytes },
      status: { const: "clean" },
      current_version_id: uuid,
      created_at: dateTime,
      deleted_at: nil,
    }),
    oneOf: [
      {
        properties: {
          scope: { const: "personal" },
          kind: { const: "material" },
          room_id: nil,
        },
      },
      {
        properties: {
          scope: { const: "room" },
          kind: { const: "chat" },
          room_id: uuid,
        },
      },
    ],
  },
});
function intakeError(description: string, codes: string[]) {
  return {
    description,
    content: content(
      record({ error: { enum: codes }, document_id: uuid }, ["error"]),
    ),
  };
}

const materialUpload = {
  post: {
    operationId: "uploadAcademyCourseMaterial",
    tags: ["Licensed course profile"],
    summary:
      "Upload and scan course material, an exam PDF or a course-chat attachment",
    description: `${writeAccess} Send one file of up to 10 MiB from an allowlisted Origin. Use academy-material to upload course material as the currently assigned lecturer. Use academy-student-exam to upload a PDF as an assigned lecturer, authorised course staff member or contact for the course company while the exam is required. Retry an interrupted upload with the same mode, client ID, course, name and bytes. Use academy-answer-key for a restricted PDF as a currently assigned lecturer or course manager while the exam is required. The response confirms a clean scan of the exact stored version. Pass document.current_version_id to publishAcademyCourseMaterial or to publishAcademyStudentExamPdf with the matching audience. An answer-key upload never publishes to students. Use academy-course-chat with academy_room_id for a draft in a current participant-room membership. Submit the exact file and version IDs through sendAcademyCourseChatAttachment to publish it with one message.`,
    security: credentials,
    "x-portal-licence": "active",
    parameters: [
      {
        name: "mode",
        in: "query",
        required: true,
        schema: {
          type: "string",
          enum: [
            "academy-material",
            "academy-student-exam",
            "academy-answer-key",
            "academy-course-chat",
          ],
        },
      },
      {
        name: "Origin",
        in: "header",
        required: true,
        schema: { ...string, format: "uri" },
        example: "https://academy.example.invalid",
      },
    ],
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: {
            ...record(
              {
                academy_course_id: uuid,
                academy_room_id: uuid,
                client_id: uuid,
                file: {
                  ...string,
                  format: "binary",
                  description: "One file of up to 10 MiB",
                },
              },
              ["client_id", "file"],
            ),
            oneOf: [
              { required: ["academy_course_id"] },
              { required: ["academy_room_id"] },
            ],
          },
          encoding: { file: { contentType: materialMime.join(", ") } },
        },
      },
    },
    responses: {
      "200": ok(materialUploadResult),
      "400": intakeError("Invalid request fields or multipart file", [
        "invalid_request",
      ]),
      "401": intakeError("Authentication required", [
        "authentication_required",
      ]),
      "403": intakeError(
        "Origin, current course access, exam setting or licence denied",
        ["origin_not_allowed", "access_denied", "upload_not_allowed"],
      ),
      "409": intakeError(
        "The same request was used for a different file or mode, or the version changed",
        ["idempotency_conflict", "version_superseded"],
      ),
      "413": intakeError("The file was empty or exceeded the allowed size", [
        "file_size",
      ]),
      "415": intakeError("Unsupported or inconsistent file type", [
        "unsupported_type",
      ]),
      "422": intakeError("The scanner rejected the file", ["scan_rejected"]),
      "503": intakeError(
        "Storage, scan or upload barrier could not be confirmed",
        ["deletion_unavailable", "scanner_unavailable", "upload_failed"],
      ),
    },
  },
};

const examFileError = (description: string, codes: string[]) => ({
  description,
  content: content(record({ error: { enum: codes } })),
});
const withdrawalOperation = courseOperation(
  "withdrawAcademyExamPdf",
  "Withdraw a published exam PDF",
  "The current authorised editor who owns the publication may withdraw its exact ID from the matching course. The file version is retained. Published answer-key withdrawal is restricted to current course staff.",
  "active",
  record({ ...run, p_exam_id: uuid }),
  nil,
).post;
const examWithdrawal = {
  post: {
    ...withdrawalOperation,
    responses: {
      "204": { description: "Publication withdrawn" },
      "400": withdrawalOperation.responses["400"],
      "401": withdrawalOperation.responses["401"],
      "403": withdrawalOperation.responses["403"],
    },
  },
};

const courseDocumentDownload = {
  post: {
    operationId: "downloadAcademyCourseDocument",
    tags: ["Licensed course profile"],
    summary:
      "Download a protected learning document, attachment or attendance report",
    description: `${readAccess} Send an approved Origin and the exact published document ID. Student and staff exam visibility follow the current course and the selected audience. Course materials, exam papers and chat attachments use the exact scan-confirmed version. Chat attachments require the message ID, exact version ID and current room membership. Completion documents use retained verified facts. For attendance, current course staff and authorised company contacts can request PDF or CSV with the session ID. The caller’s authority and facts are checked again before delivery.`,
    security: credentials,
    "x-portal-licence": "active-or-grace",
    parameters: [
      {
        name: "Origin",
        in: "header",
        required: true,
        schema: { ...string, format: "uri" },
      },
    ],
    requestBody: {
      required: true,
      content: content({
        oneOf: [
          record({ kind: { enum: ["resource", "exam", "completion"] }, id: uuid }),
          record({
            kind: { const: "course_chat_attachment" },
            id: uuid,
            version_id: uuid,
          }),
          record(
            {
              kind: { const: "attendance" },
              id: uuid,
              format: { enum: ["pdf", "csv"], default: "pdf" },
            },
            ["kind", "id"],
          ),
        ],
      }),
    },
    responses: {
      "200": {
        description: "Private course document, chat attachment or attendance report",
        headers: {
          "Cache-Control": { schema: string },
          "Content-Disposition": { schema: string },
        },
        content: {
          "application/pdf": { schema: { ...string, format: "binary" } },
          ...Object.fromEntries(
            materialMime
              .filter((mime) => mime !== "application/pdf")
              .map((mime) => [
                mime,
                { schema: { ...string, format: "binary" } },
              ]),
          ),
          "text/csv": { schema: string },
        },
      },
      "400": examFileError("Invalid request", ["invalid_request"]),
      "401": examFileError("Authentication required", [
        "authentication_required",
      ]),
      "403": examFileError(
        "Origin, current publication or course access denied",
        [
          "origin_not_allowed",
          "document_unavailable",
          "document_changed_or_revoked",
        ],
      ),
      "422": examFileError("PDF font cannot represent a retained character", [
        "unsupported_glyph",
      ]),
      "503": examFileError("PDF unavailable", [
        "document_unavailable",
        "document_integrity_failed",
      ]),
    },
  },
};
const expectedVersion = { type: "integer", minimum: 0 };
const academyActivityActions = new Set([
  "resource_acknowledge",
  "feedback",
  "quiz_config",
  "quiz_attempt",
  "completion_issue",
  "completion_revoke",
]);
const welcomeText = { ...string, maxLength: 4000 };
const attendanceVersion = { type: "integer", minimum: 0 };
const attendanceStatus = { enum: ["present", "absent", "excused"] };
const academyRegister = z.toJSONSchema(
  attendanceRegisterSchema.extend({ evidence: z.array(z.unknown()).length(0) }),
);
const welcome = {
  version: expectedVersion,
  description: welcomeText,
  objectives: welcomeText,
  joining_instructions: welcomeText,
  published_at: nullable(dateTime),
};
const rooms = list(
  record({ id: uuid, title: nullable(string), can_post: boolean }),
);
const messages = {
  ...list(
    record({
      id: uuid,
      sender_id: uuid,
      sender_name: string,
      body: nullable(string),
      created_at: dateTime,
      deleted_at: nullable(dateTime),
      attachment: nullable(
        record({
          version_id: uuid,
          name: string,
          size_bytes: { type: "integer", minimum: 1, maximum: materialBytes },
        }),
      ),
    }),
  ),
  maxItems: 100,
};

const messagePage = {
  ...record(
    {
      p_room_id: uuid,
      p_before_at: nullable(dateTime),
      p_before_id: nullable(uuid),
      p_limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
    },
    ["p_room_id"],
  ),
  anyOf: [
    { type: "object", properties: { p_before_at: nil, p_before_id: nil } },
    {
      type: "object",
      properties: { p_before_at: dateTime, p_before_id: uuid },
      required: ["p_before_at", "p_before_id"],
    },
  ],
};

// Advertise a closed subset of the migrated academy gate. An advertised RPC
// still runs the installation, licence, role and resource checks in Postgres.
const coursePaths = {
  "/rest/v1/rpc/notification_inbox": {
    post: {
      ...notificationPaths["/rest/v1/rpc/notification_inbox"].post,
      operationId: "readAcademyNotifications",
      tags: ["Licensed course profile"],
      description: `${readAccess} Returns the current account's visible course messages, shared material, enrolment, attendance and completion notices. Uses a stable timestamp and ID cursor.`,
      security: credentials,
      "x-portal-licence": "active-or-grace",
    },
  },
  "/rest/v1/rpc/mark_notifications": {
    post: {
      ...notificationPaths["/rest/v1/rpc/mark_notifications"].post,
      operationId: "markOwnAcademyNotifications",
      tags: ["Licensed course profile"],
      description: `${writeAccess} Only currently visible course notifications can be changed. A request containing any other account's or revoked ID fails as a whole.`,
      security: credentials,
      "x-portal-licence": "active",
    },
  },
  "/rest/v1/rpc/academy_course_draft_options": courseOperation(
    "readAcademyDraftOptions",
    "Find organisations and templates for a new course draft",
    "A current course manager may search the active local catalogue by literal name or title. Each list is limited to 50. Eligible course members without management authority receive null.",
    "active",
    record(
      {
        p_organisation_query: { ...string, maxLength: 100, default: "" },
        p_template_query: { ...string, maxLength: 100, default: "" },
      },
      [],
    ),
    z.toJSONSchema(academyDraftOptions),
  ),
  "/rest/v1/rpc/academy_create_course_draft": courseOperation(
    "createAcademyCourseDraft",
    "Create a course draft and its scheduled sessions",
    "Requires current course management and an active local organisation. Provide one existing template ID or a new template title and an exact IANA time zone with offset-aware sessions. No course publishes automatically. A retry with the same request ID and contents returns the original draft. A changed request or archived draft returns 409.",
    "active",
    {
      ...record({
        p_request_id: uuid,
        p_organisation_id: uuid,
        p_template_id: nullable(uuid),
        p_template_title: nullable({ ...string, minLength: 1, maxLength: 200 }),
        p_payload: z.toJSONSchema(academyDraftPayload),
      }),
      oneOf: [
        { properties: { p_template_id: uuid, p_template_title: nil } },
        {
          properties: {
            p_template_id: nil,
            p_template_title: { ...string, minLength: 1, maxLength: 200 },
          },
        },
      ],
    },
    z.toJSONSchema(academyDraftReceipt),
    true,
  ),
  "/rest/v1/rpc/academy_draft_schedule": courseOperation(
    "readAcademyDraftSchedule",
    "Read the latest editable draft schedule",
    "Requires current course management. Returns null when the course has been published or assigned, or has enrolment or attendance records.",
    "active",
    record({ p_course_id: uuid }),
    z.toJSONSchema(academyDraftScheduleReceipt.nullable()),
  ),
  "/rest/v1/rpc/academy_save_draft_schedule": courseOperation(
    "saveAcademyDraftSchedule",
    "Update an unallocated course draft schedule and venue",
    "Supply the last-read revision and the complete set of one to sixty non-overlapping sessions with explicit UTC offsets. Existing entries keep their session IDs. Null IDs create new sessions. Stale or allocated courses return 409. Repeating the previous successful revision with identical contents returns the confirmed schedule.",
    "active",
    record({
      p_course_id: uuid,
      p_expected_revision: { type: "integer", minimum: 1 },
      p_payload: z.toJSONSchema(academyDraftScheduleInput),
    }),
    z.toJSONSchema(academyDraftScheduleReceipt),
    true,
  ),
  "/rest/v1/rpc/academy_course_publication": courseOperation(
    "readAcademyCoursePublication",
    "Read the draft or published course state",
    "Requires current course management. Returns null for older courses outside the dedicated draft workflow.",
    "active-or-grace",
    record({ p_course_id: uuid }),
    z.toJSONSchema(academyCoursePublication),
  ),
  "/rest/v1/rpc/academy_publish_course": courseOperation(
    "publishAcademyCourse",
    "Open a scheduled course for enrolment",
    "Requires current course management, scheduled sessions and an active assigned instructor. Locks the course and records the participant capacity. An identical retry returns the existing publication. A conflicting or premature publication returns 409.",
    "active",
    record({
      p_course_id: uuid,
      p_capacity: z.toJSONSchema(academyCourseCapacity),
    }),
    z.toJSONSchema(academyPublishedCourse),
    true,
  ),
  "/rest/v1/rpc/academy_set_course_capacity": courseOperation(
    "setAcademyCourseCapacity",
    "Review and change a published course’s group size",
    "Requires current course management and the previously confirmed capacity. An identical retry returns the current capacity. A stale change or a capacity below existing enrolments returns 409. Existing confirmed places are retained.",
    "active",
    record({
      p_course_id: uuid,
      p_expected_capacity: z.toJSONSchema(academyCourseCapacity),
      p_capacity: z.toJSONSchema(academyCourseCapacity),
    }),
    z.toJSONSchema(academyPublishedCourse),
    true,
  ),
  ...academyAdministrationPaths,
  "/rest/v1/rpc/academy_timetable": courseOperation(
    "readAcademyTimetable",
    "List visible course sessions for a date range",
    "Specify an inclusive range of up to 31 civil dates in each course’s time zone. Returns up to 100 sessions ordered by exact start and session ID. To continue, supply both values from the last response cursor. Includes only courses currently visible to the caller. Overnight sessions appear from their first visible date.",
    "active-or-grace",
    z.toJSONSchema(academyTimetableRequestSchema),
    z.toJSONSchema(academyTimetableSchema),
  ),
  "/rest/v1/rpc/my_course_workspaces": courseOperation(
    "listAcademyCourseWorkspaces",
    "List my course workspaces",
    "Returns up to 200 current courses visible to this account. Participants see only courses in which they are enrolled or have completed.",
    "active-or-grace",
    record({}),
    {
      ...myWorkspacesResult,
      maxItems: 200,
      items: record({
        ...myWorkspacesResult.items.properties,
        lms_enabled: { const: true },
      }),
    },
  ),
  "/rest/v1/rpc/course_workspace": courseOperation(
    "readAcademyCourseWorkspace",
    "Read a course workspace and its online meeting link",
    "Returns course details scoped to the caller’s current role. An ongoing online course may have a meeting link. The exam projection contains the recorded requirement and omits its version for learners. Published student papers appear only while an exam is required. Current course staff alone see published answer-key metadata. Course staff can read published keys even when the exam setting is off. Grace clears meeting and exam editing and withdrawal permissions. The repeat_request field is always null in these editions.",
    "active-or-grace",
    record(run),
    record({
      ...workspaceResult.properties,
      repeat_request: nil,
      exams: record({
        ...workspaceResult.properties.exams.properties,
        documents: list(
          record({
            id: uuid,
            name: string,
            version_id: uuid,
            version: expectedVersion,
            audience: { type: "string", enum: ["students", "exam_staff"] },
            can_remove: boolean,
          }),
        ),
      }),
    }),
  ),
  "/rest/v1/rpc/set_course_meeting_link": courseOperation(
    "setAcademyCourseMeetingLink",
    "Set or clear an online course meeting link",
    "The course manager or assigned instructor can change the link before the online course ends. Use a credential-free HTTPS URL with a DNS hostname. Send null to clear the link and the last-read version to detect concurrent changes.",
    "active",
    record({ ...run, p_url: meetingUrl, p_expected_version: expectedVersion }),
    record({ ...meetingLinkResult.properties, can_edit: { const: true } }),
    true,
  ),
  "/rest/v1/rpc/course_welcome_content": courseOperation(
    "readAcademyCourseWelcome",
    "Read the latest published course welcome revision",
    "A course without a published revision returns version zero, empty text and a null publication time.",
    "active-or-grace",
    record(run),
    record(welcome),
  ),
  "/rest/v1/rpc/publish_course_welcome_content": courseOperation(
    "publishAcademyCourseWelcome",
    "Publish a course welcome revision",
    "Course managers, assigned instructors and authorised contacts of the exact company can publish. Submit the last-read version to detect concurrent changes.",
    "active",
    record({
      ...run,
      p_description: welcomeText,
      p_objectives: welcomeText,
      p_joining_instructions: welcomeText,
      p_expected_version: expectedVersion,
    }),
    record({
      ...welcome,
      version: { ...expectedVersion, minimum: 1 },
      published_at: dateTime,
    }),
    true,
  ),
  "/functions/v1/files": materialUpload,
  "/rest/v1/rpc/academy_course_material_action": courseOperation(
    "publishAcademyCourseMaterial",
    "Publish or withdraw a scanned course material version",
    "Only the currently assigned lecturer can publish their own exact clean version for the selected audience. Use the returned current_version_id from the course upload. Repeating a share for the same version and audience returns the same resource ID. To withdraw your own publication, send the resource ID with resource_remove and omit the audience and category.",
    "active",
    materialAction,
    record({ id: uuid }),
  ),
  "/rest/v1/rpc/course_session_register": courseOperation(
    "readAcademyCourseAttendanceRegister",
    "Read the attendance register for an exact course session",
    "Current course managers, assigned instructors and authorised contacts of the exact company can read enrolled or completed participants and correction history. A learner can see their own attendance in the course workspace. PDF evidence is unavailable through this register.",
    "active-or-grace",
    record({ ...run, p_session_id: uuid }),
    academyRegister,
  ),
  "/rest/v1/rpc/save_course_session_attendance": courseOperation(
    "saveAcademyCourseSessionAttendance",
    "Mark or correct one participant’s session attendance",
    "The course session must have started and the participant must be currently enrolled or completed. Submit the last-read version. A correction requires a reason of 3–500 characters. Arrival and departure timestamps are optional for present status and must be null for other statuses. The server calculates verified minutes and records the change.",
    "active",
    record({
      ...run,
      p_session_id: uuid,
      p_user_id: uuid,
      p_status: attendanceStatus,
      p_arrival_at: nullable(dateTime),
      p_departure_at: nullable(dateTime),
      p_note: { ...string, maxLength: 1000 },
      p_reason: { ...string, maxLength: 500 },
      p_expected_version: attendanceVersion,
    }),
    record({
      status: attendanceStatus,
      version: attendanceVersion,
      minutes: attendanceVersion,
    }),
    true,
  ),
  "/rest/v1/rpc/import_course_session_attendance": courseOperation(
    "importAcademyCourseSessionAttendance",
    "Save a confirmed attendance import for one exact session",
    "Review the CSV or XLSX locally first. Send the confirmed structured rows and last-read versions. The same started-session and current-enrolment rules apply to every row. Duplicate identities are rejected. If any row fails, every change is rolled back. The original file stays in the browser.",
    "active",
    record({
      ...run,
      p_session_id: uuid,
      p_rows: {
        ...list(z.toJSONSchema(attendanceImportRowSchema)),
        minItems: 1,
        maxItems: maxAttendanceImportRows,
      },
    }),
    z.toJSONSchema(attendanceImportReceiptSchema),
    true,
  ),
  "/rest/v1/rpc/set_course_exam_required": courseOperation(
    "setAcademyCourseExamRequirement",
    "Set whether the course requires an exam",
    "Current course managers, assigned instructors and authorised contacts of the exact company may update the requirement. Use the setting version from the course workspace. The operation records a new version and preserves any retained files and enrolments.",
    "active",
    record({
      ...run,
      p_required: boolean,
      p_expected_version: expectedVersion,
    }),
    record({ required: boolean, version: { ...expectedVersion, minimum: 1 } }),
    true,
  ),
  "/rest/v1/rpc/academy_student_exam_pdf_options": courseOperation(
    "listAcademyStudentExamPdfOptions",
    "List the course editor’s own scanned PDFs eligible for an exam",
    "The course must already require an exam. Returns up to 50 exact eligible versions. A version cannot be published as an exam while its document has an active general course share.",
    "active",
    record(run),
    {
      ...list(
        record({
          id: uuid,
          name: string,
          version: expectedVersion,
          created_at: dateTime,
        }),
      ),
      maxItems: 50,
    },
  ),
  "/rest/v1/rpc/share_course_exam_pdf": courseOperation(
    "publishAcademyStudentExamPdf",
    "Publish an exact scanned exam PDF",
    "The currently assigned instructor, scoped company contact or course manager can publish an eligible student paper while the exam is required. Only the currently assigned instructor or course manager can explicitly publish a staff answer key uploaded through the answer-key mode. Use the exact scanner-confirmed version ID. Repeating a publication of the same version returns its existing ID.",
    "active",
    record({
      ...run,
      p_version_id: uuid,
      p_audience: { type: "string", enum: ["students", "exam_staff"] },
    }),
    uuid,
  ),
  "/rest/v1/rpc/remove_course_exam_pdf": examWithdrawal,
  "/functions/v1/course-documents": courseDocumentDownload,
  "/rest/v1/rpc/academy_learning_action": courseOperation(
    "saveAcademyLearningActivity",
    "Acknowledge material or save a learning activity",
    "Acknowledge an exact currently visible course resource. Course staff author revisioned quizzes and can revoke a completion record. Current learners submit their own attempts and request completion after verified attendance, completion of enrolment and passing any published quiz. Eligible learners and company contacts can give feedback after the last session. Correct answers stay staff-only. Stale writes return 409.",
    "active",
    {
      ...record(
        {
          ...run,
          p_action: { enum: [...academyActivityActions] },
          p_payload: { type: "object" },
          p_expected_version: { ...expectedVersion, default: 0 },
        },
        ["p_run_id", "p_action", "p_payload"],
      ),
      oneOf: workspaceActionRequest.oneOf.filter(({ properties }) =>
        academyActivityActions.has(
          (properties.p_action as { const: string }).const,
        ),
      ),
    },
    workspaceActionResult,
    true,
  ),
  "/rest/v1/rpc/academy_ensure_course_chat": courseOperation(
    "ensureAcademyCourseChat",
    "Open the course participant text room",
    "Only a course manager can open the room. Returns the room ID. A current member with course-management authority can repeat the request to obtain the same ID.",
    "active",
    record(run),
    uuid,
  ),
  "/rest/v1/rpc/course_chat_rooms": courseOperation(
    "listAcademyCourseChatRooms",
    "List my course participant rooms",
    "Returns current participant-room memberships for the specified course. Grace sets can_post to false.",
    "active-or-grace",
    record(run),
    rooms,
  ),
  "/rest/v1/rpc/course_chat_messages": courseOperation(
    "readAcademyCourseChatMessages",
    "Read messages and attachment metadata from a course participant room",
    "Requires current room membership. Use the oldest returned timestamp and ID together to read an earlier page. Omit both or send both as null for the latest page. Each page is returned oldest first. Deleted messages have a null body and attachment. When present, attachment includes the exact version ID, file name and size.",
    "active-or-grace",
    messagePage,
    messages,
  ),
  "/rest/v1/rpc/send_course_chat_attachment": courseOperation(
    "sendAcademyCourseChatAttachment",
    "Post a message with one scanned course-chat attachment",
    "Requires current course room membership and the sender's own exact clean draft from academy-course-chat. The message body may be empty. Retry with the same client ID, room, body, document and version. The message is created only after the scan is confirmed.",
    "active",
    record({
      p_room_id: uuid,
      p_body: { ...string, maxLength: 8000 },
      p_client_id: uuid,
      p_document_id: uuid,
      p_version_id: uuid,
    }),
    uuid,
  ),
  "/rest/v1/rpc/send_course_chat_message": courseOperation(
    "sendAcademyCourseChatMessage",
    "Post text to a course participant room",
    "Requires current room membership. The body must include text. Reuse the client ID, room and body to retry the same send. Returns the message ID.",
    "active",
    record({
      p_room_id: uuid,
      p_body: { ...string, minLength: 1, maxLength: 8000, pattern: "[^ ]" },
      p_client_id: uuid,
    }),
    uuid,
  ),
};

type AcademyIdentity = Pick<
  InstallationBrand,
  "installationId" | "edition" | "name"
>;

export function academyOpenApi(backend: string, brand: AcademyIdentity) {
  return {
    openapi: "3.1.0",
    info: {
      title: `${brand.name} API`,
      version: "1.17.0",
      description:
        "This catalogue covers the dedicated edition’s operator-enabled course profile for the exact licensed release. The installation readiness marker remains false. An active licence permits authorised reads and writes. A grace-period licence permits authorised reads only. A disabled profile, a mismatched release, or an unlicensed, scheduled or expired licence denies course access. Capability bootstrap remains available.",
    },
    servers: [{ url: backend.replace(/\/+$/, "") || "/" }],
    paths: {
      "/rest/v1/rpc/installation_capabilities": {
        get: {
          operationId: "readAcademyInstallationCapabilities",
          tags: ["Installation"],
          summary: "Read the public installation capabilities",
          description:
            "Returns the current licence status and public edition flags. Readiness flags remain false for the dedicated profile. The status alone does not confirm that the course profile is enabled.",
          security: [{ apiKey: [] }],
          responses: {
            "200": ok(
              record({
                installation_id:
                  brand.installationId === null
                    ? uuid
                    : { const: brand.installationId },
                edition: { const: brand.edition },
                licence_status: {
                  enum: [
                    "unlicensed",
                    "scheduled",
                    "active",
                    "grace",
                    "expired",
                  ],
                },
                customer_ready: { const: false },
                lms_available: { const: false },
                marketplace_available: { const: false },
                company_premium_switch_available: { const: false },
              }),
            ),
          },
        },
      },
      ...coursePaths,
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: "apiKey",
          in: "header",
          name: "apikey",
          description: "Public Supabase client key.",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "Current installation account session access token.",
        },
      },
    },
    "x-portal-installation": {
      installation_id: brand.installationId,
      edition: brand.edition,
      customer_ready: false,
    },
  };
}
