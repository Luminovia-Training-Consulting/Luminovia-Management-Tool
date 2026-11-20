/** Fictional dependency fixtures exercise irreversible execution barriers and
 * failure/retry behavior; actual Auth/Storage absence is checked by API tests. */
import assert from "node:assert/strict";
import {type DeletionDependencies, type DeletionWork, executeDeletion,} from "./deletion-worker.ts";

const id = "44444444-4444-4444-8444-444444444444";
const target = "55555555-5555-4555-8555-555555555555";

/** Track external writes without using real accounts or real file objects. */
function fixture(
    overrides: Partial<DeletionDependencies> = {},
    patch: Partial<DeletionWork> = {},
) {
    const calls: string[] = [];
    let authExists = true;
    const operation = {
        operation_id: id,
        kind: "account",
        id: target,
        status: "pending" as const,
    };
    const deps: DeletionDependencies = {
        authorize: async (token, operationId) => {
            assert.equal(token, "caller");
            assert.equal(operationId, id);
            calls.push("authorize");
            return "permit";
        },
        work: async () => ({
            ...operation,
            objects: [
                {bucket: "portal-clean", path: "reserved/version.pdf"},
                {bucket: "portal-quarantine", path: "reserved/version.pdf"},
            ],
            auth_user_id: target,
            pending_uploads: 0,
            ...patch,
        }),
        removeObject: async (bucket, path) => {
            calls.push(`remove:${bucket}:${path}`);
        },
        objectAbsent: async () => {
            calls.push("verify-object");
            return true;
        },
        apply: async () => {
            calls.push("apply");
        },
        authUserAbsent: async () => {
            calls.push("verify-auth");
            return !authExists;
        },
        deleteAuthUser: async (userId) => {
            assert.equal(userId, target);
            calls.push("delete-auth");
            authExists = false;
        },
        complete: async () => {
            calls.push("complete");
            return {...operation, status: "completed"};
        },
        ...overrides,
    };
    return {calls, deps};
}

Deno.test("permanent deletion waits for actual binary, relational and native Auth absence", async () => {
    const {calls, deps} = fixture();
    const result = await executeDeletion("caller", id, deps);
    assert.equal(result.status, "completed");
    assert.equal(calls.filter((value) => value.startsWith("remove:")).length, 2);
    assert.ok(calls.indexOf("verify-object") < calls.indexOf("apply"));
    assert.ok(calls.indexOf("apply") < calls.indexOf("delete-auth"));
    assert.ok(calls.lastIndexOf("verify-auth") < calls.indexOf("complete"));
    assert.equal(calls.filter((value) => value === "authorize").length, 6);
});
Deno.test("active writers remain pending without deleting any object or relational row", async () => {
    const {calls, deps} = fixture({}, {pending_uploads: 1});
    assert.equal((await executeDeletion("caller", id, deps)).status, "pending");
    assert.deepEqual(calls, ["authorize"]);
});
Deno.test("Storage failure and ambiguous absence never reach relational deletion or success", async () => {
    for (
        const overrides of [
        {
            removeObject: async () => {
                throw new Error("network");
            },
        },
        {objectAbsent: async () => false},
    ]
        ) {
        const {calls, deps} = fixture(overrides);
        await assert.rejects(() => executeDeletion("caller", id, deps));
        assert.ok(!calls.includes("apply"));
        assert.ok(!calls.includes("complete"));
    }
});
Deno.test("lost authority after external I/O stops remaining privileged phases", async () => {
    let authorized = true;
    const {calls, deps} = fixture({
        authorize: async () => {
            if (!authorized) throw new Error("permission_required");
            return "permit";
        },
        objectAbsent: async () => {
            authorized = false;
            return true;
        },
    });
    await assert.rejects(
        () => executeDeletion("caller", id, deps),
        /permission_required/,
    );
    assert.ok(!calls.includes("apply"));
    assert.ok(!calls.includes("delete-auth"));
});
Deno.test("native Auth persistence and relational failures cannot be acknowledged as deleted", async () => {
    for (
        const overrides of [
        {
            authUserAbsent: async () => false, deleteAuthUser: async () => {
            }
        },
        {
            apply: async () => {
                throw new Error("dependency_changed");
            },
        },
    ]
        ) {
        const {calls, deps} = fixture(overrides);
        await assert.rejects(() => executeDeletion("caller", id, deps));
        assert.ok(!calls.includes("complete"));
    }
});
Deno.test("completed retries never repeat external work", async () => {
    const {calls, deps} = fixture({}, {status: "completed"});
    assert.equal((await executeDeletion("caller", id, deps)).status, "completed");
    assert.deepEqual(calls, ["authorize"]);
});
Deno.test("unexpected bucket/path manifest fails closed before removal", async () => {
    const {calls, deps} = fixture({}, {
        objects: [{bucket: "portal-clean", path: "../other"}],
    });
    await assert.rejects(() => executeDeletion("caller", id, deps));
    assert.ok(!calls.some((value) => value.startsWith("remove:")));
});