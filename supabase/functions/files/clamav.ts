/**
 * Edge ClamAV adapter using HTTPS gateway or private TCP. Bound upload/response bytes, time and signature age; failure must not mark a document clean.
 */
const encoder = new TextEncoder();
const MAX_SCAN_BYTES = 100 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4096;
const SIGNATURE_MAX_AGE = 14 * 86400000;
const nativeSignatureDate = /^[A-Z][a-z]{2} [A-Z][a-z]{2} [ 0-9][0-9] [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4}$/;

// Server-side HTTPS gateway configuration, never supplied by a browser upload.
export interface HttpsScannerConfig {
    url?: string;
    token?: string;
}

// Injection is for isolated protocol/deadline tests, never browser input.
// Replaceable transport/deadline boundary for isolated protocol tests.
type ScannerConnection = Pick<Deno.Conn, "read" | "write" | "close">;

interface ScannerDependencies {
    fetcher?: typeof fetch;
    connect?: (options: Deno.ConnectOptions) => Promise<ScannerConnection>;
    timeoutMs?: number;
}

// Validate response format and signature date; a version string alone does not prove fresh signatures.
export function validateClamAvVersion(value: unknown, now = Date.now()): string {
    if (
        typeof value !== "string" || !value.startsWith("ClamAV ") ||
        value.length > 1024 ||
        [...value].some((character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        )
    ) throw new Error("scanner_version");
    const signatureDate = value.slice(value.lastIndexOf("/") + 1);
    // clamd VERSION uses ctime, which has no zone. The managed daemons run in
    // UTC so an operator's host zone must not change the scanner verdict.
    const stamp = Date.parse(nativeSignatureDate.test(signatureDate)
        ? signatureDate + " UTC"
        : signatureDate);
    const age = now - stamp;
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
        return {clean: verdict.clean, version: validateClamAvVersion(verdict.version)};
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
async function writeAll(conn: ScannerConnection, bytes: Uint8Array) {
    let at = 0;
    while (at < bytes.length) {
        const n = await conn.write(bytes.subarray(at));
        if (n === 0) throw new Error("scanner_write");
        at += n;
    }
}

// z-prefixed commands require a complete NUL-terminated reply.
async function readResult(conn: ScannerConnection) {
    const buffer = new Uint8Array(MAX_RESPONSE_BYTES);
    let length = 0;
    while (length < buffer.length) {
        const count = await conn.read(buffer.subarray(length));
        if (count === null) break;
        const terminator = buffer.subarray(length, length + count).indexOf(0);
        if (terminator !== -1) {
            if (terminator + 1 !== count) throw new Error("scanner_protocol");
            return new TextDecoder("utf-8", {fatal: true})
                .decode(buffer.subarray(0, length + terminator));
        }
        length += count;
    }
    throw new Error("scanner_protocol");
}

function closeConnection(conn?: ScannerConnection) {
    try {
        conn?.close();
    } catch { /* closed */ }
}

async function withScannerConnection<T>(
    hostname: string,
    port: number,
    timeoutMs: number,
    dependencies: ScannerDependencies,
    exchange: (conn: ScannerConnection) => Promise<T>,
): Promise<T> {
    const controller = new AbortController();
    let conn: ScannerConnection | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error("scanner_timeout"));
            controller.abort();
        }, timeoutMs);
    });
    const operation = async () => {
        const socket = await (dependencies.connect ?? Deno.connect)({
            hostname,
            port,
            signal: controller.signal,
        });
        // Retire late connections even when a runtime cannot cancel Deno.connect.
        if (controller.signal.aborted) {
            closeConnection(socket);
            throw new Error("scanner_timeout");
        }
        conn = socket;
        return await exchange(conn);
    };
    try {
        return await Promise.race([deadline, operation()]);
    } finally {
        clearTimeout(timer);
        closeConnection(conn);
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
    const timeoutMs = dependencies.timeoutMs ?? 30000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) {
        throw new Error("scanner_configuration");
    }
    const version = await withScannerConnection(host, port, Math.min(timeoutMs, 3000), dependencies, async (conn) => {
        await writeAll(conn, encoder.encode("zVERSION\0"));
        return validateClamAvVersion(await readResult(conn));
    });
    return await withScannerConnection(host, port, timeoutMs, dependencies, async (conn) => {
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
        if (result.endsWith(" FOUND")) return {clean: false, version};
        if (result !== "stream: OK") {
            throw new Error("scanner_unavailable_or_limit");
        }
        return {clean: true, version};
    });
}
