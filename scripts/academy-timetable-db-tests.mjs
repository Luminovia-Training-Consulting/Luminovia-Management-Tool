/** Exercise the dedicated timetable with exact course memberships and civil-date windows. */
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { academyTimetableSchema } from "../src/features/learning/academy-timetable-schema.ts";
import { prepareAcademyInstallation } from "./academy-installation.mjs";
import { signAcademyLicence } from "./academy-licence.mjs";
import { quoteSql as q, withTestDatabase } from "./testing/database.mjs";

const endpoint = "academy_timetable";
const gate = (name, method = "POST") =>
  `set local request.path=${q("/rpc/" + name)};set local request.method=${q(method)};select public.require_portal_access();`;
const date = (value) => value.toISOString().slice(0, 10);
const year = new Date().getUTCFullYear() + 2;
const marchEnding = new Date(Date.UTC(year, 3, 0));
const springSunday = 31 - marchEnding.getUTCDay();
const day = date(new Date(Date.UTC(year, 2, springSunday)));
const before = date(new Date(Date.UTC(year, 2, springSunday - 1)));
const after = date(new Date(Date.UTC(year, 2, springSunday + 1)));

for (const edition of ["customer-self-hosted", "customer-managed"]) {
  await withTestDatabase("academy_timetable", async ({ sql, actor }) => {
    const [
      installation,
      manager,
      lecturer,
      client,
      foreignClient,
      learner,
      outsider,
      org,
      otherOrg,
      template,
      otherTemplate,
      run,
      otherRun,
      archivedRun,
      overnight,
      transition,
      priorLocalDay,
      honoluluMidnight,
      archive,
    ] = Array.from({ length: 19 }, randomUUID);
    const now = Date.now();
    const time = (days) => new Date(now + days * 86_400_000).toISOString();
    const terms = {
      installation_id: installation,
      edition,
      release_commit: "ab".repeat(20),
      issued_at: time(-7),
      starts_at: time(-6),
      expires_at: time(3),
      grace_until: time(4),
      modules: ["lms"],
      limits: {
        seat_count: 30,
        storage_bytes: 2_000_000,
        api_requests_per_minute: 60,
      },
    };
    const keys = generateKeyPairSync("ed25519");
    await prepareAcademyInstallation(
      {
        envelope: signAcademyLicence(terms, keys.privateKey),
        publicKey: keys.publicKey,
        expected: terms,
      },
      sql,
    );
    const configure = (enabled) =>
      sql(
        `select private.configure_academy_course_access(${q(installation)},${q(terms.release_commit)},${enabled})`,
      );
    const licence = (change) =>
      sql(
        `select private.apply_verified_installation_licence(${q(JSON.stringify({ ...terms, ...change }))}::jsonb)`,
      );

    const accounts = [
      [manager, "admin"],
      [lecturer, "lecturer"],
      [client, "client"],
      [foreignClient, "client"],
      [learner, "participant"],
      [outsider, "lecturer"],
    ];
    const membership = randomUUID();
    await sql(`insert into auth.users(id,email,email_confirmed_at) values
      ${accounts.map(([id]) => `(${q(id)},${q(id + "@example.invalid")},now())`).join(",")};
      insert into public.user_roles(user_id,role) values
      ${accounts.map(([id, role]) => `(${q(id)},${q(role)})`).join(",")};
      insert into public.organisations(id,name) values(${q(org)},'Fictional Academy'),(${q(otherOrg)},'Fictional other academy');
      insert into public.client_organisation_memberships(organisation_id,user_id) values (${q(org)},${q(client)}),(${q(otherOrg)},${q(foreignClient)});
      insert into public.course_templates(id,title) values(${q(template)},'Fictional Berlin course'),(${q(otherTemplate)},'Fictional Honolulu course');
      insert into public.course_runs(id,template_id,organisation_id,time_zone,venue,archived_at) values
        (${q(run)},${q(template)},${q(org)},'Europe/Berlin','Fictional classroom',null),
        (${q(otherRun)},${q(otherTemplate)},${q(otherOrg)},'Pacific/Honolulu','',null),
        (${q(archivedRun)},${q(template)},${q(org)},'Europe/Berlin','',now());
      insert into public.course_sessions(id,course_run_id,starts_at,ends_at) values
        (${q(overnight)},${q(run)},${q(before + "T22:30:00Z")},${q(day + "T00:30:00Z")}),
        (${q(transition)},${q(run)},${q(day + "T00:45:00Z")},${q(day + "T02:00:00Z")}),
        (${q(priorLocalDay)},${q(otherRun)},${q(day + "T09:30:00Z")},${q(day + "T09:55:00Z")}),
        (${q(honoluluMidnight)},${q(otherRun)},${q(day + "T10:00:00Z")},${q(day + "T11:00:00Z")}),
        (${q(archive)},${q(archivedRun)},${q(day + "T08:00:00Z")},${q(day + "T09:00:00Z")});
      insert into private.company_participant_link_requests(id,organisation_id,requested_by,request_id,luminovia_user_id,target_user_id,status,expires_at)
        select ${q(membership)},${q(org)},${q(manager)},${q(randomUUID())},luminovia_user_id,id,'accepted',now()+interval '1 day'
        from public.profiles where id=${q(learner)};
      insert into private.company_participant_memberships(organisation_id,user_id,status,link_request_id,invited_by,joined_at)
        values(${q(org)},${q(learner)},'active',${q(membership)},${q(manager)},now());
      insert into public.course_enrolments(course_run_id,user_id,enrolled_by,status) values
        (${q(run)},${q(learner)},${q(manager)},'enrolled');
      insert into public.personal_events(user_id,title,starts_at,ends_at) values
        (${q(manager)},'Fictional private event',${q(day + "T08:00:00Z")},${q(day + "T09:00:00Z")});
      insert into public.global_events(title,starts_at,ends_at,published) values
        ('Fictional internal event',${q(day + "T08:00:00Z")},${q(day + "T09:00:00Z")},true);`);

    const read = (
      who,
      { from = day, until = day, method = "POST", cursor } = {},
    ) =>
      actor(
        who,
        gate(endpoint, method) +
          `select public.academy_timetable(${q(from)},${q(until)}${cursor ? `,${q(cursor.start)},${q(cursor.id)}` : ""})`,
      )
        .then(JSON.parse)
        .then((value) => academyTimetableSchema.parse(value));
    const ids = ({ rows }) => rows.map((row) => row.session_id);

    await assert.rejects(read(manager), /42501/);
    await assert.rejects(
      actor(manager, `select public.academy_timetable(${q(day)},${q(day)})`),
      /42501/,
    );
    await configure(true);
    const assignment = await actor(
      manager,
      gate("academy_assign_course_instructor") +
        `select public.academy_assign_course_instructor(${q(run)},${q(lecturer)},${q(randomUUID())})`,
    ).then(JSON.parse);
    assert.equal(assignment.status, "confirmed");

    assert.deepEqual(ids(await read(manager)), [
      overnight,
      transition,
      honoluluMidnight,
    ]);
    assert.deepEqual(ids(await read(client)), [overnight, transition]);
    assert.deepEqual(ids(await read(lecturer, { method: "GET" })), [
      overnight,
      transition,
    ]);
    assert.deepEqual(ids(await read(foreignClient)), [honoluluMidnight]);
    assert.deepEqual(ids(await read(outsider)), []);
    const learnerSchedule = await read(learner);
    assert.deepEqual(ids(learnerSchedule), [overnight, transition]);
    assert.equal(learnerSchedule.rows[0].local_day, day);
    assert.equal(learnerSchedule.rows[0].time_zone, "Europe/Berlin");
    assert.equal(
      new Date(learnerSchedule.rows[0].starts_at).toISOString(),
      before + "T22:30:00.000Z",
    );
    assert.equal(
      new Date(learnerSchedule.rows[1].ends_at).toISOString(),
      day + "T02:00:00.000Z",
    );
    assert.deepEqual(
      ids(await read(learner, { from: before, until: before })),
      [overnight],
    );
    assert.deepEqual(
      ids(await read(learner, { from: after, until: after })),
      [],
    );
    assert.deepEqual(
      ids(await read(foreignClient, { from: before, until: before })),
      [priorLocalDay],
    );
    await assert.rejects(read(manager, { from: after, until: day }), /22023/);
    await assert.rejects(
      read(manager, { from: `${year}-03-01`, until: `${year}-04-01` }),
      /22023/,
    );
    await assert.rejects(read(manager, { until: "infinity" }), /22023/);
    await assert.rejects(read(manager, { method: "PATCH" }), /42501/);
    await assert.rejects(
      actor(
        manager,
        gate(endpoint) +
          `select public.academy_timetable(${q(day)},${q(day)},${q(day + "T00:00:00Z")})`,
      ),
      /22023/,
    );

    await sql(`update public.client_organisation_memberships set removed_at=now()
      where user_id=${q(client)} and organisation_id=${q(org)};
      update private.company_participant_memberships set status='removed',removed_at=now()
      where user_id=${q(learner)} and organisation_id=${q(org)};`);
    assert.deepEqual(ids(await read(learner)), []);
    assert.deepEqual(ids(await read(client)), []);
    await actor(
      manager,
      gate("academy_release_course_instructor") +
        `select public.academy_release_course_instructor(${q(run)},${q(assignment.claim_id)},'Fictional teaching allocation ended',${q(randomUUID())})`,
    );
    assert.deepEqual(ids(await read(lecturer)), []);
    await sql(
      `update public.organisations set archived_at=now() where id=${q(otherOrg)};`,
    );
    assert.deepEqual(ids(await read(manager)), [overnight, transition]);

    await sql(`insert into public.course_sessions(course_run_id,starts_at,ends_at)
      select ${q(run)},${q(day + "T10:00:00Z")},${q(day + "T11:00:00Z")} from generate_series(1,103);`);
    const page1 = await read(manager);
    assert.equal(page1.rows.length, 100);
    assert.equal(page1.next.id, page1.rows.at(-1).session_id);
    const page2 = await read(manager, { cursor: page1.next });
    assert.equal(page2.rows.length, 5);
    assert.equal(page2.next, null);
    assert.equal(new Set([...ids(page1), ...ids(page2)]).size, 105);

    await configure(false);
    await assert.rejects(read(manager), /42501/);
    await configure(true);
    await licence({ issued_at: time(-6), expires_at: time(-2) });
    assert.deepEqual(await read(manager), page1);
    await licence({
      issued_at: time(-5),
      starts_at: time(-5),
      expires_at: time(-2),
      grace_until: time(-1),
    });
    await assert.rejects(read(manager), /42501/);
    console.log(
      `PASS ${edition} timetable role scopes, DST civil-day overlaps, revocation, grace and stable pagination`,
    );
  });
}
