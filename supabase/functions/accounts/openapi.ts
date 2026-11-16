/**
 * Published OpenAPI contract for the account HTTP API. Schemas describe input/output; handlers and current database functions still enforce permissions/MFA.
 */
// Define a JSON response for the published HTTP contract.
const jsonResponse = (schema: unknown = { type: "object" }) => ({
  description: "Confirmed server result",
  content: { "application/json": { schema } },
});
const errors = {
  "400": { description: "Invalid request" },
  "401": { description: "Valid active account required" },
  "403": { description: "Capability and verified MFA required" },
  "503": { description: "Unavailable; no success is implied" },
};
// Describe a required JSON request body without implying runtime authorization.
const jsonBody = (schema: unknown) => ({
  required: true,
  content: { "application/json": { schema } },
});
const userId = [
  {
    name: "id",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
];
const role = {
  type: "string",
  enum: [
    "owner",
    "admin",
    "management",
    "senior_lecturer",
    "lecturer",
    "client",
    "participant",
  ],
};
export const accountOpenApi = {
  openapi: "3.1.0",
  info: {
    title: "Luminovia Account API",
    version: "1.0.0",
    description:
      "Bearer-authenticated account API. Admin operations require current database capabilities and AAL2. Course/job/chat/wiki/files/reviews/finance use the same JWT through Supabase /rest/v1/rpc and the authenticated files function; see docs/API_REFERENCE.md. Payments are tracking records and do not transfer money.",
  },
  servers: [{ url: "/functions/v1/accounts" }],
  security: [{ bearerAuth: [], publicApiKey: [] }],
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      publicApiKey: {
        type: "apiKey",
        in: "header",
        name: "apikey",
        description: "Public Supabase key; never service-role credentials",
      },
    },
  },
  paths: {
    "/v1/me": {
      get: {
        operationId: "accountMe",
        summary: "Own profile, roles, permissions and MFA assurance",
        responses: { "200": jsonResponse(), ...errors },
      },
      patch: {
        operationId: "saveOwnAccount",
        summary: "Edit own non-privileged profile fields",
        requestBody: jsonBody({
          type: "object",
          additionalProperties: false,
          properties: {
            display_name: { type: "string", minLength: 1, maxLength: 120 },
            bio_de: { type: "string", maxLength: 4000 },
            bio_en: { type: "string", maxLength: 4000 },
            phone: { type: ["string", "null"], maxLength: 50 },
            time_zone: { type: "string" },
            locale: { enum: ["de", "en"] },
          },
        }),
        responses: { "200": jsonResponse(), ...errors },
      },
    },
    "/v1/users": {
      get: {
        operationId: "listAccounts",
        summary: "MFA-authorised account directory",
        parameters: [
          {
            name: "q",
            in: "query",
            schema: { type: "string", maxLength: 120 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
          },
          {
            name: "offset",
            in: "query",
            schema: {
              type: "integer",
              minimum: 0,
              maximum: 100000,
              default: 0,
            },
          },
        ],
        responses: { "200": jsonResponse(), ...errors },
      },
    },
    "/v1/roles": {
      get: {
        operationId: "accountRoleCatalog",
        summary: "Read available roles and capabilities with management MFA",
        responses: {
          "200": jsonResponse({ type: "array", items: { type: "object" } }),
          ...errors,
        },
      },
    },
    "/v1/users/{id}/roles": {
      put: {
        operationId: "setAccountRoles",
        summary: "Audited role assignment; self/last-admin protection",
        parameters: userId,
        requestBody: jsonBody({
          type: "object",
          additionalProperties: false,
          required: ["roles"],
          properties: {
            roles: { type: "array", minItems: 1, maxItems: 7, items: role },
          },
        }),
        responses: { "200": jsonResponse(), ...errors },
      },
    },
    "/v1/users/{id}/status": {
      patch: {
        operationId: "setAccountStatus",
        summary: "Reversible activation/suspension; self/last-admin protection",
        parameters: userId,
        requestBody: jsonBody({
          type: "object",
          additionalProperties: false,
          required: ["active"],
          properties: { active: { type: "boolean" } },
        }),
        responses: { "200": jsonResponse({ type: "null" }), ...errors },
      },
    },
    "/v1/users/{id}/organisations/{organisationId}": {
      put: {
        operationId: "assignClientOrganisation",
        summary:
          "Grant an existing client scoped organisation access; admin/owner MFA",
        parameters: [
          ...userId,
          {
            name: "organisationId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": jsonResponse(), ...errors },
      },
      delete: {
        operationId: "revokeClientOrganisation",
        summary:
          "Revoke organisation access immediately without deleting historical records",
        parameters: [
          ...userId,
          {
            name: "organisationId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: { "200": jsonResponse(), ...errors },
      },
    },
    "/v1/invitations": {
      post: {
        operationId: "inviteAccount",
        summary:
          "Idempotent captured/approved email invitation; authoritative role and optional client organisation",
        requestBody: jsonBody({
          type: "object",
          additionalProperties: false,
          required: ["email", "role", "idempotency_key"],
          properties: {
            email: { type: "string", format: "email", maxLength: 254 },
            display_name: { type: "string", maxLength: 120 },
            role,
            organisation_id: {
              type: ["string", "null"],
              format: "uuid",
              description: "Required exactly for client role",
            },
            idempotency_key: { type: "string", format: "uuid" },
          },
        }),
        responses: {
          "200": jsonResponse(),
          "409": {
            description: "Request identity reused for a different invitation",
          },
          "429": { description: "Durable invitation rate limit reached" },
          "502": {
            description:
              "Uncertain email send; reservation retained for reconciliation",
          },
          ...errors,
        },
      },
    },
  },
};
