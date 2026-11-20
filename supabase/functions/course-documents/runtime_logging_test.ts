import {logRuntimeFailure, runtimeDiagnostic,} from "../../../deploy/hostinger/selfhost/runtime/safe-log.ts";

Deno.test("worker fetch failure containing a private capability URL never enters diagnostic logs", async () => {
    const token = "fictional-private-calendar-capability-29";
    const request = new Request(
        `https://example.invalid/functions/v1/calendar-feed?token=${token}`,
    );
    const worker = {
        fetch: async (_request: Request) => {
            throw new TypeError(`Failed to fetch ${request.url}`);
        },
    };
    const logs: string[] = [];
    try {
        await worker.fetch(request);
    } catch (error) {
        logRuntimeFailure(
            "worker_fetch_failed",
            error,
            undefined,
            (line) => logs.push(line),
        );
    }
    if (
        logs.length !== 1 || logs[0].includes(token) ||
        logs[0].includes("https:") || logs[0].includes("token=")
    ) throw new Error("Private capability appeared in diagnostic output");
    const diagnostic = JSON.parse(logs[0]);
    if (
        diagnostic.event !== "worker_fetch_failed" ||
        diagnostic.error_class !== "TypeError"
    ) throw new Error("Useful fixed event/class missing");
});
Deno.test("untrusted error names and references cannot smuggle private fields into logs", () => {
    const error = new Error("private content");
    error.name = "https://example.invalid/?token=private";
    const text = runtimeDiagnostic(
        "request_handler_failed",
        error,
        "private-token",
    );
    if (
        text.includes("private") || text.includes("https:") ||
        JSON.parse(text).error_class !== "UnknownError"
    ) throw new Error("Untrusted diagnostics were retained");
});