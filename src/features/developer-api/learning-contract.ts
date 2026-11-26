/**
 * Reviewed JSON payloads projected by the Premium LMS migration chain.
 * The generated native catalogue owns PostgreSQL signatures and REST gates.
 */
import { z } from "zod";
import { workspaceAttendanceHistorySchema } from "../learning/attendance-schema.ts";
import { questionDifficulties } from "../learning/question-bank-schema.ts";
import { materialMetadataSchema } from "../learning/material-metadata-schema.ts";
import {
  courseWelcomePublishRequestSchema,
  courseWelcomeRevisionSchema,
} from "../learning/welcome-content-schema.ts";

export const courseWelcomeResult = z.toJSONSchema(courseWelcomeRevisionSchema);
export const courseWelcomePublishedResult = z.toJSONSchema(
  courseWelcomeRevisionSchema.safeExtend({
    version: z.int().positive(),
    published_at: z.iso.datetime({ offset: true }),
  }),
);
export const courseWelcomeWrite = {
  ...z.toJSONSchema(courseWelcomePublishRequestSchema),
  required: ["p_run_id", "p_expected_version"],
};

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

const materialCategory = { type: "string", enum: ["material", "report"] };
const materialMetadata = z.toJSONSchema(materialMetadataSchema);
export const materialMetadataParameters = {
  p_resource_id: uuid,
  p_expected_revision: integer,
  p_metadata: materialMetadata,
};
export const materialMetadataRevision = { ...integer, minimum: 1 };
export const materialHistoryParameters = {
  p_resource_id: uuid,
  p_before: nullable(materialMetadataRevision),
};
export const materialHistoryResult = {
  ...itemList(
    record({
      revision: materialMetadataRevision,
      content: materialMetadata,
      changed_at: dateTime,
    }),
  ),
  maxItems: 21,
};
export const materialSearchParameters = {
  p_course_id: nullable(uuid),
  p_search: nullable({ ...text, maxLength: 200 }),
  p_category: nullable(materialCategory),
  p_offset: integer,
};
export const materialSearchResult = {
  ...itemList(
    record({
      id: uuid,
      course_id: uuid,
      course_title: text,
      organisation_name: nullable(text),
      name: text,
      version: integer,
      category: materialCategory,
      can_upload: boolean,
      can_edit_metadata: boolean,
      can_read_metadata_history: boolean,
      can_reuse: boolean,
      metadata_revision: integer,
      metadata: nullable(materialMetadata),
    }),
  ),
  maxItems: 25,
};
export const materialReuseTargetsParameters = {
  p_resource_id: uuid,
  p_search: nullable({ ...text, maxLength: 150 }),
};
export const materialReuseTargetsResult = {
  ...itemList(record({ id: uuid, title: text, shared: boolean })),
  maxItems: 51,
};
export const materialReuseParameters = {
  p_resource_id: uuid,
  p_target_run_id: uuid,
  p_copy_metadata: boolean,
};
export const materialReuseResult = uuid;

export const importRowParameters = {
  p_row_key: uuid,
  p_kind: {
    type: "string",
    enum: [
      "course-template",
      "course-draft",
      "company",
      "contact",
      "taxonomy",
      "enrolment",
    ],
  },
  p_scope: nullable(uuid),
  p_payload: { type: "object" },
};
export const importRowResult = { const: true };

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
const questionBankSource = record({
  question_id: uuid,
  revision: { ...integer, minimum: 1 },
});
const questionBankItem = record(quizQuestion);
const questionBankContentFields = {
  content: questionBankItem,
  topic: { ...text, minLength: 1, maxLength: 120 },
  difficulty: { type: "string", enum: [...questionDifficulties] },
};
export const questionBankParameters = {
  p_run_id: uuid,
  p_search: { ...text, maxLength: 120, default: "" },
  p_include_archived: { ...boolean, default: false },
  p_offset: { ...integer, default: 0 },
};
export const questionBankOptionalParameters = [
  "p_search",
  "p_include_archived",
  "p_offset",
];
export const questionBankResult = record({
  items: {
    ...itemList(
      record({
        ...questionBankContentFields,
        id: uuid,
        revision: { ...integer, minimum: 1 },
        archived: boolean,
        can_edit: boolean,
      }),
    ),
    maxItems: 20,
  },
  has_more: boolean,
});
export const questionBankActionParameters = {
  p_run_id: uuid,
  p_action: { type: "string", enum: ["save", "set_archived", "configure"] },
  p_payload: { type: "object" },
  p_expected_version: integer,
};
export const questionBankActionVariants = [
  ["save", record({ id: uuid, ...questionBankContentFields })],
  ["set_archived", record({ id: uuid, archived: boolean })],
  [
    "configure",
    record({
      entries: {
        ...itemList({ oneOf: [questionBankItem, questionBankSource] }),
        minItems: 1,
        maxItems: 20,
      },
      pass_percent: { ...score, minimum: 50 },
      max_attempts: { ...integer, minimum: 1, maximum: 10 },
      published: boolean,
      shuffle: boolean,
    }),
  ],
].map(([action, payload]) =>
  record({
    ...questionBankActionParameters,
    p_action: { const: action },
    p_payload: payload,
  }),
);
export const questionBankActionResult = record(
  { version: { ...integer, minimum: 1 }, id: uuid },
  ["version"],
);

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
      questions: itemList(
        record({ ...quizQuestion, source: questionBankSource }, [
          "prompt",
          "options",
        ]),
      ),
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

