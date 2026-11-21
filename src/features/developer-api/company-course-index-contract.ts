const text = { type: "string" };
const uuid = { ...text, format: "uuid" };
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const json = (schema: Record<string, unknown>) => ({
  "application/json": { schema },
});
const error = (description: string, code: string) => ({
  description,
  content: json(object({ error: { ...text, const: code } })),
});
const rateLimited = {
  ...error("Key rate limit reached", "rate_limited"),
  headers: { "Retry-After": { schema: { type: "integer" } } },
};
const scopedOperation = {
  tags: ["Server integrations"],
  security: [{ integrationKey: [] }],
};
const scopedErrors = {
  "400": error("Invalid request fields", "invalid_request"),
  "401": error(
    "Missing, inactive or differently scoped key",
    "invalid_credential",
  ),
  "403": error("Browser origin denied", "browser_origin_denied"),
  "404": error(
    "No authorised published course or confirmed participant matches",
    "not_found",
  ),
  "429": rateLimited,
  "503": error(
    "Integration temporarily unavailable",
    "integration_unavailable",
  ),
};
const participant = { ...text, pattern: "^LV(-[0-9A-F]{4}){5}$" };
const count = { type: "integer", minimum: 0 };

export const companyCourseIndexPath = {
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

export const companyCourseOperationPaths = {
  "/functions/v1/company-integration/enrolments": {
    post: {
      ...scopedOperation,
      operationId: "integrationEnrolParticipant",
      summary: "Enrol a confirmed company participant",
      description:
        "Requires enrolments.write. Both the published course and the confirmed participant must belong to the key's company. Repeating a current enrolment returns the same receipt. A removed or completed enrolment cannot be restored by this operation.",
      requestBody: {
        required: true,
        content: json(object({ course_id: uuid, participant_id: participant })),
      },
      responses: {
        "200": {
          description: "Current enrolment receipt",
          content: json(
            object({
              course_id: uuid,
              participant_id: participant,
              status: { ...text, const: "enrolled" },
            }),
          ),
        },
        ...scopedErrors,
        "409": error(
          "Capacity or the current enrolment state prevents this action",
          "enrolment_unavailable",
        ),
      },
    },
  },
  "/functions/v1/company-integration/participation": {
    get: {
      ...scopedOperation,
      operationId: "integrationCourseParticipation",
      summary: "Read aggregate participation for a published course",
      description:
        "Requires reports.read. Returns counts for the key's company without learner-level records.",
      parameters: [
        { name: "course_id", in: "query", required: true, schema: uuid },
      ],
      responses: {
        "200": {
          description: "Current aggregate participation",
          content: json(
            object({
              course_id: uuid,
              session_count: count,
              enrolled_count: count,
              completed_count: count,
            }),
          ),
        },
        ...scopedErrors,
      },
    },
  },
};
