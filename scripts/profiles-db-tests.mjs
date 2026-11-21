/** Real disposable PostgreSQL/RLS checks for profiles, enrolment and reviews.
 * The separate profiles-api-check exercises actual Auth and management permission.
 */
import {spawn} from "node:child_process";
import {readdir, readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {z} from "zod";
import {portalOpenApi} from "../src/features/developer-api/contract.ts";
import {withMigrationReplayLock} from "./testing/database.mjs";

const container =
    process.env.PORTAL_DB_CONTAINER ?? "supabase_db_luminovia-portal";
if (
    !/^supabase_db_luminovia-portal(?:-test(?:-[a-zA-Z0-9_-]+)?)?$/.test(
        container,
    )
)
    throw new Error(
        "Only the named local portal database container is permitted.",
    );
const database = `profiles_test_${randomUUID().replaceAll("-", "")}`;

/** Starts the test program with explicit arguments and preserves its failure status. */
function command(args, input = "") {
    return new Promise((resolve, reject) => {
        const child = spawn("docker", args, {stdio: ["pipe", "pipe", "pipe"]});
        let out = "",
            err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", reject);
        child.on("exit", (code) =>
            code === 0 ? resolve(out.trim()) : reject(new Error(err || out)),
        );
        child.stdin.end(input);
    });
}

/** Sends SQL to the owned test database and makes every psql error fail the run. */
const sql = (text, name = database) =>
    command(
        [
            "exec",
            "-i",
            container,
            "psql",
            "-U",
            "postgres",
            "-d",
            name,
            "-X",
            "-qAt",
            "-v",
            "ON_ERROR_STOP=1",
        ],
        text,
    );
/** Quotes controlled fixture SQL literals; identifiers have separate validation. */
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
/** Executes the check as a specific identity so administrative fixture privileges cannot mask the tested access. */
const actor = (id, statement, aal = "aal1") =>
    sql(
        `begin;set local role authenticated;set local request.jwt.claims=${quote(JSON.stringify({sub: id, aal, role: "authenticated"}))};${statement};commit;`,
    );
const lecturer = randomUUID(),
    peer = randomUUID(),
    admin = randomUUID(),
    student = randomUUID(),
    stranger = randomUUID(),
    client = randomUUID();
const run = randomUUID(),
    org = randomUUID(),
    template = randomUUID();
const {paths} = portalOpenApi("https://portal.example.invalid");
const courseResponses = new Map(["profile_courses", "lecturer_reviews"].map((name) => [
    name,
    z.fromJSONSchema(paths[`/rest/v1/rpc/${name}`].post.responses["200"].content["application/json"].schema),
]));
/** Calls the business database API under the fixture's controlled identity/permission claims. */
const rpc = (who, name, args = [], aal = "aal1") =>
    actor(
        who,
        `select public.${name}(${args.map((x) => (x === null ? "null" : typeof x === "number" || typeof x === "boolean" ? String(x) : quote(x))).join(",")})`,
        aal,
    ).then((x) => {
        const response = courseResponses.get(name);
        if (response) return response.parse(JSON.parse(x));
        try {
            return JSON.parse(x);
        } catch {
            return x;
        }
    });
let checks = 0;
/** Counts and reports a group only after every related assertion has passed. */
const check = async (name, fn) => {
    await fn();
    checks++;
    console.log(`PASS ${name}`);
};
try {
    await sql(`create database ${database}`, "postgres");
    await sql(`create schema auth;create schema extensions;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz default now(),created_at timestamptz default clock_timestamp());
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 grant usage on schema auth to authenticated,anon,service_role;grant execute on all functions in schema auth to authenticated,anon,service_role;`);
    await withMigrationReplayLock(container, async () => {
        for (const file of (
            await readdir(new URL("../supabase/migrations/", import.meta.url))
        )
            .filter((f) => f.endsWith(".sql"))
            .sort())
            await sql(
                await readFile(
                    new URL(`../supabase/migrations/${file}`, import.meta.url),
                    "utf8",
                ),
            );
    });

    await sql(`insert into auth.users(id) values ${[lecturer, peer, admin, student, stranger, client].map((id) => `('${id}')`).join(",")};
 insert into public.user_roles(user_id,role) values('${lecturer}','lecturer'),('${peer}','lecturer'),('${admin}','admin'),('${student}','participant'),('${stranger}','participant'),('${client}','client');
 update public.profiles set active=true where id='${client}';
 update public.profiles set display_name=case id when '${lecturer}' then 'Fictional Teacher' when '${student}' then 'Private Student Identity' else 'Fictional Other' end,bio_de='Öffentliche Biografie',phone='Private phone';
 insert into public.organisations(id,name) values('${org}','Fictional Academy');
 insert into public.course_templates(id,title) values('${template}','Fictional completed course');
 insert into public.course_runs(id,template_id,organisation_id,published) values('${run}','${template}','${org}',false);
 insert into public.course_sessions(course_run_id,starts_at,ends_at) values('${run}',now()-interval '2 day',now()-interval '1 day');`);
    await rpc(admin, "set_company_premium", [org, true, 0, randomUUID()]);
    /** Creates a controlled actual course assignment so reviews check real participation eligibility. */
    const seedAssignment = async (target, course, starts, ends) => {
        const job = randomUUID(),
            claim = randomUUID();
        await sql(
            `insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,time_zone,status,amount,currency,rate_unit,total_amount,terms) values('${job}','${course}','Fictional assignment','Fictional Academy','online','Europe/Berlin','filled',100,'EUR','fixed_total',100,'Fictional terms');insert into public.job_sessions(job_id,starts_at,ends_at) values('${job}',${starts},${ends});insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,currency,rate_unit,total_amount,terms,terms_version) values('${claim}','${job}','${target}','${randomUUID()}',100,'EUR','fixed_total',100,'Fictional terms',1);insert into public.assignment_sessions(claim_id,lecturer_id,starts_at,ends_at) values('${claim}','${target}',${starts},${ends});`,
        );
        return {job, claim};
    };
    await seedAssignment(
        lecturer,
        run,
        "now()-interval '2 day'",
        "now()-interval '1 day'",
    );
    await check(
        "Own labels/details persist with bounded normalized self-authored data; direct writes denied",
        async () => {
            await rpc(lecturer, "save_profile_details", [
                JSON.stringify({
                    country: "Germany",
                    languages: ["Deutsch", "English"],
                    labels: ["Python", "python", "Mentoring"],
                    teaching_experience: "Fictional experience",
                }) + "",
            ]);
            const own = await rpc(lecturer, "own_profile_details");
            assert.equal(own.labels.length, 2);
            assert.equal(own.country, "Germany");
            await assert.rejects(
                rpc(lecturer, "save_profile_details", [
                    JSON.stringify({labels: ["x".repeat(41)]}),
                ]),
                /Invalid labels/,
            );
            await assert.rejects(
                rpc(lecturer, "save_profile_details", [null]),
                /Invalid profile details/,
            );
            await assert.rejects(
                rpc(lecturer, "save_profile_details", [
                    JSON.stringify({country: {forged: "object"}}),
                ]),
                /Invalid profile details/,
            );
            await assert.rejects(
                rpc(lecturer, "save_profile_details", [
                    JSON.stringify({role: "admin"}),
                ]),
                /Invalid profile details/,
            );
            await assert.rejects(
                actor(
                    lecturer,
                    `update public.profile_details set labels=array['Admin'] where user_id='${peer}'`,
                ),
                /permission denied/,
            );
        },
    );
    await check(
        "Staff directory/profile intentionally share authored fields but exclude contact and money",
        async () => {
            const people = await rpc(peer, "people_directory", ["", "Python"]);
            assert.equal(people.length, 1);
            assert.equal(people[0].id, lecturer);
            assert.equal("phone" in people[0], false);
            assert.equal("email" in people[0], false);
            assert.equal("amount" in people[0], false);
            const profile = await rpc(peer, "person_profile", [lecturer]);
            assert.equal(profile.teaching_experience, "Fictional experience");
            assert.equal("phone" in profile, false);
            await assert.rejects(
                rpc(stranger, "people_directory"),
                /Active account required/,
            );
            await assert.rejects(
                rpc(stranger, "person_profile", [lecturer]),
                /access denied/,
            );
        },
    );
    await check(
        "Course history uses real accepted session instants for current/upcoming/past and contains no rates",
        async () => {
            for (const [state, start, end] of [
                ["current", "now()-interval '1 hour'", "now()+interval '1 hour'"],
                ["upcoming", "now()+interval '2 day'", "now()+interval '3 day'"],
            ]) {
                const id = randomUUID();
                await sql(
                    `insert into public.course_runs(id,template_id,organisation_id) values('${id}','${template}','${org}');`,
                );
                await seedAssignment(lecturer, id, start, end);
                assert.ok(
                    (await rpc(peer, "profile_courses", [lecturer])).some(
                        (x) => x.course_run_id === id && x.state === state,
                    ),
                );
            }
            const courses = await rpc(peer, "profile_courses", [lecturer]);
            assert.ok(
                courses.some((x) => x.course_run_id === run && x.state === "past"),
            );
            assert.ok(
                courses.every(
                    (x) => !("amount" in x) && !("customer_name" in x) && !("terms" in x),
                ),
            );
        },
    );
    await check(
        "Client visibility is limited to their organisation assigned lecturers and course history",
        async () => {
            const directory = async (stage) => {
                try {
                    return await rpc(client, "people_directory", ["", "", null]);
                } catch (error) {
                    throw new Error(`${stage}: ${error.message}`, {cause: error});
                }
            };
            assert.equal(await actor(client, "select private.actor_active()"), "t");
            assert.deepEqual(await directory("without organisation membership"), []);
            await sql(
                `insert into public.client_organisation_memberships(user_id,organisation_id) values('${client}','${org}');`,
            );
            assert.equal(await actor(client, "select private.actor_active()"), "t");
            const people = await directory("with organisation membership");
            assert.deepEqual(
                people.map((x) => x.id),
                [lecturer],
            );
            const courses = await rpc(client, "profile_courses", [lecturer]);
            assert.equal(courses.length, 3);
            assert.ok(courses.every((x) => x.title === "Fictional completed course"));
            await sql(
                `update public.client_organisation_memberships set removed_at=now() where user_id='${client}'`,
            );
            assert.equal(await actor(client, "select private.actor_active()"), "t");
            assert.deepEqual(
                await directory("after organisation membership removal"),
                [],
            );
        },
    );
    await check(
        "Administrator functions still cannot review the administrator’s own teaching",
        async () => {
            const selfRun = randomUUID();
            await sql(
                `insert into public.course_runs(id,template_id,organisation_id) values('${selfRun}','${template}','${org}');insert into public.course_sessions(course_run_id,starts_at,ends_at) values('${selfRun}',now()-interval '2 day',now()-interval '1 day');`,
            );
            await seedAssignment(
                admin,
                selfRun,
                "now()-interval '2 day'",
                "now()-interval '1 day'",
            );
            await assert.rejects(
                rpc(admin, "manage_course_enrolment", [selfRun, admin, "completed"]),
                /Active company participant required/,
            );
            await assert.rejects(
                rpc(admin, "submit_course_review", [
                    selfRun,
                    admin,
                    5,
                    "Self endorsement",
                ]),
                /Invalid review/,
            );
        },
    );
    await check(
        "Unassociated participant identities have no directory, learner or review access for this company",
        async () => {
            for (const account of [student, stranger]) {
                await assert.rejects(
                    rpc(account, "people_directory"),
                    /Active account required/,
                );
                await assert.rejects(rpc(account, "profile_courses", [lecturer]));
                await assert.rejects(rpc(account, "course_enrolments", [run]));
                assert.deepEqual(await rpc(account, "reviewable_courses"), []);
                await assert.rejects(
                    rpc(account, "submit_course_review", [
                        run,
                        lecturer,
                        5,
                        "Unassociated reviewer",
                    ]),
                    /Company membership or completed enrolment required/,
                );
            }
            assert.equal(
                await actor(
                    student,
                    `select count(*) from public.course_runs where id='${run}'`,
                ),
                "0",
            );
            assert.equal(
                await actor(
                    stranger,
                    `select count(*) from public.course_runs where id='${run}'`,
                ),
                "0",
            );
            assert.equal(
                await sql("select count(*) from public.course_reviews"),
                "0",
            );
        },
    );
    await check(
        "Suspended and anonymous actors cannot read or mutate profile/community data",
        async () => {
            await sql(
                `update public.profiles set active=false where id='${student}'`,
            );
            await assert.rejects(
                rpc(student, "people_directory"),
                /Active account required/,
            );
            await assert.rejects(
                rpc(student, "save_profile_details", ["{}"]),
                /Active login/,
            );
            await assert.rejects(
                sql("set role anon;select public.people_directory()"),
                /permission denied/,
            );
            assert.equal(
                await sql(
                    `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`,
                ),
                "0",
            );
        },
    );
    console.log(`\n${checks} profile/enrolment/review PostgreSQL checks passed.`);
} finally {
    await sql(`drop database if exists ${database} with (force)`, "postgres");
}
