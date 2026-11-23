/** Generate the credential-free clients from the same Academy document shipped to operators. */
import { readFileSync } from "node:fs";

export const academyClientPaths = ["api/client.ts", "api/client.py"];
const methods = ["get", "post", "put", "patch", "delete", "head"];
const editions = ["customer-managed", "customer-self-hosted"];
const credentials = ["apiKey", "bearerAuth", "integrationKey"];
const requestMedia = ["application/json", "image/png", "multipart/form-data"];

const template = (name) =>
  readFileSync(new URL("./academy-clients/" + name, import.meta.url), "utf8");

function operationsFrom(document) {
  const operations = new Map();
  for (const [path, item] of Object.entries(document.paths)) {
    if (!/^\/(?:rest|functions)\/v1\/[a-zA-Z0-9_/-]+$/.test(path))
      throw new Error("Unsupported Academy client operation path.");
    for (const method of methods) {
      const operation = item[method];
      if (!operation) continue;
      const { operationId: id, security } = operation;
      const requirements = Object.keys(security?.[0] ?? {});
      const content = Object.keys(operation.requestBody?.content ?? {});
      const parameters = operation.parameters ?? [];
      const query = parameters.filter(({ in: place }) => place === "query");
      if (
        typeof id !== "string" ||
        !id ||
        operations.has(id) ||
        !Array.isArray(security) ||
        security.length > 1 ||
        requirements.some((key) => !credentials.includes(key)) ||
        content.some((media) => !requestMedia.includes(media)) ||
        parameters.some(
          (parameter) =>
            parameter.in !== "query" &&
            !(parameter.in === "header" && parameter.name === "Origin"),
        )
      )
        throw new Error(
          `Unsupported or duplicate Academy client operation: ${method.toUpperCase()} ${path} (${id}).`,
        );
      operations.set(id, {
        method: method.toUpperCase(),
        path,
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
  const asJson = (value) => JSON.stringify(value, null, 2);
  // Python's JSON parser accepts the same deterministic literals emitted for
  // TypeScript, including booleans and nullable installation identifiers.
  const pythonLiteral = (value) => JSON.stringify(JSON.stringify(value));
  return new Map([
    [
      academyClientPaths[0],
      `// Generated from this Academy's OpenAPI document.\nexport const installation = ${asJson(identity)} as const;\nexport const operations = ${asJson(operations)} as const;\n\n${template("client.ts.txt")}`,
    ],
    [
      academyClientPaths[1],
      `"""Generated from this Academy's OpenAPI document."""\n\n${template("client.py.txt")}\n\nINSTALLATION = json.loads(${pythonLiteral(identity)})\nOPERATIONS = json.loads(${pythonLiteral(operations)})\n`,
    ],
  ]);
}
