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
