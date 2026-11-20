import assert from "node:assert/strict";
import {PassThrough} from "node:stream";
import test from "node:test";
import {collectUtf8} from "./testing/utf8-stream.mjs";

test("collects supplementary Unicode characters split between UTF-8 chunks", async () => {
    const stream = new PassThrough();
    const result = collectUtf8(stream);
    const bytes = Buffer.from("before😀after", "utf8");
    const split = bytes.indexOf(Buffer.from("😀")) + 2;

    stream.write(bytes.subarray(0, split));
    stream.end(bytes.subarray(split));
    await new Promise((resolve) => stream.once("end", resolve));

    assert.equal(result(), "before😀after");
});