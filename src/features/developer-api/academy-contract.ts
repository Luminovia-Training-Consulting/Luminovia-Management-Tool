import type { InstallationBrand } from "../../lib/installation-brand.ts";
import { z } from "zod";
import {
  academyDraftOptions,
  academyDraftPayload,
  academyDraftReceipt,
} from "../learning/academy-draft-schema.ts";
import { attendanceRegisterSchema } from "../learning/attendance-schema.ts";
import {
  academyCourseCapacity,
  academyCoursePublication,
  academyPublishedCourse,
} from "../learning/academy-publication-schema.ts";
import { notificationPaths } from "./notifications-contract.ts";
import {
  meetingLinkResult,
  meetingUrl,
  myWorkspacesResult,
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
  request: ReturnType<typeof record> & { oneOf?: object[] },
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
        required: request.required.length > 0,
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
  document: record({
    id: uuid,
    owner_id: uuid,
    uploaded_by: uuid,
    scope: { const: "personal" },
    kind: { const: "material" },
    room_id: nil,
    job_id: nil,
    original_name: { ...string, minLength: 1, maxLength: 200 },
    mime_type: { enum: materialMime },
    size_bytes: { type: "integer", minimum: 1, maximum: materialBytes },
    status: { const: "clean" },
    current_version_id: uuid,
    created_at: dateTime,
    deleted_at: nil,
  }),
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
    summary: "Upload and scan an assigned lecturer’s course material",
    description: `${writeAccess} Send one file of up to 10 MiB from an allowlisted Origin. Only the currently assigned lecturer can upload their own material. Use the same client ID, course, name and bytes to retry an interrupted upload. The response confirms a clean scan of the exact stored version. To share it, pass document.current_version_id to publishAcademyCourseMaterial.`,
    security: credentials,
    "x-portal-licence": "active",
    parameters: [
      {
        name: "mode",
        in: "query",
        required: true,
        schema: { const: "academy-material" },
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
          schema: record({
            academy_course_id: uuid,
            client_id: uuid,
            file: {
              ...string,
              format: "binary",
              description: "One file of up to 10 MiB",
            },
          }),
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
        "Origin, current course assignment or licence denied",
        ["origin_not_allowed", "access_denied", "upload_not_allowed"],
      ),
      "409": intakeError(
        "The same request was used for different material or the version changed",
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
const studentExamDownload = {
  post: {
    operationId: "downloadAcademyStudentExamPdf",
    tags: ["Licensed course profile"],
    summary: "Download the exact scanned student exam paper",
    description: `${readAccess} Send an approved Origin and the student paper ID from the course workspace. The course must still require an exam and the caller must retain course access. The exact stored SHA-256 and current permissions are checked before any bytes are returned.`,
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
      content: content(record({ kind: { const: "exam" }, id: uuid })),
    },
    responses: {
      "200": {
        description: "Private exact PDF",
        headers: {
          "Cache-Control": { schema: string },
          "Content-Disposition": { schema: string },
        },
        content: {
          "application/pdf": { schema: { ...string, format: "binary" } },
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
      "503": examFileError("Exact PDF unavailable", [
        "document_unavailable",
        "document_integrity_failed",
      ]),
    },
  },
};
const expectedVersion = { type: "integer", minimum: 0 };
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
      attachment: nil,
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
      description: `${readAccess} Only the current account's visible notices for course messages, shared material and own attendance are returned. Uses a stable timestamp and ID cursor.`,
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
    "Returns course details scoped to the caller’s current role. An ongoing online course may have a meeting link. The exam projection contains the recorded requirement and omits its version for learners. Published student papers appear only while an exam is required. Grace sets meeting and exam editing flags to false. The repeat_request field is always null in these editions.",
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
            audience: { const: "students" },
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
    "Publish an exact previously scanned student exam paper",
    "The currently assigned instructor, scoped company contact or course manager can publish an eligible version from their own personal files while the exam is required. Supply the ID returned by the exam PDF options operation. Repeating a publication of the same version returns the existing paper ID.",
    "active",
    record({ ...run, p_version_id: uuid, p_audience: { const: "students" } }),
    uuid,
  ),
  "/functions/v1/course-documents": studentExamDownload,
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
    "List my course participant text rooms",
    "Returns current participant-room memberships for the specified course. Grace sets can_post to false.",
    "active-or-grace",
    record(run),
    rooms,
  ),
  "/rest/v1/rpc/course_chat_messages": courseOperation(
    "readAcademyCourseChatMessages",
    "Read text messages from a course participant room",
    "Requires current room membership. Use the oldest returned timestamp and ID together to read an earlier page. Omit both or send both as null for the latest page. Each page is returned oldest first. Deleted messages have a null body and the attachment field is always null.",
    "active-or-grace",
    messagePage,
    messages,
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
      version: "1.9.0",
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
