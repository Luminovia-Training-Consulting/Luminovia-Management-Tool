import {createCourseDocumentHandler} from "./handler.ts";

Deno.test(
    "own passport binds one server timestamp across reauthorization and rejects a browser subject",
    async () => {
        const args: Record<string, unknown>[] = [];
        let storageCalls = 0;
        const handler = createCourseDocumentHandler({
            origins: ["https://portal.example.invalid"],
            authenticate: async () => true,
            rpc: async (_token, name, value) => {
                assert(name === "own_qualification_passport");
                args.push(value);
                return {
                    data: {data: {locale: value.p_locale}, hash: "a".repeat(64)},
                    error: null,
                };
            },
            download: async () => {
                storageCalls++;
                return new Uint8Array();
            },
            render: async () => new TextEncoder().encode("%PDF-fictional"),
        });
        const response = await handler(
            request({kind: "qualification_passport", locale: "en"}),
        );
        assert(response.status === 200);
        assert(response.headers.get("cache-control")?.includes("no-store"));
        assert(
            args.length === 2 && JSON.stringify(args[0]) === JSON.stringify(args[1]),
        );
        assert(Object.keys(args[0]).sort().join(",") === "p_as_of,p_locale");
        assert(Math.abs(Date.now() - Date.parse(String(args[0].p_as_of))) < 10000);
        assert(storageCalls === 0);
        assert(
            (
                await handler(
                    request({
                        kind: "qualification_passport",
                        locale: "de",
                        user_id: id,
                    }),
                )
            ).status === 400,
        );
        assert(
            (await handler(request({kind: "qualification_passport", locale: "fr"})))
                .status === 400,
        );
    },
);
const id = "52b7ddee-2166-485a-bcee-04d0eea958d1",
    origin = "https://portal.example.invalid";

function assert(value: unknown, message = "Assertion failed"): asserts value {
    if (!value) throw new Error(message);
}

function request(body: unknown, headers: Record<string, string> = {}) {
    return new Request("https://backend.example.invalid/course-documents", {
        method: "POST",
        headers: {
            Origin: origin,
            Authorization: "Bearer fictional-token",
            "Content-Type": "application/json",
            ...headers,
        },
        body: JSON.stringify(body),
    });
}

function fixture() {
    let authCalls = 0,
        rpcCalls = 0;
    const state = {
        active: true,
        revoked: false,
        changed: false,
        unsupported: false,
        calls: [] as string[],
    };
    const handler = createCourseDocumentHandler({
        origins: [origin],
        authenticate: async () => {
            authCalls++;
            return state.active;
        },
        rpc: async (_token, name, args) => {
            rpcCalls++;
            state.calls.push(name);
            return {
                data: state.revoked
                    ? null
                    : {
                        id: args.p_id ?? args.p_claim_id ?? id,
                        version: state.changed && rpcCalls > 1 ? 2 : 1,
                    },
                error: null,
            };
        },
        download: async () => new Uint8Array(),
        render: async () => {
            if (state.unsupported) throw new Error("unsupported_glyph");
            return new TextEncoder().encode("%PDF-1.7\nfictional");
        },
    });
    return {
        handler,
        state,
        authCalls: () => authCalls,
        rpcCalls: () => rpcCalls,
    };
}

