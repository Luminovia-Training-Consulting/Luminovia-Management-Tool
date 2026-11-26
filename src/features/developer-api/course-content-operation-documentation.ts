/** Published contracts for the versioned educational course content endpoints. */
const uuid = { type: "string", format: "uuid" };
const revision = { type: "integer", minimum: 0 };
const positiveRevision = { type: "integer", minimum: 1 };

const lessonBlockProperties = {
  id: {
    ...uuid,
    pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
  },
  title: { type: "string", maxLength: 120 },
  text: { type: "string", maxLength: 4000 },
};
const lessonBlockRequired = ["id", "kind", "title", "text"];

const courseContent = {
  type: "object",
  additionalProperties: false,
  required: ["modules"],
  description:
    "Bounded versioned lessons support safe Tiptap nodes, scanned material references and plain-text note, practice and checklist blocks.",
  properties: {
    modules: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "description", "lessons"],
        properties: {
          id: uuid,
          title: { type: "string", minLength: 1, maxLength: 150 },
          description: { type: "string", maxLength: 1000 },
          archived: { type: "boolean" },
          lessons: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              additionalProperties: false,
              required: [
                "id",
                "title",
                "objectives",
                "duration_minutes",
                "body",
              ],
              properties: {
                id: uuid,
                title: { type: "string", minLength: 1, maxLength: 150 },
                objectives: { type: "string", maxLength: 1000 },
                duration_minutes: {
                  type: "integer",
                  minimum: 0,
                  maximum: 1440,
                },
                body: { type: "object" },
                archived: { type: "boolean" },
                blocks: {
                  type: "array",
                  maxItems: 12,
                  items: {
                    oneOf: [
                      {
                        type: "object",
                        additionalProperties: false,
                        required: lessonBlockRequired,
                        properties: {
                          ...lessonBlockProperties,
                          kind: { const: "practice" },
                          answer: { type: "string", maxLength: 4000 },
                        },
                      },
                      {
                        type: "object",
                        additionalProperties: false,
                        required: lessonBlockRequired,
                        properties: {
                          ...lessonBlockProperties,
                          kind: { enum: ["note", "checklist"] },
                        },
                      },
                    ],
                  },
                },
                material_ids: {
                  type: "array",
                  items: {
                    ...uuid,
                    pattern:
                      "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
                  },
                  maxItems: 12,
                  uniqueItems: true,
                  description:
                    "Ordered references to exact course material shares.",
                },
              },
            },
          },
        },
      },
    },
  },
};

const courseContentStudio = {
  type: "object",
  additionalProperties: false,
  required: [
    "can_edit",
    "published_version",
    "published_content",
    "published_at",
    "draft_version",
    "draft_base_version",
    "draft_content",
    "versions",
  ],
  properties: {
    can_edit: { type: "boolean" },
    published_version: revision,
    published_content: courseContent,
    published_at: { type: ["string", "null"], format: "date-time" },
    draft_version: revision,
    draft_base_version: revision,
    draft_content: { anyOf: [courseContent, { type: "null" }] },
    review: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["state", "publish_at"],
          properties: {
            state: {
              enum: [
                "requested",
                "approved",
                "returned",
                "scheduled",
                "blocked",
              ],
            },
            publish_at: { type: ["string", "null"], format: "date-time" },
          },
        },
        { type: "null" },
      ],
    },
    versions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["version", "published_at", "module_count"],
        properties: {
          version: positiveRevision,
          published_at: { type: "string", format: "date-time" },
          module_count: { type: "integer", minimum: 0, maximum: 40 },
        },
      },
    },
  },
};

const expectedVersionFields = {
  published_version: revision,
  draft_version: revision,
};

