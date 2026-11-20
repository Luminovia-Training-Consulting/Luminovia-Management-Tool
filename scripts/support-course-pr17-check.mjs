/** Manual strict compatibility probe against one exact committed PR17 source.
 * Intentionally not named -db-tests: ordinary CI owns the synthetic optional
 * contract separately. A missing commit or course prerequisite is a real error,
 * never a skipped-success, and no uncommitted PR17 source is read or modified.
 */
import assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {readdir, readFile} from "node:fs/promises";
import {promisify} from "node:util";
import {withTestDatabase} from "./testing/database.mjs";
import {runSupportCourseRegistryChecks} from "./testing/support-course-registry.mjs";

const commit = process.env.PORTAL_REVIEW_PR17_COMMIT;
assert.match(
    commit ?? "",
    /^[a-f0-9]{40}$/,
    "PORTAL_REVIEW_PR17_COMMIT must identify one exact locally available committed source",
);
const root = new URL("../", import.meta.url),
    git = promisify(execFile),
    base = "20261116021008";
/** Only immutable Git-object reads, no shell interpolation/fetch/worktree access. */
const gitText = async (args) =>
    (await git("git", args, {cwd: root, maxBuffer: 16 * 1024 * 1024})).stdout;
const sources = new Map();
for (const file of (
    await readdir(new URL("supabase/migrations/", root))
).filter((name) => name.endsWith(".sql") && name.slice(0, 14) > base))
    sources.set(
        file,
        await readFile(new URL("supabase/migrations/" + file, root), "utf8"),
    );
const paths = (
    await gitText(["ls-tree", "-r", "--name-only", commit, "supabase/migrations"])
)
    .trim()
    .split("\n")
    .filter((path) =>
        /^supabase\/migrations\/\d{14}_[a-z0-9_]+\.sql$/.test(path),
    );
const reads = await Promise.allSettled(
    paths.map(async (path) => ({
        path,
        body: await gitText(["show", commit + ":" + path]),
    })),
);
for (const read of reads) {
    if (read.status === "rejected") throw read.reason;
    const {path, body} = read.value,
        file = path.split("/").at(-1);
    if (file.slice(0, 14) <= base) {
        assert.ok(
            body === (await readFile(new URL(path, root), "utf8")),
            "Common released migration differs: " + file,
        );
        continue;
    }
    if (sources.has(file))
        assert.ok(sources.get(file) === body, "Shared migration differs: " + file);
    else sources.set(file, body);
}
await withTestDatabase(
    "support_course_pr",
    async (fixture) => {
        for (const [, body] of [...sources].sort(([left], [right]) =>
            left.localeCompare(right),
        ))
            await fixture.sql(body);
        await runSupportCourseRegistryChecks(fixture, {
            label: "actual pinned PR17 " + commit,
            requireRealCourse: true,
        });
    },
    {migrationsThrough: base},
);