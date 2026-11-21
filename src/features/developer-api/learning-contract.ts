/**
 * Reviewed JSON payloads projected by the Premium LMS migration chain.
 * The generated native catalogue owns PostgreSQL signatures and REST gates.
 */
import { z } from "zod";
import { workspaceAttendanceHistorySchema } from "../learning/attendance-schema.ts";

const text = { type: "string" };
const boolean = { type: "boolean" };
const uuid = { ...text, format: "uuid" };
const dateTime = { ...text, format: "date-time" };
const integer = { type: "integer", minimum: 0 };
const score = { ...integer, maximum: 100 };
const rating = { ...integer, minimum: 1, maximum: 5 };
const itemList = <Item extends object>(items: Item) => ({
  type: "array",
  items,
});
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const record = <Fields extends Record<string, unknown>>(
  properties: Fields,
  required: (keyof Fields)[] = Object.keys(properties),
) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const enrolmentState = { enum: ["enrolled", "completed", "removed"] };
const deliveryType = { enum: ["online", "onsite"] };
const audience = { enum: ["staff", "client", "participants", "all"] };
const attendanceState = { enum: ["reported", "attended", "absent"] };
const courseIdentity = {
  id: uuid,
  title: text,
  description: text,
  syllabus: text,
  time_zone: text,
  venue: text,
  delivery_type: deliveryType,
  lms_enabled: boolean,
};

/** A disabled company's course can still appear for its contacts or staff; not learners. */
const overviewFields = {
  ...courseIdentity,
  starts_at: nullable(dateTime),
  ends_at: nullable(dateTime),
  participant: boolean,
};

export const myWorkspacesResult = itemList(
  record(
    {
      ...overviewFields,
      organisation_name: nullable(text),
      next_start_at: nullable(dateTime),
    },
    Object.keys(overviewFields) as (keyof typeof overviewFields)[],
  ),
);

const options = {
  ...itemList({ ...text, minLength: 1, maxLength: 300 }),
  minItems: 2,
  maxItems: 6,
};
const quizPrompt = { ...text, minLength: 1, maxLength: 500 };
const quizQuestion = {
  prompt: quizPrompt,
  options,
  correct: { ...integer, maximum: 5 },
};
const dateRange = { starts_at: dateTime, ends_at: dateTime };
const resourceReference = { id: uuid, name: text, version: integer };

export const meetingUrl = nullable({
  ...text,
  format: "uri",
  pattern: "^https://",
  maxLength: 2048,
});
export const meetingLinkResult = record({
  url: meetingUrl,
  version: integer,
  can_edit: boolean,
});

/** Only staff see answer indices, and learner projections have no roster or attendance history. */
const workspaceFields = {
  ...courseIdentity,
  lms_enabled: { const: true },
  ended: boolean,
  access: record({
    manager: boolean,
    teacher: boolean,
    learner: boolean,
    client: boolean,
    staff: boolean,
    lms_enabled: { const: true },
  }),
  settings_version: integer,
  meeting_link: nullable(meetingLinkResult),
  contact: nullable(record({ name: text, email: text, phone: text })),
  contact_options: itemList(record({ id: uuid, name: text })),
  sessions: itemList(
    record({
      id: uuid,
      ...dateRange,
      attendance: nullable(attendanceState),
      minutes: nullable(integer),
      version: integer,
      can_check_in: boolean,
      can_verify: boolean,
    }),
  ),
  preparation: itemList(
    record({
      id: uuid,
      label: text,
      done: boolean,
      client_visible: boolean,
      version: integer,
    }),
  ),
  resources: itemList(
    record({
      ...resourceReference,
      version_id: uuid,
      sha256: nullable({ ...text, pattern: "^[a-f0-9]{64}$" }),
      category: { enum: ["material", "report"] },
      audience,
      acknowledged: boolean,
      ownership_kind: { enum: ["staff", "company", "lecturer"] },
      can_remove: boolean,
    }),
  ),
  share_options: itemList(record(resourceReference)),
  questions: itemList(
    record({
      id: uuid,
      body: text,
      answer: text,
      version: integer,
      mine: boolean,
    }),
  ),
  notebook: record({ body: text, version: integer }),
  feedback: nullable(record({ rating, comment: text, version: integer })),
  feedback_summary: nullable(
    record({
      count: integer,
      average: nullable({ type: "number", minimum: 1, maximum: 5 }),
      comments: nullable(itemList(text)),
    }),
  ),
  quiz: nullable(
    record({
      version: integer,
      published: boolean,
      pass_percent: { ...score, minimum: 50 },
      max_attempts: { ...integer, minimum: 1, maximum: 10 },
      questions: itemList(record(quizQuestion, ["prompt", "options"])),
      attempts: integer,
      passed: boolean,
      last_score: nullable(score),
    }),
  ),
  completion: nullable(record({ id: uuid, created_at: dateTime })),
  repeat_request: nullable(
    record({ id: uuid, sessions: itemList(record(dateRange)) }),
  ),
  attendance_history: z.toJSONSchema(workspaceAttendanceHistorySchema),
  roster: itemList(
    record({
      user_id: uuid,
      name: text,
      status: { enum: ["enrolled", "completed"] },
      completion_id: nullable(uuid),
      sessions: itemList(
        record({
          session_id: uuid,
          state: nullable(attendanceState),
          minutes: nullable(integer),
          version: integer,
        }),
      ),
    }),
  ),
  exams: record({
    required: boolean,
    version: nullable(integer),
    can_edit: boolean,
    documents: itemList(
      record({
        ...resourceReference,
        version_id: uuid,
        audience: { enum: ["students", "exam_staff"] },
      }),
    ),
  }),
};

