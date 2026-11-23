/**
 * Published OpenAPI contract for the account HTTP API. Schemas describe input/output; handlers and current database functions still enforce permissions.
 */
// Define a JSON response for the published HTTP contract.
const jsonResponse = (schema: unknown, description = "Confirmed server result") => ({
    description,
    content: {"application/json": {schema}},
});
const errors = {
    "400": {description: "Invalid request"},
    "401": {description: "Valid active account required"},
    "403": {
        description: "Current database capability or resource scope required",
    },
    "503": {description: "Unavailable; no success is implied"},
};
// Describe a required JSON request body without implying runtime authorization.
const jsonBody = (schema: unknown) => ({
    required: true,
    content: {"application/json": {schema}},
});
const userId = [
    {
        name: "id",
        in: "path",
        required: true,
        schema: {type: "string", format: "uuid"},
    },
];
const role = {
    type: "string",
    enum: [
        "admin",
        "management",
        "senior_lecturer",
        "lecturer",
        "client",
        "participant",
        "guest",
    ],
};
const storedRole = { ...role, enum: ["owner", ...role.enum] };
const text = {type: "string"};
const uuid = {type: "string", format: "uuid"};
const instant = {type: "string", format: "date-time"};
const boolean = {type: "boolean"};
const count = {type: "integer", minimum: 0};
const nil = {type: "null"};
const list = (items: object) => ({type: "array", items});
const record = (properties: Record<string, object>, required = Object.keys(properties)) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false,
});
const deletionKind = {type: "string", pattern: "^[a-z_]{1,40}$"};
const deletionTarget = {id: uuid, kind: deletionKind, label: text};
const deletionAccess = record({can_admin: boolean, kinds: list(deletionKind)});
const deletionResources = record({
    items: {
        ...list(record({
            ...deletionTarget,
            owner_label: {type: ["string", "null"]},
            can_delete: boolean,
        })),
        maxItems: 100,
    },
    next_cursor: {type: ["string", "null"], format: "uuid"},
});
const deletionPreview = record({
    ...deletionTarget,
    plan_id: uuid,
    counts: {type: "object", additionalProperties: count},
    blockers: list(record({code: text, kind: text, count})),
    can_confirm: boolean,
    expires_at: instant,
});
const deletionReceipt = {operation_id: uuid, kind: deletionKind, id: uuid};
const deletionOperation = record({
    ...deletionReceipt,
    status: {enum: ["pending", "failed", "completed"]},
});
const deletionCompleted = jsonResponse(record({
    ...deletionReceipt,
    status: {const: "completed"},
}));
const deletionRemaining = jsonResponse(
    record({...deletionReceipt, status: {enum: ["pending", "failed"]}}),
    "Deletion remains incomplete; the operation ID can be used to resume it.",
);
const ownAccount = record({
    profile: record({
        id: uuid,
        luminovia_user_id: {
            ...text,
            pattern: "^LV-(?:[0-9A-F]{4}-){4}[0-9A-F]{4}$",
        },
        display_name: {...text, maxLength: 120},
        bio_de: {...text, maxLength: 4000},
        bio_en: {...text, maxLength: 4000},
        phone: {type: ["string", "null"], maxLength: 50},
        time_zone: text,
        locale: {enum: ["de", "en"]},
        active: boolean,
        created_at: instant,
        email: {type: ["string", "null"], format: "email"},
    }),
    roles: list(storedRole),
    permissions: list(text),
});
const createdAccount = record({
    status: {const: "created"},
    creation_id: uuid,
    user_id: uuid,
});
const accountCreationConflict = {
    anyOf: [
        record({status: {enum: ["in_progress", "failed"]}, creation_id: uuid, user_id: {type: ["string", "null"], format: "uuid"}}),
        record({error: {const: "invalid_request"}}),
    ],
};
const roleCapability = record({
    role,
    permissions: list(text),
    assignable: boolean,
});
const savedRoles = record({id: uuid, roles: {...list(storedRole), minItems: 1, maxItems: 7}});
const sentInvitation = record({
    status: {enum: ["sent", "already_sent", "failed"]},
    invitation_id: uuid,
});
const invitationInProgress = record(
    {status: {const: "in_progress"}, invitation_id: uuid},
    ["status"],
);
const invitationConflict = record(
    {status: {const: "idempotency_conflict"}, invitation_id: uuid},
    ["status"],
);
const invitationIdentity = {
    email: {type: "string", format: "email", maxLength: 254},
    display_name: {type: "string", maxLength: 120},
    idempotency_key: uuid,
};
const invitationInput = {
    anyOf: [
        record({
            ...invitationIdentity,
            role: {const: "client"},
            organisation_id: {
                anyOf: [uuid, nil],
                description: "An optional active organisation. The current inviter must be allowed to manage the association.",
            },
        }, ["email", "role", "idempotency_key"]),
        record({
            ...invitationIdentity,
            role: {
                enum: ["admin", "management", "senior_lecturer", "lecturer", "guest"],
                default: "lecturer",
            },
            organisation_id: nil,
        }, ["email", "idempotency_key"]),
    ],
};
const invitationError = (description: string, ...codes: string[]) =>
    jsonResponse(record({error: {enum: codes}}), description);
