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

/** @typedef {import("@supabase/supabase-js").SupabaseClient} SupabaseClient */
/** @typedef {{id: string, email: string, client: SupabaseClient}} TestActor */
/** @typedef {{appOrigin: string, mailpitOrigin: string, confirmationUrl: string}} RecoveryEndpoints */
/** @typedef {(client: SupabaseClient) => Promise<void>} PasswordOnlyAssertion */
/** @typedef {<R extends {data: unknown, error: unknown}>(request: PromiseLike<R>, label?: string) => Promise<R extends {data: infer T} ? T : never>} CheckedRequest */

/** @typedef {object} ApiFixture
 * @property {SupabaseClient} service Service-role client scoped to the disposable project.
 * @property {(name: string, role: string) => Promise<TestActor>} actor Creates and signs in one fictional role fixture.
 * @property {PasswordOnlyAssertion} passwordOnly Confirms the supported password-only Auth state.
 * @property {(text: string) => Promise<string>} sql Runs SQL in the owned disposable database.
 * @property {(callback: () => unknown | Promise<unknown>) => void} defer Registers dependent-resource cleanup.
 * @property {CheckedRequest} checked Requires SDK success and returns its response data.
 * @property {string} suffix Random suffix shared by fixture records.
 * @property {string} url Loopback URL for the disposable Supabase API.
 * @property {RecoveryEndpoints} recoveryEndpoints Canonical app, Mailpit and Auth confirmation endpoints.
 */

/** Requires actual SDK success before returning the response data.
 * @template { {data: unknown, error: unknown} } R
 * @param {PromiseLike<R>} request
 * @param {string} [label]
 * @returns {Promise<R extends {data: infer T} ? T : never>}
 */
async function checked(request, label = "API operation") {
    const {data, error} = await request;
    assert.equal(error, null, `${label}: ${error instanceof Error ? error.message : String(error)}`);
    return /** @type {R extends {data: infer T} ? T : never} */ (data);
}

/** Use the current fictional actor session for an authenticated gateway request.
 * @param {TestActor} actor
 * @param {string} origin
 * @returns {Promise<Record<string, string>>}
 */
export async function testActorHeaders(actor, origin) {
    const apiKey = process.env.SUPABASE_ANON_KEY;
    assert.ok(apiKey, "The isolated API fixture requires its local anon key.");
    const data = await checked(actor.client.auth.getSession(), "Read local session");
    assert.ok(data.session, "The API actor must have an active test session.");
    return {
        Origin: origin,
        apikey: apiKey,
        Authorization: `Bearer ${data.session.access_token}`,
    };
}

/** Checks test mode, random project and API port before mutation, separating assertion failures from cleanup errors.
 * @template T
 * @param {(fixture: ApiFixture) => T | Promise<T>} run
 * @returns {Promise<T>}
 */
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
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const apiKey = process.env.SUPABASE_ANON_KEY;
    const fixturePassword = process.env.E2E_PASSWORD;
    assert.ok(serviceRoleKey, "The isolated API fixture requires its local service key.");
    assert.ok(apiKey, "The isolated API fixture requires its local anon key.");
    assert.ok(fixturePassword, "The isolated API fixture requires its fictional account password.");
    const url = process.env.SUPABASE_URL;
    assert.ok(
        url && ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname),
        "Loopback API required.",
    );
    const recoveryEndpoints = {
        appOrigin: "http://127.0.0.1:5273",
        mailpitOrigin: "http://127.0.0.1:55324",
        confirmationUrl: new URL("/auth/v1/verify", url).href,
    };
    if (process.env.PORTAL_TEST_RANDOM_SERVICE_PORTS === "1") {
        assert.match(project, /^luminovia-portal-test-[a-f0-9]{8}$/);
        const {command, projectConfig} = await import("../runtime-lib.mjs");
        const {api, mail, site} = projectConfig(process.cwd());
        assert.equal(site, recoveryEndpoints.appOrigin);
        assert.equal(url, `http://127.0.0.1:${api}`);
        assert.ok(Number.isInteger(mail) && mail > 0 && mail <= 65535);
        const gateway = `supabase_kong_${project}`;
        const bound = await command("docker", ["port", gateway, "8000/tcp"], {quiet: true});
        assert.equal(bound.trim(), `127.0.0.1:${api}`,
            "The API port must belong to the disposable project gateway.");
        const mailpit = `supabase_inbucket_${project}`;
        const mailPorts = await command("docker", ["port", mailpit], {quiet: true});
        assert.ok(mailPorts.split("\n").some((/** @type {string} */ line) => line.endsWith(` -> 127.0.0.1:${mail}`)),
            "The mail port must belong to the disposable project.");
        recoveryEndpoints.mailpitOrigin = `http://127.0.0.1:${mail}`;
    } else {
        assert.equal(
            new URL(url).port,
            "55321",
            "Dedicated canonical API port required.",
        );
    }
    /** Creates a separate SDK client without persistent sessions or automatic session refresh. */
    /** @param {string} key */
    const make = (key) =>
        createClient(url, key, {
            auth: {persistSession: false, autoRefreshToken: false},
        });
    const service = make(serviceRoleKey),
        /** @type {SupabaseClient[]} */ clients = [],
        /** @type {string[]} */ users = [],
        /** @type {Array<() => unknown | Promise<unknown>>} */ cleanups = [];
    const suffix = randomUUID();
    /** Sends SQL to the owned test database and makes every psql error fail the run. */
    /** @param {string} text @returns {Promise<string>} */
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
    /** @param {string} name @param {string} role @returns {Promise<TestActor>} */
    const actor = async (name, role) => {
        assert.match(name, /^[a-z][a-z0-9-]{0,40}$/i);
        const email = `m4-${name}-${suffix}@example.invalid`;
        const result = await checked(
            service.auth.admin.createUser({
                email,
                password: fixturePassword,
                email_confirm: true,
            }),
            "Create fictional API actor",
        );
        assert.ok(result.user, "The fictional Auth actor must be created successfully.");
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
        const client = make(apiKey);
        clients.push(client);
        await checked(
            client.auth.signInWithPassword({
                email,
                password: fixturePassword,
            }),
            "Sign in with actual Auth",
        );
        return {id: result.user.id, email, client};
    };
    /** Confirms privileged role fixtures use password-only sessions and have no enrolled MFA factors. */
    /** @type {PasswordOnlyAssertion} */
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
            recoveryEndpoints,
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
    return /** @type {T} */ (result);
}
