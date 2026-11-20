/**
 * Checks real password Auth/profile/calendar/Storage persistence across stop and restart.
 * An owned fictional probe actor and exact object bytes distinguish retained data from mere service readiness.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {cleanEnvironment, command, projectConfig, readEnvFile,} from "./runtime-lib.mjs";

const env = readEnvFile(".env.test.local");
const config = projectConfig();
const url = new URL(env.SUPABASE_URL);
assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
    Number(url.port) === config.api,
    "Persistence checks require this checkout local stack",
);
const service = createClient(url.href, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {persistSession: false, autoRefreshToken: false},
});
/** Creates a separate nonpersistent Auth client for actual password persistence checks. */
const anon = () =>
    createClient(url.href, env.SUPABASE_ANON_KEY, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
const id = randomUUID();
const email = `persistence-${id}@example.invalid`;
const password = `Persist!${randomUUID()}Aa9`;
const bucket = `portal-persistence-${id}`;
const payload = `Luminovia persistent Storage marker ${id}`;
let user;
let storageCreated = false;
let fixtureProfile;
let fixtureExpertise;
let probeFailure;
const cleanupFailures = [];

/** Requires actual SDK success before returning the response data. */
async function checked(promise, label) {
    const {data, error} = await promise;
    assert.equal(error, null, `${label}: ${error?.message}`);
    return data;
}

try {
    if (process.env.PORTAL_TEST_MODE === "1") {
        const listed = await checked(
            service.auth.admin.listUsers({perPage: 1000}),
            "Read isolated fixtures",
        );
        const fixture = listed.users.find(
            (account) => account.email === "lecturer11@example.invalid",
        );
        assert.ok(fixture);
        fixtureProfile = await checked(
            service.from("profiles").select("*").eq("id", fixture.id).single(),
            "Read isolated fixture profile",
        );
        fixtureExpertise = await checked(
            service.from("lecturer_topics").select("*").eq("user_id", fixture.id),
            "Read isolated fixture verification",
        );
        await checked(
            service
                .from("profiles")
                .update({
                    bio_de: payload,
                    active: false,
                    time_zone: "Australia/Brisbane",
                })
                .eq("id", fixture.id),
            "Edit isolated fixture and suspend access",
        );
        await checked(
            service
                .from("lecturer_topics")
                .update({verified: false, valid_until: null})
                .eq("user_id", fixture.id),
            "Revoke isolated fixture expertise",
        );
        await command(process.execPath, ["scripts/local-env.mjs"], {
            env: cleanEnvironment(),
        });
        await command(process.execPath, ["scripts/local-seed.mjs"], {
            env: cleanEnvironment(),
        });
        assert.equal(
            readEnvFile(".env.test.local").E2E_PASSWORD,
            env.E2E_PASSWORD,
            "Bootstrap password stays stable",
        );
        const untouched = await checked(
            service
                .from("profiles")
                .select("bio_de,active,time_zone")
                .eq("id", fixture.id)
                .single(),
            "Check insert-only seed preservation",
        );
        assert.deepEqual(untouched, {
            bio_de: payload,
            active: false,
            time_zone: "Australia/Brisbane",
        });
        const unchanged = await checked(
            service
                .from("lecturer_topics")
                .select("verified,valid_until")
                .eq("user_id", fixture.id),
            "Check verification preservation",
        );
        assert.ok(
            unchanged.every((topic) => !topic.verified && topic.valid_until === null),
        );
        console.log(
            "PASS: repeated environment generation and explicit seed preserve fixture password, edited profile, suspension and revoked verification.",
        );
    }
    user = (
        await checked(
            service.auth.admin.createUser({email, password, email_confirm: true}),
            "Create isolated persistence account",
        )
    ).user;
    await checked(
        service
            .from("profiles")
            .update({
                display_name: `Fictional persistence check ${id}`,
                bio_de: payload,
                bio_en: "Fictional persistence probe",
                time_zone: "Australia/Brisbane",
            })
            .eq("id", user.id),
        "Set persisted profile",
    );
    await checked(
        service.from("user_roles").insert({user_id: user.id, role: "lecturer"}),
        "Set local role",
    );
    const starts = new Date(Date.now() + 400 * 86400000);
    const ends = new Date(+starts + 3600000);
    const event = await checked(
        service
            .from("personal_events")
            .insert({
                user_id: user.id,
                title: payload,
                starts_at: starts.toISOString(),
                ends_at: ends.toISOString(),
                time_zone: "Australia/Brisbane",
            })
            .select("id")
            .single(),
        "Set private appointment",
    );
    const actor = anon();
    await checked(
        actor.auth.signInWithPassword({email, password}),
        "Sign in persistence account",
    );
    await checked(
        service.storage.createBucket(bucket, {public: false}),
        "Create private persistence bucket",
    );
    storageCreated = true;
    await checked(
        service.storage
            .from(bucket)
            .upload("marker.txt", new Blob([payload], {type: "text/plain"})),
        "Store actual object bytes",
    );
    await command(process.execPath, ["scripts/runtime-cli.mjs", "restart"], {
        env: cleanEnvironment(),
        timeoutMs: 480000,
    });
    const next = anon();
    await checked(
        next.auth.signInWithPassword({email, password}),
        "Original password still works after restart",
    );
    const profile = await checked(
        next.from("profiles").select("bio_de,time_zone").eq("id", user.id).single(),
        "Read persisted private profile",
    );
    assert.equal(profile.bio_de, payload);
    assert.equal(profile.time_zone, "Australia/Brisbane");
    const savedEvent = await checked(
        next.from("personal_events").select("title").eq("id", event.id).single(),
        "Read persisted private appointment",
    );
    assert.equal(savedEvent.title, payload);
    const factors = await checked(
        next.auth.mfa.listFactors(),
        "Confirm no MFA factors",
    );
    assert.deepEqual(factors, {
        all: [],
        totp: [],
        phone: [],
        webauthn: [],
        recovery_code: [],
    });
    const object = await checked(
        service.storage.from(bucket).download("marker.txt"),
        "Download persisted actual object",
    );
    assert.equal(await object.text(), payload);
    const bucketMetadata = await checked(
        service.storage.getBucket(bucket),
        "Read persisted bucket policy",
    );
    assert.equal(bucketMetadata.public, false);
    console.log(
        "PASS: actual stop/start preserves password-only Auth, edited profile/timezone, private appointment and private Storage object bytes; no MFA factors are present.",
    );
} catch (error) {
    probeFailure = error;
} finally {
    /** Removes resources created by this run; cleanup must not hide a business assertion failure. */
    const cleanup = async (operation, label) => {
        try {
            await checked(operation, label);
        } catch (error) {
            cleanupFailures.push(error);
        }
    };
    if (storageCreated) {
        await cleanup(
            service.storage.from(bucket).remove(["marker.txt"]),
            "Remove own probe object",
        );
        await cleanup(
            service.storage.deleteBucket(bucket),
            "Remove own probe bucket",
        );
    }
    if (user) {
        await cleanup(
            service.from("personal_events").delete().eq("user_id", user.id),
            "Remove own probe appointment before Auth deletion",
        );
        await cleanup(
            service.auth.admin.deleteUser(user.id),
            "Remove own temporary Auth account",
        );
    }
    if (fixtureProfile) {
        const {id, ...profile} = fixtureProfile;
        await cleanup(
            service.from("profiles").update(profile).eq("id", id),
            "Restore isolated fixture profile",
        );
        if (fixtureExpertise?.length)
            await cleanup(
                service
                    .from("lecturer_topics")
                    .upsert(fixtureExpertise, {onConflict: "user_id,topic_id"}),
                "Restore isolated fixture expertise",
            );
    }
}
if (probeFailure || cleanupFailures.length)
    throw new AggregateError(
        [...(probeFailure ? [probeFailure] : []), ...cleanupFailures],
        "Persistence probe or cleanup failed",
    );
console.log(
    "PASS: temporary persistence probe and fixture mutations fully cleaned.",
);