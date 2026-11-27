/** Validate the downloaded profile API schemas with committed PostgreSQL results. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {portalOpenApi} from "../src/features/developer-api/contract.ts";
import {quoteSql as q, withTestDatabase} from "./testing/database.mjs";

const {paths} = portalOpenApi("https://example.invalid", true);
const names = new Set();
const parameter = (value) => {
    if (value === null) return "null";
    if (typeof value === "object") return `${q(JSON.stringify(value))}::jsonb`;
    return typeof value === "string" ? q(value) : String(value);
};

await withTestDatabase("profile_contract", async ({sql, actor}) => {
    const teacher = randomUUID();
    const peer = randomUUID();
    const manager = randomUUID();
    const topic = randomUUID();
    await sql(`insert into auth.users(id,email) values (${q(teacher)},'teacher@example.invalid'),(${q(peer)},null),(${q(manager)},'manager@example.invalid');
        insert into public.user_roles(user_id,role)
          values (${q(teacher)},'lecturer'),(${q(peer)},'lecturer'),(${q(manager)},'management');
        insert into public.topics(id,label_de,label_en,kind) values (${q(topic)},'Fiktives Thema','Fictional topic','topic');
        insert into public.lecturer_topics(user_id,topic_id,verified) values (${q(teacher)},${q(topic)},true);
        update public.profiles set phone='+49 40 123456' where id=${q(teacher)};`);

    const call = async (who, name, input = {}) => {
        const operation = paths[`/rest/v1/rpc/${name}`].post;
        const request =
            operation.requestBody.content["application/json"].schema;
        assert.deepEqual(z.fromJSONSchema(request).parse(input), input, name);
        const args = Object.entries(input).map(
            ([key, value]) => `${key} => ${parameter(value)}`,
        );
        const raw = await actor(
            who,
            `select public.${name}(${args.join(",")})`,
        );
        names.add(name);
        const response =
            operation.responses["200"]?.content["application/json"].schema;
        if (!response) {
            assert.ok(operation.responses["204"], name);
            assert.equal(raw, "", name);
            return;
        }
        const actual = JSON.parse(raw || "null");
        assert.deepEqual(
            z.fromJSONSchema(response).parse(actual),
            actual,
            name,
        );
        return actual;
    };

    const defaultDetails = {
        country: "",
        languages: [],
        teaching_experience: "",
        teaching_minutes: 0,
        labels: [],
    };
    assert.deepEqual(
        await call(teacher, "own_profile_details"),
        defaultDetails,
    );
    await call(teacher, "save_profile_details", {
        p_payload: {
            country: " Germany ",
            labels: [" Python ", "python"],
            languages: ["Deutsch"],
        },
    });
    assert.deepEqual(await call(teacher, "own_profile_details"), {
        ...defaultDetails,
        country: "Germany",
        labels: ["Python"],
        languages: ["Deutsch"],
    });
    await call(teacher, "save_profile_details", {p_payload: {country: null}});
    assert.deepEqual(
        await call(teacher, "own_profile_details"),
        defaultDetails,
    );

    const target = {p_user_id: teacher};
    const profile = (who) => call(who, "person_profile", target);
    const directory = (input) => call(peer, "people_directory", input);
    assert.equal((await profile(peer)).topics[0].verified, true);
    assert.equal((await profile(peer)).can_moderate, false);
    assert.equal((await call(manager, "own_profile_details")).teaching_minutes, null);
    const work = [
        [teacher, "approved", 1, 15],
        [teacher, "submitted", 2, 0],
        [teacher, "rejected", 3, 0],
        [peer, "approved", 4, 0],
        [teacher, "approved", 5, 30, "cancelled"],
        [teacher, "approved", 6, 20, "completed"],
        [teacher, "submitted", 7, 0, "partial"],
    ];
    for (const [lecturer, state, day, pause, outcome] of work) {
        const job = randomUUID(), claim = randomUUID(), session = randomUUID();
        const start = q(`2020-05-0${day} 09:00:00+00`);
        const end = q(`2020-05-0${day} 11:00:00+00`);
        await sql(`insert into public.jobs(id,title,customer_name,delivery_type,status,amount,total_amount,currency,rate_unit,terms)
          values (${q(job)},'Fictional completed assignment','Fictional academy','online','filled',100,100,'EUR','fixed_total','Fixture');
          insert into public.job_claims(id,job_id,lecturer_id,idempotency_key,amount,total_amount,currency,rate_unit,terms,terms_version)
          values (${q(claim)},${q(job)},${q(lecturer)},${q(randomUUID())},100,100,'EUR','fixed_total','Fixture',1);
          insert into public.assignment_sessions(id,claim_id,lecturer_id,starts_at,ends_at)
          values (${q(session)},${q(claim)},${q(lecturer)},${start},${end});
          insert into private.teaching_timesheets(id,session_id,lecturer_id,starts_at,ends_at,break_minutes,state)
          values (gen_random_uuid(),${q(session)},${q(lecturer)},${start},${end},${pause},${q(state)});`);
        if (outcome) {
            const revision = randomUUID();
            const [actualStart, actualEnd] = outcome === "cancelled" ? ["null", "null"] : [start, end];
            await sql(`insert into private.delivery_records(session_id,status)
              values (${q(session)},'confirmed');
              insert into private.delivery_submissions(id,session_id,revision,lecturer_id,outcome,
                actual_start,actual_end,time_zone,notes,correction_reason,scheduled_start,scheduled_end)
              values (${q(revision)},${q(session)},1,${q(lecturer)},${q(outcome)},
                ${actualStart},${actualEnd},'UTC','','',${start},${end});
              update private.delivery_records set latest_submission_id = ${q(revision)} where session_id = ${q(session)};`);
        }
    }
    assert.equal((await call(teacher, "own_profile_details")).teaching_minutes, 325);
    assert.equal((await profile(peer)).teaching_minutes, 325);
    assert.equal((await call(peer, "own_profile_details")).teaching_minutes, 120);
    await assert.rejects(actor(peer, `select private.lecturer_delivery_minutes(${q(teacher)})`), /42501/);
    const listing = (await directory({p_topic_id: topic})).find(
        ({id}) => id === teacher,
    );
    assert.equal(listing.review_count, 0);
    assert.equal(listing.rating_average, 0);
    assert.deepEqual(await directory({p_search: "missing-741c2"}), []);
    assert.deepEqual(await call(teacher, "profile_topic_preferences"), {
        visible: true,
        can_share: true,
        version: 0,
    });
    assert.deepEqual(
        await call(teacher, "save_profile_topic_preferences", {
            p_visible: false,
            p_expected_version: 0,
        }),
        {visible: false, can_share: true, version: 1},
    );
    assert.deepEqual((await profile(peer)).topics, []);
    assert.equal((await profile(manager)).topics[0].id, topic);
    assert.deepEqual(await directory({p_topic_id: topic}), []);
    assert.equal(
        (await directory()).some(({id}) => id === teacher),
        true,
    );
    await assert.rejects(
        call(teacher, "save_profile_topic_preferences", {
            p_visible: true,
            p_expected_version: 0,
        }),
        /40001/,
    );

    assert.deepEqual(await call(peer, "person_contact", target), {
        email: null,
        phone: null,
    });
    assert.deepEqual(await call(peer, "person_contact", {p_user_id: null}), {
        email: null,
        phone: null,
    });
    assert.equal(
        (await call(peer, "contact_visibility_preferences")).email_address,
        null,
    );
    assert.equal(
        (await call(teacher, "contact_visibility_preferences")).version,
        0,
    );
    const enableEmail = {
        p_payload: {email_visible: true, phone_visible: false},
        p_expected_version: 0,
    };
    assert.equal(
        (
            await call(
                teacher,
                "save_contact_visibility_preferences",
                enableEmail,
            )
        ).version,
        1,
    );
    assert.deepEqual(await call(peer, "person_contact", target), {
        email: "teacher@example.invalid",
        phone: null,
    });
    await assert.rejects(
        call(teacher, "save_contact_visibility_preferences", enableEmail),
        /PT409/,
    );

    const before = await call(manager, "managed_profile", target);
    const update = {
        ...target,
        p_payload: {
            display_name: "Fictional teacher",
            locale: "en",
            time_zone: "Australia/Brisbane",
        },
        p_expected: before,
    };
    assert.deepEqual(
        await call(manager, "save_managed_profile", update),
        update.p_payload,
    );
    await assert.rejects(
        call(manager, "save_managed_profile", update),
        /40001/,
    );
    await assert.rejects(call(peer, "managed_profile", target), /42501/);

    assert.equal(await call(peer, "profile_avatar", target), null);
    const image = JSON.parse(
        await actor(
            teacher,
            `select public.reserve_document('avatar.png','image/png',200,'personal','avatar',null,null,${q(randomUUID())})`,
        ),
    );
    await sql(`update public.document_versions set status='clean',sha256=repeat('a', 64),scanner_version='Fictional fixture' where id=${q(image.version_id)};
        update public.documents set status='clean' where id=${q(image.document_id)};`);
    const selected = await call(teacher, "set_profile_avatar", {
        p_version_id: image.version_id,
    });
    assert.equal(selected.version_id, image.version_id);
    assert.deepEqual(await call(peer, "profile_avatar", target), selected);
    assert.equal(await call(teacher, "set_profile_avatar"), null);
    assert.equal(await call(peer, "profile_avatar", target), null);

    assert.equal(names.size, 13);
    console.log(
        `PASS ${names.size} profile and people OpenAPI operations match native PostgreSQL results, including protected and nullable projections`,
    );
});
