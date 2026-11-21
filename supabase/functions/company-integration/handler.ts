type Course = { id: string; title: string; time_zone: string };
type Lookup =
  | { status: "denied" | "rate_limited" }
  | { status: "ok"; items: Course[]; next_cursor: string | null };
type FindCourses = (input: {
  p_id: string;
  p_secret_hash: string;
  p_limit: number;
  p_after: string | null;
}) => Promise<Lookup>;

const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const cursorPattern = new RegExp(`^${uuid}$`);
const credentialPattern = new RegExp(`^Bearer lvi_(${uuid})_([0-9a-f]{64})$`);

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

/** Exposes one explicit operation. Native Auth, REST and Storage never accept integration keys. */
export function createCompanyIntegrationHandler(findCourses: FindCourses) {
  return async (request: Request) => {
    const url = new URL(request.url);
    if (
      !["/company-integration", "/functions/v1/company-integration"].includes(
        url.pathname,
      )
    ) {
      return respond(404, { error: "not_found" });
    }
    if (request.method !== "GET") {
      return respond(405, { error: "method_not_allowed" }, { allow: "GET" });
    }
    if (request.headers.has("origin")) {
      return respond(403, { error: "browser_origin_denied" });
    }
    const credential = credentialPattern.exec(
      request.headers.get("authorization") ?? "",
    );
    if (!credential) return respond(401, { error: "invalid_credential" });
    const params = url.searchParams;
    const limit = params.get("limit") ?? "25";
    const after = params.get("after");
    if (
      [...params.keys()].some((key) => !["limit", "after"].includes(key)) ||
      params.getAll("limit").length > 1 || params.getAll("after").length > 1 ||
      !/^([1-9]|[1-4][0-9]|50)$/.test(limit) ||
      (after !== null && !cursorPattern.test(after))
    ) {
      return respond(400, { error: "invalid_query" });
    }

    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(credential[2]),
      );
      const result = await findCourses({
        p_id: credential[1],
        p_secret_hash: Array.from(
          new Uint8Array(digest),
          (byte) => byte.toString(16).padStart(2, "0"),
        ).join(""),
        p_limit: Number(limit),
        p_after: after,
      });
      if (result.status === "denied") {
        return respond(401, { error: "invalid_credential" });
      }
      if (result.status === "rate_limited") {
        return respond(429, { error: "rate_limited" }, { "retry-after": "60" });
      }
      if (result.status === "ok") {
        return respond(200, {
          items: result.items,
          next_cursor: result.next_cursor,
        });
      }
    } catch {
      // Avoid storing credentials, hashes, upstream response metadata or SQL messages in logs.
    }
    return respond(503, { error: "integration_unavailable" });
  };
}
