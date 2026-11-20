/**
 * Edge ClamAV adapter using HTTPS gateway or private TCP. Bound upload/response bytes, time and signature age; failure must not mark a document clean.
 */
const encoder = new TextEncoder();
const MAX_SCAN_BYTES = 100 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4096;
const SIGNATURE_MAX_AGE = 14 * 86400000;

// Server-side HTTPS gateway configuration, never supplied by a browser upload.
export interface HttpsScannerConfig {
    url?: string;
    token?: string;
}

// Injection is for isolated protocol/deadline tests, never browser input.
// Replaceable transport/deadline boundary for isolated protocol tests.
interface ScannerDependencies {
    fetcher?: typeof fetch;
    timeoutMs?: number;
}

// Validate response format and signature date; a version string alone does not prove fresh signatures.
function validateVersion(value: unknown): string {
    if (
        typeof value !== "string" || !value.startsWith("ClamAV ") ||
        value.length > 1024 ||
        [...value].some((character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        )
    ) throw new Error("scanner_version");
    const stamp = Date.parse(value.slice(value.lastIndexOf("/") + 1));
    const age = Date.now() - stamp;
    if (!Number.isFinite(stamp) || age > SIGNATURE_MAX_AGE || age < -86400000) {
        throw new Error("scanner_definitions_stale");
    }
    return value;
}

// Accept only the server-configured HTTPS /scan endpoint without credentials or a query; redirects are rejected by the transport.
function httpsEndpoint(config: HttpsScannerConfig): URL {
    let endpoint: URL;
    try {
        if (!config.url || config.url !== config.url.trim()) throw new Error();
        endpoint = new URL(config.url);
    } catch {
        throw new Error("scanner_https_configuration");
    }
    if (
        endpoint.protocol !== "https:" || endpoint.pathname !== "/scan" ||
        endpoint.username || endpoint.password || endpoint.search ||
        endpoint.hash ||
        !config.token || !/^[A-Za-z0-9_-]{43,128}$/.test(config.token)
    ) throw new Error("scanner_https_configuration");
    return endpoint;
}

// Bound upload/response size, reject redirects, and terminate fetch/readers on completion or timeout.
async function scanHttps(
    bytes: Uint8Array,
    config: HttpsScannerConfig,
    dependencies: ScannerDependencies,
): Promise<{ clean: boolean; version: string }> {
    const endpoint = httpsEndpoint(config);
    if (!bytes.length || bytes.length > MAX_SCAN_BYTES) {
        throw new Error("scanner_size");
    }
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = dependencies.timeoutMs ?? 30000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) {
        throw new Error("scanner_https_configuration");
    }
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            controller.abort();
            void reader?.cancel().catch(() => {
            });
            reject(new Error("scanner_timeout"));
        }, timeoutMs);
    });
    const operation = async () => {
        const response = await (dependencies.fetcher ?? fetch)(endpoint, {
            method: "POST",
            headers: {
                Authorization: "Bearer " + config.token,
                "Content-Type": "application/octet-stream",
                Accept: "application/json",
            },
            body: new Uint8Array(bytes),
            redirect: "error",
            credentials: "omit",
            referrerPolicy: "no-referrer",
            cache: "no-store",
            signal: controller.signal,
        });
        if (controller.signal.aborted) {
            void response.body?.cancel().catch(() => {
            });
            throw new Error("scanner_timeout");
        }
        reader = response.body?.getReader();
        if (
            response.status !== 200 || response.redirected ||
            !/^application\/json(?:\s*;|$)/i.test(
                response.headers.get("content-type") ?? "",
            ) ||
            !reader
        ) throw new Error("scanner_response");
        const declaredLength = response.headers.get("content-length");
        if (
            declaredLength !== null &&
            (!/^\d+$/.test(declaredLength) ||
                Number(declaredLength) > MAX_RESPONSE_BYTES)
        ) {
            throw new Error("scanner_response_size");
        }
        const chunks: Uint8Array[] = [];
        let length = 0;
        while (true) {
            const {value, done} = await reader.read();
            if (done) break;
            length += value.length;
            if (length > MAX_RESPONSE_BYTES) throw new Error("scanner_response_size");
            chunks.push(value);
        }
        const body = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {
            body.set(chunk, offset);
            offset += chunk.length;
        }
        const result: unknown = JSON.parse(
            new TextDecoder("utf-8", {fatal: true}).decode(body),
        );
        if (!result || typeof result !== "object" || Array.isArray(result)) {
            throw new Error("scanner_response");
        }
        const verdict = result as { clean?: unknown; version?: unknown };
        if (typeof verdict.clean !== "boolean") throw new Error("scanner_response");
        return {clean: verdict.clean, version: validateVersion(verdict.version)};
    };
    try {
        return await Promise.race([operation(), deadline]);
    } catch {
        // Network errors can contain request URLs; never forward provider details.
        throw new Error("scanner_unavailable");
    } finally {
        clearTimeout(timer);
        controller.abort();
        void reader?.cancel().catch(() => {
        });
    }
}

