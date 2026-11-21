import { accountOpenApi } from "../../../supabase/functions/accounts/openapi.ts";

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
    requestBody: { required: true, content: json(object(input)) },
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

const workspaceAction = {
  post: {
    ...rpc(
      "courseWorkspaceAction",
      "Premium LMS",
      "Update a course resource or attendance record",
      "The action is limited here to the documented resource and attendance commands. Current Premium, course role, ownership and version checks are enforced by the database. Resource sharing requires a clean personal material version, except that authorized staff may share material from the same course job. The server assigns immutable staff, company or lecturer ownership; company contacts can remove company-owned links, and lecturers can remove only their own lecturer-owned links. Retained attendance evidence cannot be removed.",
      {},
      {
        type: "object",
        properties: { id: nullableUuid, saved: boolean },
        required: ["id"],
        additionalProperties: false,
      },
    ).post,
    requestBody: {
      required: true,
      content: json({
        oneOf: [
          object({
            p_run_id: uuid,
            p_action: { const: "resource_share" },
            p_payload: object({
              version_id: uuid,
              audience: { enum: ["staff", "client", "participants", "all"] },
              category: { enum: ["material", "report"] },
            }),
            p_expected_version: version,
          }),
          object({
            p_run_id: uuid,
            p_action: { const: "resource_remove" },
            p_payload: object({ id: uuid }),
            p_expected_version: version,
          }),
          object({
            p_run_id: uuid,
            p_action: { const: "resource_acknowledge" },
            p_payload: object({ id: uuid }),
            p_expected_version: version,
          }),
          object({
            p_run_id: uuid,
            p_action: { const: "attendance_report" },
            p_payload: object({ session_id: uuid }),
            p_expected_version: version,
          }),
          object({
            p_run_id: uuid,
            p_action: { const: "attendance_verify" },
            p_payload: object({
              session_id: uuid,
              user_id: uuid,
              state: { enum: ["attended", "absent"] },
              minutes: { type: "integer", minimum: 0 },
              reason: { type: "string", minLength: 3, maxLength: 500 },
            }),
            p_expected_version: version,
          }),
        ],
      }),
    },
  },
};

const courseDocuments = {
  post: {
    operationId: "downloadCourseDocument",
    tags: ["Premium LMS"],
    summary: "Download an authorized course PDF or resource",
    description:
      "Returns protected bytes only after current access and file integrity checks. The id is an exam share, resource, completion record or course run for attendance, respectively.",
    requestBody: {
      required: true,
      content: json(
        object({
          kind: { enum: ["resource", "exam", "completion", "attendance"] },
          id: uuid,
        }),
      ),
    },
    responses: {
      "200": {
        description: "Authorized document bytes",
        content: {
          "application/pdf": { schema: { type: "string", format: "binary" } },
          "application/octet-stream": {
            schema: { type: "string", format: "binary" },
          },
        },
      },
      "400": { description: "Invalid request" },
      "401": { description: "Authentication required" },
      "403": { description: "Document unavailable" },
      "503": { description: "Document access or integrity unavailable" },
    },
  },
};

const courseMaterialUpload = {
  post: {
    operationId: "uploadCourseMaterial",
    tags: ["Premium LMS"],
    summary: "Upload and scan personal course material",
    description:
      "Upload an allowed material file to the caller's personal documents. Share its returned clean current_version_id with course_workspace_action resource_share. Upload alone does not make it visible to a course. The gateway validates bytes, scope and current permissions.",
    requestBody: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: object({
            file: { type: "string", format: "binary" },
            scope: { const: "personal" },
            kind: { const: "material" },
            client_id: uuid,
          }),
        },
      },
    },
    responses: {
      "200": {
        description: "Clean, authorized personal document",
        content: json({
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
      },
      "400": { description: "Invalid file or request" },
      "401": { description: "Authentication required" },
      "403": { description: "Upload not allowed" },
      "409": { description: "Conflicting retry or replacement" },
      "422": { description: "Malware scan rejected" },
      "503": { description: "Scanner or upload unavailable" },
    },
  },
};

const nativePaths = {
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
  "/rest/v1/rpc/remove_course_exam_pdf": rpc(
    "removeCourseExamPdf",
    "Premium LMS",
    "Remove a course exam share",
    "Authorized course exam editors can remove the share; the underlying uploaded version is retained.",
    { ...course, p_exam_id: uuid },
    { type: "null" },
  ),
  "/rest/v1/rpc/inspect_company_course_chat": rpc(
    "inspectCompanyCourseChat",
    "Administration",
    "Inspect one company's course chat with an audit reason",
    "Requires the active admin role and an exact company/course match. Each request records a reason and can inspect retained participant course text while Premium is off.",
    {
      ...organisation,
      ...course,
      p_reason: { ...text, minLength: 8, maxLength: 300 },
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
    "Read text history from a course participant room",
    "Requires current room access or read authority for a linked company contact on that Premium course. Deleted bodies are null; attachment metadata is omitted.",
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
  "/functions/v1/files": courseMaterialUpload,
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
  "/rest/v1/rpc/request_company_participant_link": rpc(
    "requestParticipantLink",
    "Premium LMS",
    "Request participant association",
    "Requires Premium and scoped company authority. An opaque acknowledgement does not confirm that an ID exists or membership was granted. The participant must accept.",
    {
      ...organisation,
      p_luminovia_user_id: { ...text, maxLength: 64 },
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

const paths: Record<string, Record<string, unknown>> = {
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
  ...nativePaths,
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

/** Publish only supported, explicitly described product operations. */
export function portalOpenApi(backend: string, includeNonInteractive = true) {
  const documentedPaths: typeof paths = includeNonInteractive
    ? {
        ...paths,
        ...credentialPaths,
        "/functions/v1/company-integration": integrationPath,
      }
    : paths;
  return {
    ...accountOpenApi,
    info: {
      title: "Luminovia Portal API",
      version: "1.0.0",
      description:
        "Interactive contract for accounts and the listed business operations. Current database permissions, company scope and entitlements still apply. Consult the repository API reference for the wider native RPC inventory.",
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
  return Object.entries(paths).some(([path, operations]) => {
    if (!Object.hasOwn(operations, verb)) return false;
    const segments = (prefix + path).split("/");
    const candidate = target.pathname.split("/");
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
