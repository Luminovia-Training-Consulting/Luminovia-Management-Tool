/** Course document boundary regressions use fictional facts and injected Auth, RPC and Storage. */
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
        authUnavailable: false,
        revoked: false,
        changed: false,
        unsupported: false,
        calls: [] as string[],
    };
    const handler = createCourseDocumentHandler({
        origins: [origin],
        authenticate: async () => {
            authCalls++;
            if (state.authUnavailable) throw new Error("private provider detail");
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
// An Auth outage must return the protected response envelope before any fact lookup.
Deno.test("course documents return a no-store CORS error if Auth is unavailable", async () => {
    const f = fixture();
    f.state.authUnavailable = true;
    const response = await f.handler(request({kind: "completion", id}));
    assert(response.status === 503);
    assert(response.headers.get("access-control-allow-origin") === origin);
    assert(response.headers.get("cache-control") === "no-store, private");
    assert((await response.json()).error === "document_unavailable");
    assert(f.authCalls() === 1 && f.rpcCalls() === 0);
});
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
Deno.test("attendance CSV escapes spreadsheet formulas and checks the exact permission twice", async () => {
    const facts = {
        report_scope: "session",
        id,
        course: "+Fictional Course",
        time_zone: "Europe/Berlin",
        sessions: [{id, starts_at: "2026-11-01T08:00:00Z", ends_at: "2026-11-01T09:00:00Z"}],
        roster: [{
            user_id: id,
            name: '=DUMMY("Quoted", 1)',
            sessions: [{session_id: id, status: "excused", minutes: 0}],
        }],
    };
    let changed = false;
    let calls = 0;
    let rechecks = 0;
    const handler = createCourseDocumentHandler({
        origins: [origin],
        authenticate: async () => { rechecks++; return true; },
        rpc: async (_token, name, args) => {
            calls++;
            assert(name === "course_document_access");
            assert(JSON.stringify(args) === JSON.stringify({p_kind: "attendance", p_id: id}));
            return {data: changed && calls % 2 === 0 ? {...facts, roster: []} : facts, error: null};
        },
        download: async () => { throw new Error("No Storage read expected"); },
        render: async () => { throw new Error("No PDF render expected"); },
    });
    const response = await handler(request({kind: "attendance", id, format: "csv"}));
    assert(response.status === 200);
    assert(response.headers.get("content-type") === "text/csv; charset=utf-8");
    assert(response.headers.get("cache-control") === "no-store, private");
    assert(response.headers.get("content-disposition")?.endsWith('.csv"'));
    const csv = await response.text();
    assert(csv.includes('"\'+Fictional Course"'));
    assert(csv.includes('"\'=DUMMY(""Quoted"", 1)"'));
    assert(csv.includes('"excused","","","0"'));
    assert(calls === 2 && rechecks === 2);
    changed = true;
    const conflict = await handler(request({kind: "attendance", id, format: "csv"}));
    assert(conflict.status === 403);
    assert(!(await conflict.text()).includes("Fictional Course"));
    assert((await handler(request({kind: "attendance", id, format: "xlsx"}))).status === 400);
    assert((await handler(request({kind: "completion", id, format: "csv"}))).status === 400);
    const legacy = fixture();
    assert((await legacy.handler(request({kind: "attendance", id, format: "csv"}))).status === 403);
    assert((await legacy.handler(request({kind: "attendance", id}))).status === 200);
});
Deno.test("internal exact-session export uses one checked register for both formats", async () => {
    const facts = {
        report_scope: "session",
        id: "b977ffbe-0692-4854-8e33-65fc3cf17571",
        course: "Fictional Course",
        time_zone: "Europe/Berlin",
        sessions: [{id, starts_at: "2026-11-01T08:00:00Z", ends_at: "2026-11-01T09:00:00Z"}],
        roster: [{user_id: id, name: "Fictional Learner", sessions: [{session_id: id, status: "excused", minutes: 0}]}],
    };
    let requested = facts;
    let reads = 0;
    let renders = 0;
    const handler = createCourseDocumentHandler({
        origins: [origin],
        authenticate: async () => true,
        rpc: async (_token, name, args) => {
            reads++;
            assert(name === "course_document_access" && args.p_kind === "attendance_session" && String(args.p_id).toLowerCase() === id);
            return {data: requested, error: null};
        },
        download: async () => { throw new Error("No Storage read expected"); },
        render: async (kind, suppliedFacts) => {
            renders++;
            assert(kind === "attendance" && suppliedFacts === facts);
            return new TextEncoder().encode("%PDF-1.7\nfictional");
        },
    });
    const csv = await handler(request({kind: "attendance_session", id, format: "csv"}));
    assert(csv.status === 200 && csv.headers.get("content-type") === "text/csv; charset=utf-8");
    assert((await csv.text()).includes('"Fictional Learner","excused"'));
    const pdf = await handler(request({kind: "attendance_session", id: id.toUpperCase()}));
    assert(pdf.status === 200 && (await pdf.text()).startsWith("%PDF-"));
    assert(reads === 4 && renders === 1);
    requested = {...facts, sessions: [{...facts.sessions[0], id: facts.id}]};
    assert((await handler(request({kind: "attendance_session", id}))).status === 403);
    requested = {...facts, report_scope: "course"};
    assert((await handler(request({kind: "attendance_session", id, format: "csv"}))).status === 403);
    assert(renders === 1);
});
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

Deno.test("administrative download receipts contain only verified identifiers", async () => {
    const actor = "52b7ddee-2166-485a-bcee-04d0eea958d4";
    const bytes = new TextEncoder().encode("Fictional attachment");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((value) => value.toString(16).padStart(2, "0")).join("");
    const sequence: string[] = [];
    let available = true;
    let authorised = true;
    let receiptAvailable = true;
    const handler = createCourseDocumentHandler({
        origins: [origin],
        authenticate: async () => {
            sequence.push("authenticate");
            return authorised ? actor : false;
        },
        rpc: async () => {
            sequence.push("resolve");
            return {data: {sha256: hash, name: "Private filename.txt",
                mime_type: "text/plain", object_path: "fictional/exact-private-file"}, error: null};
        },
        download: async () => {
            sequence.push("read");
            if (!available) throw new Error("resource_unavailable");
            return bytes;
        },
        recordDownload: async (loggedActor, resource) => {
            assert(loggedActor === actor && resource === id);
            sequence.push("receipt");
            if (!receiptAvailable) throw new Error("document_unavailable");
        },
        render: async () => { throw new Error("Unexpected render"); },
    });
    const file = request({kind: "resource", id});
    assert((await handler(file)).status === 200);
    assert(sequence.join(",") === "authenticate,resolve,read,authenticate,resolve,receipt");

    sequence.length = 0;
    available = false;
    assert((await handler(request({kind: "resource", id}))).status === 503);
    assert(!sequence.includes("receipt"));

    sequence.length = 0;
    available = true;
    authorised = false;
    assert((await handler(request({kind: "resource", id}))).status === 401);
    assert(!sequence.includes("receipt"));

    authorised = true;
    receiptAvailable = false;
    const failure = await handler(request({kind: "resource", id}));
    assert(failure.status === 503);
    assert(!(await failure.text()).includes("Fictional attachment"));
});

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
        authenticate: async () => id,
        recordDownload: async () => { throw new Error("Private chat must stay out of the activity journal"); },
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

Deno.test("retained files require exact scope and are audited only after byte verification", async () => {
    const bytes = new TextEncoder().encode("Fictional retained exam");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((value) => value.toString(16).padStart(2, "0")).join("");
    const version = "52b7ddee-2166-485a-bcee-04d0eea958d2";
    const company = "52b7ddee-2166-485a-bcee-04d0eea958d3";
    const course = "52b7ddee-2166-485a-bcee-04d0eea958d4";
    const reason = "Fictional archived exam review";
    const facts = {
        version_id: version, size_bytes: bytes.length,
        name: "Fictional exam.pdf", sha256: hash, mime_type: "application/pdf",
    };
    const sequence: string[] = [];
    let denied = false, revokeDuringDownload = false, integrityFailure = false;
    const handler = createCourseDocumentHandler({
        origins: [origin],
        authenticate: async () => {
            sequence.push("auth");
            return true;
        },
        rpc: async (_token, name, args) => {
            assert(name === "retained_course_file_access");
            assert(args.p_organisation_id === company && args.p_run_id === course);
            assert(args.p_file_kind === "exam" && args.p_file_id === id);
            assert(args.p_version_id === version && args.p_reason === reason);
            assert(typeof args.p_record_access === "boolean");
            sequence.push(args.p_record_access ? "final audit" : "preflight");
            return denied ? {data: null, error: true} : {data: facts, error: null};
        },
        retainedPath: async (requestedVersion, requestedHash) => {
            sequence.push("path");
            assert(requestedVersion === version && requestedHash === hash);
            return "fictional/retained-exam";
        },
        download: async (path) => {
            sequence.push("storage");
            assert(path === "fictional/retained-exam");
            if (revokeDuringDownload) denied = true;
            return integrityFailure ? new Uint8Array(bytes.length) : bytes;
        },
        render: async () => { throw new Error("Retained files must return the scanned bytes"); },
    });
    const body = {
        kind: "retained_course_file", organisation_id: company, run_id: course,
        id, version_id: version, file_kind: "exam", reason,
    };
    const ok = await handler(request(body));
    assert(ok.status === 200 && await ok.text() === "Fictional retained exam");
    assert(ok.headers.get("Cache-Control") === "no-store, private");
    assert(ok.headers.get("Content-Disposition") === 'attachment; filename="Fictional_exam.pdf"');
    assert(sequence.splice(0).join(",") === "auth,preflight,path,storage,auth,final audit");

    assert((await handler(request({...body, object_path: "fictional/custom"}))).status === 400);
    assert((await handler(request({...body, reason: "short"}))).status === 400);
    assert(sequence.splice(0).join(",") === "auth,auth");

    denied = true;
    assert((await handler(request(body))).status === 403);
    assert(sequence.splice(0).join(",") === "auth,preflight");

    denied = false;
    integrityFailure = true;
    assert((await handler(request(body))).status === 503);
    assert(sequence.splice(0).join(",") === "auth,preflight,path,storage");

    integrityFailure = false;
    revokeDuringDownload = true;
    const revoked = await handler(request(body));
    assert(revoked.status === 403 && !(await revoked.text()).includes("Fictional retained exam"));
    assert(sequence.join(",") === "auth,preflight,path,storage,auth,final audit");
});

Deno.test("dedicated course PDFs use database branding and reject a changing issuer or request override", async () => {
    const brand = {
        name: "Fictional academy",
        short_name: "Academy",
        theme_color: "#1e5b61",
    };
    let calls = 0;
    let renderCalls = 0;
    let change = false;
    const handler = createCourseDocumentHandler({
        origins: [origin],
        authenticate: async () => true,
        rpc: async (_token, name, args) => {
            assert(name === "course_document_access");
            assert(Object.keys(args).sort().join(",") === "p_id,p_kind");
            calls++;
            return {
                data: { id, academy_pdf_brand: change && calls % 2 === 0
                    ? {...brand, name: "Changed issuer"} : brand },
                error: null,
            };
        },
        download: async () => { throw new Error("unexpected_download"); },
        render: async (kind, facts) => {
            renderCalls++;
            assert(kind === "completion");
            assert(facts.academy_pdf_brand === brand);
            return new TextEncoder().encode("%PDF-Fictional");
        },
    });
    const result = await handler(request({kind: "completion", id}));
    assert(result.status === 200);
    assert(result.headers.get("Content-Disposition") === 'attachment; filename="course-completion.pdf"');
    assert(calls === 2);
    change = true;
    const stale = await handler(request({kind: "completion", id}));
    assert(stale.status === 403);
    assert(!(await stale.text()).includes("%PDF"));
    const forged = await handler(request({kind: "completion", id, academy_pdf_brand: brand}));
    assert(forged.status === 400);
    assert(Number(calls) === 4 && renderCalls === 2);
});

Deno.test("private submissions use one exact service-resolved version and fail closed on revoked access", async () => {
    const version = "22715826-28c1-458a-8975-05bf4b916cd2";
    const bytes = new TextEncoder().encode("Fictional private submission");
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    let reads: Record<string, unknown>[] = [];
    let resolved = 0, downloaded = 0;
    let revoke = false, wrongVersion = false, wrongSize = false;
    const handler = createCourseDocumentHandler({
        origins: [origin],
        authenticate: async () => true,
        rpc: async (_token, name, args) => {
            assert(name === "course_submission_access");
            reads.push(args);
            return {
                data: revoke && args.p_record ? null : {
                    version_id: wrongVersion ? id : version,
                    name: "private-course.txt",
                    mime_type: "text/plain",
                    size_bytes: bytes.length + (wrongSize ? 1 : 0),
                    sha256: digest,
                },
                error: null,
            };
        },
        submissionPath: async (course, selected) => {
            resolved++;
            assert(course === id && selected === version);
            return "private/exact-version";
        },
        download: async (path) => {
            downloaded++;
            assert(path === "private/exact-version");
            return bytes;
        },
        render: async () => { throw new Error("Unexpected render"); },
    });
    const body = {kind: "participant_submission", id, version_id: version};
    const delivered = await handler(request(body));
    assert(delivered.status === 200);
    assert(await delivered.text() === "Fictional private submission");
    assert(delivered.headers.get("cache-control")?.includes("no-store"));
    assert(reads.length === 2 && reads[0].p_run_id === id && reads[0].p_version_id === version);
    assert(!reads[0].p_record && reads[1].p_record);
    revoke = true;
    reads = [];
    assert((await handler(request(body))).status === 403);
    wrongSize = true;
    assert((await handler(request(body))).status === 503);
    wrongVersion = true;
    assert((await handler(request(body))).status === 403);
    assert((await handler(request({...body, owner_id: id}))).status === 400);
    assert(resolved === 3 && downloaded === 3);
});

Deno.test("portfolio evidence binds the exact revision and never streams after revocation", async () => {
    const version = "77cb1012-7949-4b4e-bfb8-1d820c85b01d";
    const body = {kind: "portfolio_evidence", id, revision: 4, shared: true, version_id: version};
    const payload = new TextEncoder().encode("Fictional work");
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", payload))]
        .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    let revoked = false;
    let revokeDuringRead = false;
    let calls = 0;
    const handler = createCourseDocumentHandler({
        origins: ["https://portal.example.invalid"],
        authenticate: async () => id,
        rpc: async (_token, name, args) => {
            assert(name === "learning_portfolio_evidence_access");
            assert(args.p_id === id && args.p_revision === 4 && args.p_shared === true && args.p_version_id === version);
            return {data: revoked ? null : {
                version_id: version, name: "evidence.txt", mime_type: "text/plain",
                size_bytes: payload.byteLength, sha256: hash,
            }, error: null};
        },
        retainedPath: async (file, checksum) => {
            assert(file === version && checksum === hash);
            return "private-test-path";
        },
        download: async (path) => {
            assert(path === "private-test-path");
            calls++;
            if (revokeDuringRead) revoked = true;
            return payload;
        },
        render: async () => { throw new Error("Portfolio bytes must not be rendered"); },
        recordDownload: async () => { throw new Error("No administrative portfolio download journal"); },
    });
    const allowed = await handler(request(body));
    assert(allowed.status === 200 && await allowed.text() === "Fictional work");
    assert(allowed.headers.get("content-disposition") === 'attachment; filename="evidence.txt"');
    revokeDuringRead = true;
    const crossed = await handler(request(body));
    assert(crossed.status === 403);
    assert((await handler(request(body))).status === 403);
    assert((await handler(request({...body, shared: "true"}))).status === 400);
    assert((await handler(request({...body, revision: 31}))).status === 400);
    assert(calls === 2);
});