const actionPayload = {
  type: "object",
  description:
    "Use the payload shape that matches p_action: save_draft carries content and both expected versions; publish and review transitions carry both expected versions; schedule_publish adds a future publish_at instant; restore adds source_version; migrate carries user_id and target_version.",
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["content", "published_version", "draft_version"],
      properties: {
        content: courseContent,
        ...expectedVersionFields,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["published_version", "draft_version"],
      properties: expectedVersionFields,
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["publish_at", "published_version", "draft_version"],
      properties: {
        publish_at: { type: "string", format: "date-time" },
        ...expectedVersionFields,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["source_version", "published_version", "draft_version"],
      properties: {
        source_version: positiveRevision,
        ...expectedVersionFields,
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["user_id", "target_version"],
      properties: {
        user_id: uuid,
        target_version: positiveRevision,
      },
    },
  ],
};

export const curriculumCatalogueParameters = {
  p_run_id: uuid,
  p_search: { type: "string", maxLength: 150 },
  p_offset: { ...revision, maximum: 10000 },
  p_source_run_id: uuid,
  p_source_version: positiveRevision,
  p_lesson_id: uuid,
};

const catalogueItem = {
  source_run_id: uuid,
  source_version: positiveRevision,
  course_title: { type: "string" },
  module_title: { type: "string" },
  title: { type: "string" },
  lesson_id: uuid,
};
export const curriculumCatalogueResult = {
  oneOf: [
    {
      type: "object",
      required: ["items", "next_offset"],
      properties: {
        items: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            properties: catalogueItem,
            required: Object.keys(catalogueItem),
          },
        },
        next_offset: { type: ["integer", "null"] },
      },
    },
    {
      type: "object",
      required: ["lesson"],
      properties: {
        lesson: courseContent.properties.modules.items.properties.lessons.items,
      },
    },
  ],
};

export const courseContentOperationDocumentation = {
  course_content_action: {
    summary: "Manage drafts, reviews and published course content revisions",
    description:
      "Requires current assigned course teaching authority and an enabled LMS. Draft writes use both the latest published version and current draft version as conflict checks. Publishing creates a new immutable revision and pins only active enrolments without a prior content version; completed participants and existing pinned history are not silently migrated. A saved draft can enter optional review. Course managers can return, approve or schedule the same approved draft. The worker rechecks authority before publishing. Restore creates a new draft. Only course managers may explicitly migrate one active participant to an existing revision. Academy writes require an active entitlement.",
    parameters: {
      p_run_id: uuid,
      p_action: {
        type: "string",
        enum: [
          "save_draft",
          "publish",
          "restore",
          "migrate",
          "request_review",
          "approve_review",
          "return_review",
          "cancel_review",
          "schedule_publish",
        ],
      },
      p_payload: actionPayload,
    },
    required: ["p_run_id", "p_action", "p_payload"],
    result: courseContentStudio,
    errors: {
      "400":
        "The action or content is invalid, violates structural/size limits, contains unsupported editor nodes, or uses an unsafe link scheme.",
      "403":
        "The caller lacks current course author/manager authority, the enrolment is unavailable, or the target revision is outside this course.",
      "409":
        "The published or draft revision changed (PT409); reread the studio before retrying.",
    },
  },
  course_content_studio: {
    summary: "Read authorised course curriculum and publication state",
    description:
      "Requires an enabled LMS and current course access. Assigned staff receive the latest published curriculum, private draft and revision metadata. Participants receive only the exact published revision pinned to their active/completed enrolment; draft content and revision history are omitted. Archived modules and lessons are omitted from participant projections. Material references are resolved against current learner-visible scanned course shares. Completed legacy enrolments without a pinned content revision do not inherit future publications. Academy reads are available while the installation is active or in its permitted grace period.",
    parameters: { p_run_id: uuid },
    required: ["p_run_id"],
    result: courseContentStudio,
    errors: {
      "403":
        "The course is unavailable, LMS access is disabled, or the caller lacks current staff or enrolled participant access.",
    },
  },
  course_curriculum_catalogue: {
    summary: "Browse or read published lessons for use in another course",
    description:
      "Current teaching staff can search published lessons from other authorised courses in the same organisation. The listing is metadata only. Send the source course, publication version and lesson ID together to retrieve a specific active lesson. Copies use the existing version-checked draft save and receive a new lesson ID. Material links are returned only for eligible destination shares of the exact scanned version. A newer source publication returns 409.",
    parameters: curriculumCatalogueParameters,
    required: ["p_run_id"],
    result: curriculumCatalogueResult,
    errors: {
      "403":
        "Either course or the requested lesson is unavailable to the current author.",
      "409": "The source course published another curriculum revision (PT409).",
    },
  },
};
