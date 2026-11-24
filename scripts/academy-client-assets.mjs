/** Generate the credential-free clients from the same Academy document shipped to operators. */
import { readFileSync } from "node:fs";

export const academyClientPaths = ["api/client.ts", "api/client.py"];
const methods = ["get", "post", "put", "patch", "delete", "head"];
const editions = ["customer-managed", "customer-self-hosted"];
const credentials = ["apiKey", "bearerAuth", "integrationKey"];
const requestMedia = ["application/json", "image/png", "multipart/form-data"];

// Static-only documents must still render byte-identical signed clients.
const pathSupport = {
  "client.ts.txt": {
    PATH_INPUT: "  path?: Readonly<Record<string, string>>;\n",
    PATH_CODE: `  const parameters: readonly string[] = "pathParameters" in operation ? operation.pathParameters : [];
  const supplied = input.path ?? {};
  for (const name of Object.keys(supplied))
    if (!parameters.includes(name)) throw new Error("Undocumented path parameter: " + name);
  const path = operation.path.replace(/\\{([a-zA-Z_][a-zA-Z0-9_]*)\\}/g, (_, name: string) => {
    const value = Object.hasOwn(supplied, name) ? supplied[name] : undefined;
    if (typeof value !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value))
      throw new Error("A UUID path parameter is required: " + name);
    return value;
  });
`,
    OPERATION_PATH: ["operation.path", "path"],
  },
  "client.py.txt": {
    PATH_INPUT: "path_params=None, ",
    PATH_CODE: `    parameters = operation.get("pathParameters", ())
    supplied = {} if path_params is None else path_params
    if not isinstance(supplied, dict) or any(name not in parameters for name in supplied):
        raise ValueError("Undocumented path parameter.")
    def substitute(match):
        name = match.group(1)
        value = supplied.get(name)
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", value, re.IGNORECASE):
            raise ValueError("A UUID path parameter is required: " + name)
        return value
    path = re.sub(r"\\{([a-zA-Z_][a-zA-Z0-9_]*)\\}", substitute, operation["path"])
`,
    OPERATION_PATH: ['operation["path"]', "path"],
  },
};

function template(name, hasPathParameters) {
  const parts = pathSupport[name];
  return readFileSync(
    new URL("./academy-clients/" + name, import.meta.url),
    "utf8",
  )
    .replace("@@PATH_INPUT@@", hasPathParameters ? parts.PATH_INPUT : "")
    .replace("@@PATH_CODE@@", () => (hasPathParameters ? parts.PATH_CODE : ""))
    .replace(
      "@@OPERATION_PATH@@",
      parts.OPERATION_PATH[Number(hasPathParameters)],
    );
}

function operationsFrom(document) {
  const operations = new Map();
  for (const [path, item] of Object.entries(document.paths)) {
    if (
      !/^\/(?:rest|functions)\/v1(?:\/(?:[a-zA-Z0-9_-]+|\{[a-zA-Z_][a-zA-Z0-9_]*\}))+$/u.test(
        path,
      )
    )
      throw new Error("Unsupported Academy client operation path.");
    const placeholders = [...path.matchAll(/\{([^}]+)\}/g)].map(
      ([, name]) => name,
    );
    for (const method of methods) {
      const operation = item[method];
      if (!operation) continue;
      const { operationId: id, security } = operation;
      const requirements = Object.keys(security?.[0] ?? {});
      const content = Object.keys(operation.requestBody?.content ?? {});
      const parameters = operation.parameters ?? [];
      const query = parameters.filter(({ in: place }) => place === "query");
      const pathParameters = parameters.filter(
        ({ in: place }) => place === "path",
      );
      if (
        typeof id !== "string" ||
        !id ||
        operations.has(id) ||
        !Array.isArray(security) ||
        security.length > 1 ||
        requirements.some((key) => !credentials.includes(key)) ||
        content.some((media) => !requestMedia.includes(media)) ||
        pathParameters.length !== placeholders.length ||
        new Set(placeholders).size !== placeholders.length ||
        placeholders.some(
          (name) =>
            !pathParameters.some(
              (parameter) =>
                parameter.name === name &&
                parameter.required === true &&
                parameter.schema?.type === "string" &&
                parameter.schema.format === "uuid",
            ),
        ) ||
        parameters.some(
          (parameter) =>
            parameter.in !== "query" &&
            parameter.in !== "path" &&
            !(parameter.in === "header" && parameter.name === "Origin"),
        )
      )
        throw new Error(
          `Unsupported or duplicate Academy client operation: ${method.toUpperCase()} ${path} (${id}).`,
        );
      operations.set(id, {
        method: method.toUpperCase(),
        path,
        ...(placeholders.length && { pathParameters: placeholders }),
        credentials: requirements,
        query: query.map(({ name }) => name),
        requiredQuery: query
          .filter(({ required }) => required)
          .map(({ name }) => name),
        originHeader: parameters.some((parameter) => parameter.in === "header"),
        content,
        requiredBody: operation.requestBody?.required === true,
        deprecated: operation.deprecated === true,
        statuses: Object.keys(operation.responses ?? {}),
      });
    }
  }
  return Object.fromEntries(operations);
}

/** Reused by the browser build and the signed-package verifier. */
export function academyClientAssets(document) {
  const installation = document["x-portal-installation"];
  if (!editions.includes(installation?.edition))
    throw new Error(
      "Only a dedicated Academy contract may generate these clients.",
    );
  const baseUrl = document.servers?.[0]?.url;
  if (baseUrl !== "/") {
    const url = new URL(baseUrl);
    if (
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      ) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Invalid Academy client API origin.");
  }
  const identity = {
    edition: installation.edition,
    installationId: installation.installation_id,
    openApiVersion: document.info.version,
    baseUrl,
  };
  const operations = operationsFrom(document);
  const hasPathParameters = Object.values(operations).some(
    (operation) => operation.pathParameters,
  );
  const asJson = (value) => JSON.stringify(value, null, 2);
  // Python's JSON parser accepts the same deterministic literals emitted for
  // TypeScript, including booleans and nullable installation identifiers.
  const pythonLiteral = (value) => JSON.stringify(JSON.stringify(value));
  return new Map([
    [
      academyClientPaths[0],
      `// Generated from this Academy's OpenAPI document.\nexport const installation = ${asJson(identity)} as const;\nexport const operations = ${asJson(operations)} as const;\n\n${template("client.ts.txt", hasPathParameters)}`,
    ],
    [
      academyClientPaths[1],
      `"""Generated from this Academy's OpenAPI document."""\n\n${template("client.py.txt", hasPathParameters)}\n\nINSTALLATION = json.loads(${pythonLiteral(identity)})\nOPERATIONS = json.loads(${pythonLiteral(operations)})\n`,
    ],
  ]);
}
