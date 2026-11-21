/** Chat permission and transaction tests on actual PostgreSQL, in a disposable DB.
 * Auth helpers are compatible stubs here; the separate chat-api-check uses real JWTs/realtime.
 */
import {spawn} from "node:child_process";
import {readdir, readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
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
const database = `chat_test_${randomUUID().replaceAll("-", "")}`;

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
/** Calls the public RPC as the test identity and returns its scalar database value. */
const value = (id, fn, args = [], aal) =>
    actor(
        id,
        `select public.${fn}(${args.map((x) => (x === null ? "null" : typeof x === "boolean" ? String(x) : quote(x))).join(",")})`,
        aal,
    );
/** Aggregates public RPC rows into JSON under the checked caller identity. */
const rows = (id, fn, args = [], aal) =>
    actor(
        id,
        `select coalesce(json_agg(x),'[]') from public.${fn}(${args.map((x) => (x === null ? "null" : typeof x === "number" || typeof x === "boolean" ? String(x) : quote(x))).join(",")}) x`,
        aal,
    ).then(JSON.parse);
const a = randomUUID(),
    b = randomUUID(),
    c = randomUUID(),
    admin = randomUUID(),
    participant = randomUUID(),
    outsider = randomUUID();
let checks = 0;
/** Counts and reports a case only after all of its assertions have completed successfully. */
const check = async (name, fn) => {
    await fn();
    checks++;
    console.log(`PASS ${name}`);
};
/** Sends messages through the actual RPC with an explicit retry identity and optional document reference. */
const msg = (who, room, body, key = randomUUID(), document = null) =>
    value(who, "send_message", [room, body, key, document]);
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
    await sql(`insert into auth.users(id) values ${[a, b, c, admin, participant, outsider].map((id) => `('${id}')`).join(",")};
 insert into public.user_roles(user_id,role) values('${a}','lecturer'),('${b}','lecturer'),('${c}','senior_lecturer'),('${admin}','admin'),('${participant}','participant'),('${outsider}','participant');
 update public.profiles set display_name=case id when '${a}' then 'Fictional Alpha' when '${b}' then 'Fictional Beta' else 'Fictional Other' end;`);
    let dm;
    await check(
        "Concurrent opposing DM requests return one canonical private room",
        async () => {
            const r = await Promise.all([
                value(a, "create_dm", [b]),
                value(b, "create_dm", [a]),
                value(a, "create_dm", [b]),
            ]);
            assert.equal(new Set(r).size, 1);
            dm = r[0];
            assert.equal(
                await sql(
                    `select count(*) from public.chat_members where room_id='${dm}'`,
                ),
                "2",
            );
        },
    );
    await check(
        "Names-only directory has current staff permissions and no participant/private profile spill",
        async () => {
            const contacts = await rows(a, "chat_contacts");
            assert.ok(contacts.some((x) => x.id === b));
            assert.ok(!contacts.some((x) => x.id === participant));
            assert.deepEqual(Object.keys(contacts[0]).sort(), [
                "display_name",
                "id",
                "roles",
            ]);
            assert.deepEqual(await rows(participant, "chat_contacts"), []);
            assert.equal(
                await actor(a, `select count(*) from public.profiles where id='${b}'`),
                "0",
            );
        },
    );
    await check(
        "Administrator cannot list, read, send to or inspect revisions of another private DM",
        async () => {
            assert.deepEqual(await rows(admin, "chat_rooms_list"), []);
            assert.equal(
                await actor(
                    admin,
                    `select count(*) from public.chat_rooms where id='${dm}'`,
                    "aal1",
                ),
                "0",
            );
            await assert.rejects(
                rows(admin, "chat_messages", [dm]),
                /access denied/i,
            );
            await assert.rejects(msg(admin, dm, "forged"), /access denied/i);
        },
    );
    await check(
        "Pins are personal, persist server-side and reject forged room access",
        async () => {
            assert.deepEqual(await value(a, "chat_pinned_rooms"), "{}");
            await value(a, "set_chat_pin", [dm, true]);
            assert.match(await value(a, "chat_pinned_rooms"), new RegExp(dm));
            assert.equal(await value(b, "chat_pinned_rooms"), "{}");
            await assert.rejects(
                value(admin, "set_chat_pin", [dm, true], "aal2"),
                /access denied/i,
            );
            await assert.rejects(
                value(a, "set_chat_pin", [dm, null]),
                /Invalid pin/i,
            );
            assert.match(await value(a, "chat_pinned_rooms"), new RegExp(dm));
            await value(a, "set_chat_pin", [dm, false]);
            assert.equal(await value(a, "chat_pinned_rooms"), "{}");
        },
    );
    const key = randomUUID();
    let first;
    await check(
        "Message retry preserves one row and one notification; altered body/key is rejected",
        async () => {
            first = await msg(a, dm, "Hallo Beta", key);
            assert.equal(await msg(a, dm, "Hallo Beta", key), first);
            assert.equal(
                await sql(`select count(*) from public.messages where room_id='${dm}'`),
                "1",
            );
            assert.equal(
                await sql(
                    `select count(*) from public.notifications where resource_id='${first}'`,
                ),
                "1",
            );
            await assert.rejects(
                msg(a, dm, "Altered content", key),
                /Idempotency key conflicts/,
            );
        },
    );
    await check(
        "Unread cursor, explicit mark and mute preferences persist server-side",
        async () => {
            assert.equal(
                (await rows(b, "chat_rooms_list")).find((x) => x.id === dm)
                    .unread_count,
                1,
            );
            await value(b, "mark_chat_read", [dm, first]);
            assert.equal(
                (await rows(b, "chat_rooms_list")).find((x) => x.id === dm)
                    .unread_count,
                0,
            );
            await value(b, "mark_chat_read", [dm, null, true]);
            const muted = await msg(a, dm, "Muted notification");
            assert.equal(
                await sql(
                    `select count(*) from public.notifications where resource_id='${muted}'`,
                ),
                "0",
            );
            assert.equal((await rows(b, "chat_rooms_list"))[0].muted, true);
        },
    );
    await check(
        "Personal hiding filters direct reads, both history APIs, search and unread without changing the other member",
        async () => {
            await value(b, "mark_chat_read", [dm, null, false]);
            const hidden = await msg(a, dm, "personal hide fictional marker");
            assert.equal(
                await sql(
                    `select count(*) from public.notifications where user_id='${b}' and kind='chat_message' and resource_id='${hidden}'`,
                ),
                "1",
            );
            const unreadBefore = (await rows(b, "chat_rooms_list")).find(
                (x) => x.id === dm,
            ).unread_count;
            await assert.rejects(
                value(admin, "hide_chat_message", [hidden], "aal2"),
                /access denied/i,
            );
            await value(b, "hide_chat_message", [hidden]);
            await value(b, "hide_chat_message", [hidden]);
            const inbox = JSON.parse(await value(b, "notification_inbox"));
            assert.ok(inbox.items.some((item) => item.kind === "chat_message"));
            assert.ok(
                !JSON.stringify(inbox).includes("personal hide fictional marker"),
            );
            assert.equal(
                await sql(
                    `select hidden_generation from public.chat_members where room_id='${dm}' and user_id='${b}'`,
                ),
                "1",
            );
            assert.equal(
                (await rows(b, "chat_rooms_list")).find((x) => x.id === dm)
                    .unread_count,
                unreadBefore - 1,
            );
            assert.equal(
                (
                    await rows(b, "chat_messages", [
                        dm,
                        null,
                        null,
                        "personal hide fictional marker",
                        10,
                    ])
                ).length,
                0,
            );
            assert.equal(
                (
                    await rows(b, "chat_messages_with_mentions", [
                        dm,
                        null,
                        null,
                        "personal hide fictional marker",
                        10,
                    ])
                ).length,
                0,
            );
            assert.equal(
                await actor(
                    b,
                    `select count(*) from public.messages where id='${hidden}'`,
                ),
                "0",
            );
            assert.equal(
                (
                    await rows(a, "chat_messages", [
                        dm,
                        null,
                        null,
                        "personal hide fictional marker",
                        10,
                    ])
                ).length,
                1,
            );
            await assert.rejects(
                actor(b, "select * from private.chat_hidden_messages"),
                /permission denied/i,
            );
            const firstVisiblePage = await rows(b, "chat_messages", [
                dm,
                null,
                null,
                "",
                1,
            ]);
            assert.equal(firstVisiblePage.length, 1);
            assert.notEqual(firstVisiblePage[0].id, hidden);
            for (const [kind, id] of [
                ["account", b],
                ["chat_room", dm],
            ]) {
                const scope = JSON.parse(
                    await sql(`select private.deletion_snapshot('${kind}','${id}')`),
                );
                assert.equal(scope.counts["private.chat_hidden_messages"], 1);
                assert.ok(
                    !scope.blockers.some(
                        (entry) => entry.kind === "private.chat_hidden_messages",
                    ),
                );
            }
            const deletion = JSON.parse(
                await sql(`select private.deletion_snapshot('message','${hidden}')`),
            );
            assert.equal(deletion.counts["private.chat_hidden_messages"], 1);
            assert.ok(
                !deletion.blockers.some(
                    (entry) => entry.kind === "private.chat_hidden_messages",
                ),
            );
        },
    );
    await check(
        "Authored text is searched and pages use a stable timestamp/id cursor",
        async () => {
            await msg(b, dm, "Search Needle <script>alert(1)</script>");
            const page = await rows(a, "chat_messages", [dm, null, null, "", 2]);
            assert.equal(page.length, 2);
            const older = await rows(a, "chat_messages", [
                dm,
                page.at(-1).created_at,
                page.at(-1).id,
                "",
                2,
            ]);
            assert.ok(older.length > 0);
            assert.ok(older.every((x) => !page.some((p) => p.id === x.id)));
            const found = await rows(a, "chat_messages", [
                dm,
                null,
                null,
                "needle",
                10,
            ]);
            assert.equal(found.length, 1);
            assert.ok(found[0].body.includes("<script>"));
            assert.equal(found[0].sender_name, "Fictional Beta");
        },
    );
    await check(
        "Only sender edits within15minutes; immutable original request key survives edit",
        async () => {
            await assert.rejects(value(b, "edit_message", [first, "No"]), /denied/);
            await value(a, "edit_message", [first, "Corrected text"]);
            assert.equal(await msg(a, dm, "Hallo Beta", key), first);
            const revision = await actor(
                a,
                `select previous_body from public.chat_message_revisions where message_id='${first}'`,
            );
            assert.equal(revision, "Hallo Beta");
            assert.equal(
                await actor(
                    admin,
                    `select count(*) from public.chat_message_revisions where message_id='${first}'`,
                    "aal1",
                ),
                "0",
            );
            await sql(
                `update public.messages set created_at=now()-interval '16 minutes' where id='${first}'`,
            );
            await assert.rejects(
                value(a, "edit_message", [first, "Too late"]),
                /window has closed/,
            );
        },
    );
    await check(
        "Reactions are idempotent safe allowlist aggregates with tombstone removal",
        async () => {
            await value(b, "react_to_message", [first, "👍", false]);
            await value(b, "react_to_message", [first, "👍", false]);
            let data = (
                await rows(a, "chat_messages", [dm, null, null, "Corrected", 10])
            )[0];
            assert.deepEqual(data.reactions, [
                {emoji: "👍", count: 1, mine: false},
            ]);
            await value(b, "react_to_message", [first, "👍", true]);
            data = (
                await rows(a, "chat_messages", [dm, null, null, "Corrected", 10])
            )[0];
            assert.deepEqual(data.reactions, []);
            await assert.rejects(
                value(b, "react_to_message", [first, "<img>", false]),
                /Invalid reaction/,
            );
        },
    );
    await check(
        "Deletes are text-free tombstones and administrator moderation cannot bypass DM privacy",
        async () => {
            await assert.rejects(
                value(admin, "delete_message", [first], "aal1"),
                /denied/,
            );
            await value(a, "delete_message", [first]);
            const data = (await rows(b, "chat_messages", [dm])).find(
                (x) => x.id === first,
            );
            assert.equal(data.body, "");
            assert.equal(data.document_id, null);
            assert.ok(data.deleted_at);
            await assert.rejects(
                value(b, "react_to_message", [first, "👍", false]),
                /access denied/,
            );
        },
    );
    await check(
        "General room accepts explicit teaching roles, excludes other accounts and is singleton",
        async () => {
            const ids = await Promise.all([
                value(a, "ensure_general_chat"),
                value(b, "ensure_general_chat"),
            ]);
            assert.equal(ids[0], ids[1]);
            await assert.rejects(
                value(admin, "ensure_general_chat", [], "aal1"),
                /Lecturer role required/,
            );
            await sql(`insert into public.user_roles(user_id,role) values('${admin}','lecturer')`);
            assert.equal(
                await value(admin, "ensure_general_chat", [], "aal1"),
                ids[0],
            );
            await assert.rejects(
                value(participant, "ensure_general_chat"),
                /Lecturer role required/,
            );
            await sql(
                `delete from public.user_roles where user_id='${b}';insert into public.user_roles(user_id,role) values('${b}','participant')`,
            );
            await assert.rejects(rows(b, "chat_messages", [ids[0]]), /access denied/);
            assert.ok(
                !(await rows(b, "chat_rooms_list")).some((x) => x.id === ids[0]),
            );
            await sql(
                `delete from public.user_roles where user_id='${b}';insert into public.user_roles(user_id,role) values('${b}','lecturer')`,
            );
        },
    );
    let group;
    await check(
        "Only the topic group owner manages membership; participants are excluded",
        async () => {
            group = await value(a, "create_chat_group", ["Private Topic", `{${b}}`]);
            assert.equal((await rows(a, "chat_room_members", [group])).length, 2);
            await assert.rejects(
                value(b, "manage_chat_member", [group, c, false]),
                /Membership management denied/,
            );
            await assert.rejects(
                value(admin, "manage_chat_member", [group, c, false], "aal1"),
                /denied/,
            );
            await assert.rejects(
                value(a, "manage_chat_member", [group, participant, false]),
                /Invalid group member/,
            );
            await assert.rejects(
                value(a, "manage_chat_member", [group, a, true]),
                /owner must remain/,
            );
            await value(a, "manage_chat_member", [group, c, false]);
            assert.equal((await rows(c, "chat_room_members", [group])).length, 3);
        },
    );
    await check(
        "Pin order is personal, persists, and rejects stale concurrent moves",
        async () => {
            await value(a, "set_chat_pin", [dm, true]);
            await value(a, "set_chat_pin", [group, true]);
            await value(b, "set_chat_pin", [dm, true]);
            const reviewed = await value(a, "chat_pinned_rooms");
            assert.equal(reviewed, `{${dm},${group}}`);
            const moves = await Promise.allSettled([
                value(a, "move_chat_pin", [group, "up", reviewed]),
                value(a, "move_chat_pin", [group, "up", reviewed]),
            ]);
            assert.equal(
                moves.filter((result) => result.status === "fulfilled").length,
                1,
            );
            assert.equal(
                moves.filter(
                    (result) =>
                        result.status === "rejected" &&
                        /order changed/.test(String(result.reason)),
                ).length,
                1,
            );
            assert.equal(await value(a, "chat_pinned_rooms"), `{${group},${dm}}`);
            assert.equal(await value(b, "chat_pinned_rooms"), `{${dm}}`);
            await assert.rejects(
                value(b, "move_chat_pin", [group, "down", `{${dm}}`]),
                /access denied/i,
            );
            await assert.rejects(
                value(a, "move_chat_pin", [group, "up", `{${group},${dm}}`]),
                /already at the edge/i,
            );
            await value(a, "set_chat_pin", [group, false]);
            await value(a, "set_chat_pin", [dm, false]);
            await value(b, "set_chat_pin", [dm, false]);
        },
    );
    await check(
        "Revoked member immediately loses history/send/edit/reaction access but sees own revocation marker",
        async () => {
            const m = await msg(b, group, "Remove me");
            await value(b, "set_chat_pin", [group, true]);
            assert.match(await value(b, "chat_pinned_rooms"), new RegExp(group));
            await value(a, "manage_chat_member", [group, b, true]);
            assert.doesNotMatch(
                await value(b, "chat_pinned_rooms"),
                new RegExp(group),
            );
            await assert.rejects(
                value(b, "set_chat_pin", [group, false]),
                /access denied/i,
            );
            await assert.rejects(rows(b, "chat_messages", [group]), /access denied/);
            await assert.rejects(msg(b, group, "After removal"), /access denied/);
            await assert.rejects(value(b, "hide_chat_message", [m]), /access denied/);
            await assert.rejects(
                value(b, "edit_message", [m, "After removal"]),
                /denied/,
            );
            await assert.rejects(
                value(b, "react_to_message", [m, "👍", false]),
                /access denied/,
            );
            assert.equal(
                await actor(
                    b,
                    `select count(*) from public.messages where room_id='${group}'`,
                ),
                "0",
            );
            assert.equal(
                await actor(
                    b,
                    `select removed_at is not null from public.chat_members where room_id='${group}'`,
                ),
                "t",
            );
            assert.ok(
                !(await rows(b, "chat_rooms_list")).some((x) => x.id === group),
            );
        },
    );
    await check(
        "Course channels require active portal members and stay separate from commercial channels",
        async () => {
            const start = new Date(Date.now() + 90 * 86400000).toISOString(),
                end = new Date(Date.now() + 90 * 86400000 + 3600000).toISOString();
            const payload = {
                title: "Fictional participant course",
                customer_name: "Fictional academy",
                description: "test",
                delivery_type: "online",
                location: "",
                time_zone: "Europe/Berlin",
                status: "published",
                amount: 400,
                total_amount: 400,
                currency: "EUR",
                rate_unit: "fixed_total",
                terms: "test",
                sessions: [{starts_at: start, ends_at: end}],
                topic_ids: [],
            };
            const job = await actor(
                admin,
                `select public.create_job(${quote(JSON.stringify(payload))}::jsonb)`,
                "aal1",
            );
            const courseRun = await sql(
                    `select course_run_id
                 from public.jobs
                 where id = ${quote(job)}`,
                ),
                courseOrganisation = randomUUID();
            await sql(
                `insert into public.organisations(id, name)
             values (${quote(courseOrganisation)}, 'Fictional participant academy');
            update public.course_runs
            set organisation_id=${quote(courseOrganisation)}
            where id = ${quote(courseRun)}`,
            );
            await actor(
                admin,
                `select public.set_company_premium(${quote(courseOrganisation)},true,0,'${randomUUID()}')`,
                "aal1",
            );
            const room = await value(
                admin,
                "create_chat_group",
                ["Fictional course channel", `{${a},${b}}`, "participant_course", job],
                "aal1",
            );
            await assert.rejects(msg(participant, room, "Participant question"));
            assert.equal(
                await sql(
                    `select count(*) from public.chat_members where room_id=${quote(room)} and user_id=${quote(participant)}`,
                ),
                "0",
            );
            await assert.rejects(value(participant, "create_dm", [outsider]));
            const claimed = JSON.parse(
                await actor(a, `select public.claim_job('${job}','${randomUUID()}',1)`),
            );
            assert.equal(claimed.status, "confirmed");
            const commercial = (await rows(a, "chat_rooms_list")).find(
                (x) => x.job_id === job,
            );
            assert.equal(commercial.kind, "lecturer_course");
            assert.equal(commercial.owner_id, a);
            await assert.rejects(rows(participant, "chat_messages", [commercial.id]));
            await assert.rejects(
                value(a, "manage_chat_member", [commercial.id, participant, false]),
                /Invalid group member/,
            );
            await value(a, "manage_chat_member", [commercial.id, c, false]);
            const theirs = await msg(c, commercial.id, "Other staff");
            await assert.rejects(
                value(c, "delete_message", [
                    theirs === "never"
                        ? theirs
                        : await msg(a, commercial.id, "Owner content"),
                ]),
                /denied/,
            );
        },
    );
    await check(
        "Invalid documents, empty text, oversized text and direct table forgery fail",
        async () => {
            await assert.rejects(msg(a, dm, "", randomUUID()), /Invalid message/);
            await assert.rejects(msg(a, dm, "x".repeat(8001)), /Invalid message/);
            await assert.rejects(
                msg(a, dm, "", randomUUID(), randomUUID()),
                /Attachment is not available/,
            );
            await assert.rejects(
                actor(
                    a,
                    `insert into public.messages(room_id, sender_id, client_id, request_hash, body)
                     values ('${dm}', '${b}', '${randomUUID()}', 'forged', 'forged')`,
                ),
                /permission denied/,
            );
            await assert.rejects(
                actor(
                    a,
                    `update public.chat_members set removed_at=null where room_id='${group}'`,
                ),
                /permission denied/,
            );
        },
    );
    await check(
        "Suspension denies all existing-session chat access, including Realtime RLS source",
        async () => {
            await value(c, "set_chat_pin", [group, true]);
            await sql(`update public.profiles set active=false where id='${c}'`);
            assert.equal(await value(c, "chat_pinned_rooms"), "{}");
            await assert.rejects(
                value(c, "set_chat_pin", [group, false]),
                /access denied/i,
            );
            assert.deepEqual(await rows(c, "chat_rooms_list"), []);
            assert.deepEqual(await rows(c, "chat_contacts"), []);
            await assert.rejects(msg(c, group, "suspended"), /access denied/);
            await assert.rejects(
                value(c, "hide_chat_message", [first]),
                /access denied/,
            );
            assert.equal(await actor(c, "select count(*) from public.messages"), "0");
        },
    );
    await check(
        "Message rate limit is enforced transactionally and retries do not consume quota",
        async () => {
            const fresh = randomUUID();
            await sql(
                `insert into auth.users(id) values('${fresh}');insert into public.user_roles(user_id,role) values('${fresh}','lecturer')`,
            );
            const room = await value(fresh, "create_dm", [a]);
            const attempts = await Promise.allSettled(
                Array.from({length: 31}, () =>
                    msg(fresh, room, "Rate-limited content"),
                ),
            );
            assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 30);
            assert.equal(attempts.filter((x) => x.status === "rejected").length, 1);
        },
    );
    await check(
        "Anonymous RPC execution denied and all exposed chat tables enforce RLS",
        async () => {
            await assert.rejects(
                sql(`set role anon;select public.chat_rooms_list()`),
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
    console.log(
        `\n${checks} chat PostgreSQL checks passed (including concurrent DM and send races).`,
    );
} finally {
    await sql(`drop database if exists ${database} with(force)`, "postgres");
}