import assert from "node:assert/strict";
import test from "node:test";
import {assertLocalQaMemory, localQaTempRoot} from "./runtime-qa-memory.mjs";

test("local Linux QA places snapshots and browser temporaries on disk", () => {
    const filesystem = (candidate) => ({type: candidate === "/ram" ? 0x01021994 : 0xef53});
    const fixture = {platform: "linux", statfs: filesystem, access() {}};
    assert.equal(localQaTempRoot({...fixture, preferred: "/ram"}), "/var/tmp");
    assert.equal(localQaTempRoot({...fixture, preferred: "/qa-disk"}), "/qa-disk");
    assert.throws(() => localQaTempRoot({
        ...fixture, preferred: "/ram", access() { throw new Error("not writable"); },
    }), /disk-backed temporary directory/);
});

test("local preflight rejects insufficient available memory and preserves CI or unreported hosts", () => {
    const low = () => "MemTotal: 32000000 kB\nMemAvailable: 2097152 kB\n";
    assert.throws(() => assertLocalQaMemory(3, {platform: "linux", ci: "", read: low}), /Linux reports 2\.0 GiB/);
    assert.doesNotThrow(() => assertLocalQaMemory(1.5, {platform: "linux", ci: "", read: low}));
    assert.doesNotThrow(() => assertLocalQaMemory(3, {platform: "linux", ci: "true", read: low}));
    assert.doesNotThrow(() => assertLocalQaMemory(3, {platform: "darwin", ci: "", read: low}));
    assert.doesNotThrow(() => assertLocalQaMemory(3, {platform: "linux", ci: "", read: () => ""}));
});
