/** Assignment and Grade Services endpoints for an opted-in tool deployment. */
import { boundedBytes, RequestBodyTooLarge } from "../_shared/bounded-body.ts";

const prefix = "https://purl.imsglobal.org/spec/lti-ags/scope/";
export const agsScopes = [
  prefix + "lineitem",
  prefix + "lineitem.readonly",
  prefix + "result.readonly",
  prefix + "score",
];

const lineMedia = "application/vnd.ims.lis.v2.lineitem+json";
const listMedia = "application/vnd.ims.lis.v2.lineitemcontainer+json";
const resultMedia = "application/vnd.ims.lis.v2.resultcontainer+json";
const scoreMedia = "application/vnd.ims.lis.v1.score+json";
const id = "[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}";
const uuid = new RegExp(`^${id}$`, "i");
const route = new RegExp(
  `^/learning-lti/ags/(${id})/lineitems(?:/(${id})(?:/(scores|results))?)?$`,
  "i",
);
const utf8 = new TextDecoder("utf-8", { fatal: true });

type JsonObject = Record<string, unknown>;
type ServiceResponse = { data: unknown; code?: string };
export type AgsBackend = (
  deployment: string,
  token: string,
  action: string,
  item: string | null,
  input: JsonObject,
) => Promise<ServiceResponse>;

const object = (value: unknown): value is JsonObject =>
  !!value && typeof value === "object" && !Array.isArray(value);

function content(
  status: number,
  value: unknown,
  type = "application/json",
  extra: HeadersInit = {},
) {
  const headers = new Headers(extra);
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  if (status !== 204) headers.set("Content-Type", type);
  return new Response(status === 204 ? null : JSON.stringify(value), {
    status,
    headers,
  });
}

const requiredError = () =>
  content(401, { error: "invalid_token" }, undefined, {
    "WWW-Authenticate": "Bearer",
  });

function readInput(url: URL, results: boolean) {
  const fields = results
    ? ["user_id", "after", "limit"]
    : ["resource_link_id", "resource_id", "tag", "after", "limit"];
  const params: Record<string, string | number> = {};
  for (const key of fields) {
    const values = url.searchParams.getAll(key);
    if (!values.length) continue;
    const input = values[0];
    if (
      values.length !== 1 || input.length > 500 ||
      /[\u0000-\u001f\u007f]/.test(input)
    ) return null;
    if (
      (key === "after" || key.endsWith("_id") && key !== "resource_id") &&
      !uuid.test(input)
    ) return null;
    if (key === "limit") {
      if (!/^(?:[1-9][0-9]?|1[0-9]{2}|200)$/.test(input)) return null;
      params.limit = Number(input);
    } else params[key] = input;
  }
  return params;
}

function date(value: unknown) {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/i
      .test(value) &&
    Number.isFinite(Date.parse(value));
}

function checkedBody(action: string, payload: JsonObject, canonical: string) {
  if (action === "score") {
    return date(payload.timestamp) && typeof payload.userId === "string" &&
      uuid.test(payload.userId);
  }
  if (
    payload.id !== undefined &&
    (action === "create" || payload.id !== canonical)
  ) return false;
  return ["startDateTime", "endDateTime"].every((name) =>
    payload[name] == null || payload[name] === "" || date(payload[name])
  );
}

const scopedUrl = (base: string, deployment: string) =>
  `${base}/ags/${deployment}/lineitems`;

/** Advertise endpoints and scopes only when this deployment has enabled the service. */
export function agsClaims(
  base: string,
  launch: {
    id: string;
    ags_enabled?: boolean;
    ags_lineitem?: string;
    registration_scopes?: string[];
  },
) {
  if (!launch.ags_enabled) return {};
  const scope = launch.registration_scopes
    ? agsScopes.filter((service) =>
      launch.registration_scopes?.includes(service)
    )
    : agsScopes;
  if (!scope.length) return {};
  const lineitems = scopedUrl(base, launch.id);
  return {
    "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": {
      scope,
      lineitems,
      ...(launch.ags_lineitem
        ? { lineitem: `${lineitems}/${launch.ags_lineitem}` }
        : {}),
    },
  };
}

