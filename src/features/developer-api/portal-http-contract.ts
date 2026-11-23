import {
  portalHttpActions,
  type PortalHttpAction,
  portalHttpMethods,
  type PortalHttpMethod,
  portalHttpPutTargets,
  portalHttpPutVersions,
} from "../../../supabase/functions/_shared/portal-http-methods.ts";

const rpcPrefix = "/rest/v1/rpc/";
export const portalHttpAliasPrefix = "/functions/v1/portal-api/v1/";

type Paths = Record<string, object>;

type RpcPost = {
  operationId: string;
  description?: string;
  responses: Record<
    string,
    { description: string; headers?: object; content?: object }
  >;
  requestBody?: {
    required?: boolean;
    content: { "application/json"?: { schema: unknown } };
  };
  "x-portal-document-only"?: boolean;
};

type HttpPaths = Record<
  `${typeof portalHttpAliasPrefix}${string}`,
  Record<string, RpcPost & { parameters?: object[] }>
>;

function gatewayError(description: string, code: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: {
          type: "object",
          required: ["error"],
          properties: { error: { const: code } },
        },
      },
    },
  };
}

type ActionSchema = {
  oneOf?: readonly {
    properties?: Record<
      string,
      { const?: unknown; enum?: readonly unknown[]; type?: unknown }
    >;
  }[];
};

/** Omit mutually exclusive native alternatives so Swagger starts with a compatible example. */
function branchSchema(schema: unknown, action: PortalHttpAction | undefined) {
  if (!action || !schema || typeof schema !== "object") return schema;
  const original = schema as ActionSchema;
  if (!Array.isArray(original.oneOf)) return schema;
  const oneOf = original.oneOf.filter((branch) => {
    const fields = branch.properties;
    const discriminator = fields?.[action.argument];
    if (action.target && fields?.[action.target]?.type === "null") return false;
    if (!discriminator) return true;
    if ("const" in discriminator)
      return action.values.some((value) => value === discriminator.const);
    const choices = discriminator.enum;
    return !choices || action.values.some((value) => choices.includes(value));
  });
  return oneOf.length ? { ...original, oneOf } : schema;
}

/** Derive each HTTP method from the current edition's documented RPC contract. */
export function withPortalHttpAliases<T extends Paths>(
  paths: T,
): T & HttpPaths {
  const definitions = [
    ...Object.entries(portalHttpMethods),
    ...Object.entries(portalHttpActions).flatMap(([name, methods]) =>
      (Object.keys(methods) as PortalHttpMethod[]).map(
        (method) => [name, method] as const,
      ),
    ),
  ];
  const aliases: HttpPaths = {};
  for (const [name, method] of definitions) {
    const path = paths[rpcPrefix + name];
    if (!path || !("post" in path)) continue;
    const { requestBody, ...source } = path.post as RpcPost;
    if (source["x-portal-document-only"]) continue;
    const json = requestBody?.content["application/json"];
    if (!json) continue;
    const verb = method.toLowerCase();
    const action =
      method === "GET" ? undefined : portalHttpActions[name]?.[method];
    const target =
      action?.target ??
      (method === "PUT" ? portalHttpPutTargets[name] : undefined);
    const version =
      action?.version ??
      (method === "PUT" ? portalHttpPutVersions[name] : undefined);
    const properties = {
      ...(action && { [action.argument]: { enum: action.values } }),
      ...(target && { [target]: { type: "string", format: "uuid" } }),
      ...(version && { [version]: { type: "integer", minimum: 1 } }),
    };
    const required = Object.keys(properties);
    const body = required.length
      ? {
          required: true,
          content: {
            "application/json": {
              ...json,
              schema: {
                allOf: [
                  branchSchema(json.schema, action),
                  {
                    type: "object",
                    required,
                    properties,
                  },
                ],
              },
            },
          },
        }
      : requestBody;
    const operation = {
      ...source,
      operationId: `http_${verb}_${name}`,
      responses: {
        ...source.responses,
        "405": {
          ...gatewayError(
            "Method is not enabled for this operation",
            "method_not_allowed",
          ),
          headers: {
            Allow: {
              schema: {
                type: "string",
                example: [
                  ...(action ? Object.keys(portalHttpActions[name]) : [method]),
                  "OPTIONS",
                ].join(", "),
              },
            },
          },
        },
        ...(method === "GET"
          ? {
              "414": gatewayError(
                "Query arguments are too large",
                "request_uri_too_large",
              ),
            }
          : {
              "413": gatewayError(
                "Request body is too large",
                "request_too_large",
              ),
              "415": gatewayError(
                "The request body must be JSON",
                "unsupported_media_type",
              ),
            }),
        "502": gatewayError(
          "The native operation did not return JSON",
          "upstream_unavailable",
        ),
      },
      description: [
        source.description,
        method === "GET"
          ? "Send RPC arguments as a JSON object in the input query parameter."
          : "Send the same JSON arguments as the native RPC, including any required version, request ID or confirmation.",
        action &&
          `${method} accepts only ${action.argument}: ${action.values.map((value) => JSON.stringify(value)).join(", ")}.`,
      ]
        .filter(Boolean)
        .join(" "),
      ...(method === "GET"
        ? {
            parameters: [
              {
                name: "input",
                in: "query",
                required: requestBody?.required ?? false,
                content: { "application/json": json },
              },
            ],
          }
        : { requestBody: body }),
    };
    const route = `${portalHttpAliasPrefix}${name}` as const;
    (aliases[route] ??= {})[verb] = operation;
  }
  return { ...paths, ...aliases };
}

/** Check a concrete gateway alias against an already edition-filtered catalogue. */
export function isPortalHttpAliasRequest(
  url: URL,
  path: string,
  method: string,
  paths: Paths,
) {
  if (!path.startsWith(portalHttpAliasPrefix) || !Object.hasOwn(paths, path))
    return false;
  if (!Object.hasOwn(paths[path], method)) return false;
  if (method !== "get") return !url.search;

  for (const key of url.searchParams.keys()) {
    if (key !== "input") return false;
  }
  const inputs = url.searchParams.getAll("input");
  if (inputs.length === 0) return true;
  if (inputs.length !== 1) return false;
  try {
    const input: unknown = JSON.parse(inputs[0]);
    return typeof input === "object" && input !== null && !Array.isArray(input);
  } catch {
    return false;
  }
}
