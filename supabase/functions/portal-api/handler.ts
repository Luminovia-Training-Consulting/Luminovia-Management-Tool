import { boundedBytes, RequestBodyTooLarge } from "../_shared/bounded-body.ts";

type OperationMethod = "GET" | "PUT" | "DELETE";

interface PortalHttpDependencies {
  backend: string;
  publicKey: string;
  origins: readonly string[];
  operations: Readonly<Record<string, OperationMethod>>;
  putTargets: Readonly<Record<string, string>>;
  putVersions: Readonly<Record<string, string>>;
  transport?: typeof fetch;
}

const inputLimit = 1024 * 1024;
const queryLimit = 16 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pathPattern = /^\/(?:functions\/v1\/)?portal-api\/v1\/([a-z][a-z0-9_]*)$/;

async function argumentsFor(
  request: Request,
  url: URL,
): Promise<{ args: Record<string, unknown>; body: string }> {
  let body = "{}";
  if (request.method === "GET") {
    if (url.search.length > queryLimit) throw new RequestBodyTooLarge();
    const parameters = [...url.searchParams];
    if (
      parameters.length > 1 ||
      (parameters.length === 1 && parameters[0][0] !== "input")
    ) {
      throw new Error("invalid_request");
    }
    if (parameters.length) body = parameters[0][1];
  } else {
    if (url.search) throw new Error("invalid_request");
    if (request.body) {
      if (
        request.headers.get("content-type")?.split(";")[0].trim()
          .toLowerCase() !== "application/json"
      ) {
        throw new Error("unsupported_media_type");
      }
      body = new TextDecoder("utf-8", { fatal: true }).decode(
        await boundedBytes(request, inputLimit),
      );
    }
  }
  const input: unknown = JSON.parse(body);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("invalid_request");
  }
  return { args: input as Record<string, unknown>, body };
}

/** Serve the documented aliases using only the current caller's native RPC authority. */
export function createPortalHttpHandler(deps: PortalHttpDependencies) {
  const transport = deps.transport ?? fetch;
  const backend = deps.backend.replace(/\/+$/, "");
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const headers = new Headers({
      "Cache-Control": "no-store, private",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Vary": "Origin",
    });
    const error = (status: number, code: string) =>
      Response.json({ error: code }, { status, headers });
    if (origin !== null) {
      if (!deps.origins.includes(origin)) {
        return error(403, "origin_not_allowed");
      }
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set(
        "Access-Control-Allow-Headers",
        "authorization,apikey,content-type,x-client-info",
      );
    }

    const url = new URL(request.url);
    const operation = pathPattern.exec(url.pathname)?.[1];
    if (!operation || !Object.hasOwn(deps.operations, operation)) {
      return error(404, "not_found");
    }
    const method = deps.operations[operation];
    headers.set("Allow", `${method}, OPTIONS`);
    if (origin !== null) {
      headers.set("Access-Control-Allow-Methods", `${method}, OPTIONS`);
      headers.set("Access-Control-Expose-Headers", "Allow");
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== method) return error(405, "method_not_allowed");

    const bearer = request.headers.get("authorization");
    if (!bearer || !/^Bearer [^\s,]+$/i.test(bearer)) {
      return error(401, "authentication_required");
    }
    let input: Awaited<ReturnType<typeof argumentsFor>>;
    try {
      input = await argumentsFor(request, url);
    } catch (cause) {
      if (cause instanceof RequestBodyTooLarge) {
        return request.method === "GET"
          ? error(414, "request_uri_too_large")
          : error(413, "request_too_large");
      }
      if (
        cause instanceof Error && cause.message === "unsupported_media_type"
      ) {
        return error(415, "unsupported_media_type");
      }
      return error(400, "invalid_request");
    }

    if (method === "PUT" && Object.hasOwn(deps.putTargets, operation)) {
      const target = input.args[deps.putTargets[operation]];
      if (typeof target !== "string" || !uuid.test(target)) {
        return error(400, "existing_record_id_required");
      }
    }

    if (method === "PUT" && Object.hasOwn(deps.putVersions, operation)) {
      const version = input.args[deps.putVersions[operation]];
      if (
        typeof version !== "number" || !Number.isSafeInteger(version) ||
        version < 1
      ) {
        return error(400, "existing_record_version_required");
      }
    }

    const upstreamHeaders = {
      apikey: deps.publicKey,
      Authorization: bearer,
      Accept: "application/json",
    };
    try {
      if (!backend || !deps.publicKey) return error(503, "service_unavailable");
      const identity = await transport(`${backend}/auth/v1/user`, {
        headers: upstreamHeaders,
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      });
      if ([400, 401, 403].includes(identity.status)) {
        await identity.body?.cancel();
        return error(401, "authentication_required");
      }
      if (!identity.ok) {
        await identity.body?.cancel();
        return error(503, "service_unavailable");
      }
      const user: unknown = await identity.json();
      if (
        !user || typeof user !== "object" || !("id" in user) ||
        typeof user.id !== "string" || !user.id
      ) {
        return error(401, "authentication_required");
      }

      const result = await transport(`${backend}/rest/v1/rpc/${operation}`, {
        method: "POST",
        headers: {
          ...upstreamHeaders,
          "Content-Type": "application/json",
        },
        body: input.body,
        redirect: "error",
        signal: AbortSignal.timeout(45_000),
      });
      if (result.status === 204) {
        return new Response(null, { status: 204, headers });
      }
      if (
        result.headers.get("content-type")?.split(";")[0].trim()
          .toLowerCase() !== "application/json"
      ) {
        await result.body?.cancel();
        return error(502, "upstream_unavailable");
      }
      let status = result.status;
      if (status === 500) {
        const nativeError: unknown = await result.clone().json().catch(() =>
          null
        );
        if (
          nativeError && typeof nativeError === "object" &&
          "code" in nativeError && nativeError.code === "40001"
        ) {
          status = 409;
        }
      }
      headers.set("Content-Type", "application/json");
      return new Response(result.body, { status, headers });
    } catch {
      return error(503, "service_unavailable");
    }
  };
}
