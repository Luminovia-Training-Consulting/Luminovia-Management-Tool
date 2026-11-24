import assert from "node:assert/strict";
import { scan } from "./clamav.ts";

const encode = (text: string) => new TextEncoder().encode(text);
const bytes = encode("Fictional scan input");
const version = () => "ClamAV 1.4.3/12345/" + new Date().toUTCString();

function connection(...replies: Uint8Array[]) {
    const writes: Uint8Array[] = [];
    let closed = false;
    return {
        writes,
        async read(buffer: Uint8Array) {
            const reply = replies.shift();
            if (!reply) return null;
            const length = Math.min(reply.length, buffer.length);
            buffer.set(reply.subarray(0, length));
            if (length < reply.length) replies.unshift(reply.subarray(length));
            return length;
        },
        async write(buffer: Uint8Array) {
            writes.push(buffer.slice());
            return buffer.length;
        },
        close() { closed = true; },
        get closed() { return closed; },
    };
}

Deno.test("native ClamAV handles split framed replies and preserves clean and rejected verdicts", async () => {
    for (const [reply, clean] of [["OK", true], ["Fixture FOUND", false]] as const) {
        const expected = version();
        const versionSocket = connection(encode(expected), encode("\0"));
        const scanSocket = connection(encode("stream: "), encode(reply), encode("\0"));
        const sockets = [versionSocket, scanSocket];
        const result = await scan(bytes, "private-scanner.invalid", 3310, {}, {
            connect: () => Promise.resolve(sockets.shift()!),
        });
        assert.deepEqual(result, { clean, version: expected });
        assert.deepEqual(versionSocket.writes, [encode("zVERSION\0")]);
        assert.deepEqual(scanSocket.writes, [
            encode("zINSTREAM\0"),
            new Uint8Array([0, 0, 0, bytes.length]),
            bytes,
            new Uint8Array(4),
        ]);
        assert.ok(versionSocket.closed && scanSocket.closed);
    }
});

Deno.test("native ClamAV refuses truncated, wrongly framed, oversized and non-clean results", async () => {
    for (const reply of [
        "stream: OK",
        "stream: OK\n",
        "stream: OK\0extra",
        "stream: " + "x".repeat(4096),
        "stream: Scan limit ERROR\0",
    ]) {
        const versionSocket = connection(encode(version() + "\0"));
        const scanSocket = connection(encode(reply));
        const sockets = [versionSocket, scanSocket];
        await assert.rejects(scan(bytes, "private-scanner.invalid", 3310, {}, {
            connect: () => Promise.resolve(sockets.shift()!),
        }), /^Error: scanner_(protocol|unavailable_or_limit)$/);
        assert.ok(versionSocket.closed && scanSocket.closed);
    }
    const truncatedVersion = connection(encode(version()));
    await assert.rejects(scan(bytes, "private-scanner.invalid", 3310, {}, {
        connect: () => Promise.resolve(truncatedVersion),
    }), /scanner_protocol/);
    assert.ok(truncatedVersion.closed);
});

Deno.test("native scanner deadline bounds connection setup and disposes a late socket", async () => {
    const pending = Promise.withResolvers<ReturnType<typeof connection>>();
    let signal: AbortSignal | undefined;
    await assert.rejects(scan(bytes, "private-scanner.invalid", 3310, {}, {
        timeoutMs: 10,
        connect: (options) => {
            signal = options.signal;
            return pending.promise;
        },
    }), /scanner_timeout/);
    assert.equal(signal?.aborted, true);
    const socket = connection();
    pending.resolve(socket);
    await pending.promise;
    assert.equal(socket.closed, true);
    assert.equal(socket.writes.length, 0);
});

Deno.test("native scan closes a connected socket when the verdict misses its deadline", async () => {
    const versionSocket = connection(encode(version() + "\0"));
    const pending = Promise.withResolvers<number | null>();
    const scanSocket = { ...connection(), read: () => pending.promise, close: () => pending.resolve(null) };
    const sockets = [versionSocket, scanSocket];
    await assert.rejects(scan(bytes, "private-scanner.invalid", 3310, {}, {
        timeoutMs: 20,
        connect: () => Promise.resolve(sockets.shift()!),
    }), /scanner_timeout/);
    assert.equal(await pending.promise, null);
});