// Write the complete protocol block even when TCP writes accept only part of it.
async function writeAll(conn: Deno.Conn, bytes: Uint8Array) {
    let at = 0;
    while (at < bytes.length) {
        const n = await conn.write(bytes.subarray(at));
        if (n === 0) throw new Error("scanner_write");
        at += n;
    }
}

// Read only the bounded clamd response through its protocol terminator.
async function readResult(conn: Deno.Conn) {
    let result = "";
    const buffer = new Uint8Array(4096);
    while (result.length < 4096) {
        const n = await conn.read(buffer);
        if (n === null) break;
        result += new TextDecoder().decode(buffer.subarray(0, n));
        if (result.includes("\0") || result.includes("\n")) break;
    }
    return result.trim().replace(/\0/g, "");
}

// Query clamd's current signature version through a separate bounded connection.
async function scannerVersion(host: string, port: number) {
    const conn = await Deno.connect({hostname: host, port});
    const timeout = setTimeout(() => {
        try {
            conn.close();
        } catch { /* closed */
        }
    }, 3000);
    try {
        await writeAll(conn, encoder.encode("zVERSION\0"));
        return validateVersion(await readResult(conn));
    } finally {
        clearTimeout(timeout);
        try {
            conn.close();
        } catch { /* closed */
        }
    }
}

// Use only the configured transport and accept a complete, validated scan result.
export async function scan(
    bytes: Uint8Array,
    host: string,
    port = 3310,
    https: HttpsScannerConfig = {},
    dependencies: ScannerDependencies = {},
): Promise<{ clean: boolean; version: string }> {
    // A partial/empty HTTPS setting is a deployment error, never TCP fallback.
    if (https.url !== undefined || https.token !== undefined) {
        return await scanHttps(bytes, https, dependencies);
    }
    if (!bytes.length || bytes.length > MAX_SCAN_BYTES) {
        throw new Error("scanner_size");
    }
    if (!host) throw new Error("scanner_not_configured");
    const version = await scannerVersion(host, port);
    const conn = await Deno.connect({hostname: host, port});
    const timeout = setTimeout(() => {
        try {
            conn.close();
        } catch { /* closed */
        }
    }, 30000);
    try {
        await writeAll(conn, encoder.encode("zINSTREAM\0"));
        for (let at = 0; at < bytes.length; at += 65536) {
            const chunk = bytes.subarray(at, at + 65536);
            const prefix = new Uint8Array(4);
            new DataView(prefix.buffer).setUint32(0, chunk.length, false);
            await writeAll(conn, prefix);
            await writeAll(conn, chunk);
        }
        await writeAll(conn, new Uint8Array(4));
        const result = await readResult(conn);
        if (!result.startsWith("stream: ")) throw new Error("scanner_protocol");
        if (result.includes(" FOUND")) return {clean: false, version};
        if (result !== "stream: OK") {
            throw new Error("scanner_unavailable_or_limit");
        }
        return {clean: true, version};
    } finally {
        clearTimeout(timeout);
        try {
            conn.close();
        } catch { /* closed */
        }
    }
}