Deno.test(
    "course PDFs require exact origin, method and actual Auth before reading data",
    async () => {
        const f = fixture();
        assert(
            (
                await f.handler(
                    request(
                        {kind: "completion", id},
                        {
                            Origin: "https://foreign.invalid",
                        },
                    ),
                )
            ).status === 403,
        );
        f.state.active = false;
        assert(
            (await f.handler(request({kind: "completion", id}))).status === 401,
        );
        assert(f.rpcCalls() === 0);
    },
);
Deno.test(
    "completion PDF rechecks actual Auth and same authorised facts after rendering",
    async () => {
        const f = fixture();
        const response = await f.handler(request({kind: "completion", id}));
        assert(response.status === 200);
        assert(response.headers.get("content-type") === "application/pdf");
        assert(response.headers.get("cache-control") === "no-store, private");
        assert((await response.text()).startsWith("%PDF"));
        assert(f.authCalls() === 2 && f.rpcCalls() === 2);
    },
);
Deno.test(
    "changed or revoked facts fail closed and never release PDF bytes",
    async () => {
        const f = fixture();
        f.state.changed = true;
        const response = await f.handler(request({kind: "completion", id}));
        assert(response.status === 403);
        assert(!(await response.text()).includes("%PDF"));
    },
);
Deno.test(
    "financial kinds dispatch only reviewed caller-bound RPC argument shapes",
    async () => {
        const f = fixture();
        assert(
            (await f.handler(request({kind: "assignment_confirmation", id})))
                .status === 200,
        );
        assert(f.state.calls.every((name) => name === "assignment_confirmation"));
        assert(
            (
                await f.handler(
                    request({
                        kind: "earnings_statement",
                        from: "2026-11-01",
                        until: "2026-12-01",
                        all: false,
                    }),
                )
            ).status === 200,
        );
        assert(new Set<string>(f.state.calls).has("finance_statement"));
        assert(
            (await f.handler(request({kind: "completion", id, user_id: id})))
                .status === 400,
        );
    },
);
Deno.test(
    "unsupported glyphs return an explicit safe error without silent name alteration",
    async () => {
        const f = fixture();
        f.state.unsupported = true;
        const response = await f.handler(request({kind: "completion", id}));
        assert(response.status === 422);
        assert((await response.json()).error === "unsupported_glyph");
    },
);
Deno.test(
    "exam PDF bytes require exact scanned version and a second current course authorization",
    async () => {
        const bytes = new TextEncoder().encode("%PDF-1.7 fictional exam");
        const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
            .map((value) => value.toString(16).padStart(2, "0")).join("");
        let calls = 0;
        const handler = createCourseDocumentHandler({
            origins: [origin],
            authenticate: async () => true,
            rpc: async (_token, name, args) => {
                assert(name === "course_document_access");
                assert(args.p_kind === "exam" && args.p_id === id);
                calls++;
                return {
                    data: {
                        object_path: "clean/exam-version",
                        name: "fictional-exam.pdf",
                        mime_type: "application/pdf",
                        sha256: digest,
                    },
                    error: null,
                };
            },
            download: async () => bytes,
            render: async () => { throw new Error("unexpected_render"); },
        });
        const response = await handler(request({kind: "exam", id}));
        assert(response.status === 200);
        assert((await response.text()) === "%PDF-1.7 fictional exam");
        assert(calls === 2);

        let revokedCalls = 0;
        const revoked = createCourseDocumentHandler({
            origins: [origin],
            authenticate: async () => true,
            rpc: async () => ({
                data: ++revokedCalls === 1 ? {
                    object_path: "clean/exam-version",
                    name: "fictional-exam.pdf",
                    mime_type: "application/pdf",
                    sha256: digest,
                } : null,
                error: null,
            }),
            download: async () => bytes,
            render: async () => { throw new Error("unexpected_render"); },
        });
        const denied = await revoked(request({kind: "exam", id}));
        assert(denied.status === 403);
        assert((await denied.json()).error === "document_changed_or_revoked");
    },
);

Deno.test(
    "resource downloads bind exact clean bytes to hash and recheck current membership",
    async () => {
        const bytes = new TextEncoder().encode("fictional reviewed bytes");
        const digest = [
            ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        ]
            .map((x) => x.toString(16).padStart(2, "0"))
            .join("");
        let calls = 0;
        const handler = createCourseDocumentHandler({
            origins: [origin],
            authenticate: async () => true,
            rpc: async () => {
                calls++;
                return {
                    data: {
                        object_path: "clean/scoped",
                        name: "safe.txt",
                        mime_type: "text/plain",
                        sha256: digest,
                    },
                    error: null,
                };
            },
            download: async () => bytes,
            render: async () => {
                throw new Error("unexpected_render");
            },
        });
        const response = await handler(request({kind: "resource", id}));
        assert(response.status === 200);
        assert((await response.text()) === "fictional reviewed bytes");
        assert(calls === 2);
    },
);

