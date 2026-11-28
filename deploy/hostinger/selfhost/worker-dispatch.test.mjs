import assert from "node:assert/strict";
import test from "node:test";
import {dispatchToWorker} from "./runtime/worker-dispatch.mjs";

const retired = new Error("worker retired");
const endpoint = "https://portal.example/files";

function dispatchOptions(createWorker, retries) {
    return {
        createWorker,
        prepareRequest: (request) => new Request(request),
        isRetired: (error) => error === retired,
        onRetry: (retriesLeft) => retries.push(retriesLeft),
        maxRetries: 3,
    };
}

function streamedUpload() {
    const request = new Request(endpoint, {
        method: "POST",
        duplex: "half",
        body: new ReadableStream({
            start(controller) {
                controller.enqueue(new TextEncoder().encode("upload "));
                controller.enqueue(new TextEncoder().encode("bytes"));
                controller.close();
            },
        }),
    });
    request.clone = () => assert.fail("upload must not be teed for retry");
    return request;
}

test("a streamed upload survives a worker acquisition race without cloning the body", async () => {
    const retries = [];
    let acquisitions = 0;
    const request = streamedUpload();
    const response = await dispatchToWorker(request, dispatchOptions(async () => {
        if (++acquisitions === 1) throw retired;
        return {
            async fetch(forwarded) {
                assert.equal(forwarded.method, "POST");
                return new Response(await forwarded.text());
            },
        };
    }, retries));
    assert.equal(await response.text(), "upload bytes");
    assert.equal(acquisitions, 2);
    assert.deepEqual(retries, [3]);
});

test("a retirement after forwarding an upload does not replay the stream", async () => {
    const retries = [];
    let dispatched = 0;
    await assert.rejects(dispatchToWorker(streamedUpload(), dispatchOptions(async () => ({
        async fetch(forwarded) {
            dispatched += 1;
            assert.equal(await forwarded.text(), "upload bytes");
            throw retired;
        },
    }), retries)), (error) => error === retired);
    assert.equal(dispatched, 1);
    assert.deepEqual(retries, []);
});

test("bodyless requests still get bounded retirement retries after handoff", async () => {
    const retries = [];
    let dispatched = 0;
    await assert.rejects(dispatchToWorker(new Request(endpoint), dispatchOptions(async () => ({
        async fetch(forwarded) {
            dispatched += 1;
            assert.equal(forwarded.url, endpoint);
            assert.equal(forwarded.body, null);
            throw retired;
        },
    }), retries)), (error) => error === retired);
    assert.equal(dispatched, 4);
    assert.deepEqual(retries, [3, 2, 1]);
});

test("other worker errors do not retry", async () => {
    const retries = [];
    const failure = new Error("worker failed");
    await assert.rejects(dispatchToWorker(new Request(endpoint), dispatchOptions(async () => {
        throw failure;
    }, retries)), (error) => error === failure);
    assert.deepEqual(retries, []);
});
