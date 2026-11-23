import {assertEquals} from "jsr:@std/assert@1.0.14";
import {readJobSource} from "./job-source.ts";

const original = {
    sha256: "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
    file_name: "source.pdf",
};
const path = `course-sources/${original.sha256}.pdf`;

Deno.test("job source checks permission before Storage and retrieves metadata only for availability", async () => {
    const calls: string[] = [];
    const deps = {
        select: () => Promise.resolve(null as typeof original | null),
        exists: (key: string) => { calls.push(key); return Promise.resolve(true); },
        download: () => Promise.reject(new Error("unexpected byte read")),
    };
    assertEquals(await readJobSource(true, deps), {status: 403});
    assertEquals(calls, []);
    assertEquals(await readJobSource(true, {...deps, select: () => Promise.resolve(original)}), {status: 204});
    assertEquals(calls, [path]);
});

Deno.test("job source refuses changed bytes and rechecks authority before delivering", async () => {
    let reads = 0;
    const deps = {
        select: () => Promise.resolve(++reads === 1 ? original : null),
        exists: () => Promise.resolve(true),
        download: (key: string) => {
            assertEquals(key, path);
            return Promise.resolve(new Blob(["a"]));
        },
    };
    assertEquals(await readJobSource(false, deps), {status: 403});
    const stable = {...deps, select: () => Promise.resolve(original)};
    assertEquals((await readJobSource(false, stable)).status, 200);
    assertEquals(await readJobSource(false, {...stable, download: () => Promise.resolve(new Blob(["b"]))}), {status: 409});
});