export const workspaceResult = record(workspaceFields);

export const participantInvitesResult = itemList(
  record({
    organisation_id: uuid,
    organisation_name: text,
    version: { ...integer, minimum: 1 },
    expires_at: dateTime,
    source: { enum: ["email", "luminovia_user_id"] },
  }),
);

export const courseEnrolmentsResult = itemList(
  record({
    user_id: uuid,
    display_name: text,
    status: enrolmentState,
    updated_at: dateTime,
  }),
);

/** Send the reviewed current version for edits. PostgreSQL defaults omitted versions to zero. */
const workspaceActions: [action: string, payload: Record<string, unknown>][] = [
  [
    "resource_share",
    {
      version_id: uuid,
      audience,
      category: { enum: ["material", "report"] },
    },
  ],
  ["resource_remove", { id: uuid }],
  ["resource_acknowledge", { id: uuid }],
  ["attendance_report", { session_id: uuid }],
  [
    "attendance_verify",
    {
      session_id: uuid,
      user_id: uuid,
      state: { enum: ["attended", "absent"] },
      minutes: integer,
      reason: { ...text, minLength: 3, maxLength: 500 },
    },
  ],
  [
    "preparation_create",
    {
      label: { ...text, minLength: 1, maxLength: 300 },
      client_visible: boolean,
    },
  ],
  ["preparation_toggle", { id: uuid, done: boolean }],
  ["contact_select", { contact_id: nullable(uuid) }],
  ["notebook", { body: { ...text, maxLength: 12000 } }],
  ["question", { body: { ...text, minLength: 1, maxLength: 2000 } }],
  ["answer", { id: uuid, answer: { ...text, minLength: 1, maxLength: 4000 } }],
  ["feedback", { rating, comment: { ...text, maxLength: 2000 } }],
  [
    "quiz_config",
    {
      questions: {
        ...itemList(record(quizQuestion)),
        minItems: 1,
        maxItems: 20,
      },
      published: boolean,
      pass_percent: { ...score, minimum: 50 },
      max_attempts: { ...integer, minimum: 1, maximum: 10 },
    },
  ],
  [
    "quiz_attempt",
    {
      answers: {
        ...itemList({ ...integer, maximum: 5 }),
        minItems: 1,
        maxItems: 20,
      },
      request_id: uuid,
    },
  ],
  ["completion_issue", {}],
  [
    "completion_revoke",
    { id: uuid, reason: { ...text, minLength: 3, maxLength: 500 } },
  ],
];

export const workspaceActionRequest = {
  oneOf: workspaceActions.map(([action, payload]) =>
    record(
      {
        p_run_id: uuid,
        p_action: { const: action },
        p_payload: record(payload),
        p_expected_version: { ...integer, default: 0 },
      },
      ["p_run_id", "p_action", "p_payload"],
    ),
  ),
};

/** Normal commands, acknowledged resource IDs and graded quiz attempts have distinct shapes. */
export const workspaceActionResult = {
  oneOf: [
    record({ id: uuid }),
    record({ id: nullable(uuid), saved: { const: true } }),
    record({ id: uuid, score, passed: boolean }),
  ],
};
