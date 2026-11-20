/** Real isolated PostgreSQL withdrawal decisions, privacy and complete-block release.
 * Auth helpers are emulated here; native Auth/HTTP acceptance remains separate. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

const execute = promisify(execFile);

await withTestDatabase(
    "claim_withdrawal",
    async ({sql, actor, container, database}) => {
        const [admin, manager, teacher, peer, participant, managerTeacher] =
            Array.from({length: 6}, randomUUID);
        await sql(`insert into auth.users(id,email) values ${[admin, manager, teacher, peer, participant, managerTeacher].map((id) => `(${q(id)},${q(id + "@example.invalid")})`).join(",")};
    insert into public.user_roles(user_id,role) values(${q(admin)},'admin'),(${q(manager)},'management'),(${q(teacher)},'lecturer'),(${q(peer)},'lecturer'),(${q(participant)},'participant'),(${q(managerTeacher)},'management'),(${q(managerTeacher)},'lecturer');`);
        await actor(
            admin,
            "select public.configure_compensation_policy(31,73,0)",
            "aal1",
        );
        const rpc = async (who, name, args = [], aal = "aal1") =>
            JSON.parse(
                await actor(who, `select public.${name}(${args.join(",")})`, aal),
            );
        let sequence = 0;
        let checks = 0;
        const check = async (name, run) => {
            await run();
            checks++;
            console.log(`PASS ${name}`);
        };
        /** Every fixture occupies a distinct hour, keeping ordinary teacher conflicts real. */
        const create = async ({days = 3, who = teacher} = {}) => {
            const start = Date.now() + days * 86400000 + sequence++ * 7200000;
            const job = await actor(
                admin,
                `select public.create_job(${q(
                    JSON.stringify({
                        title: "Fictional withdrawal teaching block",
                        customer_name: "Fictional withdrawal organisation",
                        delivery_type: "online",
                        status: "published",
                        amount: 100,
                        total_amount: 200,
                        currency: "EUR",
                        rate_unit: "per_day",
                        terms: "Accepted fictional withdrawal terms",
                        sessions: [0, 1].map((n) => ({
                            starts_at: new Date(start + n * 1800000).toISOString(),
                            ends_at: new Date(start + n * 1800000 + 900000).toISOString(),
                        })),
                    }),
                )}::jsonb)`,
                "aal1",
            );
            const version = await actor(
                who,
                `select item->>'terms_version' from jsonb_array_elements(public.job_offers()) item where item->>'id'=${q(job)}`,
                "aal1",
            );
            assert.match(version, /^[1-9][0-9]*$/);
            const claim = await rpc(
                who,
                "claim_job",
                [q(job), q(randomUUID()), version],
                "aal1",
            );
            assert.equal(claim.status, "confirmed");
            return {job, claim: claim.claim_id, who};
        };
        const list = (who, job, aal = "aal1") =>
            rpc(who, "assignment_withdrawals", job ? [q(job)] : [], aal);
        const request = (
            fixture,
            reason = "Fictional scheduling conflict",
            key = randomUUID(),
        ) =>
            rpc(
                fixture.who,
                "request_assignment_withdrawal",
                [q(fixture.claim), q(reason), q(key)],
                "aal1",
            );
        const review = (
            id,
            approve,
            who = manager,
            key = randomUUID(),
            reason = "Fictional management decision",
            aal = "aal1",
        ) =>
            rpc(
                who,
                "review_assignment_withdrawal",
                [q(id), String(approve), q(reason), q(key)],
                aal,
            );
        const cancel = (fixture, who = fixture.who, aal = "aal1") =>
            actor(
                who,
                `select public.cancel_job_assignment(${q(fixture.claim)},'Fictional cancellation reason',${q(randomUUID())})`,
                aal,
            );
        const snapshot = async (fixture) =>
            JSON.parse(
                await sql(
                    `select jsonb_build_object('claim',to_jsonb(c),'sessions',(select jsonb_agg(to_jsonb(s) order by s.starts_at) from public.assignment_sessions s where s.claim_id=c.id),'ledger',(select to_jsonb(l) from private.claim_revenue_ledger l where l.claim_id=c.id),'members',(select jsonb_agg(to_jsonb(m) order by m.room_id,m.user_id) from public.chat_members m join public.chat_rooms r on r.id=m.room_id where r.job_id=c.job_id),'job_status',(select status from public.jobs where id=c.job_id)) from public.job_claims c where c.id=${q(fixture.claim)}`,
                ),
            );
        const assertReleased = async (fixture, before) => {
            const after = await snapshot(fixture);
            assert.deepEqual(after.claim, {...before.claim, status: "cancelled"});
            assert.deepEqual(after.ledger, before.ledger);
            assert.equal(after.sessions.length, 2);
            after.sessions.forEach((session, index) => {
                assert.ok(session.released_at);
                assert.deepEqual(
                    {...session, released_at: null},
                    before.sessions[index],
                );
            });
            assert.equal(after.job_status, "published");
            assert.equal(
                await sql(
                    `select count(*) from public.chat_members m join public.chat_rooms r on r.id=m.room_id where r.job_id=${q(fixture.job)} and m.user_id=${q(fixture.who)} and m.removed_at is null`,
                ),
                "0",
            );
        };

        await check(
            "Only own assignments or current managers expose withdrawal reasons and capabilities",
            async () => {
                const fixture = await create();
                const own = await list(teacher, fixture.job);
                assert.equal(own.claims[0].requires_approval, true);
                assert.equal(own.claims[0].can_withdraw, true);
                assert.equal(own.can_review, false);
                assert.equal(
                    (await list(manager, fixture.job, "aal1")).can_review,
                    true,
                );
                const hidden = await list(peer, fixture.job);
                assert.deepEqual(hidden.items, []);
                assert.deepEqual(hidden.claims, []);
                assert.equal(hidden.can_review, false);
                await assert.rejects(
                    list(participant, fixture.job),
                    /Authentication required/,
                );
                for (const table of [
                    "assignment_withdrawals",
                    "assignment_withdrawal_commands",
                ])
                    await assert.rejects(
                        actor(teacher, `select * from private.${table}`),
                        /42501/,
                    );
                await assert.rejects(
                    actor(
                        teacher,
                        `select private.cancel_job_assignment_immediate(${q(fixture.claim)},'Fictional bypass attempt',${q(randomUUID())})`,
                    ),
                    /42501/,
                );
                for (const name of [
                    "assignment_withdrawals(uuid)",
                    "request_assignment_withdrawal(uuid,text,uuid)",
                    "review_assignment_withdrawal(uuid,boolean,text,uuid)",
                ])
                    assert.equal(
                        await sql(
                            `select has_function_privilege('anon',${q("public." + name)},'execute')`,
                        ),
                        "f",
                    );
            },
        );

        await check(
            "Strict PostgreSQL diagnostics validate all new withdrawal routines and trigger",
            async () => {
                await execute("docker", [
                    "exec",
                    container,
                    "psql",
                    "-U",
                    "supabase_admin",
                    "-d",
                    database,
                    "-X",
                    "-qAt",
                    "-v",
                    "ON_ERROR_STOP=1",
                    "-c",
                    "create extension plpgsql_check with schema extensions",
                ]);
                for (const signature of [
                    "private.cancel_job_assignment(uuid,text,uuid)",
                    "private.assignment_withdrawals(uuid)",
                    "private.request_assignment_withdrawal(uuid,text,uuid)",
                    "private.review_assignment_withdrawal(uuid,boolean,text,uuid)",
                    "private.job_lifecycle(uuid)",
                    "private.notification_target(text,uuid)",
                    "private.check_substitution_claim(uuid)",
                    "private.respond_job_substitution(uuid,text,text,uuid,boolean)",
                    "private.request_replacement(uuid,text,text,uuid[],boolean,uuid)",
                    "private.claim_replacement(uuid,integer,integer,uuid)",
                    "private.replacement_assignments()",
                    "private.participant_chat_assignment_grant(uuid,uuid)",
                    "private.participant_chat_assignment_release(uuid,uuid,uuid)",
                    "private.resolve_participant_chat_origin(uuid,uuid,boolean)",
                    "private.manage_chat_member(uuid,uuid,boolean)",
                    "private.create_chat_group(text,uuid[],text,uuid)",
                    "private.manage_course_enrolment(uuid,uuid,text)",
                    "private.cancel_job_assignment_immediate(uuid,text,uuid)",
                ])
                    assert.deepEqual(
                        JSON.parse(
                            await sql(
                                `select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from extensions.plpgsql_check_function_tb(${q(signature)}::regprocedure)t`,
                            ),
                        ),
                        [],
                        signature,
                    );
                assert.deepEqual(
                    JSON.parse(
                        await sql(
                            "select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb) from extensions.plpgsql_check_function_tb('private.supersede_assignment_withdrawals()'::regprocedure,'public.job_claims'::regclass)t",
                        ),
                    ),
                    [],
                );
            },
        );

        await check(
            "Seven-day-or-more withdrawal releases the entire block and preserves accepted snapshots",
            async () => {
                const fixture = await create({days: 10});
                const before = await snapshot(fixture);
                assert.equal(
                    (await list(teacher, fixture.job)).claims[0].requires_approval,
                    false,
                );
                const key = randomUUID();
                const result = await request(fixture, "", key);
                assert.equal(result.status, "withdrawn");
                await assertReleased(fixture, before);
                assert.deepEqual(await request(fixture, "", key), result);
                await assert.rejects(
                    request(fixture, "Changed retry reason", key),
                    /22023/,
                );
                assert.equal(
                    await sql(
                        `select count(*) from public.claim_events where claim_id=${q(fixture.claim)} and event_type='cancelled'`,
                    ),
                    "1",
                );
                assert.equal(
                    await sql(
                        `select count(*) from public.notifications where resource_id=${q(fixture.claim)} and kind='claim_cancelled'`,
                    ),
                    "1",
                );
            },
        );

        // Legacy rows are intentionally constructed without provenance to exercise
        // migration behaviour; the withdrawal and management calls are real RPCs.
        const participantRoom = async (fixture, mode) => {
            const room = randomUUID();
            const run = await sql(
                `select course_run_id from public.jobs where id=${q(fixture.job)}`,
            );
            assert.match(run, /^[0-9a-f-]{36}$/);
            const organisation = randomUUID();
            await sql(
                `insert into public.organisations(id,name) values(${q(organisation)},'Fictional withdrawal course company');update public.course_runs set organisation_id=${q(organisation)} where id=${q(run)}`,
            );
            await actor(
                admin,
                `select public.set_company_premium(${q(organisation)},true,0,${q(randomUUID())})`,
                "aal1",
            );
            await sql(`insert into public.chat_rooms(id,kind,title,owner_id,course_run_id) values(${q(room)},'participant_course','Fictional participant room',${q(admin)},${q(run)});
       insert into public.chat_members(room_id,user_id) values(${q(room)},${q(admin)});`);
            if (mode === "assignment")
                await sql(
                    `select private.participant_chat_assignment_grant(${q(room)},${q(fixture.who)});`,
                );
            await sql(
                `insert into public.chat_members(room_id,user_id) values(${q(room)},${q(fixture.who)});`,
            );
            return {run, room};
        };
        const isMember = (room, who = teacher) =>
            sql(
                `select exists(select 1 from public.chat_members where room_id=${q(room)} and user_id=${q(who)} and removed_at is null)`,
            );

        await check(
            "Unknown legacy participant access blocks withdrawal atomically until an authorised room manager explicitly resolves it",
            async () => {
                const fixture = await create({days: 10});
                const {room} = await participantRoom(fixture, "legacy");
                const before = await snapshot(fixture);
                await assert.rejects(request(fixture, ""), /PZ002/);
                assert.deepEqual(await snapshot(fixture), before);
                assert.equal(await isMember(room), "t");
                await assert.rejects(
                    actor(
                        peer,
                        `select public.manage_chat_member(${q(room)},${q(teacher)},false)`,
                    ),
                    /42501/,
                );
                await actor(
                    admin,
                    `select public.manage_chat_member(${q(room)},${q(teacher)},false)`,
                    "aal1",
                );
                assert.equal((await request(fixture, "")).status, "withdrawn");
                assert.equal(await isMember(room), "t");
            },
        );
        await check(
            "A manager can resolve unknown access as assignment-only without granting independent membership",
            async () => {
                const fixture = await create({days: 10});
                const {room} = await participantRoom(fixture, "legacy");
                await assert.rejects(
                    actor(
                        peer,
                        `select public.resolve_participant_chat_origin(${q(room)},${q(teacher)},false)`,
                    ),
                    /42501/,
                );
                await actor(
                    admin,
                    `select public.resolve_participant_chat_origin(${q(room)},${q(teacher)},false)`,
                    "aal1",
                );
                assert.equal((await request(fixture, "")).status, "withdrawn");
                assert.equal(await isMember(room), "f");
            },
        );
        await check(
            "Assignment-only participant access is removed atomically while explicit grants remain",
            async () => {
                const fixture = await create({days: 10});
                const {room} = await participantRoom(fixture, "assignment");
                assert.equal((await request(fixture, "")).status, "withdrawn");
                assert.equal(await isMember(room), "f");
                const manual = await create({days: 10});
                const second = await participantRoom(manual, "assignment");
                await actor(
                    admin,
                    `select public.manage_chat_member(${q(second.room)},${q(teacher)},false)`,
                    "aal1",
                );
                assert.equal((await request(manual, "")).status, "withdrawn");
                assert.equal(await isMember(second.room), "t");
            },
        );
        await check(
            "An independent course enrolment preserves access during an assignment withdrawal",
            async () => {
                const fixture = await create({days: 10});
                const {room, run} = await participantRoom(fixture, "assignment");
                await sql(
                    `insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by) values(${q(run)},${q(teacher)},'enrolled',${q(admin)})`,
                );
                assert.equal((await request(fixture, "")).status, "withdrawn");
                assert.equal(await isMember(room), "t");
                await sql(
                    `insert into public.user_roles(user_id,role) values(${q(teacher)},'participant')`,
                );
                await actor(
                    admin,
                    `select public.manage_course_enrolment(${q(run)},${q(teacher)},'removed')`,
                    "aal1",
                );
                await sql(
                    `delete from public.user_roles where user_id=${q(teacher)} and role='participant'`,
                );
                assert.equal(await isMember(room), "f");
            },
        );

        await check(
            "A second confirmed course assignment preserves participant access until its own release",
            async () => {
                const fixture = await create({days: 10});
                const {room, run} = await participantRoom(fixture, "assignment");
                const [otherJob, otherClaim] = Array.from({length: 2}, randomUUID);
                // The second real confirmed claim shares this run; its future allocation
                // is separate, so both withdrawals still use the public release path.
                await sql(`insert into public.jobs(id, course_run_id, title, customer_name, delivery_type, status, amount, currency, rate_unit, total_amount, terms)
                           values (${q(otherJob)}, ${q(run)}, 'Fictional second assignment', 'Fictional academy', 'online', 'published', 100, 'EUR', 'per_day', 100, 'Fictional terms');
                insert into public.job_claims(id, job_id, lecturer_id, idempotency_key, amount, currency, rate_unit, total_amount, terms, terms_version)
                values (${q(otherClaim)}, ${q(otherJob)}, ${q(teacher)}, ${q(randomUUID())}, 100, 'EUR', 'per_day', 100, 'Fictional terms', 1);
                insert into public.assignment_sessions(claim_id, lecturer_id, starts_at, ends_at)
                values (${q(otherClaim)}, ${q(teacher)}, now() + interval '40 days', now() + interval '40 days 1 hour');`);
                assert.equal((await request(fixture, "")).status, "withdrawn");
                assert.equal(await isMember(room), "t");
                assert.equal(
                    (
                        await request(
                            {job: otherJob, claim: otherClaim, who: teacher},
                            "",
                        )
                    ).status,
                    "withdrawn",
                );
                assert.equal(await isMember(room), "f");
            },
        );

        await check(
            "Legacy enrolment removal requires an explicit membership decision and never guesses access provenance",
            async () => {
                const fixture = await create({days: 10});
                const {room, run} = await participantRoom(fixture, "legacy");
                await sql(`insert into public.chat_members(room_id,user_id) values(${q(room)},${q(participant)});
       insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by) values(${q(run)},${q(participant)},'enrolled',${q(admin)});`);
                await assert.rejects(
                    actor(
                        admin,
                        `select public.manage_course_enrolment(${q(run)},${q(participant)},'removed')`,
                        "aal1",
                    ),
                    /PZ002/,
                );
                assert.equal(
                    await sql(
                        `select status from public.course_enrolments where course_run_id=${q(run)} and user_id=${q(participant)}`,
                    ),
                    "enrolled",
                );
                await actor(
                    admin,
                    `select public.resolve_participant_chat_origin(${q(room)},${q(participant)},true)`,
                    "aal1",
                );
                await actor(
                    admin,
                    `select public.manage_course_enrolment(${q(run)},${q(participant)},'removed')`,
                    "aal1",
                );
                assert.equal(await isMember(room, participant), "t");
            },
        );

        await check(
            "The notice window uses 168 elapsed hours at the first session, across the seven-day boundary",
            async () => {
                for (const [seconds, expected] of [
                    [60, "withdrawn"],
                    [-60, "pending"],
                ]) {
                    const fixture = await create({days: 8});
                    await sql(`update public.assignment_sessions set starts_at=starts_at+shift.delta,ends_at=ends_at+shift.delta
        from(select clock_timestamp()+interval '168 hours'+${seconds}*interval '1 second'-min(starts_at) delta from public.assignment_sessions where claim_id=${q(fixture.claim)})shift where claim_id=${q(fixture.claim)}`);
                    const current = await list(teacher, fixture.job);
                    assert.equal(current.claims[0].requires_approval, seconds < 0);
                    assert.equal((await request(fixture)).status, expected);
                }
            },
        );

        await check(
            "Under seven days requires a bounded reason and pending requests retain all allocations and access",
            async () => {
                const fixture = await create();
                const before = await snapshot(fixture);
                for (const reason of ["", "  ", "no", "x".repeat(1001)])
                    await assert.rejects(request(fixture, reason), /22023/);
                assert.deepEqual(await snapshot(fixture), before);
                const result = await request(fixture);
                assert.equal(result.status, "pending");
                assert.deepEqual(await snapshot(fixture), before);
                assert.equal(
                    await sql(
                        `select count(*) from public.audit_events where details::text like '%Fictional scheduling conflict%'`,
                    ),
                    "0",
                    "Potentially sensitive application text stays outside public audit details",
                );
                const own = await list(teacher, fixture.job);
                assert.equal(own.claims[0].can_withdraw, false);
                assert.equal(own.items[0].id, result.id);
                assert.equal(own.items[0].reason, "Fictional scheduling conflict");
                assert.equal(own.items[0].can_review, false);
                assert.equal(
                    (await list(manager, fixture.job, "aal1")).items[0].can_review,
                    true,
                );
                assert.equal((await list(peer)).items.length, 0);
                for (const who of [admin, manager, teacher]) {
                    const inbox = await rpc(who, "notification_inbox", [], "aal1");
                    assert.ok(
                        inbox.items.some(
                            (item) =>
                                item.kind === "assignment_withdrawal_requested" &&
                                item.href === `/jobs/${fixture.job}`,
                        ),
                    );
                }
                assert.equal(
                    (await rpc(peer, "notification_inbox")).items.filter(
                        (item) => item.href === `/jobs/${fixture.job}`,
                    ).length,
                    0,
                );
            },
        );

        await check(
            "Legacy direct cancellation and forged peer requests cannot bypass the short-notice decision",
            async () => {
                const fixture = await create();
                const before = await snapshot(fixture);
                await assert.rejects(cancel(fixture), /22023|42501/);
                await assert.rejects(request({...fixture, who: peer}), /42501/);
                await assert.rejects(
                    request({...fixture, who: participant}),
                    /42501/,
                );
                assert.deepEqual(await snapshot(fixture), before);
                const managerFixture = await create({who: managerTeacher});
                await assert.rejects(
                    cancel(managerFixture, managerTeacher, "aal1"),
                    /22023|42501/,
                );
                const result = await request(managerFixture);
                await assert.rejects(review(result.id, true, managerTeacher), /42501/);
                assert.equal(
                    (await snapshot(managerFixture)).claim.status,
                    "confirmed",
                );
            },
        );

        await check(
            "Management rejection leaves the complete assignment binding and sends one durable receipt",
            async () => {
                const fixture = await create();
                const before = await snapshot(fixture);
                const result = await request(fixture);
                const key = randomUUID();
                for (const invalidReason of ["", "no", "x".repeat(1001)])
                    await assert.rejects(
                        review(result.id, false, manager, randomUUID(), invalidReason),
                        /22023/,
                    );
                const rejected = await review(result.id, false, manager, key);
                assert.equal(rejected.status, "rejected");
                assert.deepEqual(
                    await review(result.id, false, manager, key),
                    rejected,
                );
                await assert.rejects(review(result.id, true, manager, key), /22023/);
                assert.deepEqual(await snapshot(fixture), before);
                const own = await list(teacher, fixture.job);
                assert.equal(
                    own.items[0].review_reason,
                    "Fictional management decision",
                );
                assert.equal(own.items[0].status, "rejected");
                assert.equal(own.claims[0].can_withdraw, true);
                assert.equal(
                    (await rpc(teacher, "notification_inbox")).items.filter(
                        (item) =>
                            item.href === `/jobs/${fixture.job}` &&
                            item.kind === "assignment_withdrawal_rejected",
                    ).length,
                    1,
                );
                assert.equal(
                    (await request(fixture, "Fictional new circumstances")).status,
                    "pending",
                );
            },
        );

        await check(
            "Administration approval is atomic and releases every session once with immutable money and terms",
            async () => {
                const fixture = await create();
                const before = await snapshot(fixture);
                const result = await request(fixture);
                const key = randomUUID();
                const approved = await review(result.id, true, admin, key);
                assert.equal(approved.status, "approved");
                assert.deepEqual(await review(result.id, true, admin, key), approved);
                await assertReleased(fixture, before);
                assert.equal(
                    (await list(teacher, fixture.job)).items[0].can_review,
                    false,
                );
                assert.equal(
                    (await rpc(teacher, "notification_inbox")).items.filter(
                        (item) =>
                            item.href === `/jobs/${fixture.job}` &&
                            item.kind === "assignment_withdrawal_approved",
                    ).length,
                    1,
                );
                assert.equal(
                    await sql(
                        `select count(*) from public.claim_events where claim_id=${q(fixture.claim)} and event_type='cancelled'`,
                    ),
                    "1",
                );
            },
        );

        await check(
            "Request retries converge; competing approval/rejection commits exactly one decision",
            async () => {
                const fixture = await create();
                const key = randomUUID();
                const attempts = await Promise.all(
                    Array.from({length: 8}, () =>
                        request(fixture, "Fictional concurrent retry", key),
                    ),
                );
                assert.equal(new Set(attempts.map((item) => item.id)).size, 1);
                assert.equal((await list(teacher, fixture.job)).items.length, 1);
                const result = attempts[0];
                const reviewed = await Promise.allSettled([
                    review(result.id, true, admin),
                    review(result.id, false, manager),
                ]);
                assert.equal(
                    reviewed.filter((item) => item.status === "fulfilled").length,
                    1,
                );
                const final = (await list(teacher, fixture.job)).items[0];
                assert.ok(["approved", "rejected"].includes(final.status));
                assert.equal(
                    (await snapshot(fixture)).claim.status,
                    final.status === "approved" ? "cancelled" : "confirmed",
                );
            },
        );

        await check(
            "permission, current role and requester boundaries remain authoritative for every review",
            async () => {
                const fixture = await create();
                const result = await request(fixture);
                const before = await snapshot(fixture);
                for (const who of [teacher, peer, participant])
                    await assert.rejects(review(result.id, true, who), /42501/);
                await sql(
                    `delete from public.user_roles where user_id=${q(manager)} and role='management'`,
                );
                try {
                    await assert.rejects(review(result.id, true, manager), /42501/);
                    assert.deepEqual(await snapshot(fixture), before);
                    assert.equal(
                        (await list(teacher, fixture.job)).items[0].status,
                        "pending",
                    );
                } finally {
                    await sql(
                        `insert into public.user_roles(user_id,role) values(${q(manager)},'management')`,
                    );
                }
            },
        );

        /** Observe actual database waits so the revocation regression cannot pass
         * merely because the writer happened to begin after the role change. */
        const barrier = async (tag, condition, attempts = 100) => {
            for (let attempt = 0; attempt < attempts; attempt++) {
                if (
                    (await sql(
                        `select exists(select 1 from pg_stat_activity where datname=current_database() and application_name=${q(tag)} and ${condition})`,
                    )) === "t"
                )
                    return;
                await new Promise((resolve) => setTimeout(resolve, 10));
            }
            throw new Error(
                "The actual withdrawal profile-lock barrier was not observed",
            );
        };
        await check(
            "A real concurrent claim serializes enrolment and manual membership removal",
            async () => {
                for (const mode of ["enrolment", "manual"]) {
                    const fixture = await create({days: 10});
                    const {room, run} = await participantRoom(fixture, "assignment");
                    if (mode === "enrolment") {
                        await sql(`insert into public.user_roles(user_id,role) values(${q(teacher)},'participant');
           insert into public.course_enrolments(course_run_id,user_id,status,enrolled_by) values(${q(run)},${q(teacher)},'enrolled',${q(admin)});`);
                    } else {
                        await actor(
                            admin,
                            `select public.manage_chat_member(${q(room)},${q(teacher)},false)`,
                            "aal1",
                        );
                    }
                    assert.equal((await request(fixture, "")).status, "withdrawn");
                    const nextJob = randomUUID();
                    await sql(`insert into public.jobs(id,course_run_id,title,customer_name,delivery_type,status,amount,currency,rate_unit,total_amount,terms)
         values(${q(nextJob)},${q(run)},'Fictional simultaneous claim','Fictional academy','online','published',100,'EUR','per_day',100,'Fictional terms');
         insert into public.job_sessions(job_id,starts_at,ends_at) values(${q(nextJob)},now()+${mode === "enrolment" ? "interval '80 days'" : "interval '100 days'"},now()+${mode === "enrolment" ? "interval '80 days 1 hour'" : "interval '100 days 1 hour'"});`);
                    const claimTag = `origin_claim_${randomUUID().replaceAll("-", "")}`;
                    const removeTag = `origin_remove_${randomUUID().replaceAll("-", "")}`;
                    const claiming = actor(
                        teacher,
                        `set local application_name=${q(claimTag)};select public.claim_job(${q(nextJob)},${q(randomUUID())},1);select pg_sleep(2)`,
                    );
                    let removing;
                    try {
                        await barrier(claimTag, "wait_event='PgSleep'");
                        const statement =
                            mode === "enrolment"
                                ? `select public.manage_course_enrolment(${q(run)},${q(teacher)},'removed')`
                                : `select public.manage_chat_member(${q(room)},${q(teacher)},true)`;
                        removing = actor(
                            admin,
                            `set local application_name=${q(removeTag)};${statement}`,
                            "aal1",
                        );
                        const outcomes = Promise.allSettled([claiming, removing]);
                        await barrier(removeTag, "wait_event_type='Lock'");
                        const [claimed, removed] = await outcomes;
                        assert.equal(claimed.status, "fulfilled");
                        assert.match(claimed.value, /"status": "confirmed"/);
                        assert.equal(
                            removed.status,
                            mode === "enrolment" ? "fulfilled" : "rejected",
                        );
                        if (removed.status === "rejected")
                            assert.match(removed.reason.message, /22023/);
                        assert.equal(await isMember(room), "t");
                    } finally {
                        await Promise.allSettled([
                            claiming,
                            ...(removing ? [removing] : []),
                        ]);
                        if (mode === "enrolment")
                            await sql(
                                `delete from public.user_roles where user_id=${q(teacher)} and role='participant'`,
                            );
                    }
                }
            },
        );
        const revokeWhileQueued = async (who, statement, aal) => {
            const revokeTag = `withdrawal_revoke_${randomUUID().replaceAll("-", "")}`;
            const writeTag = `withdrawal_write_${randomUUID().replaceAll("-", "")}`;
            const revoker = actor(
                admin,
                `set local application_name=${q(revokeTag)};select public.set_account_roles(${q(who)},array['guest']);select pg_sleep(2)`,
                "aal1",
            );
            let writer;
            try {
                await barrier(revokeTag, "wait_event='PgSleep'");
                writer = actor(
                    who,
                    `set local application_name=${q(writeTag)};${statement}`,
                    aal,
                );
                const settled = Promise.allSettled([revoker, writer]);
                await barrier(writeTag, "wait_event_type='Lock'");
                const results = await settled;
                assert.equal(results[0].status, "fulfilled");
                assert.equal(results[1].status, "rejected");
                assert.match(results[1].reason.message, /42501/);
            } finally {
                await Promise.allSettled([revoker, ...(writer ? [writer] : [])]);
                await actor(
                    admin,
                    `select public.set_account_roles(${q(who)},array[${q(who === manager ? "management" : "lecturer")}])`,
                    "aal1",
                );
            }
        };
        await check(
            "Queued lecturer withdrawal rechecks committed role revocation after the profile lock",
            async () => {
                const fixture = await create();
                const before = await snapshot(fixture);
                await revokeWhileQueued(
                    teacher,
                    `select public.request_assignment_withdrawal(${q(fixture.claim)},'Fictional queued request',${q(randomUUID())})`,
                    "aal1",
                );
                assert.deepEqual(await snapshot(fixture), before);
                assert.deepEqual((await list(teacher, fixture.job)).items, []);
            },
        );
        await check(
            "Queued management review rechecks committed role revocation after the profile lock",
            async () => {
                const fixture = await create();
                const pending = await request(fixture);
                const before = await snapshot(fixture);
                await revokeWhileQueued(
                    manager,
                    `select public.review_assignment_withdrawal(${q(pending.id)},true,'Fictional queued decision',${q(randomUUID())})`,
                    "aal1",
                );
                assert.deepEqual(await snapshot(fixture), before);
                assert.equal(
                    (await list(teacher, fixture.job)).items[0].status,
                    "pending",
                );
            },
        );

        await check(
            "Administrative cancellation closes a pending application and prevents a stale later decision",
            async () => {
                const fixture = await create();
                const pending = await request(fixture);
                const before = await snapshot(fixture);
                await cancel(fixture, admin, "aal1");
                await assertReleased(fixture, before);
                assert.equal(
                    (await list(teacher, fixture.job)).items[0].status,
                    "superseded",
                );
                assert.equal(
                    (await list(manager, fixture.job, "aal1")).items[0].can_review,
                    false,
                );
                await assert.rejects(review(pending.id, true), /40001/);
            },
        );

        await check(
            "Started work cannot create or approve a withdrawal and never partially releases a block",
            async () => {
                const fixture = await create();
                const pending = await request(fixture);
                await sql(
                    `update public.assignment_sessions set starts_at=starts_at-interval '10 days',ends_at=ends_at-interval '10 days' where claim_id=${q(fixture.claim)}`,
                );
                const before = await snapshot(fixture);
                await assert.rejects(review(pending.id, true), /22023/);
                await assert.rejects(request(fixture), /22023/);
                assert.deepEqual(await snapshot(fixture), before);
            },
        );

        await check(
            "Invoiced work blocks release even after the original short-notice application was submitted",
            async () => {
                const fixture = await create();
                const pending = await request(fixture);
                const document = randomUUID(),
                    version = randomUUID(),
                    key = randomUUID();
                await sql(`insert into public.documents(id,owner_id,uploaded_by,scope,kind,original_name,mime_type,size_bytes,status,client_id) values(${q(document)},${q(teacher)},${q(teacher)},'personal','invoice','Fictional withdrawal invoice.pdf','application/pdf',100,'clean',${q(key)});
      insert into public.document_versions(id,document_id,uploaded_by,client_id,version,object_path,original_name,mime_type,size_bytes,sha256,status) values(${q(version)},${q(document)},${q(teacher)},${q(key)},1,${q(`${teacher}/${document}/${version}`)},'Fictional withdrawal invoice.pdf','application/pdf',100,${q("1".repeat(64))},'clean');
      update public.documents set current_version_id=${q(version)} where id=${q(document)}`);
                await actor(
                    teacher,
                    `select public.submit_invoice('Fictional withdrawal invoice',array[${q(fixture.claim)}::uuid],${q(version)},current_date,current_date+7,${q(randomUUID())})`,
                );
                const before = await snapshot(fixture);
                await assert.rejects(review(pending.id, true), /22023/);
                await assert.rejects(request(fixture), /22023/);
                assert.deepEqual(await snapshot(fixture), before);
                assert.equal(
                    (await list(teacher, fixture.job)).claims[0].can_withdraw,
                    false,
                );
            },
        );

        const propose = (fixture, who = fixture.who) =>
            actor(
                who,
                `select public.propose_job_substitution(${q(fixture.claim)},${q(peer)},'Fictional complete replacement request',${q(randomUUID())})`,
                "aal1",
            );
        const targetOffer = async (id) =>
            (await rpc(peer, "job_substitutions")).find((offer) => offer.id === id);
        const accept = (offer, key = randomUUID()) =>
            rpc(peer, "respond_job_substitution", [
                q(offer.id),
                "'accept'",
                q(offer.quote_hash),
                q(key),
                "true",
            ]);
        const handoverSnapshot = (fixture) =>
            sql(`select jsonb_build_object(
      'claims',(select jsonb_agg(to_jsonb(c) order by c.id) from public.job_claims c where c.job_id=${q(fixture.job)}),
      'sessions',(select jsonb_agg(to_jsonb(s) order by s.id) from public.assignment_sessions s join public.job_claims c on c.id=s.claim_id where c.job_id=${q(fixture.job)}),
      'directed',(select jsonb_agg(to_jsonb(o) order by o.id) from private.job_substitutions o where o.job_id=${q(fixture.job)}),
      'marketplace',(select jsonb_agg(to_jsonb(o) order by o.id) from private.replacement_offers o where o.original_claim_id=${q(fixture.claim)}),
      'ledger',(select jsonb_agg(to_jsonb(l) order by l.claim_id) from private.claim_revenue_ledger l where l.job_id=${q(fixture.job)}))`);

        await check(
            "A short-notice source lecturer cannot bypass review through a directed substitute, including management's own assignment",
            async () => {
                for (const who of [teacher, managerTeacher]) {
                    const fixture = await create({who});
                    const before = await handoverSnapshot(fixture);
                    await assert.rejects(
                        propose(fixture),
                        /22023:[^\n]*Short-notice withdrawal/,
                    );
                    assert.equal(await handoverSnapshot(fixture), before);
                }
            },
        );

        await check(
            "An earlier lecturer-proposed substitute cannot cross into the short-notice window without review",
            async () => {
                const fixture = await create({days: 10});
                const offer = await targetOffer(await propose(fixture));
                await sql(
                    `update public.assignment_sessions set starts_at=starts_at-interval '7 days',ends_at=ends_at-interval '7 days' where claim_id=${q(fixture.claim)}`,
                );
                const before = await handoverSnapshot(fixture);
                await assert.rejects(
                    accept(offer),
                    /22023:[^\n]*Short-notice withdrawal/,
                );
                assert.equal(await handoverSnapshot(fixture), before);
            },
        );

        await check(
            "Exact historical lecturer-proposed consent inside seven days still cannot release the source",
            async () => {
                const fixture = await create();
                const id = randomUUID();
                // A coherent historical fixture models time passing since a proposal was
                // originally made outside the window. Its unchanged quote exactly equals
                // the current canonical quote, so stale terms cannot explain the denial.
                await sql(`insert into private.job_substitutions(id, original_claim_id, job_id, target_user_id, proposed_by, request_id, reason, quote, quote_hash, pricing_context, expires_at, created_at)
                           select ${q(id)},
                                  ${q(fixture.claim)},
                                  ${q(fixture.job)},
                                  ${q(peer)},
                                  ${q(teacher)},
                                  ${q(randomUUID())},
                                  'Fictional historical source proposal',
                                  quote,
                                  encode(sha256(convert_to(quote::text, 'UTF8')), 'hex'),
                                  private.substitution_pricing_context(${q(fixture.claim)}, ${q(peer)}),
                                  clock_timestamp() + interval '2 days', clock_timestamp()- interval '5 days'
                           from (select private.substitution_target_quote(${q(fixture.claim)}, ${q(peer)}) quote) canonical`);
                const offer = await targetOffer(id);
                assert.equal(
                    await sql(
                        `select (quote=private.substitution_target_quote(original_claim_id,target_user_id))::text from private.job_substitutions where id=${q(id)}`,
                    ),
                    "true",
                );
                const before = await handoverSnapshot(fixture);
                await assert.rejects(
                    accept(offer),
                    /22023:[^\n]*Short-notice withdrawal/,
                );
                assert.equal(await handoverSnapshot(fixture), before);
            },
        );

        await check(
            "A distinct current management proposal permits an atomic short-notice substitute and historical receipt retries",
            async () => {
                const fixture = await create();
                const before = await snapshot(fixture);
                const offer = await targetOffer(await propose(fixture, manager));
                const key = randomUUID();
                const result = await accept(offer, key);
                assert.equal(result.status, "confirmed");
                const after = await snapshot(fixture);
                assert.deepEqual(after.claim, {...before.claim, status: "cancelled"});
                assert.deepEqual(after.ledger, before.ledger);
                assert.equal(
                    after.sessions.filter((session) => session.released_at).length,
                    2,
                );
                assert.equal(
                    await sql(
                        `select count(*) from public.assignment_sessions where claim_id=${q(result.claim_id)} and lecturer_id=${q(peer)} and released_at is null`,
                    ),
                    "2",
                );
                await actor(
                    admin,
                    `select public.set_account_roles(${q(manager)},array['guest'])`,
                    "aal1",
                );
                try {
                    assert.deepEqual(
                        await accept(offer, key),
                        result,
                        "Historical acceptance remains a truthful receipt after the approving manager's later role change",
                    );
                } finally {
                    await actor(
                        admin,
                        `select public.set_account_roles(${q(manager)},array['management'])`,
                        "aal1",
                    );
                }
            },
        );

        await check(
            "Revoked management provenance cannot authorize a pending short-notice substitute",
            async () => {
                const fixture = await create();
                const offer = await targetOffer(await propose(fixture, manager));
                const before = await handoverSnapshot(fixture);
                await actor(
                    admin,
                    `select public.set_account_roles(${q(manager)},array['guest'])`,
                    "aal1",
                );
                try {
                    await assert.rejects(
                        accept(offer),
                        /22023:[^\n]*Short-notice withdrawal/,
                    );
                    assert.equal(await handoverSnapshot(fixture), before);
                } finally {
                    await actor(
                        admin,
                        `select public.set_account_roles(${q(manager)},array['management'])`,
                        "aal1",
                    );
                }
            },
        );

        await check(
            "Queued short-notice substitute acceptance observes the proposer's committed management revocation",
            async () => {
                const fixture = await create();
                const offer = await targetOffer(await propose(fixture, manager));
                const before = await handoverSnapshot(fixture);
                const revokeTag = `substitute_revoke_${randomUUID().replaceAll("-", "")}`;
                const writeTag = `substitute_accept_${randomUUID().replaceAll("-", "")}`;
                const revoker = actor(
                    admin,
                    `set local application_name=${q(revokeTag)};select public.set_account_roles(${q(manager)},array['guest']);select pg_sleep(2)`,
                    "aal1",
                );
                let writer;
                try {
                    await barrier(revokeTag, "wait_event='PgSleep'");
                    writer = actor(
                        peer,
                        `set local application_name=${q(writeTag)};select public.respond_job_substitution(${q(offer.id)},'accept',${q(offer.quote_hash)},${q(randomUUID())},true)`,
                    );
                    const settled = Promise.allSettled([revoker, writer]);
                    await barrier(writeTag, "wait_event_type='Lock'");
                    const results = await settled;
                    assert.equal(results[0].status, "fulfilled");
                    assert.equal(results[1].status, "rejected");
                    assert.match(
                        results[1].reason.message,
                        /22023:[^\n]*Short-notice withdrawal/,
                    );
                    assert.equal(await handoverSnapshot(fixture), before);
                } finally {
                    await Promise.allSettled([revoker, ...(writer ? [writer] : [])]);
                    await actor(
                        admin,
                        `select public.set_account_roles(${q(manager)},array['management'])`,
                        "aal1",
                    );
                }
            },
        );

        const requestMarket = (fixture, who = fixture.who) =>
            actor(
                who,
                `select public.request_replacement(${q(fixture.claim)},'Fictional marketplace replacement','open','{}',false,${q(randomUUID())})`,
                "aal1",
            );
        const marketOffer = async (id) =>
            (await rpc(peer, "replacement_marketplace")).find(
                (offer) => offer.id === id,
            );
        const takeMarket = (offer) =>
            rpc(peer, "claim_replacement", [
                q(offer.id),
                String(offer.version),
                String(offer.quote.terms_version),
                q(randomUUID()),
            ]);
        await check(
            "A short-notice source cannot bypass review through an open replacement marketplace offer",
            async () => {
                for (const who of [teacher, managerTeacher]) {
                    const fixture = await create({who});
                    const before = await handoverSnapshot(fixture);
                    await assert.rejects(
                        requestMarket(fixture),
                        /22023:[^\n]*Short-notice withdrawal/,
                    );
                    assert.equal(await handoverSnapshot(fixture), before);
                }
            },
        );
        await check(
            "An older source-opened marketplace offer cannot release work after entering the short-notice window",
            async () => {
                const fixture = await create({days: 10});
                const id = await requestMarket(fixture);
                await sql(`update public.assignment_sessions set starts_at=starts_at-interval '7 days',ends_at=ends_at-interval '7 days' where claim_id=${q(fixture.claim)};
        update public.job_sessions set starts_at=starts_at-interval '7 days',ends_at=ends_at-interval '7 days' where job_id=${q(fixture.job)}`);
                const offer = await marketOffer(id);
                assert.ok(offer?.quote);
                const before = await handoverSnapshot(fixture);
                await assert.rejects(
                    takeMarket(offer),
                    /22023:[^\n]*Short-notice withdrawal/,
                );
                assert.equal(await handoverSnapshot(fixture), before);
            },
        );
        await check(
            "Distinct management may authorize a complete short-notice marketplace replacement",
            async () => {
                const fixture = await create();
                const offer = await marketOffer(await requestMarket(fixture, manager));
                const result = await takeMarket(offer);
                assert.equal(result.status, "confirmed");
                assert.equal(
                    await sql(
                        `select status from public.job_claims where id=${q(fixture.claim)}`,
                    ),
                    "cancelled",
                );
                assert.equal(
                    await sql(
                        `select count(*) from public.assignment_sessions where claim_id=${q(result.claim_id)} and lecturer_id=${q(peer)} and released_at is null`,
                    ),
                    "2",
                );
            },
        );
        await check(
            "Marketplace claims recheck management provenance after both committed revocation and a real profile-lock wait",
            async () => {
                const fixture = await create();
                const offer = await marketOffer(await requestMarket(fixture, manager));
                const before = await handoverSnapshot(fixture);
                await actor(
                    admin,
                    `select public.set_account_roles(${q(manager)},array['guest'])`,
                    "aal1",
                );
                try {
                    await assert.rejects(
                        takeMarket(offer),
                        /22023:[^\n]*Short-notice withdrawal/,
                    );
                    assert.equal(await handoverSnapshot(fixture), before);
                } finally {
                    await actor(
                        admin,
                        `select public.set_account_roles(${q(manager)},array['management'])`,
                        "aal1",
                    );
                }
                const revokeTag = `market_revoke_${randomUUID().replaceAll("-", "")}`;
                const writeTag = `market_claim_${randomUUID().replaceAll("-", "")}`;
                const revoker = actor(
                    admin,
                    `set local application_name=${q(revokeTag)};select public.set_account_roles(${q(manager)},array['guest']);select pg_sleep(2)`,
                    "aal1",
                );
                let writer;
                try {
                    await barrier(revokeTag, "wait_event='PgSleep'");
                    writer = actor(
                        peer,
                        `set local application_name=${q(writeTag)};select public.claim_replacement(${q(offer.id)},${offer.version},${offer.quote.terms_version},${q(randomUUID())})`,
                    );
                    const settled = Promise.allSettled([revoker, writer]);
                    await barrier(writeTag, "wait_event_type='Lock'");
                    const results = await settled;
                    assert.equal(results[0].status, "fulfilled");
                    assert.equal(results[1].status, "rejected");
                    assert.match(
                        results[1].reason.message,
                        /22023:[^\n]*Short-notice withdrawal/,
                    );
                    assert.equal(await handoverSnapshot(fixture), before);
                } finally {
                    await Promise.allSettled([revoker, ...(writer ? [writer] : [])]);
                    await actor(
                        admin,
                        `select public.set_account_roles(${q(manager)},array['management'])`,
                        "aal1",
                    );
                }
            },
        );
        await check(
            "A directed acceptance waiting across the exact 168-hour cutoff rechecks actual post-lock time",
            async () => {
                const source = randomUUID();
                await sql(
                    `insert into auth.users(id,email) values(${q(source)},${q(source + "@example.invalid")});insert into public.user_roles(user_id,role) values(${q(source)},'lecturer')`,
                );
                const fixture = await create({days: 8, who: source});
                // The dedicated lecturer avoids unrelated allocations at this boundary.
                // Capture a real quote outside the window; only elapsed wall time changes
                // between proposal and acceptance, so every consent field remains exact.
                await sql(`update public.assignment_sessions set starts_at=starts_at+shift.delta,ends_at=ends_at+shift.delta
        from(select clock_timestamp()+interval '168 hours 30 seconds'-min(starts_at) delta from public.assignment_sessions where claim_id=${q(fixture.claim)})shift where claim_id=${q(fixture.claim)}`);
                const offer = await targetOffer(await propose(fixture));
                const before = await handoverSnapshot(fixture);
                const lockTag = `cutoff_holder_${randomUUID().replaceAll("-", "")}`;
                const acceptTag = `cutoff_accept_${randomUUID().replaceAll("-", "")}`;
                // The holder waits until explicitly cancelled, rather than releasing on a
                // guessed delay. Its tag names only this disposable test backend.
                const holder = sql(
                    `begin;set local application_name=${q(lockTag)};select id from public.jobs where id=${q(fixture.job)} for update;select pg_sleep(120);commit`,
                );
                // Attach a rejection handler immediately: cancellation is an expected SQL
                // result and must never surface as an unhandled promise rejection.
                const holderResult = Promise.allSettled([holder]);
                let writer;
                try {
                    await barrier(lockTag, "wait_event='PgSleep'", 500);
                    // Reproduce a slow runner *after* the real job lock is acquired.
                    // It cannot make an elapsed-time assertion pass without a waiting writer.
                    await sql("select pg_sleep(4)");
                    writer = actor(
                        peer,
                        `set local application_name=${q(acceptTag)};select public.respond_job_substitution(${q(offer.id)},'accept',${q(offer.quote_hash)},${q(randomUUID())},true)`,
                    );
                    const settled = Promise.allSettled([holder, writer]);
                    await barrier(acceptTag, "wait_event_type='Lock'", 500);
                    assert.equal(
                        await sql(
                            `select a.query_start < (select min(starts_at)-interval '168 hours' from public.assignment_sessions where claim_id=${q(fixture.claim)}) from pg_stat_activity a where a.datname=current_database() and a.application_name=${q(acceptTag)} and a.wait_event_type='Lock'`,
                        ),
                        "t",
                        "The blocked acceptance statement actually started outside the cutoff",
                    );
                    // PostgreSQL's own clock controls the transition: no application clock
                    // or synthetic time override, and no second mutation of accepted terms.
                    await sql(
                        `select pg_sleep(greatest(0,extract(epoch from ((select min(starts_at)-interval '168 hours' from public.assignment_sessions where claim_id=${q(fixture.claim)})-clock_timestamp()))+0.05))`,
                    );
                    assert.equal(
                        await sql(
                            `select min(starts_at)<=clock_timestamp()+interval '168 hours' from public.assignment_sessions where claim_id=${q(fixture.claim)}`,
                        ),
                        "t",
                        "The real cutoff passed before releasing the row lock",
                    );
                    assert.equal(
                        await sql(
                            `select coalesce(bool_or(pg_cancel_backend(pid)),false) from pg_stat_activity where datname=current_database() and application_name=${q(lockTag)} and wait_event='PgSleep'`,
                        ),
                        "t",
                        "The exact fixture lock holder was released",
                    );
                    const results = await settled;
                    assert.equal(results[0].status, "rejected");
                    assert.match(results[0].reason.message, /57014|canceling statement/i);
                    assert.equal(results[1].status, "rejected");
                    assert.match(
                        results[1].reason.message,
                        /22023:[^\n]*Short-notice withdrawal/,
                    );
                    assert.equal(await handoverSnapshot(fixture), before);
                } finally {
                    // Cleanup only this test's tagged connection even after an assertion failure.
                    await sql(
                        `select pg_cancel_backend(pid) from pg_stat_activity where datname=current_database() and application_name=${q(lockTag)} and pid<>pg_backend_pid()`,
                    ).catch(() => {
                    });
                    await holderResult;
                    if (writer) await Promise.allSettled([writer]);
                }
            },
        );
        console.log(`${checks} withdrawal SQL groups passed`);
    },
);