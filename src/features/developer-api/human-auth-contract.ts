const text = { type: "string" };
const secret = { ...text, format: "password" };
const object = (properties: Record<string, object>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const json = (schema: object) => ({ "application/json": { schema } });
const error = (description: string, code: string) => ({
  description,
  content: json(object({ error: { const: code } })),
});

/** Native credentials and recovery are available in downloads only. */
export const humanAuthPaths = {
  "/functions/v1/human-login": {
    post: {
      operationId: "humanLogin",
      tags: ["Authentication"],
      summary: "Establish a native Supabase session with an email address",
      description:
        "Pass credentials in the TLS request body. Browser origins must be allowed by the installation. Existing users keep their current Supabase identity and permissions. A protected portal session may still require a personal password or an authenticator challenge.",
      security: [],
      requestBody: {
        required: true,
        content: json(
          object({
            identifier: {
              ...text,
              description:
                "The account email address. After trimming and case-folding, the identifier must have at most 254 characters.",
            },
            password: {
              ...text,
              minLength: 1,
              maxLength: 128,
              format: "password",
              writeOnly: true,
              pattern: "^[^\\u0000-\\u001f\\u007f]+$",
            },
          }),
        ),
      },
      responses: {
        "200": {
          description: "Native short-lived access token and refresh token",
          content: json(
            object({
              access_token: secret,
              refresh_token: secret,
              expires_in: { type: "integer" },
              token_type: { const: "bearer" },
            }),
          ),
        },
        "400": error("Invalid request", "invalid_request"),
        "401": error(
          "Invalid credentials or unavailable account",
          "invalid_credentials",
        ),
        "403": error("Browser origin denied", "invalid_credentials"),
        "415": error("JSON body required", "json_required"),
        "429": error("Credential attempt limit reached", "rate_limited"),
        "503": error(
          "Authentication temporarily unavailable",
          "login_unavailable",
        ),
      },
    },
  },
  "/functions/v1/human-recovery": {
    post: {
      operationId: "humanRecovery",
      tags: ["Authentication"],
      summary: "Request username recovery using native PKCE",
      description:
        "A browser must supply an allowed Origin and that origin's exact /auth/callback URL. The client keeps the PKCE verifier.",
      security: [],
      requestBody: {
        required: true,
        content: json(
          object({
            username: { ...text, pattern: "^[a-z][a-z0-9._-]{1,30}[a-z0-9]$" },
            code_challenge: { ...text, pattern: "^[A-Za-z0-9_-]{43}$" },
            code_challenge_method: { const: "s256" },
            redirect_to: { ...text, format: "uri" },
          }),
        ),
      },
      responses: {
        "202": {
          description:
            "Request accepted without revealing the account or delivery status",
          content: json(object({})),
        },
        "400": error("Invalid alias, challenge or callback", "invalid_request"),
        "403": error("Browser origin denied", "invalid_request"),
        "415": error("JSON body required", "invalid_request"),
      },
    },
  },
};