Deno.test(
    "academy resource download stops releasing bytes when access ends during Storage read",
    async () => {
        const bytes = new TextEncoder().encode("Fictional scanned course handout");
        const sha256 = [
            ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        ]
            .map((v) => v.toString(16).padStart(2, "0"))
            .join("");
        for (const revoke of ["licence", "course-role"]) {
            let current = true;
            const events: string[] = [];
            const objectPath = "fictional/exact-scanned-version";
            const handler = createCourseDocumentHandler({
                origins: [origin],
                authenticate: async (token) => {
                    assert(token === "fictional-token");
                    events.push("auth");
                    return current || revoke === "course-role";
                },
                rpc: async (token, name, args) => {
                    assert(token === "fictional-token");
                    assert(name === "course_document_access");
                    assert(
                        JSON.stringify(args) ===
                            JSON.stringify({ p_kind: "resource", p_id: id }),
                    );
                    events.push("resolve");
                    return {
                        data: current
                            ? {
                                object_path: objectPath,
                                sha256,
                                name: "Handout.txt",
                                mime_type: "text/plain",
                            }
                            : null,
                        error: null,
                    };
                },
                download: async (path) => {
                    assert(path === objectPath);
                    events.push("download");
                    current = false;
                    return bytes;
                },
                render: async () => {
                    throw new Error("unexpected_render");
                },
            });
            const response = await handler(request({ kind: "resource", id }));
            assert(response.status === 403);
            assert(response.headers.get("cache-control")?.includes("no-store"));
            assert(!response.headers.has("content-disposition"));
            const error = revoke === "licence"
                ? "document_unavailable"
                : "document_changed_or_revoked";
            assert((await response.json()).error === error);
            const expectedEvents = revoke === "licence"
                ? "auth,resolve,download,auth"
                : "auth,resolve,download,auth,resolve";
            assert(events.join(",") === expectedEvents);
        }
    },
);

Deno.test(
    "request resources dispatch exact request/version and recheck membership after protected byte read",
    async () => {
        const bytes = new TextEncoder().encode("Fictional exact request file");
        const sha256 = [
            ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        ]
            .map((v) => v.toString(16).padStart(2, "0"))
            .join("");
        let calls = 0;
        let revoked = false;
        const handler = createCourseDocumentHandler({
            origins: [origin],
            authenticate: async () => true,
            rpc: async (_token, name, args) => {
                assert(name === "client_request_document_access");
                assert(args.p_request_id === id && args.p_version_id === id);
                calls++;
                return {
                    data: revoked
                        ? null
                        : {
                            object_path: "fictional/request.txt",
                            sha256,
                            name: "Request.txt",
                            mime_type: "text/plain",
                        },
                    error: null,
                };
            },
            download: async () => bytes,
            render: async () => {
                throw new Error("must_not_render_resource");
            },
        });
        const response = await handler(
            request({kind: "request_resource", request_id: id, id}),
        );
        assert(response.status === 200);
        assert(
            new TextDecoder().decode(await response.arrayBuffer()) ===
            "Fictional exact request file",
        );
        assert(calls === 2);
        revoked = true;
        assert(
            (await handler(request({kind: "request_resource", request_id: id, id})))
                .status === 403,
        );
        assert(
            (await handler(request({kind: "request_resource", id}))).status === 400,
        );
    },
);

