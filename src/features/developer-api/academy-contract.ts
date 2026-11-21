import type { InstallationBrand } from "../../lib/installation-brand.ts";
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
const readAccess =
  "Requires an operator-enabled course profile for the exact installed release, an active or grace-period licence and current course authority. Licence grace permits reads only.";
const writeAccess =
  "Requires an operator-enabled course profile for the exact installed release, an active licence and current course authority. Writes are disabled during licence grace.";

function courseOperation(
  operationId: string,
  summary: string,
  description: string,
  licence: "active" | "active-or-grace",
  request: ReturnType<typeof record>,
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
const expectedVersion = { type: "integer", minimum: 0 };
const welcomeText = { ...string, maxLength: 4000 };
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
    "Returns course details scoped to the caller’s current role. An ongoing online course may have a meeting link. Grace sets its can_edit flag to false. The repeat_request field is always null in these editions.",
    "active-or-grace",
    record(run),
    record({ ...workspaceResult.properties, repeat_request: nil }),
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
      version: "1.2.0",
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
