const text = { type: "string" };
const body = <Schema extends object>(schema: Schema) => ({
  "application/json": { schema },
});
const nativeError = (description: string, code: string) => ({
  description,
  content: body({
    type: "object",
    properties: {
      code: { const: code },
      message: text,
      details: { type: ["string", "null"] },
      hint: { type: ["string", "null"] },
    },
    required: ["code", "message", "details", "hint"],
    additionalProperties: false,
  }),
});

export function sessionPaths(dedicated: boolean) {
  const scope = dedicated
    ? "The operator-enabled course profile and an active or grace-period licence are required."
    : "The authenticated account must have current portal access.";
  const security = [
    { [dedicated ? "apiKey" : "publicApiKey"]: [], bearerAuth: [] },
  ];
  const licence = dedicated ? { "x-portal-licence": "active-or-grace" } : {};
  const responses = {
    "200": {
      description: "Current access check",
      content: body({ type: "boolean" }),
    },
    "401": { description: "Authentication required" },
    "403": nativeError("Current access denied", "42501"),
    "412": nativeError("Authenticator verification required", "PT412"),
    "428": nativeError("Personal password setup required", "PT428"),
  };
  return {
    "/rest/v1/rpc/portal_access": {
      post: {
        operationId: "checkPortalAccess",
        tags: ["Authentication"],
        summary: "Check the current session's portal access",
        description: `${scope} The access check runs after any applicable first-password and privileged authenticator requirements.`,
        security,
        ...licence,
        responses,
      },
    },
    "/rest/v1/rpc/authenticator_settings_available": {
      post: {
        operationId: "checkAuthenticatorSettingsAvailability",
        tags: ["Authentication"],
        summary: "Check whether this session can manage its authenticator",
        description: `${scope} Returns true for an eligible owner or administrator while authenticator enrollment or enforcement is enabled. In the academy edition this also requires an active licence.`,
        security,
        ...licence,
        responses,
      },
    },
  };
}
