import { boundedJson } from "../_shared/bounded-body.ts";

type Course = { id: string; title: string; time_zone: string };
type Lookup =
  | { status: "denied" | "rate_limited" }
  | { status: "ok"; items: Course[]; next_cursor: string | null };
type Credential = {
  p_id: string;
  p_secret_hash: string;
};
type FindCourses = (
  input: Credential & {
    p_limit: number;
    p_after: string | null;
  },
) => Promise<Lookup>;

type OperationResult =
  | {
      status:
        | "denied"
        | "rate_limited"
        | "not_found"
        | "conflict"
        | "invalid_request";
    }
  | { status: "ok"; course_id: string; participant_id: string }
  | {
      status: "ok";
      course_id: string;
      session_count: number;
      enrolled_count: number;
      completed_count: number;
    };
type RunOperation = (
  input: Credential & {
    p_action: "enrol" | "report";
    p_course_id: string;
    p_participant_id: string | null;
  },
) => Promise<OperationResult>;

const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const cursorPattern = new RegExp(`^${uuid}$`);
const credentialPattern = new RegExp(`^Bearer lvi_(${uuid})_([0-9a-f]{64})$`);
const participantPattern = /^LV(-[0-9A-F]{4}){5}$/;

function respond(
  status: number,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...headers,
    },
  });
}

/** Course integrations exchange an opaque key only for their scoped dispatcher. */
export function createCompanyIntegrationHandler(
  findCourses: FindCourses,
  runOperation?: RunOperation,
) {
  return async (request: Request) => {
    const url = new URL(request.url);
    const route =
      /^\/(?:functions\/v1\/)?company-integration(?:\/(enrolments|participation))?$/.exec(
        url.pathname,
      );
    if (!route || (route[1] && !runOperation))
      return respond(404, { error: "not_found" });
    const action =
      route[1] === "enrolments"
        ? "enrol"
        : route[1] === "participation"
          ? "report"
          : null;
    const method = action === "enrol" ? "POST" : "GET";
    if (request.method !== method) {
      return respond(405, { error: "method_not_allowed" }, { allow: method });
    }
    if (request.headers.has("origin")) {
      return respond(403, { error: "browser_origin_denied" });
    }
    const credential = credentialPattern.exec(
      request.headers.get("authorization") ?? "",
    );
    if (!credential) return respond(401, { error: "invalid_credential" });
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(credential[2]),
    );
    const key = {
      p_id: credential[1],
      p_secret_hash: Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    };
    if (action && runOperation) {
      const identifiers = await operationRequest(request, url, action);
      if (!identifiers) return respond(400, { error: "invalid_request" });
      try {
        const result = await runOperation({
          ...key,
          p_action: action,
          ...identifiers,
        });
        if (result.status === "ok") {
          if ("participant_id" in result) {
            return respond(200, {
              course_id: result.course_id,
              participant_id: result.participant_id,
              status: "enrolled",
            });
          }
          return respond(200, {
            course_id: result.course_id,
            session_count: result.session_count,
            enrolled_count: result.enrolled_count,
            completed_count: result.completed_count,
          });
        }
        if (result.status === "not_found")
          return respond(404, { error: "not_found" });
        if (result.status === "conflict")
          return respond(409, { error: "enrolment_unavailable" });
        if (result.status === "invalid_request")
          return respond(400, { error: "invalid_request" });
        return keyDenied(result.status);
      } catch {
        return respond(503, { error: "integration_unavailable" });
      }
    }
    const params = url.searchParams;
    const limit = params.get("limit") ?? "25";
    const after = params.get("after");
    if (
      [...params.keys()].some((key) => !["limit", "after"].includes(key)) ||
      params.getAll("limit").length > 1 ||
      params.getAll("after").length > 1 ||
      !/^([1-9]|[1-4][0-9]|50)$/.test(limit) ||
      (after !== null && !cursorPattern.test(after))
    ) {
      return respond(400, { error: "invalid_query" });
    }

    try {
      const result = await findCourses({
        ...key,
        p_limit: Number(limit),
        p_after: after,
      });
      if (result.status !== "ok") return keyDenied(result.status);
      return respond(200, {
        items: result.items,
        next_cursor: result.next_cursor,
      });
    } catch {
      // Avoid storing credentials, hashes, upstream response metadata or SQL messages in logs.
    }
    return respond(503, { error: "integration_unavailable" });
  };
}

function keyDenied(status: "denied" | "rate_limited") {
  return status === "rate_limited"
    ? respond(429, { error: "rate_limited" }, { "retry-after": "60" })
    : respond(401, { error: "invalid_credential" });
}

async function operationRequest(
  request: Request,
  url: URL,
  action: "enrol" | "report",
) {
  if (action === "report") {
    const course = url.searchParams.get("course_id");
    return url.searchParams.size === 1 && course && cursorPattern.test(course)
      ? { p_course_id: course, p_participant_id: null }
      : null;
  }
  if (
    url.search ||
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/json"
  ) {
    return null;
  }
  try {
    const payload = await boundedJson(request, 512);
    if (!payload || typeof payload !== "object" || Array.isArray(payload))
      return null;
    const { course_id, participant_id } = payload as Record<string, unknown>;
    return Object.keys(payload).length === 2 &&
      typeof course_id === "string" &&
      cursorPattern.test(course_id) &&
      typeof participant_id === "string" &&
      participantPattern.test(participant_id)
      ? { p_course_id: course_id, p_participant_id: participant_id }
      : null;
  } catch {
    return null;
  }
}
