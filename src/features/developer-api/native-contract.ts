/** Renders replay-verified browser RPC contracts for the download and explorer. */
import catalogue from "../../../data/native-rpc.generated.json" with { type: "json" };

type NativeRpc = {
  feature: string;
  participant: boolean;
  guest: boolean;
  overloads: {
    request: { required: string[] };
    response: unknown;
    void?: boolean;
  }[];
};

/** These calls remain documentable for trusted clients with current authority.
 * Keeping them out of Try it out prevents rendering fresh secrets or accepting
 * mail credentials in Swagger's request and response panes.
 */
const documentOnly = new Set([
  "company_course_webhook_subscribe",
  "issue_company_integration_key",
  "save_calendar_subscription",
  "save_mail_configuration",
]);

const postgrestError = {
  description: "PostgREST error",
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          details: { type: ["string", "null"] },
          hint: { type: ["string", "null"] },
        },
      },
    },
  },
};

/** Each overload preserves its argument names and omission rules. */
function schemaForOverloads(schemas: unknown[]) {
  return schemas.length === 1 ? schemas[0] : { anyOf: schemas };
}

/** Compose native methods without creating or proxying any backend routes. */
function buildNativePaths(explorer: boolean) {
  const entries: Record<string, NativeRpc> = catalogue;
  return Object.fromEntries(
    Object.entries(entries)
      // Dedicated academy business endpoints stay dormant on the server.
      .filter(([name]) => !name.startsWith("academy_"))
      .filter(([name]) => !explorer || !documentOnly.has(name))
      .map(([name, entry]) => {
        const returnsData = entry.overloads.filter((item) => !item.void);
        return [
          "/rest/v1/rpc/" + name,
          {
            post: {
              operationId: "native_" + name,
              tags: ["Native / " + entry.feature.replaceAll("-", " ")],
              summary: name.replaceAll("_", " "),
              description:
                "Native PostgREST operation used by the portal. Current database authority and resource membership apply. Omit defaulted parameters to use server defaults. JSON and JSONB values follow the owning feature's validation. Inspect returned business states before reporting success.",
              "x-luminovia-rest-gate": {
                postgresRole: "authenticated",
                operationalSession: true,
                participantSession: entry.participant,
                guestSession: entry.guest,
              },
              requestBody: {
                required: entry.overloads.every(
                  (item) => item.request.required.length > 0,
                ),
                content: {
                  "application/json": {
                    schema: schemaForOverloads(
                      entry.overloads.map((item) => item.request),
                    ),
                  },
                },
              },
              responses: {
                ...(returnsData.length
                  ? {
                      "200": {
                        description: "Current server result",
                        content: {
                          "application/json": {
                            schema: schemaForOverloads(
                              returnsData.map((item) => item.response),
                            ),
                          },
                        },
                      },
                    }
                  : {}),
                ...(returnsData.length < entry.overloads.length
                  ? {
                      "204": {
                        description: "Completed without a response body",
                      },
                    }
                  : {}),
                "400": postgrestError,
                "401": postgrestError,
                "403": postgrestError,
                "404": postgrestError,
                "409": postgrestError,
                "429": postgrestError,
                "503": postgrestError,
                default: postgrestError,
              },
            },
          },
        ];
      }),
  );
}

export const nativeExplorerPaths = buildNativePaths(true);
export const nativeDownloadPaths = buildNativePaths(false);