const invitationHttpErrors = {
    "400": invitationError("Invalid invitation request", "invalid_request"),
    "401": invitationError("Current authenticated account required", "authentication_required"),
    "403": invitationError("Current invitation authority, resource scope and an approved origin are required", "permission_required", "origin_not_allowed"),
    "413": invitationError("Request exceeds 16 KiB", "request_too_large"),
    "415": invitationError("A JSON content type is required", "json_required"),
    "503": invitationError("Invitation delivery is disabled or unavailable", "invitations_disabled", "service_unavailable"),
};

const deletionConfirmation = {
    operationId: "deletionConfirm",
    summary:
        "Confirm an unexpired actor-bound plan; no trash, undo or optimistic success",
    requestBody: jsonBody({
        type: "object",
        additionalProperties: false,
        required: ["plan_id", "request_id", "confirmation"],
        properties: {
            plan_id: {type: "string", format: "uuid"},
            request_id: {type: "string", format: "uuid"},
            confirmation: {const: "DELETE"},
        },
    }),
    responses: {
        "200": deletionCompleted,
        "202": deletionRemaining,
        "409": {
            description: "Plan expired, scope changed or dependencies conflict",
        },
        ...errors,
    },
};

export const accountOpenApi = {
    openapi: "3.1.0",
    info: {
        title: "Luminovia Account API",
        version: "1.1.0",
        description:
            "Bearer-authenticated account API. Admin operations require current database capabilities and active-account status. Course/job/chat/wiki/files/reviews/finance use the same JWT through Supabase /rest/v1/rpc and the authenticated files function; see API_REFERENCE.md. Payments are tracking records and do not transfer money.",
    },
    servers: [{url: "/functions/v1/accounts"}],
    security: [{bearerAuth: [], publicApiKey: []}],
    components: {
        securitySchemes: {
            bearerAuth: {type: "http", scheme: "bearer", bearerFormat: "JWT"},
            publicApiKey: {
                type: "apiKey",
                in: "header",
                name: "apikey",
                description: "Public Supabase key; never service-role credentials",
            },
        },
    },
    paths: {
        "/v1/deletions/access": {
            get: {
                operationId: "deletionAccess",
                summary:
                    "Current typed permanent-deletion capabilities; no private content",
                responses: {"200": jsonResponse(deletionAccess), ...errors},
            },
        },
        "/v1/deletions/resources": {
            get: {
                operationId: "deletionResources",
                summary:
                    "Authorised metadata targets; companies see only current own jobs",
                parameters: [
                    {
                        name: "kind",
                        in: "query",
                        required: true,
                        schema: {type: "string", pattern: "^[a-z_]{1,40}$"},
                    },
                    {
                        name: "q",
                        in: "query",
                        schema: {type: "string", maxLength: 120},
                    },
                    {
                        name: "cursor",
                        in: "query",
                        schema: {type: "string", format: "uuid"},
                    },
                    {
                        name: "limit",
                        in: "query",
                        schema: {type: "integer", minimum: 1, maximum: 100, default: 25},
                    },
                ],
                responses: {"200": jsonResponse(deletionResources), ...errors},
            },
        },
        "/v1/deletions/preview": {
            post: {
                operationId: "deletionPreview",
                summary:
                    "Review exact target, dependency counts and blockers before irreversible confirmation",
                requestBody: jsonBody({
                    type: "object",
                    additionalProperties: false,
                    required: ["kind", "id"],
                    properties: {
                        kind: {type: "string", pattern: "^[a-z_]{1,40}$"},
                        id: {type: "string", format: "uuid"},
                    },
                }),
                responses: {
                    "200": jsonResponse(deletionPreview),
                    "409": {description: "Target or dependency conflict"},
                    ...errors,
                },
            },
        },
        "/v1/deletions/confirm": {
            post: deletionConfirmation,
            delete: {...deletionConfirmation, operationId: "deleteConfirmedResource"},
        },
        "/v1/deletions/operations": {
            get: {
                operationId: "deletionOperations",
                summary:
                    "Recover currently authorised incomplete deletion receipts after reload",
                responses: {"200": jsonResponse(record({items: list(deletionOperation)})), ...errors},
            },
        },
        "/v1/deletions/operations/{id}": {
            post: {
                operationId: "deletionResume",
                summary:
                    "Resume a confirmed operation under current caller permissions and assurance",
                parameters: userId,
                requestBody: jsonBody({type: "object", additionalProperties: false}),
                responses: {
                    "200": deletionCompleted,
                    "202": deletionRemaining,
                    "409": {description: "Dependency conflict"},
                    ...errors,
                },
            },
        },
        "/v1/me": {
            get: {
                operationId: "accountMe",
                summary: "Own profile, roles and permissions",
                responses: {"200": jsonResponse(ownAccount), ...errors},
            },
            patch: {
                operationId: "saveOwnAccount",
                summary: "Edit own non-privileged profile fields",
                requestBody: jsonBody({
                    type: "object",
                    additionalProperties: false,
                    properties: {
                        display_name: {type: "string", minLength: 1, maxLength: 120},
                        bio_de: {type: "string", maxLength: 4000},
                        bio_en: {type: "string", maxLength: 4000},
                        phone: {type: ["string", "null"], maxLength: 50},
                        time_zone: {type: "string"},
                        locale: {enum: ["de", "en"]},
                    },
                }),
                responses: {"200": jsonResponse(ownAccount), ...errors},
            },
        },
        "/v1/users": {
            post: {
                summary: "Create an individual account without sending email",
                description:
                    "Requires current account and role administration. A company contact requires an organisation. Initial learner access grants the participant role without enrolment. The operator's owner role is protected. Passwords must contain 8–128 characters, including uppercase and lowercase letters, a digit and one of the symbols configured by Supabase Auth. The password is transient and is never returned or stored in the creation request.",
                requestBody: jsonBody({
                    type: "object",
                    additionalProperties: false,
                    required: [
                        "email",
                        "display_name",
                        "password",
                        "role",
                        "idempotency_key",
                    ],
                    properties: {
                        email: {type: "string", format: "email", maxLength: 254},
                        display_name: {type: "string", minLength: 1, maxLength: 120},
                        password: {
                            type: "string",
                            minLength: 8,
                            maxLength: 128,
                            pattern:
                                "^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[!@#$%^&*()_+\\-=\\[\\]{}|;:,.<>?/]).+$",
                            writeOnly: true,
                        },
                        role,
                        organisation_id: {type: ["string", "null"], format: "uuid"},
                        idempotency_key: {type: "string", format: "uuid"},
                    },
                }),
                responses: {
                    "201": jsonResponse(createdAccount),
                    "200": jsonResponse(createdAccount),
                    "409": jsonResponse(
                        accountCreationConflict,
                        "The creation request is already running, failed, or its details changed.",
                    ),
                    "502": {
                        description:
                            "Account creation was not confirmed; no invitation was sent",
                    },
                    ...errors,
                },
            },
            get: {
                operationId: "listAccounts",
                summary: "Capability-authorised account directory",
                description:
                    "Requires the current users.manage capability and returns a bounded account projection. Every row includes a stable Luminovia User ID for display; that ID is not a lookup credential or proof of identity or permission.",
                parameters: [
                    {
                        name: "q",
                        in: "query",
                        schema: {type: "string", maxLength: 120},
                    },
                    {
                        name: "limit",
                        in: "query",
                        schema: {type: "integer", minimum: 1, maximum: 100, default: 50},
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
                responses: {
                    "200": jsonResponse({
                        type: "object",
                        required: ["items", "total", "limit", "offset"],
                        properties: {
                            items: {
                                type: "array",
                                items: {
                                    type: "object",
                                    required: [
                                        "id",
                                        "luminovia_user_id",
                                        "display_name",
                                        "email",
                                        "active",
                                        "locale",
                                        "time_zone",
                                        "created_at",
                                        "can_assign_roles",
                                        "can_change_active",
                                        "roles",
                                    ],
                                    properties: {
                                        id: {type: "string", format: "uuid"},
                                        luminovia_user_id: {
                                            type: "string",
                                            pattern: "^LV-[0-9A-F]{4}(?:-[0-9A-F]{4}){4}$",
                                            description:
                                                "Stable display reference; not an account lookup or authorization credential.",
                                        },
                                        display_name: {type: "string"},
                                        email: {type: "string", format: "email"},
                                        active: {type: "boolean"},
                                        locale: {type: "string"},
                                        time_zone: {type: "string"},
                                        created_at: {type: "string", format: "date-time"},
                                        can_assign_roles: {type: "boolean"},
                                        can_change_active: {type: "boolean"},
                                        roles: {type: "array", items: storedRole},
                                    },
                                },
                            },
                            total: {type: "integer", minimum: 0},
                            limit: {type: "integer", minimum: 1, maximum: 100},
                            offset: {type: "integer", minimum: 0},
                        },
                    }),
                    ...errors,
                },
            },
        },
        "/v1/roles": {
            get: {
                operationId: "accountRoleCatalog",
                summary: "Read available roles and current database capabilities",
                responses: {
                    "200": jsonResponse({ ...list(roleCapability), maxItems: 7 }),
                    ...errors,
                },
            },
        },
        "/v1/users/{id}/roles": {
            put: {
                operationId: "setAccountRoles",
                summary: "Audited role assignment; self/last-admin protection",
                description: "Save the explicit roles for this account. Multiple roles contribute their own permissions. Organisation membership and participant enrolment are independently scoped.",
                parameters: userId,
                requestBody: jsonBody({
                    type: "object",
                    additionalProperties: false,
                    required: ["roles"],
                    properties: {
                        roles: {type: "array", minItems: 1, maxItems: 7, items: role},
                        organisation_id: {
                            type: "string",
                            format: "uuid",
                            description:
                                "For company conversion, atomically assign the client role and this authorised organisation.",
                        },
                    },
                }),
                responses: {"200": jsonResponse({anyOf: [savedRoles, nil]}), ...errors},
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
                    properties: {active: {type: "boolean"}},
                }),
                responses: {"200": jsonResponse({type: "null"}), ...errors},
            },
        },
        "/v1/users/{id}/organisations/{organisationId}": {
            put: {
                operationId: "assignClientOrganisation",
                summary:
                    "Grant an existing client scoped organisation access; admin/owner capability required",
                parameters: [
                    ...userId,
                    {
                        name: "organisationId",
                        in: "path",
                        required: true,
                        schema: {type: "string", format: "uuid"},
                    },
                ],
                responses: {"200": jsonResponse(nil), ...errors},
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
                        schema: {type: "string", format: "uuid"},
                    },
                ],
                responses: {"200": jsonResponse(nil), ...errors},
            },
        },
        "/v1/invitations": {
            post: {
                operationId: "inviteAccount",
                summary:
                    "Idempotent captured/approved email invitation; authoritative role and optional client organisation",
                description:
                    "Requires current user and role-management authority. Omit role to invite a lecturer. Only a client invitation may name an organisation, which requires additional authority. Company participant invitations have their own operation. Repeat the original request with the same key to check its result. A retained failed status does not send another email.",
                requestBody: jsonBody(invitationInput),
                responses: {
                    ...invitationHttpErrors,
                    "200": jsonResponse(
                        {anyOf: [sentInvitation, invitationInProgress]},
                        "Delivery result or retained reservation status.",
                    ),
                    "409": jsonResponse(invitationConflict, "Request identity reused for a different invitation."),
                    "429": jsonResponse(record({status: {const: "throttled"}}), "Durable invitation rate limit reached."),
                    "502": jsonResponse(
                        record({status: {const: "failed"}, invitation_id: uuid}),
                        "Delivery could not be confirmed.",
                    ),
                },
            },
        },
        "/v1/company-participant-invitations": {
            post: {
                operationId: "inviteCompanyParticipant",
                summary: "Request a company-scoped participant-only invitation; no role or account lookup is exposed",
                description:
                    "Requires current invitation authority for the specified company while Premium is active. The participant role is determined by the server. Requested acknowledges the submission; it does not confirm account existence, delivery or enrolment. Repeat the original fields with the same key.",
                requestBody: jsonBody(record({
                    ...invitationIdentity,
                    display_name: {type: "string", minLength: 1, maxLength: 120, pattern: "\\S"},
                    organisation_id: uuid,
                })),
                responses: {
                    ...invitationHttpErrors,
                    "202": jsonResponse(record({status: {const: "requested"}})),
                    "409": invitationError("The same request key was used with different fields", "invalid_request"),
                },
            },
        },
    },
};
