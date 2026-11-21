/** Protected document boundary: exact caller/origin, finite inputs and a second
 * current-authorization/facts read after rendering or private byte access. */
interface Dependencies {
    origins: string[];
    authenticate: (token: string) => Promise<boolean>;
    rpc: (
        token: string,
        name: string,
        args: Record<string, unknown>,
    ) => Promise<{ data: Record<string, unknown> | null; error: unknown }>;
    download: (path: string) => Promise<Uint8Array>;
    wikiPath?: (id: string, version: string) => Promise<string | null>;
    render: (kind: string, facts: Record<string, unknown>) => Promise<Uint8Array>;
}

const uuid = (value: unknown): value is string =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function boundedJson(request: Request) {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("invalid_request");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) {
            await reader.cancel();
            throw new Error("invalid_request");
        }
        chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
}

export function createCourseDocumentHandler(dependencies: Dependencies) {
    return async (request: Request): Promise<Response> => {
        const origin = request.headers.get("origin") ?? "";
        const headers: Record<string, string> = {
            "Cache-Control": "no-store, private",
            Pragma: "no-cache",
            Vary: "Origin",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        };
        const json = (status: number, error: string) =>
            new Response(JSON.stringify({error}), {
                status,
                headers: {...headers, "Content-Type": "application/json"},
            });
        if (!dependencies.origins.includes(origin)) {
            return json(403, "origin_not_allowed");
        }
        Object.assign(headers, {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers":
                "authorization,apikey,content-type,x-client-info",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Expose-Headers": "Content-Disposition",
        });
        if (request.method === "OPTIONS") {
            return new Response(null, {status: 204, headers});
        }
        if (request.method !== "POST") return json(405, "method_not_allowed");
        const token = /^Bearer (\S+)$/.exec(
            request.headers.get("authorization") ?? "",
        )?.[1];
        if (!token || !(await dependencies.authenticate(token))) {
            return json(401, "authentication_required");
        }
        try {
            const body = await boundedJson(request);
            if (!body || typeof body !== "object" || Array.isArray(body)) {
                return json(400, "invalid_request");
            }
            const kind = body.kind;
            let name: string, args: Record<string, unknown>;
            if (
                kind === "qualification_passport" &&
                ["de", "en"].includes(body.locale) &&
                Object.keys(body).every((key) => ["kind", "locale"].includes(key))
            ) {
                name = "own_qualification_passport";
                // Capture server time once. Both permission/fact reads must receive the
                // same snapshot label; the database still evaluates current expiry.
                args = {p_locale: body.locale, p_as_of: new Date().toISOString()};
            } else if (
                ["resource", "exam", "completion", "attendance"].includes(kind) &&
                uuid(body.id) &&
                Object.keys(body).every((key) => ["kind", "id"].includes(key))
            ) {
                name = "course_document_access";
                args = {p_kind: kind, p_id: body.id};
            } else if (
                kind === "course_chat_attachment" &&
                uuid(body.id) &&
                uuid(body.version_id) &&
                (
                    (body.organisation_id === undefined && body.reason === undefined) ||
                    (uuid(body.organisation_id) && typeof body.reason === "string" &&
                        body.reason.trim().length >= 8 && body.reason.trim().length <= 300)
                ) &&
                Object.keys(body).every((key) =>
                    ["kind", "id", "version_id", "organisation_id", "reason"].includes(key),
                )
            ) {
                name = "course_chat_attachment_access";
                args = {
                    p_message_id: body.id,
                    p_version_id: body.version_id,
                    p_organisation_id: body.organisation_id ?? null,
                    p_reason: body.reason ?? null,
                };
            } else if (
                kind === "wiki_resource" &&
                uuid(body.id) &&
                Object.keys(body).every((key) => ["kind", "id"].includes(key))
            ) {
                name = "wiki_attachment_access";
                args = {p_id: body.id};
            } else if (
                kind === "request_resource" &&
                uuid(body.id) &&
                uuid(body.request_id) &&
                Object.keys(body).every((key) =>
                    ["kind", "id", "request_id"].includes(key),
                )
            ) {
                name = "client_request_document_access";
                args = {p_request_id: body.request_id, p_version_id: body.id};
            } else if (
                kind === "assignment_confirmation" &&
                uuid(body.id) &&
                Object.keys(body).every((key) => ["kind", "id"].includes(key))
            ) {
                name = "assignment_confirmation";
                args = {p_claim_id: body.id};
            } else if (
                kind === "earnings_statement" &&
                /^\d{4}-\d{2}-\d{2}$/.test(body.from) &&
                /^\d{4}-\d{2}-\d{2}$/.test(body.until) &&
                (body.all === undefined || typeof body.all === "boolean") &&
                Object.keys(body).every((key) =>
                    ["kind", "from", "until", "all"].includes(key),
                )
            ) {
                name = "finance_statement";
                args = {
                    p_from: body.from,
                    p_until: body.until,
                    p_all: body.all ?? false,
                };
            } else return json(400, "invalid_request");
            const first = await dependencies.rpc(token, name, args);
            if (first.error || !first.data) return json(403, "document_unavailable");
            let bytes: Uint8Array,
                mime = "application/pdf",
                filename = `luminovia-${kind}.pdf`;
            if (
                kind === "resource" ||
                kind === "exam" ||
                kind === "request_resource" ||
                kind === "wiki_resource" ||
                kind === "course_chat_attachment"
            ) {
                let objectPath: string | null = null;
                if (kind === "wiki_resource") {
                    if (!uuid(first.data.version_id) || !dependencies.wikiPath)
                        return json(403, "document_unavailable");
                    objectPath = await dependencies.wikiPath(
                        body.id,
                        first.data.version_id,
                    );
                } else if (typeof first.data.object_path === "string") {
                    objectPath = first.data.object_path;
                }
                if (kind === "course_chat_attachment" &&
                    (first.data.version_id !== body.version_id ||
                        !Number.isSafeInteger(first.data.size_bytes) ||
                        Number(first.data.size_bytes) < 1 ||
                        Number(first.data.size_bytes) > 100 * 1024 * 1024)) {
                    return json(403, "document_unavailable");
                }
                if (!objectPath || typeof first.data.sha256 !== "string")
                    return json(403, "document_unavailable");
                bytes = await dependencies.download(objectPath);
                const digest = [
                    ...new Uint8Array(
                        await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
                    ),
                ]
                    .map((value) => value.toString(16).padStart(2, "0"))
                    .join("");
                if (digest !== first.data.sha256 ||
                    (kind === "course_chat_attachment" && bytes.length !== first.data.size_bytes)) {
                    return json(503, "document_integrity_failed");
                }
                mime = String(first.data.mime_type ?? "application/octet-stream");
                filename = String(first.data.name ?? "course-resource")
                    .replace(/[^A-Za-z0-9._-]/g, "_")
                    .slice(0, 120);
            } else bytes = await dependencies.render(kind, first.data);
            // Re-check actual Auth and current database membership after potentially
            // slow storage/font work. Facts changing during rendering fail closed.
            if (!(await dependencies.authenticate(token))) {
                return json(403, "document_unavailable");
            }
            const final = await dependencies.rpc(token, name, args);
            if (
                final.error ||
                !final.data ||
                JSON.stringify(final.data) !== JSON.stringify(first.data)
            ) {
                return json(403, "document_changed_or_revoked");
            }
            return new Response(new Uint8Array(bytes), {
                status: 200,
                headers: {
                    ...headers,
                    "Content-Type": mime,
                    "Content-Disposition": `attachment; filename="${filename}"`,
                },
            });
        } catch (error) {
            if (error instanceof Error && error.message === "unsupported_glyph") {
                return json(422, "unsupported_glyph");
            }
            if (
                error instanceof SyntaxError ||
                (error instanceof Error && error.message === "invalid_request")
            ) {
                return json(400, "invalid_request");
            }
            return json(503, "document_unavailable");
        }
    };
}
