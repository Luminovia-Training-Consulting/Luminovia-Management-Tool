/**
 * Shared fixtures for real Auth/REST/RPC/Storage checks.
 * Only the canonical random test project is allowed; resources are cleaned before their fictional accounts.
 */
/** Real API fixtures belong only to the canonical disposable project, never dev. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {spawn} from "node:child_process";
import {createClient} from "@supabase/supabase-js";
import {collectUtf8} from "./utf8-stream.mjs";
import {assertPasswordOnly} from "./password-only.mjs";

/** Requires actual SDK success before returning the response data. */
async function checked(request, label = "API operation") {
    const {data, error} = await request;
    assert.equal(error, null, `${label}: ${error?.message}`);
    return data;
}

/** Checks test mode, random project and API port before mutation, separating assertion failures from cleanup errors. */
export async function withApiFixture(run) {
    assert.equal(
        process.env.PORTAL_TEST_MODE,
        "1",
        "Only ./portal test owns mutating API fixtures.",
    );
    const config = readFileSync("supabase/config.toml", "utf8");
    const project = /^project_id\s*=\s*"(luminovia-portal-test-[a-f0-9]+)"/m.exec(
        config,
    )?.[1];
    assert.ok(
        project,
        "Only the canonical random disposable project is permitted.",
    );
    process.loadEnvFile(".env.test.local");
    const url = process.env.SUPABASE_URL;
    assert.ok(
        url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
        "Loopback API required.",
    );
    assert.equal(
        new URL(url).port,
        "55321",
        "Dedicated canonical API port required.",
    );
    /** Creates a separate SDK client without persistent sessions or automatic session refresh. */
    const make = (key) =>
        createClient(url, key, {
            auth: {persistSession: false, autoRefreshToken: false},
        });
    const service = make(process.env.SUPABASE_SERVICE_ROLE_KEY),
        clients = [],
        users = [],
        cleanups = [];
    const suffix = randomUUID();
    /** Sends SQL to the owned test database and makes every psql error fail the run. */
    const sql = (text) =>
        new Promise((resolve, reject) => {
            const child = spawn(
                "docker",
                [
                    "exec",
                    "-i",
                    `supabase_db_${project}`,
                    "psql",
                    "-U",
                    "postgres",
                    "-d",
                    "postgres",
                    "-X",
                    "-qAt",
                    "-v",
                    "ON_ERROR_STOP=1",
                ],
                {stdio: ["pipe", "pipe", "pipe"]},
            );
            const stdout = collectUtf8(child.stdout);
            const stderr = collectUtf8(child.stderr);
            child.on("error", reject);
            child.on("close", (code) => {
                const out = stdout();
                const error = stderr();
                if (code === 0) resolve(out.trim());
                else reject(new Error(error || "Isolated SQL failed"));
            });
            child.stdin.end(text);
        });
    /** Creates a fictional Auth identity, assigns its fixture role and signs in a separate nonpersistent client. */
    const actor = async (name, role) => {
        assert.match(name, /^[a-z][a-z0-9-]{0,40}$/i);
        const email = `m4-${name}-${suffix}@example.invalid`;
        const result = await checked(
            service.auth.admin.createUser({
                email,
                password: process.env.E2E_PASSWORD,
                email_confirm: true,
            }),
            "Create fictional API actor",
        );
        users.push(result.user.id);
        await checked(
            service.from("user_roles").insert({user_id: result.user.id, role}),
            "Assign fictional role",
        );
        await checked(
            service
                .from("profiles")
                .update({display_name: `Fictional ${name}`})
                .eq("id", result.user.id),
            "Name fictional actor",
        );
        const client = make(process.env.SUPABASE_ANON_KEY);
        clients.push(client);
        await checked(
            client.auth.signInWithPassword({
                email,
                password: process.env.E2E_PASSWORD,
            }),
            "Sign in with actual Auth",
        );
        return {id: result.user.id, email, client};
    };
    /** Confirms privileged role fixtures use password-only sessions and have no enrolled MFA factors. */
    const passwordOnly = assertPasswordOnly;
    // Preserves assertion failures while deleting dependent resources before channels/accounts in reverse order.
    let failure;
    let result;
    const cleanupErrors = [];
    try {
        result = await run({
            service,
            actor,
            passwordOnly,
            sql,
            defer: (callback) => cleanups.push(callback),
            checked,
            suffix,
            url,
        });
    } catch (error) {
        failure = error;
    } finally {
        for (const callback of cleanups.reverse())
            try {
                await callback();
            } catch (error) {
                cleanupErrors.push(error);
            }
        for (const client of clients)
            try {
                await client.removeAllChannels();
            } catch (error) {
                cleanupErrors.push(error);
            }
        if (users.length) {
            try {
                await checked(
                    service.from("audit_events").delete().in("actor_id", users),
                    "Remove own test audit",
                );
            } catch (error) {
                cleanupErrors.push(error);
            }
            for (const id of users)
                try {
                    await checked(
                        service.auth.admin.deleteUser(id),
                        "Remove own fictional account",
                    );
                } catch (error) {
                    cleanupErrors.push(error);
                }
        }
    }
    // Even a successful business flow must fail the run when cleanup is incomplete.
    if (cleanupErrors.length)
        throw new AggregateError(
            failure ? [failure, ...cleanupErrors] : cleanupErrors,
            "Scoped API cleanup did not fully succeed",
        );
    if (failure) throw failure;
    return result;
}