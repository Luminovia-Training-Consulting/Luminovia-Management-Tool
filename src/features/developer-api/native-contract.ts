/** Renders replay-verified browser RPC contracts for the download and explorer. */
import catalogue from "../../../data/native-rpc.generated.json" with { type: "json" };
import { chatOperationDocumentation } from "./chat-operation-documentation.ts";
import { commercialOperationDocumentation } from "./commercial-operation-documentation.ts";
import { knowledgeOperationDocumentation } from "./knowledge-operation-documentation.ts";
import { operationsRpcDocumentation } from "./operations-rpc-documentation.ts";

type RpcRequest = {
  properties: Record<string, Record<string, unknown> | undefined>;
  required: string[];
};

type RpcDocumentation = {
  summary: string;
  description: string;
  parameters?: Record<string, Record<string, unknown>>;
  required?: readonly string[];
  result?: Record<string, unknown>;
  errors?: Record<string, string>;
};

const operationDocumentation: Record<string, RpcDocumentation | undefined> = {
  ...chatOperationDocumentation,
  ...commercialOperationDocumentation,
  ...knowledgeOperationDocumentation,
  ...operationsRpcDocumentation,
};

type NativeRpc = {
  feature: string;
  participant: boolean;
  guest: boolean;
  overloads: {
    request: RpcRequest;
    response: unknown;
    void?: boolean;
  }[];
};

/** These calls remain documentable for trusted clients with current authority.
 * Keeping them out of Try it out prevents rendering fresh secrets or accepting
 * mail credentials in Swagger's request and response panes.
 */
const documentOnly = new Set([
  "company_accounting_webhook_subscribe",
  "company_course_webhook_subscribe",
  "issue_company_integration_key",
  "issue_scoped_company_integration_key",
  "my_push_devices",
  "register_push_device",
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

/** Apply business constraints to known SQL arguments without changing overloads. */
function documentRequest(
  request: RpcRequest,
  documentation?: RpcDocumentation,
) {
  if (!documentation) return request;
  return {
    ...request,
    properties: Object.fromEntries(
      Object.entries(request.properties).map(([name, property]) => [
        name,
        { ...property, ...documentation.parameters?.[name] },
      ]),
    ),
    required: [
      ...new Set([
        ...request.required,
        ...(documentation.required ?? []).filter((name) =>
          Object.hasOwn(request.properties, name),
        ),
      ]),
    ],
  };
}

/** Compose native methods without creating or proxying any backend routes. */
function buildNativePaths(explorer: boolean) {
  const entries: Record<string, NativeRpc> = catalogue;
  return Object.fromEntries(
    Object.entries(entries)
      // Dedicated academy business endpoints stay dormant on the server.
      .filter(([name]) => !/^(?:save_|clear_)?academy_/.test(name))
      .filter(([name]) => !explorer || !documentOnly.has(name))
      .map(([name, entry]) => {
        const documentation = operationDocumentation[name];
        const requests = entry.overloads.map((item) =>
          documentRequest(item.request, documentation),
        );
        const returnsData = entry.overloads.filter((item) => !item.void);
        return [
          "/rest/v1/rpc/" + name,
          {
            post: {
              operationId: "native_" + name,
              tags: ["Native / " + entry.feature.replaceAll("-", " ")],
              summary: documentation?.summary ?? name.replaceAll("_", " "),
              description:
                documentation?.description ??
                "Native PostgREST operation used by the portal. Current database authority and resource membership apply. Omit defaulted parameters to use server defaults. JSON and JSONB values follow the owning feature's validation. Inspect returned business states before reporting success.",
              "x-luminovia-rest-gate": {
                postgresRole: "authenticated",
                operationalSession: true,
                participantSession: entry.participant,
                guestSession: entry.guest,
              },
              requestBody: {
                required: requests.every(
                  (request) => request.required.length > 0,
                ),
                content: {
                  "application/json": {
                    schema: schemaForOverloads(requests),
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
                            schema:
                              documentation?.result ??
                              schemaForOverloads(
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
                ...Object.fromEntries(
                  Object.entries(documentation?.errors ?? {}).map(
                    ([status, description]) => [
                      status,
                      { ...postgrestError, description },
                    ],
                  ),
                ),
              },
            },
          },
        ];
      }),
  );
}

export const nativeExplorerPaths = buildNativePaths(true);
export const nativeDownloadPaths = buildNativePaths(false);