Deno.test(
    "wiki attachment exact bytes recheck revision access after Storage read",
    async () => {
        const bytes = new TextEncoder().encode("fictional wiki attachment");
        const digest = [
            ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        ]
            .map((v) => v.toString(16).padStart(2, "0"))
            .join("");
        let revoked = false,
            calls = 0;
        const handler = createCourseDocumentHandler({
            origins: [origin],
            authenticate: async () => true,
            rpc: async (_token, name, args) => {
                assert(name === "wiki_attachment_access");
                assert(args.p_id === id);
                calls++;
                return {
                    data: revoked
                        ? null
                        : {
                            version_id: id,
                            sha256: digest,
                            name: "wiki.txt",
                            mime_type: "text/plain",
                        },
                    error: null,
                };
            },
            wikiPath: async (attachmentId, versionId) => {
                assert(attachmentId === id && versionId === id);
                return "fictional/wiki.txt";
            },
            download: async (path) => {
                assert(path === "fictional/wiki.txt");
                revoked = true;
                return bytes;
            },
            render: async () => {
                throw new Error("not a pdf");
            },
        });
        const result = await handler(request({kind: "wiki_resource", id}));
        assert(result.status === 403 && calls === 2);
        assert(
            (await handler(request({kind: "wiki_resource", id, user_id: id})))
                .status === 400,
        );
    },
);

Deno.test(
    "wiki private path resolves only after caller authorization and never appears in output",
    async () => {
        const bytes = new TextEncoder().encode("verified fictional wiki bytes");
        const sha256 = [
            ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        ]
            .map((x) => x.toString(16).padStart(2, "0"))
            .join("");
        let permitted = false,
            resolutions = 0,
            reads = 0;
        const handler = createCourseDocumentHandler({
            origins: [origin],
            authenticate: async () => true,
            rpc: async () => {
                reads++;
                return {
                    data: permitted
                        ? {
                            version_id: id,
                            sha256,
                            name: "lesson.txt",
                            mime_type: "text/plain",
                        }
                        : null,
                    error: null,
                };
            },
            wikiPath: async () => {
                resolutions++;
                return "private-owner-uuid/never-disclose";
            },
            download: async (path) => {
                assert(path === "private-owner-uuid/never-disclose");
                return bytes;
            },
            render: async () => {
                throw new Error("unexpected");
            },
        });
        assert(
            (await handler(request({kind: "wiki_resource", id}))).status === 403,
        );
        assert(resolutions === 0);
        permitted = true;
        const result = await handler(request({kind: "wiki_resource", id}));
        assert(result.status === 200);
        assert((await result.text()) === "verified fictional wiki bytes");
        assert(!JSON.stringify([...result.headers]).includes("private-owner-uuid"));
        assert(Number(resolutions) === 1 && reads === 3);
    },
);

Deno.test("course chat download checks the exact version, scan hash and post-storage authorization", async () => {
    const bytes = new TextEncoder().encode("Fictional course file");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((value) => value.toString(16).padStart(2, "0")).join("");
    const version = "52b7ddee-2166-485a-bcee-04d0eea958d2";
    let revoked = false;
    let revokeDuringRead = false;
    let downloadCount = 0;
    let downloadBytes = bytes;
    const handler = createCourseDocumentHandler({
        origins: [origin],
        authenticate: async () => true,
        rpc: async (_token, name, args) => {
            assert(name === "course_chat_attachment_access");
            assert(args.p_message_id === id);
            return {
                data: revoked ? null : {
                    version_id: version, size_bytes: bytes.length,
                    object_path: "fictional/exact-chat-file", name: "exercise.txt",
                    sha256: hash, mime_type: "text/plain",
                },
                error: null,
            };
        },
        download: async (path) => {
            downloadCount++;
            assert(path === "fictional/exact-chat-file");
            if (revokeDuringRead) revoked = true;
            return downloadBytes;
        },
        render: async () => { throw new Error("Course chat does not render documents"); },
    });
    const attachment = {kind: "course_chat_attachment", id, version_id: version};
    const ok = await handler(request(attachment));
    assert(ok.status === 200 && await ok.text() === "Fictional course file");
    assert(ok.headers.get("cache-control") === "no-store, private");
    assert((await handler(request({...attachment, version_id: id}))).status === 403);
    assert((await handler(request({...attachment, organisation_id: id}))).status === 400);
    assert(downloadCount === 1);
    downloadBytes = new Uint8Array(bytes.length);
    assert((await handler(request(attachment))).status === 503);
    downloadBytes = bytes;
    revokeDuringRead = true;
    const denied = await handler(request(attachment));
    assert(denied.status === 403 && !(await denied.text()).includes("Fictional course file"));
});
