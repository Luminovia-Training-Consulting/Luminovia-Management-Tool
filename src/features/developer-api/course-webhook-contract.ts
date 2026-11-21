/** Fields shared by the internal and dedicated outbound course webhook contracts. */
const uuid = { type: "string", format: "uuid" };
const boolean = { type: "boolean" };
const text = { type: "string" };
const object = (properties: Record<string, object>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const json = (schema: object) => ({ "application/json": { schema } });

export const companyWebhookDestination = {
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

export const companyWebhookListSchema = {
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
};

/** Describe the receiver contract in the download without offering a live Swagger send. */
export const companyCourseWebhook = {
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