export const workspaceResult = record({
  ...workspaceFields,
  selected_contact_id: nullable(uuid),
});
export const internalWorkspaceResult = {
  oneOf: [
    workspaceResult,
    record({
      ...workspaceFields,
      lms_enabled: { const: false },
      access: record({
        ...workspaceFields.access.properties,
        lms_enabled: { const: false },
        learner: { const: false },
      }),
      meeting_link: { type: "null" },
      resources: { ...workspaceFields.resources, maxItems: 0 },
      roster: { ...workspaceFields.roster, maxItems: 0 },
      exams: record({
        required: { const: false },
        version: { type: "null" },
        can_edit: { const: false },
        documents: {
          ...workspaceFields.exams.properties.documents,
          maxItems: 0,
        },
      }),
    }),
  ],
};

export const participantInvitesResult = itemList(
  record({
    organisation_id: uuid,
    organisation_name: text,
    version: { ...integer, minimum: 1 },
    expires_at: dateTime,
    source: { enum: ["email", "luminovia_user_id"] },
  }),
);

export const courseEnrolmentCandidatesResult = {
  ...itemList(
    record({ user_id: uuid, display_name: text, luminovia_user_id: text }),
  ),
  maxItems: 100,
};

export const courseEnrolmentsResult = itemList(
  record({
    user_id: uuid,
    display_name: text,
    status: enrolmentState,
    updated_at: dateTime,
  }),
);

const gradebookBand = record({
  minimum: { ...integer, maximum: 100 },
  label: { ...text, minLength: 1, maxLength: 80 },
});
const gradebookAttempt = nullable(
  record({
    id: uuid,
    quiz_version: integer,
    score,
    passed: boolean,
    created_at: dateTime,
  }),
);
const gradebookPolicy = nullable(
  record({
    version: { ...integer, minimum: 1 },
    scheme: { enum: ["percentage", "bands"] },
    bands: { ...itemList(gradebookBand), maxItems: 10 },
    created_at: dateTime,
  }),
);
const gradebookMark = record({
  revision: { ...integer, minimum: 1 },
  attempt_id: uuid,
  quiz_version: integer,
  score,
  passed: boolean,
  policy_version: { ...integer, minimum: 1 },
  grade_percent: nullable({ ...integer, maximum: 100 }),
  grade_label: nullable({ ...text, maxLength: 80 }),
  corrected: boolean,
  published_at: dateTime,
});
const staffGradebookMark = record({
  ...gradebookMark.properties,
  reason: nullable({ ...text, minLength: 3, maxLength: 500 }),
});
const gradebookPreview = nullable(
  record({
    grade_percent: nullable({ ...integer, maximum: 100 }),
    grade_label: nullable({ ...text, maxLength: 80 }),
  }),
);
const gradebookLearner = record({
  user_id: uuid,
  name: text,
  status: enrolmentState,
  best_attempt: gradebookAttempt,
  preview: gradebookPreview,
  grade: nullable(staffGradebookMark),
});

export const courseGradebookParameters = record(
  {
    p_run_id: uuid,
    p_offset: { ...integer, default: 0 },
    p_limit: { ...integer, minimum: 1, maximum: 100, default: 20 },
  },
  ["p_run_id"],
);
export const courseGradebookResult = record({
  can_manage: boolean,
  policy: gradebookPolicy,
  learners: itemList(gradebookLearner),
  own_grade: nullable(gradebookMark),
  total: integer,
  offset: integer,
  limit: { ...integer, minimum: 1, maximum: 100 },
});

export const courseGradebookHistoryParameters = record(
  {
    p_run_id: uuid,
    p_user_id: nullable(uuid),
    p_before_revision: nullable({ ...integer, minimum: 1 }),
    p_limit: { ...integer, minimum: 1, maximum: 100, default: 20 },
  },
  ["p_run_id"],
);
export const courseGradebookHistoryResult = record({
  revisions: {
    ...itemList({ oneOf: [staffGradebookMark, gradebookMark] }),
    maxItems: 100,
  },
  next_before: nullable({ ...integer, minimum: 1 }),
});
export const courseGradebookExportResult = {
  ...itemList(record({ user_id: uuid, name: text, grade: gradebookMark })),
  maxItems: 5000,
};

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
  [
    "gradebook_policy",
    {
      scheme: { enum: ["percentage", "bands"] },
      bands: itemList(gradebookBand),
    },
  ],
  [
    "gradebook_publish",
    {
      user_id: uuid,
      attempt_id: uuid,
      expected_revision: { ...integer, minimum: 0 },
      reason: { ...text, maxLength: 500 },
    },
  ],
  [
    "gradebook_correct",
    {
      user_id: uuid,
      grade_value: { ...text, minLength: 1, maxLength: 80 },
      expected_revision: { ...integer, minimum: 1 },
      reason: { ...text, minLength: 3, maxLength: 500 },
    },
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
    record({ version: { ...integer, minimum: 1 } }),
    record({ revision: { ...integer, minimum: 1 } }),
  ],
};