export function createAgsRoute(base: string, service: AgsBackend) {
  return async (request: Request, path: string) => {
    const match = route.exec(path);
    if (!match) return null;
    const [, deployment, item, subpath] = match.map((part) =>
      part?.toLowerCase()
    );
    const method = request.method;
    const action = subpath === "scores"
      ? (method === "POST" ? "score" : null)
      : subpath === "results"
      ? (method === "GET" ? "results" : null)
      : item
      ? ({ GET: "read", PUT: "update", DELETE: "delete" } as Record<
        string,
        string
      >)[method]
      : ({ GET: "list", POST: "create" } as Record<string, string>)[method];
    if (!action) {
      const allow = subpath === "scores"
        ? "POST"
        : subpath === "results"
        ? "GET"
        : item
        ? "GET, PUT, DELETE"
        : "GET, POST";
      return content(405, { error: "method_not_allowed" }, undefined, {
        Allow: allow,
      });
    }
    const credential = /^Bearer ([0-9a-f]{64})$/i.exec(
      request.headers.get("authorization") ?? "",
    )?.[1];
    if (!credential) return requiredError();

    const collection = scopedUrl(base, deployment);
    const canonical = item ? `${collection}/${item}` : collection;
    let input: JsonObject = {};
    if (action === "list" || action === "results") {
      const parsed = readInput(new URL(request.url), action === "results");
      if (parsed === null) return content(400, { error: "invalid_request" });
      input = parsed;
    } else if (
      action === "create" || action === "update" || action === "score"
    ) {
      const type = request.headers.get("content-type")?.split(";", 1)[0].trim()
        .toLowerCase();
      if (type !== (action === "score" ? scoreMedia : lineMedia)) {
        return content(415, { error: "unsupported_media_type" });
      }
      try {
        const json: unknown = JSON.parse(
          utf8.decode(await boundedBytes(request, 8192)),
        );
        if (!object(json) || !checkedBody(action, json, canonical)) {
          return content(400, { error: "invalid_request" });
        }
        input = json;
      } catch (error) {
        return content(error instanceof RequestBodyTooLarge ? 413 : 400, {
          error: "invalid_request",
        });
      }
    }

    const result = await service(
      deployment,
      credential,
      action,
      item ?? null,
      input,
    );
    if (result.code) {
      if (result.code === "42501") return requiredError();
      if (result.code === "PT404") return content(404, { error: "not_found" });
      if (result.code.startsWith("22") || result.code === "23514") {
        return content(400, { error: "invalid_request" });
      }
      return content(503, { error: "temporarily_unavailable" });
    }
    if (action === "score" || action === "delete") return content(204, null);
    if (action === "list" || action === "results") {
      if (!Array.isArray(result.data)) {
        return content(503, { error: "temporarily_unavailable" });
      }
      const limit = Number(input.limit ?? 100);
      const page = result.data.slice(0, limit);
      const url = new URL(
        action === "results" ? `${canonical}/results` : canonical,
      );
      const rows = action === "results"
        ? page.map((row) => ({
          ...row,
          id: `${url.href}/${row.userId}`,
          scoreOf: canonical,
        }))
        : page.map((row) => ({ ...row, id: `${collection}/${row.id}` }));
      const link: Record<string, string> = {};
      if (result.data.length > limit) {
        for (const [key, value] of Object.entries(input)) {
          url.searchParams.set(key, String(value));
        }
        url.searchParams.set(
          "after",
          action === "results" ? page.at(-1).userId : page.at(-1).id,
        );
        link.Link = `<${url.href}>; rel="next"`;
      }
      return content(
        200,
        rows,
        action === "results" ? resultMedia : listMedia,
        link,
      );
    }
    if (
      !object(result.data) || typeof result.data.id !== "string" ||
      !uuid.test(result.data.id)
    ) {
      return content(503, { error: "temporarily_unavailable" });
    }
    const location = `${collection}/${result.data.id}`;
    return content(
      action === "create" ? 201 : 200,
      {
        ...result.data,
        id: location,
      },
      lineMedia,
      action === "create" ? { Location: location } : {},
    );
  };
}
